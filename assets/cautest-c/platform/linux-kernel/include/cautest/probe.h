#ifndef CAUTEST_PROBE_H
#define CAUTEST_PROBE_H

#include <linux/errno.h>
#include <linux/types.h>

#include <cautest/probe_abi.h>

struct cautest_probe_channel;

#if defined(CONFIG_CAUTEST) || defined(CONFIG_CAUTEST_MODULE)

/*
 * 注册和注销只能在可睡眠上下文执行。调用 unregister 前，驱动必须先停止
 * 所有可能调用 emit 的 IRQ/workqueue。注销会立即从设备目录移除 channel；
 * 已选中它的 fd 会得到 ENODEV，实际内存在最后一个 fd 关闭后释放。
 */
struct cautest_probe_channel *
cautest_probe_register(const char *name, __u32 event_capacity);
int cautest_probe_unregister(struct cautest_probe_channel *channel);
void cautest_probe_reset(struct cautest_probe_channel *channel);

/* emit 不分配内存、不睡眠，可从 hard IRQ 调用；队列满时返回 ENOSPC 并计数。 */
int cautest_probe_emit(struct cautest_probe_channel *channel, __u32 kind,
		       const void *payload, __u16 payload_length);
__u64 cautest_probe_dropped(struct cautest_probe_channel *channel);

#else

/* Production 编译会完全消除 Probe 引用，不产生任何外部符号依赖。 */
static inline struct cautest_probe_channel *
cautest_probe_register(const char *name, __u32 event_capacity)
{
	(void)name;
	(void)event_capacity;
	return NULL;
}

static inline int cautest_probe_unregister(struct cautest_probe_channel *channel)
{
	(void)channel;
	return -EOPNOTSUPP;
}

static inline void cautest_probe_reset(struct cautest_probe_channel *channel)
{
	(void)channel;
}

static inline int cautest_probe_emit(struct cautest_probe_channel *channel,
			     __u32 kind, const void *payload,
			     __u16 payload_length)
{
	(void)channel;
	(void)kind;
	(void)payload;
	(void)payload_length;
	return 0;
}

static inline __u64
cautest_probe_dropped(struct cautest_probe_channel *channel)
{
	(void)channel;
	return 0;
}

#endif

#endif
