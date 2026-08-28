#include <cautest/cautest.h>

CAUTEST_CASE(passes)
{
    (void)suite_fixture;
    (void)case_fixture;
    (void)cautest_parameter;
    CAUTEST_EXPECT_TRUE(1);
    CAUTEST_EXPECT_EQ_U64(42U, 42U);
}

CAUTEST_SUITE(kernel_smoke,
    CAUTEST_CASE_ENTRY(passes));
