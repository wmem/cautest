#include <cautest/cautest.h>
#include "kernel_counter.h"
CAUTEST_CASE(increments)
{
    (void)suite_fixture; (void)case_fixture; (void)cautest_parameter;
    CAUTEST_EXPECT_EQ_INT(1, kernel_counter_next());
    CAUTEST_EXPECT_EQ_INT(2, kernel_counter_next());
}
CAUTEST_SUITE(kernel_counter, CAUTEST_CASE_ENTRY(increments));
