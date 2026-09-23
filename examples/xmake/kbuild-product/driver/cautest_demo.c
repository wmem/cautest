#include <linux/init.h>
#include <linux/module.h>
#ifndef CAUTEST_DEMO_VALUE
#define CAUTEST_DEMO_VALUE 7
#endif
int cautest_demo_value(void) { return CAUTEST_DEMO_VALUE; }
EXPORT_SYMBOL_GPL(cautest_demo_value);
static int __init cautest_demo_init(void) { return 0; }
static void __exit cautest_demo_exit(void) {}
module_init(cautest_demo_init);
module_exit(cautest_demo_exit);
MODULE_LICENSE("GPL");
MODULE_DESCRIPTION("Cautest Kbuild artifact contract fixture; never loaded by this test");
