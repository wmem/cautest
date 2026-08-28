#include <cautest/cautest.h>

CAUTEST_FIXTURE_CALLBACK(failed_suite_setup)
{
    (void)suite_fixture;
    (void)case_fixture;
    (void)cautest_parameter;
    CAUTEST_ERROR("suite setup failed");
}

CAUTEST_FIXTURE(failed_suite_fixture, int, failed_suite_setup, 0);

CAUTEST_CASE(should_not_run)
{
    (void)cautest_ctx;
    (void)suite_fixture;
    (void)case_fixture;
    (void)cautest_parameter;
}

CAUTEST_SUITE_WITH_FIXTURES(
    suite_setup_error, &failed_suite_fixture, CAUTEST_NO_FIXTURE,
    CAUTEST_CASE_ENTRY(should_not_run));
