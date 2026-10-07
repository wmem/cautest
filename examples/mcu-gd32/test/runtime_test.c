#include <cautest/cautest.h>

CAUTEST_CASE(assertions)
{
    (void)suite_fixture; (void)case_fixture; (void)cautest_parameter;
    CAUTEST_LOG_INFO("Cautest running on a physical MCU");
    CAUTEST_EXPECT_EQ_U32(7U, 3U + 4U);
    CAUTEST_EXPECT_EQ_INT(0, INJECT_FAILURE);
}

CAUTEST_CASE(skip_example)
{
    (void)suite_fixture; (void)case_fixture; (void)cautest_parameter;
    CAUTEST_SKIP("demonstrate MCU skip reporting");
}

CAUTEST_SUITE(runtime, CAUTEST_CASE_ENTRY(assertions), CAUTEST_CASE_ENTRY(skip_example));
