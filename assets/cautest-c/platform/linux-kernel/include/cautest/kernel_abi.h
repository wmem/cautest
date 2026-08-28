#ifndef CAUTEST_KERNEL_ABI_H
#define CAUTEST_KERNEL_ABI_H

#include <linux/ioctl.h>
#include <linux/types.h>
#include <cautest/version.h>

/*
 * /dev/cautest 的本地 ABI。所有结构只包含定宽整数和内嵌数组，
 * 不包含用户指针，因此 32/64 位 guest 可以使用同一布局。
 */
#define CAUTEST_KERNEL_NAME_MAX 64U
#define CAUTEST_KERNEL_EXPRESSION_MAX 96U
#define CAUTEST_KERNEL_FILE_MAX 96U
#define CAUTEST_KERNEL_VALUE_MAX 96U
#define CAUTEST_KERNEL_CURSOR_END ((__u32)~0U)

#define CAUTEST_KERNEL_CAP_LIST (1U << 0)
#define CAUTEST_KERNEL_CAP_RUN (1U << 1)
#define CAUTEST_KERNEL_CAP_CANCEL (1U << 2)
#define CAUTEST_KERNEL_CAP_POLL (1U << 3)

#define CAUTEST_KERNEL_EVENT_F_FINAL (1U << 0)

#define CAUTEST_KERNEL_RUN_SELECT_ONE (1U << 0)
#define CAUTEST_KERNEL_RUN_SELECT_SUITE (1U << 1)

enum cautest_kernel_run_state {
	CAUTEST_KERNEL_RUN_READY = 0,
	CAUTEST_KERNEL_RUN_QUEUED = 1,
	CAUTEST_KERNEL_RUN_RUNNING = 2,
};

enum cautest_kernel_event_type {
	CAUTEST_KERNEL_EVENT_RUN_START = 1,
	CAUTEST_KERNEL_EVENT_GROUP_START = 2,
	CAUTEST_KERNEL_EVENT_CASE_START = 3,
	CAUTEST_KERNEL_EVENT_ASSERTION = 4,
	CAUTEST_KERNEL_EVENT_SKIP = 5,
	CAUTEST_KERNEL_EVENT_CASE_END = 6,
	CAUTEST_KERNEL_EVENT_GROUP_END = 7,
	CAUTEST_KERNEL_EVENT_RUN_END = 8,
	CAUTEST_KERNEL_EVENT_ERROR = 9,
	CAUTEST_KERNEL_EVENT_LOG = 10,
};

enum cautest_kernel_error {
	CAUTEST_KERNEL_ERROR_NONE = 0,
	CAUTEST_KERNEL_ERROR_CORE = 1,
	CAUTEST_KERNEL_ERROR_CANCELLED = 2,
	CAUTEST_KERNEL_ERROR_EVENT_OVERFLOW = 3,
};

struct cautest_kernel_abi_header {
	__u16 abi_major;
	__u16 abi_minor;
	__u32 struct_size;
};

struct cautest_kernel_info {
	struct cautest_kernel_abi_header header;
	__u32 magic;
	__u32 capabilities;
	__u32 registry_count;
	__u32 descriptor_count;
	__u32 run_state;
	__u32 event_capacity;
	__u32 event_count;
	__u32 dropped_events;
	__u64 active_run_id;
};

/*
 * cursor 是本次 LIST 的全局游标；descriptor_id 在 registry_id 内稳定，
 * 响应中的 next_cursor 为下一项或 CURSOR_END。
 */
struct cautest_kernel_list {
	struct cautest_kernel_abi_header header;
	__u32 cursor;
	__u32 next_cursor;
	__u32 registry_id;
	__u32 instance_index;
	__u32 descriptor_id;
	__u32 suite_id;
	__u32 case_id;
	__u32 param_id;
	__u32 reserved;
	char registry[CAUTEST_KERNEL_NAME_MAX];
	char suite[CAUTEST_KERNEL_NAME_MAX];
	char case_name[CAUTEST_KERNEL_NAME_MAX];
	char parameter[CAUTEST_KERNEL_NAME_MAX];
};

/*
 * SELECT_ONE 使用 descriptor_id；SELECT_SUITE 使用 suite_id。
 */
struct cautest_kernel_run {
	struct cautest_kernel_abi_header header;
	__u32 registry_id;
	__u32 stop_policy;
	__u32 selection_flags;
	__u32 descriptor_id;
	__u32 suite_id;
	__u32 reserved;
	__u64 run_id;
};

struct cautest_kernel_cancel {
	struct cautest_kernel_abi_header header;
	__u64 run_id;
};

/* read(2) 每次返回一个完整 event。 */
struct cautest_kernel_event_record {
	struct cautest_kernel_abi_header header;
	__u16 type;
	__u16 flags;
	__u32 status;
	__u32 error;
	__u32 reserved0;
	__u64 sequence;
	__u64 run_id;
	__u64 line;
	__s64 expected;
	__s64 actual;
	__u32 value_kind;
	__u32 value_flags;
	__u64 expected_unsigned;
	__u64 actual_unsigned;
	__u32 expected_size;
	__u32 actual_size;
	__u32 dropped_events;
	__u32 reserved;
	char registry[CAUTEST_KERNEL_NAME_MAX];
	char suite[CAUTEST_KERNEL_NAME_MAX];
	char case_name[CAUTEST_KERNEL_NAME_MAX];
	char parameter[CAUTEST_KERNEL_NAME_MAX];
	char expression[CAUTEST_KERNEL_EXPRESSION_MAX];
	char file[CAUTEST_KERNEL_FILE_MAX];
	unsigned char expected_value[CAUTEST_KERNEL_VALUE_MAX];
	unsigned char actual_value[CAUTEST_KERNEL_VALUE_MAX];
};

#define CAUTEST_KERNEL_IOCTL_TYPE 0xc7
#define CAUTEST_KERNEL_IOCTL_INFO \
	_IOWR(CAUTEST_KERNEL_IOCTL_TYPE, 0x00, struct cautest_kernel_info)
#define CAUTEST_KERNEL_IOCTL_LIST \
	_IOWR(CAUTEST_KERNEL_IOCTL_TYPE, 0x01, struct cautest_kernel_list)
#define CAUTEST_KERNEL_IOCTL_RUN \
	_IOWR(CAUTEST_KERNEL_IOCTL_TYPE, 0x02, struct cautest_kernel_run)
#define CAUTEST_KERNEL_IOCTL_CANCEL \
	_IOW(CAUTEST_KERNEL_IOCTL_TYPE, 0x03, struct cautest_kernel_cancel)

#endif
