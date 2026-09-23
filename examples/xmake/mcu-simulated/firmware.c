#include <cautest/cautest.h>

CAUTEST_CASE(smoke)
{
    (void)suite_fixture;
    (void)case_fixture;
    (void)cautest_parameter;
    CAUTEST_EXPECT_EQ_U32(7U, 7U);
}

CAUTEST_SUITE(mcu_smoke, CAUTEST_CASE_ENTRY(smoke));
