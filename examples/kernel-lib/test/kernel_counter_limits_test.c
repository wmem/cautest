#include <cautest/cautest.h>
#include "kernel_counter_limits.h"

CAUTEST_CASE(limits_counter_value)
{
    (void)suite_fixture;
    (void)case_fixture;
    (void)cautest_parameter;
    CAUTEST_EXPECT_EQ_INT(7, kernel_counter_limit(7, 10));
    CAUTEST_EXPECT_EQ_INT(10, kernel_counter_limit(11, 10));
}

CAUTEST_SUITE(kernel_counter_limits,
    CAUTEST_CASE_ENTRY(limits_counter_value));
