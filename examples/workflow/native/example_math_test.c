#include <cautest/cautest.h>
#include "example_math.h"

CAUTEST_CASE(adds_two_numbers)
{
    (void)suite_fixture; (void)case_fixture; (void)cautest_parameter;
    CAUTEST_EXPECT_EQ_INT(5, example_add(2, 3));
}
CAUTEST_SUITE(example_math, CAUTEST_CASE_ENTRY(adds_two_numbers));
