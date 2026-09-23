#include <linux/atomic.h>
#include <linux/errno.h>
#include <linux/fs.h>
#include <linux/kthread.h>
#include <linux/miscdevice.h>
#include <linux/module.h>
#include <linux/mutex.h>
#include <linux/poll.h>
#include <linux/sched.h>
#include <linux/spinlock.h>
#include <linux/string.h>
#include <linux/uaccess.h>
#include <linux/wait.h>

#include <cautest/cautest.h>
#include <cautest/kernel_abi.h>
#include <cautest/kernel_runtime.h>

#include "selection.h"

#ifndef CAUTEST_KERNEL_MAX_REGISTRIES
#define CAUTEST_KERNEL_MAX_REGISTRIES 16U
#endif
#ifndef CAUTEST_KERNEL_EVENT_CAPACITY
#define CAUTEST_KERNEL_EVENT_CAPACITY 128U
#endif
#ifndef CAUTEST_KERNEL_WORKSPACE_SIZE
#define CAUTEST_KERNEL_WORKSPACE_SIZE (16U * 1024U)
#endif

struct cautest_kernel_registry_slot {
	const struct cautest_registry *registry;
	struct module *owner;
	__u32 id;
};

struct cautest_kernel_runtime {
	struct mutex state_lock;
	struct cautest_kernel_registry_slot registries[CAUTEST_KERNEL_MAX_REGISTRIES];
	__u32 next_registry_id;
	struct cautest_kernel_registry_slot *active;
	struct cautest_kernel_selection selection;
	struct cautest_run_config run_config;
	__u64 active_run_id;
	__u64 next_run_id;
	__u32 run_state;
	bool cancel_open;
	atomic_t cancel_requested;

	wait_queue_head_t worker_wait;
	struct task_struct *worker;

	spinlock_t event_lock;
	struct mutex read_lock;
	wait_queue_head_t event_wait;
	struct cautest_kernel_event_record events[CAUTEST_KERNEL_EVENT_CAPACITY];
	__u32 event_head;
	__u32 event_count;
	__u32 dropped_events;
	__u32 overflow_pending;
	bool run_overflowed;
	bool overflow_terminal_ready;
	__u64 overflow_run_id;
	__u64 next_event_sequence;

	atomic_t opened;
	union {
		union cautest_workspace_alignment alignment;
		unsigned char bytes[CAUTEST_KERNEL_WORKSPACE_SIZE];
	} workspace;
};

static struct cautest_kernel_runtime cautest_runtime;

static int cautest_abi_header_valid(const struct cautest_kernel_abi_header *header,
				    size_t expected)
{
	return header->abi_major == CAUTEST_KERNEL_ABI_MAJOR &&
	       header->abi_minor <= CAUTEST_KERNEL_ABI_MINOR &&
	       header->struct_size == expected;
}

static void cautest_copy_name(char *target, size_t capacity, const char *source)
{
	if (source)
		strscpy(target, source, capacity);
	else if (capacity)
		target[0] = '\0';
}

static void cautest_copy_value(unsigned char *target, size_t capacity,
			       const void *source, unsigned long size,
			       bool text)
{
	size_t limit;
	if (!source || !capacity)
		return;
	limit = size < capacity ? size : capacity;
	if (text && limit == capacity)
		limit--;
	memcpy(target, source, limit);
	if (text)
		target[limit] = '\0';
}

static void cautest_event_initialize(struct cautest_kernel_event_record *event,
				     __u16 type, __u64 run_id)
{
	memset(event, 0, sizeof(*event));
	event->header.abi_major = CAUTEST_KERNEL_ABI_MAJOR;
	event->header.abi_minor = CAUTEST_KERNEL_ABI_MINOR;
	event->header.struct_size = sizeof(*event);
	event->type = type;
	event->run_id = run_id;
}

static void cautest_materialize_overflow_locked(void)
{
	struct cautest_kernel_event_record *event;
	__u32 tail;

	if (!cautest_runtime.overflow_pending ||
	    !cautest_runtime.overflow_terminal_ready ||
	    cautest_runtime.event_count == CAUTEST_KERNEL_EVENT_CAPACITY)
		return;
	tail = (cautest_runtime.event_head + cautest_runtime.event_count) %
	       CAUTEST_KERNEL_EVENT_CAPACITY;
	event = &cautest_runtime.events[tail];
	cautest_event_initialize(event, CAUTEST_KERNEL_EVENT_ERROR,
				 cautest_runtime.overflow_run_id);
	event->flags = CAUTEST_KERNEL_EVENT_F_FINAL;
	event->status = CAUTEST_STATUS_ERROR;
	event->error = CAUTEST_KERNEL_ERROR_EVENT_OVERFLOW;
	event->dropped_events = cautest_runtime.overflow_pending;
	event->sequence = cautest_runtime.next_event_sequence++;
	cautest_runtime.event_count++;
	cautest_runtime.overflow_pending = 0;
	cautest_runtime.overflow_terminal_ready = false;
}

static int cautest_enqueue_event(struct cautest_kernel_event_record *event)
{
	unsigned long flags;
	__u32 tail;
	int rc = 0;

	spin_lock_irqsave(&cautest_runtime.event_lock, flags);
	if (cautest_runtime.event_count == CAUTEST_KERNEL_EVENT_CAPACITY) {
		cautest_runtime.dropped_events++;
		cautest_runtime.overflow_pending++;
		cautest_runtime.run_overflowed = true;
		cautest_runtime.overflow_run_id = event->run_id;
		rc = -ENOSPC;
	} else {
		tail = (cautest_runtime.event_head + cautest_runtime.event_count) %
		       CAUTEST_KERNEL_EVENT_CAPACITY;
		event->sequence = cautest_runtime.next_event_sequence++;
		cautest_runtime.events[tail] = *event;
		cautest_runtime.event_count++;
	}
	spin_unlock_irqrestore(&cautest_runtime.event_lock, flags);
	wake_up_interruptible(&cautest_runtime.event_wait);
	return rc;
}

static __u16 cautest_core_event_type(enum cautest_event_kind kind)
{
	switch (kind) {
	case CAUTEST_EVENT_TEST_GROUP_START:
		return CAUTEST_KERNEL_EVENT_GROUP_START;
	case CAUTEST_EVENT_CASE_START:
		return CAUTEST_KERNEL_EVENT_CASE_START;
	case CAUTEST_EVENT_ASSERTION:
		return CAUTEST_KERNEL_EVENT_ASSERTION;
	case CAUTEST_EVENT_SKIP:
		return CAUTEST_KERNEL_EVENT_SKIP;
	case CAUTEST_EVENT_CASE_END:
		return CAUTEST_KERNEL_EVENT_CASE_END;
	case CAUTEST_EVENT_TEST_GROUP_END:
		return CAUTEST_KERNEL_EVENT_GROUP_END;
	case CAUTEST_EVENT_LOG:
		return CAUTEST_KERNEL_EVENT_LOG;
	case CAUTEST_EVENT_FRAMEWORK_ERROR:
	default:
		return CAUTEST_KERNEL_EVENT_ERROR;
	}
}

static int cautest_kernel_event_sink(void *context,
				     const struct cautest_event *source)
{
	struct cautest_kernel_event_record event;
	__u64 run_id = *(__u64 *)context;

	if (atomic_read(&cautest_runtime.cancel_requested))
		return -ECANCELED;
	cautest_event_initialize(&event, cautest_core_event_type(source->kind), run_id);
	event.status = source->status;
	event.error = source->framework_error == CAUTEST_FRAMEWORK_ERROR_NONE ?
		CAUTEST_KERNEL_ERROR_NONE : CAUTEST_KERNEL_ERROR_CORE;
	event.line = source->line;
	event.expected = source->expected;
	event.actual = source->actual;
	event.value_kind = source->value_kind;
	event.value_flags = source->value_flags;
	event.expected_unsigned = source->expected_unsigned;
	event.actual_unsigned = source->actual_unsigned;
	event.expected_size = source->expected_size;
	event.actual_size = source->actual_size;
	cautest_copy_value(event.expected_value, sizeof(event.expected_value),
			   source->expected_data, source->expected_size,
			   source->value_kind == CAUTEST_VALUE_STRING);
	cautest_copy_value(event.actual_value, sizeof(event.actual_value),
			   source->actual_data, source->actual_size,
			   source->value_kind == CAUTEST_VALUE_STRING);
	cautest_copy_name(event.registry, sizeof(event.registry), source->registry_name);
	cautest_copy_name(event.suite, sizeof(event.suite), source->suite_name);
	cautest_copy_name(event.case_name, sizeof(event.case_name), source->case_name);
	cautest_copy_name(event.parameter, sizeof(event.parameter), source->parameter_name);
	cautest_copy_name(event.expression, sizeof(event.expression), source->expression);
	cautest_copy_name(event.file, sizeof(event.file), source->file);
	if (source->kind == CAUTEST_EVENT_LOG) {
		event.reserved0 = source->log_level;
		cautest_copy_name(event.expression, sizeof(event.expression),
				 source->message);
	}
	return cautest_enqueue_event(&event);
}

int cautest_kernel_should_cancel(void)
{
	return atomic_read(&cautest_runtime.cancel_requested) != 0;
}
EXPORT_SYMBOL_GPL(cautest_kernel_should_cancel);

static void cautest_emit_terminal(__u64 run_id, enum cautest_status status,
				  __u32 error, int explicit_error)
{
	struct cautest_kernel_event_record event;

	cautest_event_initialize(&event,
		explicit_error ? CAUTEST_KERNEL_EVENT_ERROR : CAUTEST_KERNEL_EVENT_RUN_END,
		run_id);
	event.flags = CAUTEST_KERNEL_EVENT_F_FINAL;
	event.status = status;
	event.error = error;
	(void)cautest_enqueue_event(&event);
}

static int cautest_worker(void *unused)
{
	(void)unused;
	while (!kthread_should_stop()) {
		struct cautest_kernel_registry_slot *slot;
		struct cautest_run_result result;
		struct cautest_event_sink sink;
		struct cautest_workspace workspace;
		__u64 run_id;
		int cancelled;

		wait_event_interruptible(cautest_runtime.worker_wait,
			kthread_should_stop() ||
			READ_ONCE(cautest_runtime.run_state) == CAUTEST_KERNEL_RUN_QUEUED);
		if (kthread_should_stop())
			break;

		mutex_lock(&cautest_runtime.state_lock);
		if (cautest_runtime.run_state != CAUTEST_KERNEL_RUN_QUEUED) {
			mutex_unlock(&cautest_runtime.state_lock);
			continue;
		}
		cautest_runtime.run_state = CAUTEST_KERNEL_RUN_RUNNING;
		slot = cautest_runtime.active;
		run_id = cautest_runtime.active_run_id;
		mutex_unlock(&cautest_runtime.state_lock);

		{
			struct cautest_kernel_event_record start;
			cautest_event_initialize(&start, CAUTEST_KERNEL_EVENT_RUN_START, run_id);
			cautest_copy_name(start.registry, sizeof(start.registry),
					 slot->registry->name);
			(void)cautest_enqueue_event(&start);
		}

		workspace.data = cautest_runtime.workspace.bytes;
		workspace.capacity = sizeof(cautest_runtime.workspace.bytes);
		sink.emit = cautest_kernel_event_sink;
		sink.context = &run_id;
		(void)cautest_run(&cautest_runtime.selection.registry,
				  &cautest_runtime.run_config,
				  workspace, sink, &result);

		/*
		 * 在同一 state_lock 临界区决定 cancel 并关闭 cancel window。
		 * 因而 CANCEL 要么被这里观察，要么在 finalizing 阶段返回 -ENOENT，
		 * 不会出现 CANCEL 成功但已经发布 PASS 的竞态。
		 */
		mutex_lock(&cautest_runtime.state_lock);
		cancelled = atomic_read(&cautest_runtime.cancel_requested);
		cautest_runtime.cancel_open = false;
		mutex_unlock(&cautest_runtime.state_lock);

		if (READ_ONCE(cautest_runtime.run_overflowed)) {
			/* 溢出 ERROR 在 run 状态转回 READY 后物化为唯一终态事件。 */
		} else if (cancelled)
			cautest_emit_terminal(run_id, CAUTEST_STATUS_ERROR,
					      CAUTEST_KERNEL_ERROR_CANCELLED, 1);
		else
			cautest_emit_terminal(run_id, result.status,
					      result.framework_error == CAUTEST_FRAMEWORK_ERROR_NONE ?
					      CAUTEST_KERNEL_ERROR_NONE : CAUTEST_KERNEL_ERROR_CORE,
					      0);

		mutex_lock(&cautest_runtime.state_lock);
		cautest_runtime.active = NULL;
		cautest_runtime.active_run_id = 0;
		cautest_runtime.run_state = CAUTEST_KERNEL_RUN_READY;
		mutex_unlock(&cautest_runtime.state_lock);

		if (READ_ONCE(cautest_runtime.run_overflowed)) {
			unsigned long flags;
			spin_lock_irqsave(&cautest_runtime.event_lock, flags);
			cautest_runtime.overflow_terminal_ready = true;
			cautest_materialize_overflow_locked();
			spin_unlock_irqrestore(&cautest_runtime.event_lock, flags);
		}
		module_put(slot->owner);
		module_put(THIS_MODULE);
		wake_up_interruptible(&cautest_runtime.event_wait);
	}
	return 0;
}

int cautest_kernel_register(const struct cautest_registry *registry,
			    struct module *owner)
{
	unsigned int index;
	int free_index = -1;
	int rc = 0;

	if (!owner || cautest_registry_validate(registry) !=
		      CAUTEST_FRAMEWORK_ERROR_NONE)
		return -EINVAL;
	mutex_lock(&cautest_runtime.state_lock);
	for (index = 0; index < CAUTEST_KERNEL_MAX_REGISTRIES; ++index) {
		if (!cautest_runtime.registries[index].registry && free_index < 0)
			free_index = index;
		if (cautest_runtime.registries[index].registry == registry ||
		    (cautest_runtime.registries[index].registry &&
		     !strcmp(cautest_runtime.registries[index].registry->name,
			     registry->name))) {
			rc = -EEXIST;
			goto out;
		}
	}
	if (free_index < 0) {
		rc = -ENOSPC;
		goto out;
	}
	cautest_runtime.registries[free_index].registry = registry;
	cautest_runtime.registries[free_index].owner = owner;
	cautest_runtime.registries[free_index].id = cautest_runtime.next_registry_id++;
out:
	mutex_unlock(&cautest_runtime.state_lock);
	return rc;
}
EXPORT_SYMBOL_GPL(cautest_kernel_register);

int cautest_kernel_unregister(const struct cautest_registry *registry)
{
	unsigned int index;
	int rc = -ENOENT;

	mutex_lock(&cautest_runtime.state_lock);
	for (index = 0; index < CAUTEST_KERNEL_MAX_REGISTRIES; ++index) {
		struct cautest_kernel_registry_slot *slot =
			&cautest_runtime.registries[index];
		if (slot->registry != registry)
			continue;
		if (cautest_runtime.active == slot) {
			rc = -EBUSY;
			break;
		}
		memset(slot, 0, sizeof(*slot));
		rc = 0;
		break;
	}
	mutex_unlock(&cautest_runtime.state_lock);
	return rc;
}
EXPORT_SYMBOL_GPL(cautest_kernel_unregister);

static long cautest_ioctl_info(void __user *argument)
{
	struct cautest_kernel_info info;
	unsigned long flags;
	unsigned int index;

	if (copy_from_user(&info, argument, sizeof(info)))
		return -EFAULT;
	if (!cautest_abi_header_valid(&info.header, sizeof(info)))
		return -EPROTO;
	memset((char *)&info + sizeof(info.header), 0,
	       sizeof(info) - sizeof(info.header));
	info.header.abi_minor = CAUTEST_KERNEL_ABI_MINOR;
	info.magic = CAUTEST_KERNEL_ABI_MAGIC;
	info.capabilities = CAUTEST_KERNEL_CAP_LIST | CAUTEST_KERNEL_CAP_RUN |
			    CAUTEST_KERNEL_CAP_CANCEL | CAUTEST_KERNEL_CAP_POLL;
	info.event_capacity = CAUTEST_KERNEL_EVENT_CAPACITY;
	mutex_lock(&cautest_runtime.state_lock);
	info.run_state = cautest_runtime.run_state;
	info.active_run_id = cautest_runtime.active_run_id;
	for (index = 0; index < CAUTEST_KERNEL_MAX_REGISTRIES; ++index) {
		const struct cautest_registry *registry =
			cautest_runtime.registries[index].registry;
		if (!registry)
			continue;
		info.registry_count++;
		info.descriptor_count += cautest_registry_instance_count(registry);
	}
	mutex_unlock(&cautest_runtime.state_lock);
	spin_lock_irqsave(&cautest_runtime.event_lock, flags);
	info.event_count = cautest_runtime.event_count;
	info.dropped_events = cautest_runtime.dropped_events;
	spin_unlock_irqrestore(&cautest_runtime.event_lock, flags);
	return copy_to_user(argument, &info, sizeof(info)) ? -EFAULT : 0;
}

static int cautest_list_instance(const struct cautest_registry *registry,
				 __u32 wanted, struct cautest_kernel_list *list)
{
	unsigned long suite_index;
	__u32 instance_cursor = 0;

	for (suite_index = 0; suite_index < registry->suite_count; ++suite_index) {
		const struct cautest_suite_definition *suite = registry->suites[suite_index];
		unsigned long case_index;
		for (case_index = 0; case_index < suite->case_count; ++case_index) {
			const struct cautest_case_definition *case_definition =
				&suite->cases[case_index];
			unsigned long count = case_definition->parameter_count ?: 1UL;
			unsigned long parameter_index;
			for (parameter_index = 0; parameter_index < count;
			     ++parameter_index, ++instance_cursor) {
				const unsigned char *row;
				if (instance_cursor != wanted)
					continue;
				list->instance_index = instance_cursor;
				list->suite_id = suite_index;
				list->case_id = case_index;
				list->param_id = parameter_index;
				cautest_copy_name(list->registry, sizeof(list->registry),
						 registry->name);
				cautest_copy_name(list->suite, sizeof(list->suite), suite->name);
				cautest_copy_name(list->case_name, sizeof(list->case_name),
						 case_definition->name);
				if (case_definition->parameter_count) {
					row = (const unsigned char *)case_definition->parameter_rows +
					      parameter_index * case_definition->parameter_stride;
					cautest_copy_name(list->parameter,
							 sizeof(list->parameter),
							 *(const char *const *)row);
				}
				return 0;
			}
		}
	}
	return -ENOENT;
}

static long cautest_ioctl_list(void __user *argument)
{
	struct cautest_kernel_list list;
	__u32 global_cursor = 0;
	unsigned int index;
	int rc = -ENOENT;

	if (copy_from_user(&list, argument, sizeof(list)))
		return -EFAULT;
	if (!cautest_abi_header_valid(&list.header, sizeof(list)))
		return -EPROTO;
	mutex_lock(&cautest_runtime.state_lock);
	for (index = 0; index < CAUTEST_KERNEL_MAX_REGISTRIES; ++index) {
		struct cautest_kernel_registry_slot *slot =
			&cautest_runtime.registries[index];
		__u32 count;
		if (!slot->registry)
			continue;
		count = cautest_registry_instance_count(slot->registry);
		if (list.cursor >= global_cursor + count) {
			global_cursor += count;
			continue;
		}
		memset((char *)&list + sizeof(list.header) + sizeof(list.cursor), 0,
		       sizeof(list) - sizeof(list.header) - sizeof(list.cursor));
		list.header.abi_minor = CAUTEST_KERNEL_ABI_MINOR;
		list.registry_id = slot->id;
		rc = cautest_list_instance(slot->registry,
					   list.cursor - global_cursor, &list);
		if (!rc) {
			__u32 total = global_cursor + count;
			unsigned int rest;
			list.descriptor_id = list.instance_index;
			for (rest = index + 1; rest < CAUTEST_KERNEL_MAX_REGISTRIES;
			     ++rest)
				if (cautest_runtime.registries[rest].registry)
					total += cautest_registry_instance_count(
						cautest_runtime.registries[rest].registry);
			list.next_cursor = list.cursor + 1 < total ?
				list.cursor + 1 : CAUTEST_KERNEL_CURSOR_END;
		}
		break;
	}
	mutex_unlock(&cautest_runtime.state_lock);
	if (rc)
		return rc;
	return copy_to_user(argument, &list, sizeof(list)) ? -EFAULT : 0;
}

static long cautest_ioctl_run(void __user *argument)
{
	struct cautest_kernel_run run;
	struct cautest_kernel_registry_slot *slot = NULL;
	unsigned long flags;
	unsigned int index;
	int rc = 0;

	if (copy_from_user(&run, argument, sizeof(run)))
		return -EFAULT;
	if (!cautest_abi_header_valid(&run.header, sizeof(run)))
		return -EPROTO;
	if ((run.selection_flags != CAUTEST_KERNEL_RUN_SELECT_ONE &&
	     run.selection_flags != CAUTEST_KERNEL_RUN_SELECT_SUITE) ||
	    run.stop_policy > CAUTEST_STOP_ON_ERROR)
		return -EINVAL;
	mutex_lock(&cautest_runtime.state_lock);
	if (cautest_runtime.run_state != CAUTEST_KERNEL_RUN_READY) {
		rc = -EBUSY;
		goto out;
	}
	spin_lock_irqsave(&cautest_runtime.event_lock, flags);
	if (cautest_runtime.event_count || cautest_runtime.overflow_pending)
		rc = -EAGAIN;
	spin_unlock_irqrestore(&cautest_runtime.event_lock, flags);
	if (rc)
		goto out;
	for (index = 0; index < CAUTEST_KERNEL_MAX_REGISTRIES; ++index) {
		if (!cautest_runtime.registries[index].registry)
			continue;
		if (cautest_runtime.registries[index].id == run.registry_id) {
			slot = &cautest_runtime.registries[index];
			break;
		}
	}
	if (!slot) {
		rc = -ENOENT;
		goto out;
	}
	if ((run.selection_flags == CAUTEST_KERNEL_RUN_SELECT_ONE &&
	     cautest_kernel_select_instance(slot->registry, run.descriptor_id,
					    &cautest_runtime.selection)) ||
	    (run.selection_flags == CAUTEST_KERNEL_RUN_SELECT_SUITE &&
	     cautest_kernel_select_suite(slot->registry, run.suite_id,
					 &cautest_runtime.selection))) {
		rc = -EINVAL;
		goto out;
	}
	if (!try_module_get(slot->owner)) {
		rc = -ENODEV;
		goto out;
	}
	if (!try_module_get(THIS_MODULE)) {
		module_put(slot->owner);
		rc = -ENODEV;
		goto out;
	}
	run.run_id = cautest_runtime.next_run_id + 1;
	run.header.abi_minor = CAUTEST_KERNEL_ABI_MINOR;
	if (copy_to_user(argument, &run, sizeof(run))) {
		module_put(THIS_MODULE);
		module_put(slot->owner);
		rc = -EFAULT;
		goto out;
	}
	cautest_runtime.active = slot;
	cautest_runtime.active_run_id = run.run_id;
	cautest_runtime.next_run_id = run.run_id;
	cautest_runtime.run_config.stop_policy = run.stop_policy;
	cautest_runtime.run_state = CAUTEST_KERNEL_RUN_QUEUED;
	cautest_runtime.cancel_open = true;
	atomic_set(&cautest_runtime.cancel_requested, 0);
	spin_lock_irqsave(&cautest_runtime.event_lock, flags);
	cautest_runtime.run_overflowed = false;
	cautest_runtime.overflow_terminal_ready = false;
	spin_unlock_irqrestore(&cautest_runtime.event_lock, flags);
out:
	mutex_unlock(&cautest_runtime.state_lock);
	if (rc)
		return rc;
	wake_up_interruptible(&cautest_runtime.worker_wait);
	return 0;
}

static long cautest_ioctl_cancel(void __user *argument)
{
	struct cautest_kernel_cancel cancel;
	int rc = 0;

	if (copy_from_user(&cancel, argument, sizeof(cancel)))
		return -EFAULT;
	if (!cautest_abi_header_valid(&cancel.header, sizeof(cancel)))
		return -EPROTO;
	mutex_lock(&cautest_runtime.state_lock);
	if (cautest_runtime.run_state == CAUTEST_KERNEL_RUN_READY ||
	    !cautest_runtime.cancel_open ||
	    cancel.run_id != cautest_runtime.active_run_id)
		rc = -ENOENT;
	else
		atomic_set(&cautest_runtime.cancel_requested, 1);
	mutex_unlock(&cautest_runtime.state_lock);
	return rc;
}

static long cautest_ioctl(struct file *file, unsigned int command,
			  unsigned long argument)
{
	void __user *user_argument = (void __user *)argument;
	(void)file;
	switch (command) {
	case CAUTEST_KERNEL_IOCTL_INFO:
		return cautest_ioctl_info(user_argument);
	case CAUTEST_KERNEL_IOCTL_LIST:
		return cautest_ioctl_list(user_argument);
	case CAUTEST_KERNEL_IOCTL_RUN:
		return cautest_ioctl_run(user_argument);
	case CAUTEST_KERNEL_IOCTL_CANCEL:
		return cautest_ioctl_cancel(user_argument);
	default:
		return -ENOTTY;
	}
}

static ssize_t cautest_read(struct file *file, char __user *buffer,
			    size_t size, loff_t *offset)
{
	struct cautest_kernel_event_record event;
	unsigned long flags;
	ssize_t rc;
	(void)offset;

	if (size < sizeof(event))
		return -EMSGSIZE;
	if (mutex_lock_interruptible(&cautest_runtime.read_lock))
		return -ERESTARTSYS;
	for (;;) {
		spin_lock_irqsave(&cautest_runtime.event_lock, flags);
		cautest_materialize_overflow_locked();
		if (cautest_runtime.event_count) {
			event = cautest_runtime.events[cautest_runtime.event_head];
			spin_unlock_irqrestore(&cautest_runtime.event_lock, flags);
			if (copy_to_user(buffer, &event, sizeof(event))) {
				rc = -EFAULT;
				break;
			}
			spin_lock_irqsave(&cautest_runtime.event_lock, flags);
			cautest_runtime.event_head = (cautest_runtime.event_head + 1) %
					     CAUTEST_KERNEL_EVENT_CAPACITY;
			cautest_runtime.event_count--;
			cautest_materialize_overflow_locked();
			spin_unlock_irqrestore(&cautest_runtime.event_lock, flags);
			wake_up_interruptible(&cautest_runtime.event_wait);
			rc = sizeof(event);
			break;
		}
		spin_unlock_irqrestore(&cautest_runtime.event_lock, flags);
		if (file->f_flags & O_NONBLOCK) {
			rc = -EAGAIN;
			break;
		}
		rc = wait_event_interruptible(cautest_runtime.event_wait,
			READ_ONCE(cautest_runtime.event_count) ||
			(READ_ONCE(cautest_runtime.overflow_pending) &&
			 READ_ONCE(cautest_runtime.overflow_terminal_ready)));
		if (rc)
			break;
	}
	mutex_unlock(&cautest_runtime.read_lock);
	return rc;
}

static __poll_t cautest_poll(struct file *file, poll_table *wait)
{
	__poll_t mask = 0;
	unsigned long flags;
	(void)file;
	poll_wait(file, &cautest_runtime.event_wait, wait);
	spin_lock_irqsave(&cautest_runtime.event_lock, flags);
	if (cautest_runtime.event_count ||
	    (cautest_runtime.overflow_pending &&
	     cautest_runtime.overflow_terminal_ready))
		mask = EPOLLIN | EPOLLRDNORM;
	spin_unlock_irqrestore(&cautest_runtime.event_lock, flags);
	return mask;
}

static int cautest_open(struct inode *inode, struct file *file)
{
	(void)inode;
	(void)file;
	return atomic_cmpxchg(&cautest_runtime.opened, 0, 1) == 0 ? 0 : -EBUSY;
}

static int cautest_release(struct inode *inode, struct file *file)
{
	(void)inode;
	(void)file;
	atomic_set(&cautest_runtime.opened, 0);
	return 0;
}

static const struct file_operations cautest_fops = {
	.owner = THIS_MODULE,
	.open = cautest_open,
	.release = cautest_release,
	.read = cautest_read,
	.poll = cautest_poll,
	.unlocked_ioctl = cautest_ioctl,
	.compat_ioctl = cautest_ioctl,
	.llseek = NULL,
};

static struct miscdevice cautest_device = {
	.minor = MISC_DYNAMIC_MINOR,
	.name = "cautest",
	.fops = &cautest_fops,
	.mode = 0600,
};

static int __init cautest_kernel_init(void)
{
	int rc;

	memset(&cautest_runtime, 0, sizeof(cautest_runtime));
	mutex_init(&cautest_runtime.state_lock);
	mutex_init(&cautest_runtime.read_lock);
	spin_lock_init(&cautest_runtime.event_lock);
	init_waitqueue_head(&cautest_runtime.worker_wait);
	init_waitqueue_head(&cautest_runtime.event_wait);
	cautest_runtime.next_registry_id = 1;
	cautest_runtime.run_state = CAUTEST_KERNEL_RUN_READY;
	atomic_set(&cautest_runtime.opened, 0);
	atomic_set(&cautest_runtime.cancel_requested, 0);
	cautest_runtime.worker = kthread_run(cautest_worker, NULL, "cautest-executor");
	if (IS_ERR(cautest_runtime.worker))
		return PTR_ERR(cautest_runtime.worker);
	rc = misc_register(&cautest_device);
	if (rc) {
		kthread_stop(cautest_runtime.worker);
		return rc;
	}
	return 0;
}

static void __exit cautest_kernel_exit(void)
{
	misc_deregister(&cautest_device);
	kthread_stop(cautest_runtime.worker);
}

module_init(cautest_kernel_init);
module_exit(cautest_kernel_exit);

MODULE_LICENSE("GPL");
MODULE_DESCRIPTION("Cautest test-only Linux kernel runtime");
