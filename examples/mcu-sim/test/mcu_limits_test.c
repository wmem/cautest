#include <cautest/cautest.h>
#include "mcu_math.h"

CAUTEST_CASE(clamps_values)
{
    (void)suite_fixture;
    (void)case_fixture;
    (void)cautest_parameter;
    CAUTEST_EXPECT_EQ_U32(7U, mcu_limit(7U, 10U));
    CAUTEST_EXPECT_EQ_U32(10U, mcu_limit(11U, 10U));
}

CAUTEST_SUITE(mcu_limits,
    CAUTEST_CASE_ENTRY(clamps_values));
