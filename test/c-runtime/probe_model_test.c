#include <assert.h>
#include <errno.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

#include <cautest/probe_abi.h>

#define MODEL_CAPACITY 3U

struct model_queue {
	struct cautest_probe_event_record events[MODEL_CAPACITY];
	unsigned int head;
	unsigned int count;
	uint64_t next_sequence;
	uint64_t dropped;
	uint64_t seen_dropped;
	int registered;
	int selected;
};

static int model_register(struct model_queue *queue)
{
	if (queue->registered)
		return -EEXIST;
	queue->registered = 1;
	return 0;
}

static int model_select(struct model_queue *queue)
{
	if (!queue->registered)
		return -ENOENT;
	if (queue->selected)
		return -EBUSY;
	queue->selected = 1;
	return 0;
}

static int model_unregister(struct model_queue *queue)
{
	if (!queue->registered)
		return -ENOENT;
	queue->registered = 0;
	return 0;
}

static int model_emit(struct model_queue *queue, uint32_t kind,
		      const void *payload, uint16_t length)
{
	struct cautest_probe_event_record *event;
	unsigned int tail;

	if (length > CAUTEST_PROBE_PAYLOAD_MAX || (length && !payload))
		return -EINVAL;
	if (queue->count == MODEL_CAPACITY) {
		queue->dropped++;
		return -ENOSPC;
	}
	tail = (queue->head + queue->count) % MODEL_CAPACITY;
	event = &queue->events[tail];
	memset(event, 0, sizeof(*event));
	event->header.abi_major = CAUTEST_PROBE_ABI_MAJOR;
	event->header.abi_minor = CAUTEST_PROBE_ABI_MINOR;
	event->header.struct_size = sizeof(*event);
	event->kind = kind;
	event->sequence = queue->next_sequence++;
	event->payload_length = length;
	if (length)
		memcpy(event->payload, payload, length);
	queue->count++;
	return 0;
}

static int model_read(struct model_queue *queue,
		      struct cautest_probe_event_record *event)
{
	if (queue->dropped != queue->seen_dropped) {
		queue->seen_dropped = queue->dropped;
		return -EOVERFLOW;
	}
	if (!queue->count)
		return -EAGAIN;
	*event = queue->events[queue->head];
	queue->head = (queue->head + 1) % MODEL_CAPACITY;
	queue->count--;
	return 0;
}

static void model_reset(struct model_queue *queue)
{
	int registered = queue->registered;
	int selected = queue->selected;

	memset(queue, 0, sizeof(*queue));
	queue->registered = registered;
	queue->selected = selected;
}

int main(void)
{
	struct model_queue queue = { 0 };
	struct cautest_probe_event_record event;
	const unsigned char one[] = { 1 };
	const unsigned char two[] = { 2, 3 };
	unsigned char oversized[CAUTEST_PROBE_PAYLOAD_MAX + 1];

	/* ABI layout 是跨位数固定的，不允许悄悄引入用户指针或 padding 漂移。 */
	assert(sizeof(struct cautest_probe_abi_header) == 8);
	assert(sizeof(struct cautest_probe_select) == 72);
	assert(sizeof(struct cautest_probe_dropped) == 16);
	assert(sizeof(struct cautest_probe_event_record) == 160);
	assert(sizeof(struct cautest_probe_info) == 40);
	assert(_IOC_SIZE(CAUTEST_PROBE_IOCTL_SELECT) ==
	       sizeof(struct cautest_probe_select));
	assert(model_register(&queue) == 0);
	assert(model_register(&queue) == -EEXIST);
	assert(model_select(&queue) == 0);
	assert(model_select(&queue) == -EBUSY);

	assert(model_emit(&queue, 10, one, sizeof(one)) == 0);
	assert(model_emit(&queue, 11, two, sizeof(two)) == 0);
	assert(model_emit(&queue, 12, NULL, 0) == 0);
	assert(model_emit(&queue, 13, one, sizeof(one)) == -ENOSPC);
	assert(queue.dropped == 1);
	/* Overflow 先产生 ERROR，再允许消费仍然有序的旧事件。 */
	assert(model_read(&queue, &event) == -EOVERFLOW);
	assert(model_read(&queue, &event) == 0);
	assert(event.kind == 10 && event.sequence == 0 && event.payload[0] == 1);
	assert(model_read(&queue, &event) == 0);
	assert(event.kind == 11 && event.sequence == 1 && event.payload_length == 2);
	assert(model_read(&queue, &event) == 0);
	assert(event.kind == 12 && event.sequence == 2);
	assert(model_read(&queue, &event) == -EAGAIN);
	assert(model_emit(&queue, 1, oversized, sizeof(oversized)) == -EINVAL);

	model_reset(&queue);
	assert(queue.count == 0 && queue.dropped == 0 && queue.next_sequence == 0);
	/* 注销立即停止发现，已选中 fd 的引用可以延迟释放。 */
	assert(model_unregister(&queue) == 0);
	assert(model_unregister(&queue) == -ENOENT);
	puts("probe ABI/queue model: PASS");
	return 0;
}
