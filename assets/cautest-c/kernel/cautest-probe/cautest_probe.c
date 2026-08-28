#include <linux/atomic.h>
#include <linux/errno.h>
#include <linux/fs.h>
#include <linux/kernel.h>
#include <linux/list.h>
#include <linux/miscdevice.h>
#include <linux/module.h>
#include <linux/mutex.h>
#include <linux/poll.h>
#include <linux/refcount.h>
#include <linux/slab.h>
#include <linux/spinlock.h>
#include <linux/string.h>
#include <linux/uaccess.h>
#include <linux/wait.h>

#include <cautest/probe.h>

#if !defined(CONFIG_CAUTEST) && !defined(CONFIG_CAUTEST_MODULE)
#error "cautest-probe 只能在 CONFIG_CAUTEST=y 的 Test Build 中构建"
#endif

#define CAUTEST_PROBE_MAX_CAPACITY 256U

struct cautest_probe_channel {
	struct list_head node;
	char name[CAUTEST_PROBE_NAME_MAX];
	__u32 id;
	__u32 capacity;
	spinlock_t lock;
	wait_queue_head_t wait;
	struct cautest_probe_event_record *events;
	__u32 head;
	__u32 count;
	__u64 dropped;
	__u64 next_sequence;
	__u64 reset_generation;
	atomic_t selected;
	refcount_t references;
	bool registered;
};

struct cautest_probe_file {
	struct mutex lock;
	struct cautest_probe_channel *channel;
	__u64 seen_dropped;
	__u64 seen_reset_generation;
};

static DEFINE_MUTEX(cautest_probe_channels_lock);
static LIST_HEAD(cautest_probe_channels);
static __u32 cautest_probe_next_channel_id = 1;

static void cautest_probe_channel_put(struct cautest_probe_channel *channel)
{
	if (!refcount_dec_and_test(&channel->references))
		return;
	kfree(channel->events);
	kfree(channel);
}

static bool cautest_probe_header_valid(const struct cautest_probe_abi_header *header,
				       size_t expected)
{
	return header->abi_major == CAUTEST_PROBE_ABI_MAJOR &&
	       header->abi_minor <= CAUTEST_PROBE_ABI_MINOR &&
	       header->struct_size == expected;
}

struct cautest_probe_channel *
cautest_probe_register(const char *name, __u32 event_capacity)
{
	struct cautest_probe_channel *channel;
	struct cautest_probe_channel *existing;
	size_t length;

	if (!name || !event_capacity ||
	    event_capacity > CAUTEST_PROBE_MAX_CAPACITY)
		return ERR_PTR(-EINVAL);
	length = strnlen(name, CAUTEST_PROBE_NAME_MAX);
	if (!length || length == CAUTEST_PROBE_NAME_MAX)
		return ERR_PTR(-ENAMETOOLONG);

	channel = kzalloc(sizeof(*channel), GFP_KERNEL);
	if (!channel)
		return ERR_PTR(-ENOMEM);
	channel->events = kcalloc(event_capacity, sizeof(*channel->events),
				  GFP_KERNEL);
	if (!channel->events) {
		kfree(channel);
		return ERR_PTR(-ENOMEM);
	}
	strscpy(channel->name, name, sizeof(channel->name));
	channel->capacity = event_capacity;
	spin_lock_init(&channel->lock);
	init_waitqueue_head(&channel->wait);
	atomic_set(&channel->selected, 0);
	refcount_set(&channel->references, 1);
	channel->registered = true;

	mutex_lock(&cautest_probe_channels_lock);
	list_for_each_entry(existing, &cautest_probe_channels, node) {
		if (!strcmp(existing->name, name)) {
			mutex_unlock(&cautest_probe_channels_lock);
			kfree(channel->events);
			kfree(channel);
			return ERR_PTR(-EEXIST);
		}
	}
	channel->id = cautest_probe_next_channel_id++;
	if (!cautest_probe_next_channel_id)
		cautest_probe_next_channel_id = 1;
	list_add_tail(&channel->node, &cautest_probe_channels);
	mutex_unlock(&cautest_probe_channels_lock);
	return channel;
}
EXPORT_SYMBOL_GPL(cautest_probe_register);

int cautest_probe_unregister(struct cautest_probe_channel *channel)
{
	if (!channel || IS_ERR(channel))
		return -EINVAL;
	mutex_lock(&cautest_probe_channels_lock);
	if (!channel->registered) {
		mutex_unlock(&cautest_probe_channels_lock);
		return -ENOENT;
	}
	list_del(&channel->node);
	WRITE_ONCE(channel->registered, false);
	mutex_unlock(&cautest_probe_channels_lock);
	wake_up_interruptible(&channel->wait);
	/* 注册引用释放后，已选中的 fd 继续持有 channel 内存直到 close。 */
	cautest_probe_channel_put(channel);
	return 0;
}
EXPORT_SYMBOL_GPL(cautest_probe_unregister);

void cautest_probe_reset(struct cautest_probe_channel *channel)
{
	unsigned long flags;

	if (!channel || IS_ERR(channel))
		return;
	spin_lock_irqsave(&channel->lock, flags);
	channel->head = 0;
	channel->count = 0;
	channel->dropped = 0;
	channel->next_sequence = 0;
	channel->reset_generation++;
	spin_unlock_irqrestore(&channel->lock, flags);
	wake_up_interruptible(&channel->wait);
}
EXPORT_SYMBOL_GPL(cautest_probe_reset);

int cautest_probe_emit(struct cautest_probe_channel *channel, __u32 kind,
		       const void *payload, __u16 payload_length)
{
	struct cautest_probe_event_record *event;
	unsigned long flags;
	__u32 tail;
	int rc = 0;

	if (!channel || IS_ERR(channel) ||
	    payload_length > CAUTEST_PROBE_PAYLOAD_MAX ||
	    (payload_length && !payload))
		return -EINVAL;

	spin_lock_irqsave(&channel->lock, flags);
	if (channel->count == channel->capacity) {
		channel->dropped++;
		rc = -ENOSPC;
	} else {
		tail = (channel->head + channel->count) % channel->capacity;
		event = &channel->events[tail];
		memset(event, 0, sizeof(*event));
		event->header.abi_major = CAUTEST_PROBE_ABI_MAJOR;
		event->header.abi_minor = CAUTEST_PROBE_ABI_MINOR;
		event->header.struct_size = sizeof(*event);
		event->channel_id = channel->id;
		event->kind = kind;
		event->sequence = channel->next_sequence++;
		event->payload_length = payload_length;
		if (payload_length)
			memcpy(event->payload, payload, payload_length);
		channel->count++;
	}
	spin_unlock_irqrestore(&channel->lock, flags);
	wake_up_interruptible(&channel->wait);
	return rc;
}
EXPORT_SYMBOL_GPL(cautest_probe_emit);

__u64 cautest_probe_dropped(struct cautest_probe_channel *channel)
{
	unsigned long flags;
	__u64 dropped;

	if (!channel || IS_ERR(channel))
		return 0;
	spin_lock_irqsave(&channel->lock, flags);
	dropped = channel->dropped;
	spin_unlock_irqrestore(&channel->lock, flags);
	return dropped;
}
EXPORT_SYMBOL_GPL(cautest_probe_dropped);

static int cautest_probe_open(struct inode *inode, struct file *file)
{
	struct cautest_probe_file *context;

	(void)inode;
	context = kzalloc(sizeof(*context), GFP_KERNEL);
	if (!context)
		return -ENOMEM;
	mutex_init(&context->lock);
	file->private_data = context;
	return 0;
}

static int cautest_probe_release(struct inode *inode, struct file *file)
{
	struct cautest_probe_file *context = file->private_data;

	(void)inode;
	mutex_lock(&cautest_probe_channels_lock);
	if (context->channel) {
		atomic_set(&context->channel->selected, 0);
		cautest_probe_channel_put(context->channel);
	}
	mutex_unlock(&cautest_probe_channels_lock);
	kfree(context);
	return 0;
}

static long cautest_probe_select_channel(struct cautest_probe_file *context,
					 void __user *argument)
{
	struct cautest_probe_select select;
	struct cautest_probe_channel *channel;
	long rc = -ENOENT;

	if (copy_from_user(&select, argument, sizeof(select)))
		return -EFAULT;
	if (!cautest_probe_header_valid(&select.header, sizeof(select)) ||
	    !memchr(select.channel, '\0', sizeof(select.channel)))
		return -EPROTO;

	mutex_lock(&cautest_probe_channels_lock);
	list_for_each_entry(channel, &cautest_probe_channels, node) {
		if (strcmp(channel->name, select.channel))
			continue;
		if (channel != context->channel &&
		    atomic_cmpxchg(&channel->selected, 0, 1) != 0) {
			rc = -EBUSY;
			break;
		}
		if (channel != context->channel)
			refcount_inc(&channel->references);
		if (context->channel && context->channel != channel) {
			atomic_set(&context->channel->selected, 0);
			cautest_probe_channel_put(context->channel);
		}
		context->channel = channel;
		context->seen_dropped = cautest_probe_dropped(channel);
		context->seen_reset_generation = READ_ONCE(channel->reset_generation);
		rc = 0;
		break;
	}
	mutex_unlock(&cautest_probe_channels_lock);
	return rc;
}

static long cautest_probe_ioctl_info(struct cautest_probe_file *context,
				     void __user *argument)
{
	struct cautest_probe_info info;
	struct cautest_probe_channel *channel = context->channel;
	unsigned long flags;

	if (copy_from_user(&info, argument, sizeof(info)))
		return -EFAULT;
	if (!cautest_probe_header_valid(&info.header, sizeof(info)))
		return -EPROTO;
	memset((char *)&info + sizeof(info.header), 0,
	       sizeof(info) - sizeof(info.header));
	info.magic = CAUTEST_PROBE_ABI_MAGIC;
	info.capabilities = CAUTEST_PROBE_CAP_RESET | CAUTEST_PROBE_CAP_POLL |
		CAUTEST_PROBE_CAP_DROPPED | CAUTEST_PROBE_CAP_OVERFLOW_ERROR;
	if (channel) {
		spin_lock_irqsave(&channel->lock, flags);
		info.channel_id = channel->id;
		info.event_capacity = channel->capacity;
		info.event_count = channel->count;
		info.dropped_events = channel->dropped;
		spin_unlock_irqrestore(&channel->lock, flags);
	}
	return copy_to_user(argument, &info, sizeof(info)) ? -EFAULT : 0;
}

static long cautest_probe_ioctl_dropped(struct cautest_probe_file *context,
					void __user *argument)
{
	struct cautest_probe_dropped dropped;

	if (!context->channel)
		return -ENODEV;
	if (copy_from_user(&dropped, argument, sizeof(dropped)))
		return -EFAULT;
	if (!cautest_probe_header_valid(&dropped.header, sizeof(dropped)))
		return -EPROTO;
	dropped.dropped_events = cautest_probe_dropped(context->channel);
	return copy_to_user(argument, &dropped, sizeof(dropped)) ? -EFAULT : 0;
}

static long cautest_probe_ioctl(struct file *file, unsigned int command,
				unsigned long argument)
{
	struct cautest_probe_file *context = file->private_data;
	void __user *user_argument = (void __user *)argument;
	long rc;

	if (_IOC_TYPE(command) != CAUTEST_PROBE_IOCTL_TYPE)
		return -ENOTTY;
	mutex_lock(&context->lock);
	switch (command) {
	case CAUTEST_PROBE_IOCTL_INFO:
		rc = cautest_probe_ioctl_info(context, user_argument);
		break;
	case CAUTEST_PROBE_IOCTL_SELECT:
		rc = cautest_probe_select_channel(context, user_argument);
		break;
	case CAUTEST_PROBE_IOCTL_RESET:
		if (!context->channel) {
			rc = -ENODEV;
			break;
		}
		cautest_probe_reset(context->channel);
		context->seen_dropped = 0;
		rc = 0;
		break;
	case CAUTEST_PROBE_IOCTL_DROPPED:
		rc = cautest_probe_ioctl_dropped(context, user_argument);
		break;
	default:
		rc = -ENOTTY;
		break;
	}
	mutex_unlock(&context->lock);
	return rc;
}

static ssize_t cautest_probe_read(struct file *file, char __user *buffer,
				  size_t length, loff_t *offset)
{
	struct cautest_probe_file *context = file->private_data;
	struct cautest_probe_channel *channel;
	struct cautest_probe_event_record event;
	unsigned long flags;
	int rc;

	(void)offset;
	if (length < sizeof(event))
		return -EINVAL;
	if (mutex_lock_interruptible(&context->lock))
		return -ERESTARTSYS;
	channel = context->channel;
	if (!channel || !READ_ONCE(channel->registered)) {
		rc = -ENODEV;
		goto out;
	}

	for (;;) {
		spin_lock_irqsave(&channel->lock, flags);
		if (channel->reset_generation != context->seen_reset_generation) {
			context->seen_reset_generation = channel->reset_generation;
			context->seen_dropped = channel->dropped;
		}
		if (channel->dropped != context->seen_dropped) {
			context->seen_dropped = channel->dropped;
			spin_unlock_irqrestore(&channel->lock, flags);
			rc = -EOVERFLOW;
			goto out;
		}
		if (channel->count) {
			event = channel->events[channel->head];
			channel->head = (channel->head + 1) % channel->capacity;
			channel->count--;
			spin_unlock_irqrestore(&channel->lock, flags);
			if (copy_to_user(buffer, &event, sizeof(event)))
				rc = -EFAULT;
			else
				rc = sizeof(event);
			goto out;
		}
		spin_unlock_irqrestore(&channel->lock, flags);
		if (file->f_flags & O_NONBLOCK) {
			rc = -EAGAIN;
			goto out;
		}
		rc = wait_event_interruptible(channel->wait,
			!READ_ONCE(channel->registered) ||
			READ_ONCE(channel->count) ||
			READ_ONCE(channel->reset_generation) !=
				context->seen_reset_generation ||
			READ_ONCE(channel->dropped) != context->seen_dropped);
		if (rc)
			goto out;
		if (!READ_ONCE(channel->registered)) {
			rc = -ENODEV;
			goto out;
		}
	}
out:
	mutex_unlock(&context->lock);
	return rc;
}

static __poll_t cautest_probe_poll(struct file *file, poll_table *wait)
{
	struct cautest_probe_file *context = file->private_data;
	struct cautest_probe_channel *channel = context->channel;
	unsigned long flags;
	__poll_t mask = 0;

	if (!channel || !READ_ONCE(channel->registered))
		return EPOLLERR;
	poll_wait(file, &channel->wait, wait);
	spin_lock_irqsave(&channel->lock, flags);
	if (channel->count)
		mask |= EPOLLIN | EPOLLRDNORM;
	if (channel->reset_generation == context->seen_reset_generation &&
	    channel->dropped != context->seen_dropped)
		mask |= EPOLLERR;
	spin_unlock_irqrestore(&channel->lock, flags);
	return mask;
}

static const struct file_operations cautest_probe_file_operations = {
	.owner = THIS_MODULE,
	.open = cautest_probe_open,
	.release = cautest_probe_release,
	.read = cautest_probe_read,
	.poll = cautest_probe_poll,
	.unlocked_ioctl = cautest_probe_ioctl,
#ifdef CONFIG_COMPAT
	.compat_ioctl = cautest_probe_ioctl,
#endif
	.llseek = no_llseek,
};

static struct miscdevice cautest_probe_device = {
	.minor = MISC_DYNAMIC_MINOR,
	.name = "cautest-probe",
	.fops = &cautest_probe_file_operations,
	.mode = 0600,
};

static int __init cautest_probe_init(void)
{
	return misc_register(&cautest_probe_device);
}

static void __exit cautest_probe_exit(void)
{
	misc_deregister(&cautest_probe_device);
}

module_init(cautest_probe_init);
module_exit(cautest_probe_exit);

MODULE_DESCRIPTION("Cautest test-only driver hardware-boundary probe");
MODULE_AUTHOR("Cautest");
MODULE_LICENSE("GPL");
