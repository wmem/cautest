#include <cautest/cautest.h>
#include "math_ops.h"
CAUTEST_CASE(adds) { CAUTEST_EXPECT_EQ_INT(5, math_add(2, 3)); }
CAUTEST_CASE(scales) { CAUTEST_EXPECT_EQ_INT(6, math_scale(3)); }
CAUTEST_CASE(deliberate_failure) { CAUTEST_EXPECT_EQ_INT(1, 2); }
CAUTEST_SUITE(math_test, CAUTEST_CASE_ENTRY(adds), CAUTEST_CASE_ENTRY(scales), CAUTEST_CASE_ENTRY(deliberate_failure));
