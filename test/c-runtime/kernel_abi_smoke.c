#define _GNU_SOURCE

#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <sys/ioctl.h>
#include <unistd.h>

#include <cautest/kernel_abi.h>

#define CHECK(expression_) \
	do { \
		if (!(expression_)) { \
			fprintf(stderr, "检查失败：%s:%d: %s\n", __FILE__, __LINE__, \
				#expression_); \
			return 1; \
		} \
	} while (0)

static struct cautest_kernel_abi_header header(size_t size)
{
	struct cautest_kernel_abi_header value;
	value.abi_major = CAUTEST_KERNEL_ABI_MAJOR;
	value.abi_minor = CAUTEST_KERNEL_ABI_MINOR;
	value.struct_size = (__u32)size;
	return value;
}

/* Guest Agent 可使用相同规则解析 read(2) 返回的固定边界记录。 */
static int parse_event(const unsigned char *data, size_t size,
		       struct cautest_kernel_event_record *event)
{
	struct cautest_kernel_abi_header prefix;

	if (size < sizeof(prefix))
		return -1;
	memcpy(&prefix, data, sizeof(prefix));
	if (prefix.abi_major != CAUTEST_KERNEL_ABI_MAJOR ||
	    prefix.abi_minor > CAUTEST_KERNEL_ABI_MINOR ||
	    prefix.struct_size != sizeof(*event) || size != prefix.struct_size)
		return -1;
	memcpy(event, data, sizeof(*event));
	return 0;
}

static int structural_smoke(void)
{
	struct cautest_kernel_event_record source;
	struct cautest_kernel_event_record parsed;

	CHECK(sizeof(struct cautest_kernel_abi_header) == 8U);
	CHECK(offsetof(struct cautest_kernel_info, active_run_id) % 8U == 0U);
	CHECK(offsetof(struct cautest_kernel_event_record, run_id) % 8U == 0U);
	CHECK(offsetof(struct cautest_kernel_event_record, sequence) == 24U);
	CHECK(_IOC_SIZE(CAUTEST_KERNEL_IOCTL_INFO) ==
	      sizeof(struct cautest_kernel_info));
	CHECK(_IOC_SIZE(CAUTEST_KERNEL_IOCTL_LIST) ==
	      sizeof(struct cautest_kernel_list));
	CHECK(_IOC_SIZE(CAUTEST_KERNEL_IOCTL_RUN) ==
	      sizeof(struct cautest_kernel_run));
	CHECK(_IOC_SIZE(CAUTEST_KERNEL_IOCTL_CANCEL) ==
	      sizeof(struct cautest_kernel_cancel));

	memset(&source, 0, sizeof(source));
	source.header = header(sizeof(source));
	source.type = CAUTEST_KERNEL_EVENT_RUN_END;
	source.flags = CAUTEST_KERNEL_EVENT_F_FINAL;
	source.run_id = UINT64_C(0x1020304050607080);
	source.sequence = 9;
	source.status = 2;
	memcpy(source.registry, "parser-smoke", sizeof("parser-smoke"));
	CHECK(parse_event((const unsigned char *)&source, sizeof(source), &parsed) == 0);
	CHECK(parsed.run_id == source.run_id);
	CHECK(parsed.flags == CAUTEST_KERNEL_EVENT_F_FINAL);
	CHECK(strcmp(parsed.registry, "parser-smoke") == 0);
	CHECK(parse_event((const unsigned char *)&source, sizeof(source) - 1, &parsed) < 0);
	source.header.abi_major++;
	CHECK(parse_event((const unsigned char *)&source, sizeof(source), &parsed) < 0);
	return 0;
}

static int device_smoke(const char *path)
{
	struct cautest_kernel_info info;
	struct cautest_kernel_list list;
	struct cautest_kernel_list selected;
	struct cautest_kernel_list cancel_selection;
	struct cautest_kernel_run run;
	struct cautest_kernel_cancel cancel;
	struct pollfd descriptor;
	unsigned int case_starts;
	unsigned int final_events;
	int have_cancel = 0;
	int fd;

	fd = open(path, O_RDWR | O_CLOEXEC);
	if (fd < 0) {
		perror("open /dev/cautest");
		return 1;
	}
	memset(&info, 0, sizeof(info));
	info.header = header(sizeof(info));
	CHECK(ioctl(fd, CAUTEST_KERNEL_IOCTL_INFO, &info) == 0);
	CHECK(info.magic == CAUTEST_KERNEL_ABI_MAGIC);
	CHECK((info.capabilities & CAUTEST_KERNEL_CAP_POLL) != 0);
	printf("ABI %u.%u, registries=%u, descriptors=%u\n",
	       info.header.abi_major, info.header.abi_minor,
	       info.registry_count, info.descriptor_count);
	if (!info.descriptor_count) {
		close(fd);
		return 0;
	}

	memset(&list, 0, sizeof(list));
	list.header = header(sizeof(list));
	CHECK(ioctl(fd, CAUTEST_KERNEL_IOCTL_LIST, &list) == 0);
	selected = list;
	for (;;) {
		printf("LIST [%u] %s/%s/%s\n", list.descriptor_id,
		       list.registry, list.suite, list.case_name);
		if (strcmp(list.case_name, "kernel_cancel") == 0) {
			cancel_selection = list;
			have_cancel = 1;
		}
		if (list.next_cursor == CAUTEST_KERNEL_CURSOR_END)
			break;
		list.cursor = list.next_cursor;
		CHECK(ioctl(fd, CAUTEST_KERNEL_IOCTL_LIST, &list) == 0);
	}

	memset(&run, 0, sizeof(run));
	run.header = header(sizeof(run));
	run.header.abi_minor = 0;
	run.registry_id = selected.registry_id;
	run.selection_flags = CAUTEST_KERNEL_RUN_SELECT_ONE;
	run.descriptor_id = selected.descriptor_id;
	errno = 0;
	CHECK(ioctl(fd, CAUTEST_KERNEL_IOCTL_RUN, &run) == -1);
	CHECK(errno == EPROTONOSUPPORT);

	run.header = header(sizeof(run));
	run.selection_flags = 0;
	errno = 0;
	CHECK(ioctl(fd, CAUTEST_KERNEL_IOCTL_RUN, &run) == -1);
	CHECK(errno == EINVAL);

	run.selection_flags = CAUTEST_KERNEL_RUN_SELECT_ONE;
	run.descriptor_id = UINT32_MAX;
	errno = 0;
	CHECK(ioctl(fd, CAUTEST_KERNEL_IOCTL_RUN, &run) == -1);
	CHECK(errno == EINVAL);

	run.descriptor_id = selected.descriptor_id;
	CHECK(ioctl(fd, CAUTEST_KERNEL_IOCTL_RUN, &run) == 0);
	descriptor.fd = fd;
	descriptor.events = POLLIN;
	case_starts = 0;
	final_events = 0;
	for (;;) {
		struct cautest_kernel_event_record event;
		ssize_t count;
		CHECK(poll(&descriptor, 1, 5000) == 1);
		count = read(fd, &event, sizeof(event));
		CHECK(count == (ssize_t)sizeof(event));
		CHECK(event.header.abi_major == CAUTEST_KERNEL_ABI_MAJOR);
		CHECK(event.run_id == run.run_id);
		if (event.type == CAUTEST_KERNEL_EVENT_CASE_START) {
			case_starts++;
			CHECK(strcmp(event.case_name, selected.case_name) == 0);
		}
		if (event.flags & CAUTEST_KERNEL_EVENT_F_FINAL) {
			final_events++;
			break;
		}
	}
	CHECK(case_starts == 1U);
	CHECK(final_events == 1U);

	if (have_cancel) {
		memset(&run, 0, sizeof(run));
		run.header = header(sizeof(run));
		run.registry_id = cancel_selection.registry_id;
		run.selection_flags = CAUTEST_KERNEL_RUN_SELECT_ONE;
		run.descriptor_id = cancel_selection.descriptor_id;
		/* 前一 run 的 FINAL 可能先于 worker 的收尾，短暂重试 EBUSY。 */
		for (;;) {
			if (ioctl(fd, CAUTEST_KERNEL_IOCTL_RUN, &run) == 0)
				break;
			CHECK(errno == EBUSY);
			usleep(1000);
		}
		cancel.header = header(sizeof(cancel));
		cancel.run_id = run.run_id + 1;
		errno = 0;
		CHECK(ioctl(fd, CAUTEST_KERNEL_IOCTL_CANCEL, &cancel) == -1);
		CHECK(errno == ENOENT);
		cancel.run_id = run.run_id;
		CHECK(ioctl(fd, CAUTEST_KERNEL_IOCTL_CANCEL, &cancel) == 0);
		final_events = 0;
		for (;;) {
			struct cautest_kernel_event_record event;
			CHECK(poll(&descriptor, 1, 5000) == 1);
			CHECK(read(fd, &event, sizeof(event)) == (ssize_t)sizeof(event));
			CHECK(event.run_id == run.run_id);
			if (event.flags & CAUTEST_KERNEL_EVENT_F_FINAL) {
				final_events++;
				CHECK(event.type == CAUTEST_KERNEL_EVENT_ERROR);
				CHECK(event.status == 3U);
				CHECK(event.error == CAUTEST_KERNEL_ERROR_CANCELLED);
				break;
			}
		}
		CHECK(final_events == 1U);
	}
	close(fd);
	return 0;
}

int main(int argc, char **argv)
{
	if (structural_smoke())
		return 1;
	if (argc == 2)
		return device_smoke(argv[1]);
	puts("kernel ABI/parser smoke: PASS");
	return 0;
}
