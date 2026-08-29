#include <cautest/cautest.h>
#include "example_limits.h"

CAUTEST_CASE(clamps_to_range)
{
    (void)suite_fixture;
    (void)case_fixture;
    (void)cautest_parameter;
    CAUTEST_EXPECT_EQ_INT(0, example_clamp(-1, 0, 100));
    CAUTEST_EXPECT_EQ_INT(42, example_clamp(42, 0, 100));
    CAUTEST_EXPECT_EQ_INT(100, example_clamp(101, 0, 100));
}

CAUTEST_SUITE(example_limits,
    CAUTEST_CASE_ENTRY(clamps_to_range));
