#include <cautest/cautest.h>

CAUTEST_CASE(passes)
{
    const unsigned char expected[] = { 1U, 2U, 3U };
    const unsigned char actual[] = { 1U, 2U, 3U };
    (void)suite_fixture;
    (void)case_fixture;
    (void)cautest_parameter;
    CAUTEST_EXPECT_FALSE(0);
    CAUTEST_EXPECT_NOT_NULL(expected);
    CAUTEST_EXPECT_EQ_U64(42U, 42U);
    CAUTEST_EXPECT_STREQ("cautest", "cautest");
    CAUTEST_EXPECT_MEMEQ(expected, actual, sizeof(expected));
}

CAUTEST_CASE(fails)
{
    (void)suite_fixture;
    (void)case_fixture;
    (void)cautest_parameter;
    CAUTEST_EXPECT_EQ_INT(1, 2);
}

CAUTEST_SUITE(smoke,
    CAUTEST_CASE_ENTRY(passes),
    CAUTEST_CASE_ENTRY(fails));
