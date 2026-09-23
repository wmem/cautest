#include <cautest/cautest.h>
CAUTEST_CASE(smoke) { CAUTEST_EXPECT_TRUE(1); }
CAUTEST_SUITE(math_second, CAUTEST_CASE_ENTRY(smoke));
