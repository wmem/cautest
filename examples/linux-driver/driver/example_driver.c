#include <linux/fs.h>
#include <linux/errno.h>
#include <linux/miscdevice.h>
#include <linux/module.h>
#include <linux/uaccess.h>
#include "example_driver_abi.h"
#if defined(CONFIG_CAUTEST) || defined(CONFIG_CAUTEST_MODULE)
#include <cautest/probe.h>
static struct cautest_probe_channel *probe;
#endif

static ssize_t example_read(struct file *file, char __user *buffer,
                            size_t length, loff_t *offset)
{
    __u32 value = EXAMPLE_DRIVER_VALUE;
    (void)file;
    if (*offset != 0) return 0;
    if (length < sizeof(value)) return -EINVAL;
    if (copy_to_user(buffer, &value, sizeof(value))) return -EFAULT;
#if defined(CONFIG_CAUTEST) || defined(CONFIG_CAUTEST_MODULE)
    (void)cautest_probe_emit(probe, 1U, &value, sizeof(value));
#endif
    *offset += sizeof(value);
    return sizeof(value);
}

static const struct file_operations operations = {
    .owner = THIS_MODULE,
    .read = example_read,
    .llseek = no_llseek,
};
static struct miscdevice device = {
    .minor = MISC_DYNAMIC_MINOR,
    .name = "cautest-example",
    .fops = &operations,
    .mode = 0600,
};

static int __init example_init(void)
{
#if defined(CONFIG_CAUTEST) || defined(CONFIG_CAUTEST_MODULE)
    probe = cautest_probe_register(EXAMPLE_DRIVER_PROBE, 16U);
    if (IS_ERR(probe)) return PTR_ERR(probe);
#endif
    return misc_register(&device);
}
static void __exit example_exit(void)
{
    misc_deregister(&device);
#if defined(CONFIG_CAUTEST) || defined(CONFIG_CAUTEST_MODULE)
    (void)cautest_probe_unregister(probe);
#endif
}
module_init(example_init);
module_exit(example_exit);
MODULE_LICENSE("GPL");
