#include <cautest/cautest.h>
#include "mcu_math.h"

CAUTEST_CASE(adds_values)
{
    (void)suite_fixture;
    (void)case_fixture;
    (void)cautest_parameter;
    CAUTEST_EXPECT_EQ_U32(7U, mcu_add(3U, 4U));
}

CAUTEST_SUITE(mcu_math,
    CAUTEST_CASE_ENTRY(adds_values));
