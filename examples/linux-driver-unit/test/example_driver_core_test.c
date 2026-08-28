#include <cautest/cautest.h>
#include "example_driver_core.h"

CAUTEST_CASE(clamps_to_driver_limits)
{
    (void)suite_fixture;
    (void)case_fixture;
    (void)cautest_parameter;
    CAUTEST_EXPECT_EQ_INT(0, example_driver_clamp(-1, 0, 100));
    CAUTEST_EXPECT_EQ_INT(42, example_driver_clamp(42, 0, 100));
    CAUTEST_EXPECT_EQ_INT(100, example_driver_clamp(101, 0, 100));
}

CAUTEST_SUITE(example_driver_core,
    CAUTEST_CASE_ENTRY(clamps_to_driver_limits));
