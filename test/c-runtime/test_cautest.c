#include <cautest/cautest.h>

#include <stdio.h>
#include <string.h>

#define EVENT_CAPACITY 128UL

struct fake_backend {
    struct cautest_event events[EVENT_CAPACITY];
    unsigned long count;
    unsigned long calls;
    unsigned long fail_at_call;
};

static int fake_emit(void *opaque, const struct cautest_event *event)
{
    struct fake_backend *backend = (struct fake_backend *)opaque;

    ++backend->calls;
    if (backend->fail_at_call != 0UL &&
        backend->calls == backend->fail_at_call)
        return -1;
    if (backend->count >= EVENT_CAPACITY)
        return -1;
    backend->events[backend->count++] = *event;
    return 0;
}

static void fake_reset(struct fake_backend *backend)
{
    backend->count = 0UL;
    backend->calls = 0UL;
    backend->fail_at_call = 0UL;
}

static int check_failed;

#define CHECK(expression_) \
    do { \
        if (!(expression_)) { \
            (void)fprintf(stderr, "%s:%d: CHECK(%s) 失败\n", \
                          __FILE__, __LINE__, #expression_); \
            check_failed = 1; \
            return; \
        } \
    } while (0)

static struct cautest_run_result run_registry(
    const struct cautest_registry *registry,
    enum cautest_stop_policy stop_policy,
    struct cautest_workspace workspace,
    struct fake_backend *backend,
    int *return_code)
{
    struct cautest_run_config config;
    struct cautest_event_sink sink;
    struct cautest_run_result result;

    config.stop_policy = stop_policy;
    sink.emit = fake_emit;
    sink.context = backend;
    *return_code = cautest_run(registry, &config, workspace, sink, &result);
    return result;
}

struct lifecycle_suite_fixture {
    int initialized;
};

struct lifecycle_case_fixture {
    int initialized;
};

struct lifecycle_parameter {
    int value;
};

static int lifecycle_log[16];
static unsigned long lifecycle_log_count;

static void lifecycle_record(int value)
{
    lifecycle_log[lifecycle_log_count++] = value;
}

CAUTEST_FIXTURE_CALLBACK(lifecycle_suite_setup)
{
    struct lifecycle_suite_fixture *fixture =
        (struct lifecycle_suite_fixture *)suite_fixture;

    (void)cautest_ctx;
    (void)case_fixture;
    (void)cautest_parameter;
    fixture->initialized = 17;
    lifecycle_record(1);
}

CAUTEST_FIXTURE_CALLBACK(lifecycle_suite_teardown)
{
    struct lifecycle_suite_fixture *fixture =
        (struct lifecycle_suite_fixture *)suite_fixture;

    (void)cautest_ctx;
    (void)case_fixture;
    (void)cautest_parameter;
    if (fixture->initialized != 17)
        lifecycle_record(-9);
    lifecycle_record(9);
}

CAUTEST_FIXTURE_CALLBACK(lifecycle_case_setup)
{
    struct lifecycle_case_fixture *fixture =
        (struct lifecycle_case_fixture *)case_fixture;

    (void)cautest_ctx;
    (void)suite_fixture;
    (void)cautest_parameter;
    fixture->initialized = 23;
    lifecycle_record(2);
}

CAUTEST_FIXTURE_CALLBACK(lifecycle_case_teardown)
{
    struct lifecycle_case_fixture *fixture =
        (struct lifecycle_case_fixture *)case_fixture;

    (void)cautest_ctx;
    (void)suite_fixture;
    (void)cautest_parameter;
    if (fixture->initialized != 23)
        lifecycle_record(-4);
    lifecycle_record(4);
}

CAUTEST_FIXTURE(lifecycle_suite_fixture_definition,
                struct lifecycle_suite_fixture,
                lifecycle_suite_setup,
                lifecycle_suite_teardown);
CAUTEST_FIXTURE(lifecycle_case_fixture_definition,
                struct lifecycle_case_fixture,
                lifecycle_case_setup,
                lifecycle_case_teardown);

CAUTEST_PARAM_TABLE(lifecycle_parameters, struct lifecycle_parameter,
    CAUTEST_PARAM_ROW("first", { 31 }),
    CAUTEST_PARAM_ROW("second", { 47 }));

CAUTEST_PARAM_CASE(lifecycle_case, struct lifecycle_parameter, parameter)
{
    struct lifecycle_suite_fixture *suite =
        (struct lifecycle_suite_fixture *)suite_fixture;
    struct lifecycle_case_fixture *fixture =
        (struct lifecycle_case_fixture *)case_fixture;

    lifecycle_record(3);
    CAUTEST_EXPECT_EQ_INT(17, suite->initialized);
    CAUTEST_EXPECT_EQ_INT(23, fixture->initialized);
    CAUTEST_EXPECT_TRUE(parameter->value == 31 || parameter->value == 47);
}

CAUTEST_SUITE_WITH_FIXTURES(
    lifecycle,
    &lifecycle_suite_fixture_definition,
    &lifecycle_case_fixture_definition,
    CAUTEST_PARAM_CASE_ENTRY(lifecycle_case, lifecycle_parameters));
CAUTEST_REGISTRY(lifecycle_registry, CAUTEST_SUITE_REF(lifecycle));

static int assertion_progress;
static int assertion_teardown_count;

CAUTEST_FIXTURE_CALLBACK(assertion_case_teardown)
{
    (void)cautest_ctx;
    (void)suite_fixture;
    (void)case_fixture;
    (void)cautest_parameter;
    ++assertion_teardown_count;
}

static const struct cautest_fixture_definition assertion_fixture = {
    0UL, (cautest_callback)0, assertion_case_teardown
};

CAUTEST_CASE(expect_failure)
{
    (void)suite_fixture;
    (void)case_fixture;
    (void)cautest_parameter;
    CAUTEST_EXPECT_EQ_INT(1, 2);
    ++assertion_progress;
    CAUTEST_EXPECT_TRUE(0);
    ++assertion_progress;
}

CAUTEST_CASE(assert_failure)
{
    (void)suite_fixture;
    (void)case_fixture;
    (void)cautest_parameter;
    CAUTEST_ASSERT_TRUE(0);
    assertion_progress += 100;
}

CAUTEST_CASE(skip_case)
{
    (void)suite_fixture;
    (void)case_fixture;
    (void)cautest_parameter;
    CAUTEST_SKIP("缺少前置条件");
}

CAUTEST_CASE(error_case)
{
    (void)suite_fixture;
    (void)case_fixture;
    (void)cautest_parameter;
    CAUTEST_ERROR("测试无法可靠完成");
}

CAUTEST_SUITE_WITH_FIXTURES(
    assertions, CAUTEST_NO_FIXTURE, &assertion_fixture,
    CAUTEST_CASE_ENTRY(expect_failure),
    CAUTEST_CASE_ENTRY(assert_failure),
    CAUTEST_CASE_ENTRY(skip_case),
    CAUTEST_CASE_ENTRY(error_case));
CAUTEST_REGISTRY(assertion_registry, CAUTEST_SUITE_REF(assertions));

static const unsigned char typed_expected_bytes[] = { 0x01U, 0x02U };
static const unsigned char typed_actual_bytes[] = { 0x01U, 0x03U };

CAUTEST_CASE(typed_assertions)
{
    int value = 7;
    (void)suite_fixture;
    (void)case_fixture;
    (void)cautest_parameter;
    CAUTEST_EXPECT_FALSE(1);
    CAUTEST_EXPECT_NE_INT(5, 5);
    CAUTEST_EXPECT_EQ_U64(~0ULL, 0ULL);
    CAUTEST_EXPECT_NULL(&value);
    CAUTEST_EXPECT_STREQ("expected", "actual");
    CAUTEST_EXPECT_MEMEQ(typed_expected_bytes, typed_actual_bytes,
                         sizeof(typed_expected_bytes));
    CAUTEST_ASSERT_NOT_NULL((const void *)0);
}

CAUTEST_SUITE(typed_assertion_suite,
              CAUTEST_CASE_ENTRY(typed_assertions));
CAUTEST_REGISTRY(typed_assertion_registry,
                 CAUTEST_SUITE_REF(typed_assertion_suite));

static int stop_case_count;
static int stop_suite_teardown_count;

CAUTEST_FIXTURE_CALLBACK(stop_suite_teardown)
{
    (void)cautest_ctx;
    (void)suite_fixture;
    (void)case_fixture;
    (void)cautest_parameter;
    ++stop_suite_teardown_count;
}

static const struct cautest_fixture_definition stop_suite_fixture = {
    0UL, (cautest_callback)0, stop_suite_teardown
};

CAUTEST_CASE(stop_fail)
{
    (void)suite_fixture;
    (void)case_fixture;
    (void)cautest_parameter;
    ++stop_case_count;
    CAUTEST_FAIL("用于验证 stop policy");
}

CAUTEST_CASE(stop_pass)
{
    (void)cautest_ctx;
    (void)suite_fixture;
    (void)case_fixture;
    (void)cautest_parameter;
    ++stop_case_count;
}

CAUTEST_SUITE_WITH_FIXTURES(
    stop, &stop_suite_fixture, CAUTEST_NO_FIXTURE,
    CAUTEST_CASE_ENTRY(stop_fail),
    CAUTEST_CASE_ENTRY(stop_pass));
CAUTEST_REGISTRY(stop_registry, CAUTEST_SUITE_REF(stop));

struct large_fixture {
    unsigned char data[64];
};

static int overflow_body_count;

CAUTEST_CASE(overflow_case)
{
    (void)cautest_ctx;
    (void)suite_fixture;
    (void)case_fixture;
    (void)cautest_parameter;
    ++overflow_body_count;
}

static const struct cautest_fixture_definition large_case_fixture = {
    (unsigned long)sizeof(struct large_fixture),
    (cautest_callback)0,
    (cautest_callback)0
};

CAUTEST_SUITE_WITH_FIXTURES(
    overflow, CAUTEST_NO_FIXTURE, &large_case_fixture,
    CAUTEST_CASE_ENTRY(overflow_case));
CAUTEST_REGISTRY(overflow_registry, CAUTEST_SUITE_REF(overflow));

static int sink_body_count;

CAUTEST_CASE(sink_case)
{
    (void)cautest_ctx;
    (void)suite_fixture;
    (void)case_fixture;
    (void)cautest_parameter;
    ++sink_body_count;
}

CAUTEST_SUITE(sink, CAUTEST_CASE_ENTRY(sink_case));
CAUTEST_REGISTRY(sink_registry, CAUTEST_SUITE_REF(sink));

static int failed_setup_body_count;
static int failed_setup_teardown_count;

CAUTEST_FIXTURE_CALLBACK(failed_case_setup)
{
    (void)suite_fixture;
    (void)case_fixture;
    (void)cautest_parameter;
    CAUTEST_ASSERT_TRUE(0);
}

CAUTEST_FIXTURE_CALLBACK(failed_case_teardown)
{
    (void)cautest_ctx;
    (void)suite_fixture;
    (void)case_fixture;
    (void)cautest_parameter;
    ++failed_setup_teardown_count;
}

static const struct cautest_fixture_definition failed_case_fixture = {
    0UL, failed_case_setup, failed_case_teardown
};

CAUTEST_CASE(failed_setup_case)
{
    (void)cautest_ctx;
    (void)suite_fixture;
    (void)case_fixture;
    (void)cautest_parameter;
    ++failed_setup_body_count;
}

CAUTEST_SUITE_WITH_FIXTURES(
    failed_setup, CAUTEST_NO_FIXTURE, &failed_case_fixture,
    CAUTEST_CASE_ENTRY(failed_setup_case));
CAUTEST_REGISTRY(failed_setup_registry, CAUTEST_SUITE_REF(failed_setup));

static void test_status_priority(void)
{
    CHECK(cautest_status_merge(CAUTEST_STATUS_PASS,
                               CAUTEST_STATUS_SKIP) == CAUTEST_STATUS_SKIP);
    CHECK(cautest_status_merge(CAUTEST_STATUS_SKIP,
                               CAUTEST_STATUS_FAIL) == CAUTEST_STATUS_FAIL);
    CHECK(cautest_status_merge(CAUTEST_STATUS_FAIL,
                               CAUTEST_STATUS_ERROR) == CAUTEST_STATUS_ERROR);
}

static void test_registry_parameter_fixture_and_events(void)
{
    struct fake_backend backend;
    struct cautest_run_result result;
    int return_code;
    unsigned long index;
    const int expected_log[] = { 1, 2, 3, 4, 2, 3, 4, 9 };
    const enum cautest_event_kind expected_events[] = {
        CAUTEST_EVENT_TEST_GROUP_START,
        CAUTEST_EVENT_CASE_START,
        CAUTEST_EVENT_CASE_END,
        CAUTEST_EVENT_CASE_START,
        CAUTEST_EVENT_CASE_END,
        CAUTEST_EVENT_TEST_GROUP_END
    };
    CAUTEST_WORKSPACE(storage, 128);
    struct cautest_workspace workspace = CAUTEST_WORKSPACE_INIT(storage);

    fake_reset(&backend);
    lifecycle_log_count = 0UL;
    CHECK(cautest_registry_validate(&lifecycle_registry) ==
          CAUTEST_FRAMEWORK_ERROR_NONE);
    CHECK(cautest_registry_instance_count(&lifecycle_registry) == 2UL);
    result = run_registry(&lifecycle_registry, CAUTEST_STOP_CONTINUE,
                          workspace, &backend, &return_code);
    CHECK(return_code == 0);
    CHECK(result.status == CAUTEST_STATUS_PASS);
    CHECK(result.passed == 2UL && result.instance_count == 2UL);
    CHECK(lifecycle_log_count == CAUTEST_ARRAY_SIZE(expected_log));
    for (index = 0UL; index < lifecycle_log_count; ++index)
        CHECK(lifecycle_log[index] == expected_log[index]);
    CHECK(backend.count == CAUTEST_ARRAY_SIZE(expected_events));
    for (index = 0UL; index < backend.count; ++index) {
        CHECK(backend.events[index].sequence == index + 1UL);
        CHECK(backend.events[index].kind == expected_events[index]);
    }
    CHECK(strcmp(backend.events[1].parameter_name, "first") == 0);
    CHECK(strcmp(backend.events[3].parameter_name, "second") == 0);
}

static void test_assert_skip_error_and_teardown(void)
{
    struct fake_backend backend;
    struct cautest_run_result result;
    int return_code;
    CAUTEST_WORKSPACE(storage, 32);
    struct cautest_workspace workspace = CAUTEST_WORKSPACE_INIT(storage);

    fake_reset(&backend);
    assertion_progress = 0;
    assertion_teardown_count = 0;
    result = run_registry(&assertion_registry, CAUTEST_STOP_CONTINUE,
                          workspace, &backend, &return_code);
    CHECK(return_code == 0);
    CHECK(result.status == CAUTEST_STATUS_ERROR);
    CHECK(result.failed == 2UL);
    CHECK(result.skipped == 1UL);
    CHECK(result.errors == 1UL);
    CHECK(result.instance_count == 4UL);
    CHECK(assertion_progress == 2);
    CHECK(assertion_teardown_count == 4);
    CHECK(backend.count == 15UL);
    CHECK(backend.events[0].kind == CAUTEST_EVENT_TEST_GROUP_START);
    CHECK(backend.events[2].kind == CAUTEST_EVENT_ASSERTION);
    CHECK(backend.events[3].kind == CAUTEST_EVENT_ASSERTION);
    CHECK(backend.events[4].kind == CAUTEST_EVENT_CASE_END);
    CHECK(backend.events[4].status == CAUTEST_STATUS_FAIL);
    CHECK(backend.events[9].kind == CAUTEST_EVENT_SKIP);
    CHECK(backend.events[10].status == CAUTEST_STATUS_SKIP);
    CHECK(backend.events[12].kind == CAUTEST_EVENT_ASSERTION);
    CHECK(backend.events[12].status == CAUTEST_STATUS_ERROR);
    CHECK(backend.events[14].kind == CAUTEST_EVENT_TEST_GROUP_END);
    CHECK(backend.events[14].status == CAUTEST_STATUS_ERROR);
}

static void test_stop_policy_preserves_teardown(void)
{
    struct fake_backend backend;
    struct cautest_run_result result;
    int return_code;
    struct cautest_workspace workspace = { (unsigned char *)0, 0UL };

    fake_reset(&backend);
    stop_case_count = 0;
    stop_suite_teardown_count = 0;
    result = run_registry(&stop_registry, CAUTEST_STOP_ON_FAILURE,
                          workspace, &backend, &return_code);
    CHECK(return_code == 0);
    CHECK(result.status == CAUTEST_STATUS_FAIL);
    CHECK(result.instance_count == 1UL);
    CHECK(stop_case_count == 1);
    CHECK(stop_suite_teardown_count == 1);

    fake_reset(&backend);
    stop_case_count = 0;
    stop_suite_teardown_count = 0;
    result = run_registry(&stop_registry, CAUTEST_STOP_ON_ERROR,
                          workspace, &backend, &return_code);
    CHECK(return_code == 0);
    CHECK(result.status == CAUTEST_STATUS_FAIL);
    CHECK(result.instance_count == 2UL);
    CHECK(stop_case_count == 2);
    CHECK(stop_suite_teardown_count == 1);
}

static void test_typed_assertion_values(void)
{
    struct fake_backend backend;
    struct cautest_run_result result;
    int return_code;
    unsigned long index;
    unsigned long assertion = 0UL;
    struct cautest_workspace workspace = { (unsigned char *)0, 0UL };

    fake_reset(&backend);
    result = run_registry(&typed_assertion_registry, CAUTEST_STOP_CONTINUE,
                          workspace, &backend, &return_code);
    CHECK(return_code == 0);
    CHECK(result.status == CAUTEST_STATUS_FAIL);
    for (index = 0UL; index < backend.count; ++index) {
        if (backend.events[index].kind != CAUTEST_EVENT_ASSERTION)
            continue;
        ++assertion;
        if (assertion == 3UL) {
            CHECK(backend.events[index].value_kind == CAUTEST_VALUE_U64);
            CHECK(backend.events[index].expected_unsigned == ~0ULL);
        } else if (assertion == 4UL) {
            CHECK(backend.events[index].value_kind == CAUTEST_VALUE_POINTER);
            CHECK((backend.events[index].value_flags &
                   CAUTEST_VALUE_EXPECTED_NULL) != 0U);
        } else if (assertion == 5UL) {
            CHECK(backend.events[index].value_kind == CAUTEST_VALUE_STRING);
            CHECK(strcmp((const char *)backend.events[index].expected_data,
                         "expected") == 0);
        } else if (assertion == 6UL) {
            CHECK(backend.events[index].value_kind == CAUTEST_VALUE_BYTES);
            CHECK(backend.events[index].expected_size == 2UL);
        }
    }
    CHECK(assertion == 7UL);
}

static void test_workspace_overflow(void)
{
    struct fake_backend backend;
    struct cautest_run_result result;
    int return_code;
    CAUTEST_WORKSPACE(storage, 8);
    struct cautest_workspace workspace = CAUTEST_WORKSPACE_INIT(storage);

    fake_reset(&backend);
    overflow_body_count = 0;
    result = run_registry(&overflow_registry, CAUTEST_STOP_CONTINUE,
                          workspace, &backend, &return_code);
    CHECK(return_code == -1);
    CHECK(result.status == CAUTEST_STATUS_ERROR);
    CHECK(result.framework_error ==
          CAUTEST_FRAMEWORK_ERROR_WORKSPACE_OVERFLOW);
    CHECK(result.errors == 1UL);
    CHECK(overflow_body_count == 0);
}

static void test_duplicate_names(void)
{
    static const struct cautest_suite_definition *const duplicate_suites[] = {
        &cautest_suite_sink, &cautest_suite_sink
    };
    static const struct cautest_registry duplicate_registry = {
        "duplicate", duplicate_suites, 2UL
    };
    static const struct cautest_case_definition duplicate_cases[] = {
        { "same", cautest_case_sink_case, (const void *)0, 0UL, 0UL, 0UL },
        { "same", cautest_case_sink_case, (const void *)0, 0UL, 0UL, 0UL }
    };
    static const struct cautest_suite_definition duplicate_case_suite = {
        "duplicate_case", duplicate_cases, 2UL,
        CAUTEST_NO_FIXTURE, CAUTEST_NO_FIXTURE
    };
    static const struct cautest_suite_definition *const case_suites[] = {
        &duplicate_case_suite
    };
    static const struct cautest_registry duplicate_case_registry = {
        "duplicate_case_registry", case_suites, 1UL
    };

    CHECK(cautest_registry_validate(&duplicate_registry) ==
          CAUTEST_FRAMEWORK_ERROR_DUPLICATE_NAME);
    CHECK(cautest_registry_validate(&duplicate_case_registry) ==
          CAUTEST_FRAMEWORK_ERROR_DUPLICATE_NAME);
}

static void test_event_sink_failure(void)
{
    struct fake_backend backend;
    struct cautest_run_result result;
    int return_code;
    struct cautest_workspace workspace = { (unsigned char *)0, 0UL };

    fake_reset(&backend);
    backend.fail_at_call = 2UL;
    sink_body_count = 0;
    result = run_registry(&sink_registry, CAUTEST_STOP_CONTINUE,
                          workspace, &backend, &return_code);
    CHECK(return_code == -1);
    CHECK(result.status == CAUTEST_STATUS_ERROR);
    CHECK(result.framework_error == CAUTEST_FRAMEWORK_ERROR_EVENT_SINK);
    CHECK(result.emitted_event_count == 1UL);
    CHECK(sink_body_count == 0);
}

static void test_incomplete_setup_is_not_torn_down(void)
{
    struct fake_backend backend;
    struct cautest_run_result result;
    int return_code;
    struct cautest_workspace workspace = { (unsigned char *)0, 0UL };

    fake_reset(&backend);
    failed_setup_body_count = 0;
    failed_setup_teardown_count = 0;
    result = run_registry(&failed_setup_registry, CAUTEST_STOP_CONTINUE,
                          workspace, &backend, &return_code);
    CHECK(return_code == 0);
    CHECK(result.status == CAUTEST_STATUS_FAIL);
    CHECK(result.failed == 1UL);
    CHECK(failed_setup_body_count == 0);
    CHECK(failed_setup_teardown_count == 0);
}

static void test_phased_suite_execution_preserves_fixture_snapshot(void)
{
    struct fake_backend backend;
    struct cautest_execution execution;
    struct cautest_suite_execution suite_execution;
    struct cautest_run_result result;
    struct cautest_run_config config;
    struct cautest_event_sink sink;
    enum cautest_status status;
    const int expected_log[] = { 1, 2, 3, 4, 2, 3, 4, 9 };
    unsigned long index;
    CAUTEST_WORKSPACE(storage, 128);
    struct cautest_workspace workspace = CAUTEST_WORKSPACE_INIT(storage);

    fake_reset(&backend);
    lifecycle_log_count = 0UL;
    config.stop_policy = CAUTEST_STOP_CONTINUE;
    sink.emit = fake_emit;
    sink.context = &backend;
    CHECK(cautest_execution_begin(&execution, &lifecycle_registry, &config,
                                  workspace, sink, &result) == 0);
    CHECK(cautest_suite_execution_begin(&execution, 0UL,
                                        &suite_execution) == 0);
    CHECK(cautest_suite_execution_is_ready(&suite_execution));
    CHECK(cautest_suite_execution_instance_count(&suite_execution) == 2UL);
    CHECK(cautest_suite_execution_run_instance(&suite_execution, 0UL,
                                               &status) == 0);
    CHECK(status == CAUTEST_STATUS_PASS);
    CHECK(cautest_suite_execution_run_instance(&suite_execution, 1UL,
                                               &status) == 0);
    CHECK(status == CAUTEST_STATUS_PASS);
    CHECK(cautest_suite_execution_end(&suite_execution) == 0);
    CHECK(cautest_execution_finish(&execution) == 0);
    CHECK(result.status == CAUTEST_STATUS_PASS);
    CHECK(result.passed == 2UL && result.instance_count == 2UL);
    CHECK(lifecycle_log_count == CAUTEST_ARRAY_SIZE(expected_log));
    for (index = 0UL; index < lifecycle_log_count; ++index)
        CHECK(lifecycle_log[index] == expected_log[index]);
}

int main(void)
{
    test_status_priority();
    test_registry_parameter_fixture_and_events();
    test_assert_skip_error_and_teardown();
    test_typed_assertion_values();
    test_stop_policy_preserves_teardown();
    test_workspace_overflow();
    test_duplicate_names();
    test_event_sink_failure();
    test_incomplete_setup_is_not_torn_down();
    test_phased_suite_execution_preserves_fixture_snapshot();

    if (check_failed)
        return 1;
    (void)puts("cautest C Common Core: 全部测试通过");
    return 0;
}
