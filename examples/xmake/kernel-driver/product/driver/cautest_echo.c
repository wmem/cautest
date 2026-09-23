#include <linux/fs.h>
#include <linux/miscdevice.h>
#include <linux/module.h>
#include <linux/mutex.h>
#include <linux/uaccess.h>
#include "echo_abi.h"

static int value;
static DEFINE_MUTEX(value_lock);
static ssize_t echo_read(struct file *file, char __user *buf, size_t count, loff_t *pos)
{
    int result;
    if (count != sizeof(result)) return -EINVAL;
    mutex_lock(&value_lock); result = value; mutex_unlock(&value_lock);
    return copy_to_user(buf, &result, sizeof(result)) ? -EFAULT : sizeof(result);
}
static ssize_t echo_write(struct file *file, const char __user *buf, size_t count, loff_t *pos)
{
    int next;
    if (count != sizeof(next)) return -EINVAL;
    if (copy_from_user(&next, buf, sizeof(next))) return -EFAULT;
    mutex_lock(&value_lock); value = next; mutex_unlock(&value_lock);
    return sizeof(next);
}
static long echo_ioctl(struct file *file, unsigned int command, unsigned long arg)
{
    int next;
    if (command == ECHO_GET_VALUE) {
        mutex_lock(&value_lock); next = value; mutex_unlock(&value_lock);
        return copy_to_user((void __user *)arg, &next, sizeof(next)) ? -EFAULT : 0;
    }
    if (command == ECHO_SET_VALUE) {
        if (copy_from_user(&next, (void __user *)arg, sizeof(next))) return -EFAULT;
        mutex_lock(&value_lock); value = next; mutex_unlock(&value_lock);
        return 0;
    }
    return -ENOTTY;
}
static const struct file_operations echo_ops = {
    .owner = THIS_MODULE, .read = echo_read, .write = echo_write, .unlocked_ioctl = echo_ioctl, .llseek = NULL,
};
static struct miscdevice echo_device = {.minor = MISC_DYNAMIC_MINOR, .name = "cautest_echo", .fops = &echo_ops, .mode = 0600};
static int __init echo_init(void) { return misc_register(&echo_device); }
static void __exit echo_exit(void) { misc_deregister(&echo_device); }
module_init(echo_init);
module_exit(echo_exit);
MODULE_LICENSE("GPL");
