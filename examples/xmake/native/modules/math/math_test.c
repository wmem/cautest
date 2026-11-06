#include <cautest/cautest.h>
#include "math_ops.h"
/**
 * @purpose 验证两个正整数相加
 * @expected 输入 2 和 3，返回 5
 */
CAUTEST_CASE(adds) { CAUTEST_EXPECT_EQ_INT(5, math_add(2, 3)); }
CAUTEST_CASE(scales) { CAUTEST_EXPECT_EQ_INT(6, math_scale(3)); }
CAUTEST_CASE(deliberate_failure) { CAUTEST_EXPECT_EQ_INT(1, 2); }
/** @purpose 验证加法和缩放接口 */
CAUTEST_SUITE(math_test, CAUTEST_CASE_ENTRY(adds), CAUTEST_CASE_ENTRY(scales), CAUTEST_CASE_ENTRY(deliberate_failure));
