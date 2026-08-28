#include <cautest/cautest.h>

/* 此文件只用于验证 Public API 与 Common Core 可在无宿主头文件时编译。 */
CAUTEST_CASE(freestanding_case)
{
    (void)suite_fixture;
    (void)case_fixture;
    (void)cautest_parameter;
    CAUTEST_EXPECT_TRUE(1);
}

CAUTEST_SUITE(freestanding, CAUTEST_CASE_ENTRY(freestanding_case));
CAUTEST_REGISTRY(freestanding_registry, CAUTEST_SUITE_REF(freestanding));

const struct cautest_registry *freestanding_registry_address(void)
{
    return &freestanding_registry;
}
