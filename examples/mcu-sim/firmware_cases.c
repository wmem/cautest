#include <cautest/cautest.h>
CAUTEST_CASE(passes)
{
    (void)suite_fixture; (void)case_fixture; (void)cautest_parameter;
    CAUTEST_EXPECT_EQ_U32(7U, 7U);
}
CAUTEST_SUITE(mcu_example, CAUTEST_CASE_ENTRY(passes));
CAUTEST_REGISTRY(cautest_mcu_registry, CAUTEST_SUITE_REF(mcu_example));
