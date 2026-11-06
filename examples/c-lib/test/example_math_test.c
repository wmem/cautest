#include <cautest/cautest.h>
#include "example_math.h"

/**
 * @purpose 验证两个正整数相加
 * @expected 输入 2 和 3，返回 5
 */
CAUTEST_CASE(adds_two_numbers)
{
    (void)suite_fixture; (void)case_fixture; (void)cautest_parameter;
    CAUTEST_EXPECT_EQ_INT(5, example_add(2, 3));
}
/** @purpose 验证数学加法接口 */
CAUTEST_SUITE(example_math, CAUTEST_CASE_ENTRY(adds_two_numbers));
