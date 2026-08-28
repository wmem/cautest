#include <cautest/cautest.h>

#include <signal.h>
#include <stdio.h>
#include <unistd.h>

CAUTEST_CASE(pass_case)
{
    (void)suite_fixture;
    (void)case_fixture;
    (void)cautest_parameter;
    puts("native stdout marker");
    fputs("native stderr marker\n", stderr);
    CAUTEST_LOG_INFO("native structured log");
    CAUTEST_EXPECT_TRUE(1);
}

CAUTEST_CASE(fail_case)
{
    (void)suite_fixture;
    (void)case_fixture;
    (void)cautest_parameter;
    CAUTEST_EXPECT_EQ_INT(1, 2);
}

CAUTEST_CASE(skip_case)
{
    (void)suite_fixture;
    (void)case_fixture;
    (void)cautest_parameter;
    CAUTEST_SKIP("fixture skip");
}

CAUTEST_CASE(error_case)
{
    (void)suite_fixture;
    (void)case_fixture;
    (void)cautest_parameter;
    CAUTEST_ERROR("fixture error");
}

CAUTEST_CASE(crash_case)
{
    (void)cautest_ctx;
    (void)suite_fixture;
    (void)case_fixture;
    (void)cautest_parameter;
    raise(SIGSEGV);
}

CAUTEST_CASE(timeout_case)
{
    (void)cautest_ctx;
    (void)suite_fixture;
    (void)case_fixture;
    (void)cautest_parameter;
    (void)printf("timeout case pid %ld\n", (long)getpid());
    (void)fflush(stdout);
    for (;;)
        pause();
}

struct number_parameter {
    int value;
};

CAUTEST_PARAM_TABLE(numbers, struct number_parameter,
    CAUTEST_PARAM_ROW("one", { 1 }),
    CAUTEST_PARAM_ROW("two", { 2 }));

CAUTEST_PARAM_CASE(parameter_case, struct number_parameter, parameter)
{
    (void)suite_fixture;
    (void)case_fixture;
    CAUTEST_EXPECT_TRUE(parameter->value > 0);
}

CAUTEST_SUITE(native_cases,
    CAUTEST_CASE_ENTRY(pass_case),
    CAUTEST_CASE_ENTRY(fail_case),
    CAUTEST_CASE_ENTRY(skip_case),
    CAUTEST_CASE_ENTRY(error_case),
    CAUTEST_CASE_ENTRY(crash_case),
    CAUTEST_CASE_ENTRY(timeout_case),
    CAUTEST_PARAM_CASE_ENTRY(parameter_case, numbers));

struct snapshot_fixture {
    int value;
};

CAUTEST_FIXTURE_CALLBACK(snapshot_setup)
{
    struct snapshot_fixture *fixture =
        (struct snapshot_fixture *)suite_fixture;
    (void)cautest_ctx;
    (void)case_fixture;
    (void)cautest_parameter;
    fixture->value = 17;
    puts("suite setup marker");
    fflush(stdout);
}

CAUTEST_FIXTURE_CALLBACK(snapshot_teardown)
{
    struct snapshot_fixture *fixture =
        (struct snapshot_fixture *)suite_fixture;
    (void)case_fixture;
    (void)cautest_parameter;
    CAUTEST_EXPECT_EQ_INT(17, fixture->value);
    puts("suite teardown marker");
    fflush(stdout);
}

CAUTEST_FIXTURE(snapshot_fixture_definition, struct snapshot_fixture,
                snapshot_setup, snapshot_teardown);

CAUTEST_CASE(snapshot_first)
{
    struct snapshot_fixture *fixture =
        (struct snapshot_fixture *)suite_fixture;
    (void)case_fixture;
    (void)cautest_parameter;
    CAUTEST_EXPECT_EQ_INT(17, fixture->value);
    fixture->value = 99;
}

CAUTEST_CASE(snapshot_second)
{
    struct snapshot_fixture *fixture =
        (struct snapshot_fixture *)suite_fixture;
    (void)case_fixture;
    (void)cautest_parameter;
    CAUTEST_EXPECT_EQ_INT(17, fixture->value);
}

CAUTEST_SUITE_WITH_FIXTURES(
    snapshot_cases, &snapshot_fixture_definition, CAUTEST_NO_FIXTURE,
    CAUTEST_CASE_ENTRY(snapshot_first),
    CAUTEST_CASE_ENTRY(snapshot_second));
