#include <cautest/cautest.h>

#include <stdlib.h>
#include <string.h>

CAUTEST_CASE(profile_env)
{
    const char *value = getenv("CAUTEST_PROFILE_ENV");
    (void)suite_fixture;
    (void)case_fixture;
    (void)cautest_parameter;
    CAUTEST_EXPECT_TRUE(value != 0 && strncmp(value, "profile-", 8) == 0);
}

CAUTEST_SUITE(mcu_profile, CAUTEST_CASE_ENTRY(profile_env));
CAUTEST_REGISTRY(cautest_mcu_registry, CAUTEST_SUITE_REF(mcu_profile));
