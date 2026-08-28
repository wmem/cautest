#include <linux/module.h>

/*
 * Common Core 不依赖 libc，可以直接编入 Kernel Runtime。
 * 此 translation unit 是刻意隔离的 Kbuild adapter，避免复制 Core 逻辑。
 */
#include "../../core/cautest.c"

/* 测试模块中的 assertion macro 需要调用 Common Core 公共函数。 */
EXPORT_SYMBOL_GPL(cautest_status_merge);
EXPORT_SYMBOL_GPL(cautest_expect_true);
EXPORT_SYMBOL_GPL(cautest_assert_true);
EXPORT_SYMBOL_GPL(cautest_expect_eq_int);
EXPORT_SYMBOL_GPL(cautest_assert_eq_int);
EXPORT_SYMBOL_GPL(cautest_expect_false);
EXPORT_SYMBOL_GPL(cautest_assert_false);
EXPORT_SYMBOL_GPL(cautest_expect_ne_int);
EXPORT_SYMBOL_GPL(cautest_assert_ne_int);
EXPORT_SYMBOL_GPL(cautest_expect_compare_u64);
EXPORT_SYMBOL_GPL(cautest_expect_pointer);
EXPORT_SYMBOL_GPL(cautest_expect_string);
EXPORT_SYMBOL_GPL(cautest_expect_memory);
EXPORT_SYMBOL_GPL(cautest_fail);
EXPORT_SYMBOL_GPL(cautest_skip);
EXPORT_SYMBOL_GPL(cautest_error);
EXPORT_SYMBOL_GPL(cautest_context_has_fatal);
EXPORT_SYMBOL_GPL(cautest_registry_validate);
EXPORT_SYMBOL_GPL(cautest_registry_instance_count);
