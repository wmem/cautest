#include <cautest/cautest.h>

CAUTEST_CASE(pass_case)
{
    (void)suite_fixture;
    (void)case_fixture;
    (void)cautest_parameter;
    CAUTEST_EXPECT_EQ_INT(7, 7);
}

CAUTEST_CASE(fail_case)
{
    (void)suite_fixture;
    (void)case_fixture;
    (void)cautest_parameter;
    CAUTEST_EXPECT_EQ_INT(7, 9);
}

CAUTEST_CASE(skip_case)
{
    (void)suite_fixture;
    (void)case_fixture;
    (void)cautest_parameter;
    CAUTEST_SKIP("simulated precondition");
}

CAUTEST_CASE(error_case)
{
    (void)suite_fixture;
    (void)case_fixture;
    (void)cautest_parameter;
    CAUTEST_ERROR("simulated target error");
}

CAUTEST_CASE(hang_case)
{
    volatile unsigned long running = 1UL;
    (void)cautest_ctx;
    (void)suite_fixture;
    (void)case_fixture;
    (void)cautest_parameter;
    while (running != 0UL) {
        /* Host 关闭模拟 Firmware Process 后可恢复不可协作的 MCU hang。 */
    }
}

CAUTEST_SUITE(mcu_actual,
    CAUTEST_CASE_ENTRY(pass_case),
    CAUTEST_CASE_ENTRY(fail_case),
    CAUTEST_CASE_ENTRY(skip_case),
    CAUTEST_CASE_ENTRY(error_case),
    CAUTEST_CASE_ENTRY(hang_case));
CAUTEST_REGISTRY(cautest_mcu_registry, CAUTEST_SUITE_REF(mcu_actual));
