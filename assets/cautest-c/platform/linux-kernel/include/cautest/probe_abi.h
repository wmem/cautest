#ifndef CAUTEST_PROBE_ABI_H
#define CAUTEST_PROBE_ABI_H

#include <linux/ioctl.h>
#include <linux/types.h>
#include <cautest/version.h>

/*
 * /dev/cautest-probe 是 Test Build 内的本地观察 ABI。结构中没有用户指针，
 * 因此 32/64 位 guest 共用同一布局。
 */
#define CAUTEST_PROBE_NAME_MAX 64U
#define CAUTEST_PROBE_PAYLOAD_MAX 128U

#define CAUTEST_PROBE_CAP_RESET (1U << 0)
#define CAUTEST_PROBE_CAP_POLL (1U << 1)
#define CAUTEST_PROBE_CAP_DROPPED (1U << 2)
#define CAUTEST_PROBE_CAP_OVERFLOW_ERROR (1U << 3)

struct cautest_probe_abi_header {
	__u16 abi_major;
	__u16 abi_minor;
	__u32 struct_size;
};

struct cautest_probe_info {
	struct cautest_probe_abi_header header;
	__u32 magic;
	__u32 capabilities;
	__u32 channel_id;
	__u32 event_capacity;
	__u32 event_count;
	__u32 reserved;
	__u64 dropped_events;
};

struct cautest_probe_select {
	struct cautest_probe_abi_header header;
	char channel[CAUTEST_PROBE_NAME_MAX];
};

struct cautest_probe_dropped {
	struct cautest_probe_abi_header header;
	__u64 dropped_events;
};

/* read(2) 每次只返回一个完整记录；不足一个记录的 buffer 会返回 EINVAL。 */
struct cautest_probe_event_record {
	struct cautest_probe_abi_header header;
	__u32 channel_id;
	__u32 kind;
	__u64 sequence;
	__u16 payload_length;
	__u16 flags;
	__u32 reserved;
	__u8 payload[CAUTEST_PROBE_PAYLOAD_MAX];
};

#define CAUTEST_PROBE_IOCTL_TYPE 0xc8
#define CAUTEST_PROBE_IOCTL_INFO \
	_IOWR(CAUTEST_PROBE_IOCTL_TYPE, 0x00, struct cautest_probe_info)
#define CAUTEST_PROBE_IOCTL_SELECT \
	_IOW(CAUTEST_PROBE_IOCTL_TYPE, 0x01, struct cautest_probe_select)
#define CAUTEST_PROBE_IOCTL_RESET \
	_IO(CAUTEST_PROBE_IOCTL_TYPE, 0x02)
#define CAUTEST_PROBE_IOCTL_DROPPED \
	_IOWR(CAUTEST_PROBE_IOCTL_TYPE, 0x03, struct cautest_probe_dropped)

#endif
