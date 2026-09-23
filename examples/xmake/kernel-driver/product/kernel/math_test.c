#include <linux/module.h>
#include <cautest/cautest.h>
#include <cautest/kernel_runtime.h>

CAUTEST_CASE(add) { CAUTEST_EXPECT_EQ_INT(2 + 3, 5); }
CAUTEST_CASE(boundary) { CAUTEST_EXPECT_EQ_INT(0 * 42, 0); }
CAUTEST_SUITE(kernel_math, CAUTEST_CASE_ENTRY(add), CAUTEST_CASE_ENTRY(boundary));
CAUTEST_REGISTRY(math_registry, CAUTEST_SUITE_REF(kernel_math));
static int __init math_init(void) { return CAUTEST_KERNEL_REGISTER(math_registry); }
static void __exit math_exit(void) { WARN_ON(CAUTEST_KERNEL_UNREGISTER(math_registry)); }
module_init(math_init);
module_exit(math_exit);
MODULE_LICENSE("GPL");
