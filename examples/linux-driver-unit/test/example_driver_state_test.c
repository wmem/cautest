#include <cautest/cautest.h>
#include "example_driver_state.h"

CAUTEST_CASE(transitions_driver_state)
{
    (void)suite_fixture;
    (void)case_fixture;
    (void)cautest_parameter;
    CAUTEST_EXPECT_EQ_INT(EXAMPLE_DRIVER_READY,
        example_driver_next_state(EXAMPLE_DRIVER_IDLE, 1));
    CAUTEST_EXPECT_EQ_INT(EXAMPLE_DRIVER_ERROR,
        example_driver_next_state(EXAMPLE_DRIVER_READY, 0));
}

CAUTEST_SUITE(example_driver_state,
    CAUTEST_CASE_ENTRY(transitions_driver_state));
