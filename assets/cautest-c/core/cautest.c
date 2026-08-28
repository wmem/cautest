#include <cautest/cautest.h>

struct cautest_runner_state {
    const struct cautest_registry *registry;
    struct cautest_event_sink sink;
    struct cautest_run_result *result;
    unsigned long next_sequence;
    int sink_failed;
};

struct cautest_context {
    struct cautest_runner_state *runner;
    const char *suite_name;
    const char *case_name;
    const char *parameter_name;
    enum cautest_status status;
    int fatal;
};

struct cautest_execution_internal {
    struct cautest_runner_state runner;
    struct cautest_run_config config;
    struct cautest_workspace workspace;
    int active_suite;
    int initialized;
};

struct cautest_suite_execution_internal {
    struct cautest_execution_internal *execution;
    const struct cautest_suite_definition *suite;
    void *suite_fixture;
    unsigned long suite_workspace_end;
    enum cautest_status status;
    int setup_complete;
    int ready;
    int active;
};

typedef char cautest_execution_state_size_check[
    sizeof(struct cautest_execution_internal) <= CAUTEST_EXECUTION_STATE_SIZE ?
    1 : -1];
typedef char cautest_suite_execution_state_size_check[
    sizeof(struct cautest_suite_execution_internal) <=
        CAUTEST_SUITE_EXECUTION_STATE_SIZE ? 1 : -1];

static int cautest_string_equal(const char *left, const char *right)
{
    if (left == right)
        return 1;
    if (left == (const char *)0 || right == (const char *)0)
        return 0;
    while (*left != '\0' && *right != '\0') {
        if (*left != *right)
            return 0;
        ++left;
        ++right;
    }
    return *left == *right;
}

enum cautest_status cautest_status_merge(enum cautest_status left,
                                         enum cautest_status right)
{
    return left >= right ? left : right;
}

static void cautest_event_initialize(struct cautest_event *event)
{
    event->sequence = 0UL;
    event->kind = CAUTEST_EVENT_FRAMEWORK_ERROR;
    event->status = CAUTEST_STATUS_PASS;
    event->framework_error = CAUTEST_FRAMEWORK_ERROR_NONE;
    event->registry_name = (const char *)0;
    event->suite_name = (const char *)0;
    event->case_name = (const char *)0;
    event->parameter_name = (const char *)0;
    event->expression = (const char *)0;
    event->file = (const char *)0;
    event->line = 0UL;
    event->expected = 0;
    event->actual = 0;
    event->log_level = CAUTEST_LOG_LEVEL_INFO;
    event->message = (const char *)0;
    event->value_kind = CAUTEST_VALUE_NONE;
    event->value_flags = 0U;
    event->expected_unsigned = 0ULL;
    event->actual_unsigned = 0ULL;
    event->expected_data = (const void *)0;
    event->actual_data = (const void *)0;
    event->expected_size = 0UL;
    event->actual_size = 0UL;
}

static int cautest_emit(struct cautest_runner_state *runner,
                        struct cautest_event *event)
{
    int rc;

    if (runner->sink_failed)
        return -1;

    event->sequence = runner->next_sequence++;
    event->registry_name = runner->registry->name;
    if (runner->sink.emit == (int (*)(void *, const struct cautest_event *))0) {
        ++runner->result->emitted_event_count;
        return 0;
    }

    rc = runner->sink.emit(runner->sink.context, event);
    if (rc != 0) {
        runner->sink_failed = 1;
        runner->result->framework_error = CAUTEST_FRAMEWORK_ERROR_EVENT_SINK;
        runner->result->status = CAUTEST_STATUS_ERROR;
        return -1;
    }
    ++runner->result->emitted_event_count;
    return 0;
}

static int cautest_emit_context(struct cautest_context *context,
                                enum cautest_event_kind kind,
                                enum cautest_status status,
                                const char *expression,
                                const char *file,
                                unsigned long line,
                                long long expected,
                                long long actual)
{
    struct cautest_event event;

    cautest_event_initialize(&event);
    event.kind = kind;
    event.status = status;
    event.suite_name = context->suite_name;
    event.case_name = context->case_name;
    event.parameter_name = context->parameter_name;
    event.expression = expression;
    event.file = file;
    event.line = line;
    event.expected = expected;
    event.actual = actual;
    if (cautest_emit(context->runner, &event) != 0) {
        context->status = CAUTEST_STATUS_ERROR;
        context->fatal = 1;
        return -1;
    }
    return 0;
}

static void cautest_record_framework_error(
    struct cautest_runner_state *runner,
    enum cautest_framework_error error,
    const char *suite_name,
    const char *case_name,
    const char *parameter_name)
{
    struct cautest_event event;

    runner->result->status = CAUTEST_STATUS_ERROR;
    if (runner->result->framework_error == CAUTEST_FRAMEWORK_ERROR_NONE)
        runner->result->framework_error = error;
    cautest_event_initialize(&event);
    event.kind = CAUTEST_EVENT_FRAMEWORK_ERROR;
    event.status = CAUTEST_STATUS_ERROR;
    event.framework_error = error;
    event.suite_name = suite_name;
    event.case_name = case_name;
    event.parameter_name = parameter_name;
    (void)cautest_emit(runner, &event);
}

static int cautest_assertion(struct cautest_context *context,
                            int condition,
                            int fatal,
                            const char *expression,
                            const char *file,
                            unsigned long line,
                            long long expected,
                            long long actual)
{
    if (context == (struct cautest_context *)0 || context->runner == 0)
        return 1;
    if (context->fatal)
        return 1;
    if (condition)
        return 0;

    context->status = cautest_status_merge(context->status,
                                           CAUTEST_STATUS_FAIL);
    if (cautest_emit_context(context, CAUTEST_EVENT_ASSERTION,
                             CAUTEST_STATUS_FAIL, expression, file, line,
                             expected, actual) != 0)
        return 1;
    if (fatal) {
        context->fatal = 1;
        return 1;
    }
    return 0;
}

static int cautest_assertion_typed(
    struct cautest_context *context, int condition, int fatal,
    const char *expression, const char *file, unsigned long line,
    enum cautest_value_kind value_kind, unsigned int value_flags,
    unsigned long long expected_unsigned,
    unsigned long long actual_unsigned,
    const void *expected_data, unsigned long expected_size,
    const void *actual_data, unsigned long actual_size)
{
    struct cautest_event event;

    if (context == (struct cautest_context *)0 || context->runner == 0)
        return 1;
    if (context->fatal)
        return 1;
    if (condition)
        return 0;
    context->status = cautest_status_merge(context->status,
                                           CAUTEST_STATUS_FAIL);
    cautest_event_initialize(&event);
    event.kind = CAUTEST_EVENT_ASSERTION;
    event.status = CAUTEST_STATUS_FAIL;
    event.suite_name = context->suite_name;
    event.case_name = context->case_name;
    event.parameter_name = context->parameter_name;
    event.expression = expression;
    event.file = file;
    event.line = line;
    event.value_kind = value_kind;
    event.value_flags = value_flags;
    event.expected_unsigned = expected_unsigned;
    event.actual_unsigned = actual_unsigned;
    event.expected_data = expected_data;
    event.actual_data = actual_data;
    event.expected_size = expected_size;
    event.actual_size = actual_size;
    if (cautest_emit(context->runner, &event) != 0) {
        context->status = CAUTEST_STATUS_ERROR;
        context->fatal = 1;
        return 1;
    }
    if (fatal) {
        context->fatal = 1;
        return 1;
    }
    return 0;
}

static unsigned long cautest_text_size(const char *text)
{
    unsigned long size = 0UL;
    if (text == (const char *)0)
        return 0UL;
    while (text[size] != '\0')
        ++size;
    return size;
}

static int cautest_memory_equal(const unsigned char *expected,
                                const unsigned char *actual,
                                unsigned long size)
{
    unsigned long index;
    if (expected == actual)
        return 1;
    if (expected == (const unsigned char *)0 ||
        actual == (const unsigned char *)0)
        return 0;
    for (index = 0UL; index < size; ++index) {
        if (expected[index] != actual[index])
            return 0;
    }
    return 1;
}

int cautest_expect_true(struct cautest_context *context,
                        int condition,
                        const char *expression,
                        const char *file,
                        unsigned long line)
{
    return cautest_assertion(context, condition, 0, expression, file, line,
                             1, condition ? 1 : 0);
}

int cautest_assert_true(struct cautest_context *context,
                        int condition,
                        const char *expression,
                        const char *file,
                        unsigned long line)
{
    return cautest_assertion(context, condition, 1, expression, file, line,
                             1, condition ? 1 : 0);
}

int cautest_expect_eq_int(struct cautest_context *context,
                          long long expected,
                          long long actual,
                          const char *file,
                          unsigned long line)
{
    return cautest_assertion(context, expected == actual, 0, "integer equality",
                             file, line, expected, actual);
}

int cautest_assert_eq_int(struct cautest_context *context,
                          long long expected,
                          long long actual,
                          const char *file,
                          unsigned long line)
{
    return cautest_assertion(context, expected == actual, 1, "integer equality",
                             file, line, expected, actual);
}

int cautest_expect_false(struct cautest_context *context,
                         int condition,
                         const char *expression,
                         const char *file,
                         unsigned long line)
{
    return cautest_assertion(context, !condition, 0, expression, file, line,
                             0, condition ? 1 : 0);
}

int cautest_assert_false(struct cautest_context *context,
                         int condition,
                         const char *expression,
                         const char *file,
                         unsigned long line)
{
    return cautest_assertion(context, !condition, 1, expression, file, line,
                             0, condition ? 1 : 0);
}

int cautest_expect_ne_int(struct cautest_context *context,
                          long long expected,
                          long long actual,
                          const char *file,
                          unsigned long line)
{
    return cautest_assertion(context, expected != actual, 0,
                             "integer inequality", file, line,
                             expected, actual);
}

int cautest_assert_ne_int(struct cautest_context *context,
                          long long expected,
                          long long actual,
                          const char *file,
                          unsigned long line)
{
    return cautest_assertion(context, expected != actual, 1,
                             "integer inequality", file, line,
                             expected, actual);
}

int cautest_expect_compare_u64(struct cautest_context *context,
                               unsigned long long expected,
                               unsigned long long actual,
                               int equal,
                               int fatal,
                               const char *expression,
                               const char *file,
                               unsigned long line)
{
    int condition = equal ? expected == actual : expected != actual;
    return cautest_assertion_typed(context, condition, fatal, expression,
        file, line, CAUTEST_VALUE_U64, 0U, expected, actual,
        (const void *)0, 0UL, (const void *)0, 0UL);
}

int cautest_expect_pointer(struct cautest_context *context,
                           const void *expected,
                           const void *actual,
                           int equal,
                           int fatal,
                           const char *expression,
                           const char *file,
                           unsigned long line)
{
    int condition = equal ? expected == actual : expected != actual;
    unsigned int flags = 0U;
    if (expected == (const void *)0)
        flags |= CAUTEST_VALUE_EXPECTED_NULL;
    if (actual == (const void *)0)
        flags |= CAUTEST_VALUE_ACTUAL_NULL;
    return cautest_assertion_typed(context, condition, fatal, expression,
        file, line, CAUTEST_VALUE_POINTER, flags,
        (unsigned long long)(unsigned long)expected,
        (unsigned long long)(unsigned long)actual,
        (const void *)0, 0UL, (const void *)0, 0UL);
}

int cautest_expect_string(struct cautest_context *context,
                          const char *expected,
                          const char *actual,
                          int equal,
                          int fatal,
                          const char *expression,
                          const char *file,
                          unsigned long line)
{
    int same = cautest_string_equal(expected, actual);
    unsigned int flags = 0U;
    if (expected == (const char *)0)
        flags |= CAUTEST_VALUE_EXPECTED_NULL;
    if (actual == (const char *)0)
        flags |= CAUTEST_VALUE_ACTUAL_NULL;
    return cautest_assertion_typed(context, equal ? same : !same, fatal,
        expression, file, line, CAUTEST_VALUE_STRING, flags, 0ULL, 0ULL,
        expected, cautest_text_size(expected), actual, cautest_text_size(actual));
}

int cautest_expect_memory(struct cautest_context *context,
                          const void *expected,
                          const void *actual,
                          unsigned long size,
                          int equal,
                          int fatal,
                          const char *expression,
                          const char *file,
                          unsigned long line)
{
    int same = cautest_memory_equal((const unsigned char *)expected,
                                    (const unsigned char *)actual, size);
    unsigned int flags = 0U;
    if (expected == (const void *)0)
        flags |= CAUTEST_VALUE_EXPECTED_NULL;
    if (actual == (const void *)0)
        flags |= CAUTEST_VALUE_ACTUAL_NULL;
    return cautest_assertion_typed(context, equal ? same : !same, fatal,
        expression, file, line, CAUTEST_VALUE_BYTES, flags, 0ULL, 0ULL,
        expected, size, actual, size);
}

int cautest_fail(struct cautest_context *context,
                 const char *reason,
                 const char *file,
                 unsigned long line)
{
    return cautest_assertion(context, 0, 1, reason, file, line, 1, 0);
}

int cautest_skip(struct cautest_context *context,
                 const char *reason,
                 const char *file,
                 unsigned long line)
{
    if (context == (struct cautest_context *)0 || context->runner == 0)
        return 1;
    context->status = cautest_status_merge(context->status,
                                           CAUTEST_STATUS_SKIP);
    context->fatal = 1;
    (void)cautest_emit_context(context, CAUTEST_EVENT_SKIP,
                               CAUTEST_STATUS_SKIP, reason, file, line, 0, 0);
    return 1;
}

int cautest_error(struct cautest_context *context,
                  const char *reason,
                  const char *file,
                  unsigned long line)
{
    if (context == (struct cautest_context *)0 || context->runner == 0)
        return 1;
    context->status = CAUTEST_STATUS_ERROR;
    context->fatal = 1;
    (void)cautest_emit_context(context, CAUTEST_EVENT_ASSERTION,
                               CAUTEST_STATUS_ERROR, reason, file, line, 0, 0);
    return 1;
}

int cautest_context_has_fatal(const struct cautest_context *context)
{
    return context == (const struct cautest_context *)0 || context->fatal;
}

int cautest_log(struct cautest_context *context,
                enum cautest_log_level level,
                const char *message)
{
    struct cautest_event event;

    if (context == (struct cautest_context *)0 || context->runner == 0 ||
        message == (const char *)0 || level < CAUTEST_LOG_LEVEL_TRACE ||
        level > CAUTEST_LOG_LEVEL_ERROR)
        return -1;
    cautest_event_initialize(&event);
    event.kind = CAUTEST_EVENT_LOG;
    event.suite_name = context->suite_name;
    event.case_name = context->case_name;
    event.parameter_name = context->parameter_name;
    event.log_level = level;
    event.message = message;
    if (cautest_emit(context->runner, &event) != 0) {
        context->status = CAUTEST_STATUS_ERROR;
        context->fatal = 1;
        return -1;
    }
    return 0;
}

static const char *cautest_parameter_name(
    const struct cautest_case_definition *case_definition,
    unsigned long index)
{
    const unsigned char *row;

    row = (const unsigned char *)case_definition->parameter_rows +
          index * case_definition->parameter_stride;
    return *(const char *const *)row;
}

static const void *cautest_parameter_value(
    const struct cautest_case_definition *case_definition,
    unsigned long index)
{
    const unsigned char *row;

    row = (const unsigned char *)case_definition->parameter_rows +
          index * case_definition->parameter_stride;
    return row + case_definition->parameter_value_offset;
}

enum cautest_framework_error cautest_registry_validate(
    const struct cautest_registry *registry)
{
    unsigned long suite_index;
    unsigned long other_suite_index;

    if (registry == (const struct cautest_registry *)0 ||
        registry->name == (const char *)0 ||
        (registry->suite_count != 0UL && registry->suites == 0))
        return CAUTEST_FRAMEWORK_ERROR_INVALID_ARGUMENT;

    for (suite_index = 0UL; suite_index < registry->suite_count; ++suite_index) {
        const struct cautest_suite_definition *suite;
        unsigned long case_index;
        unsigned long other_case_index;

        suite = registry->suites[suite_index];
        if (suite == (const struct cautest_suite_definition *)0 ||
            suite->name == (const char *)0 ||
            (suite->case_count != 0UL && suite->cases == 0))
            return CAUTEST_FRAMEWORK_ERROR_INVALID_DEFINITION;

        for (other_suite_index = 0UL; other_suite_index < suite_index;
             ++other_suite_index) {
            if (cautest_string_equal(suite->name,
                                     registry->suites[other_suite_index]->name))
                return CAUTEST_FRAMEWORK_ERROR_DUPLICATE_NAME;
        }

        for (case_index = 0UL; case_index < suite->case_count; ++case_index) {
            const struct cautest_case_definition *case_definition;
            unsigned long parameter_index;
            unsigned long other_parameter_index;

            case_definition = &suite->cases[case_index];
            if (case_definition->name == (const char *)0 ||
                case_definition->callback == (cautest_callback)0)
                return CAUTEST_FRAMEWORK_ERROR_INVALID_DEFINITION;
            for (other_case_index = 0UL; other_case_index < case_index;
                 ++other_case_index) {
                if (cautest_string_equal(
                        case_definition->name,
                        suite->cases[other_case_index].name))
                    return CAUTEST_FRAMEWORK_ERROR_DUPLICATE_NAME;
            }

            if (case_definition->parameter_count == 0UL) {
                if (case_definition->parameter_rows != (const void *)0 ||
                    case_definition->parameter_stride != 0UL ||
                    case_definition->parameter_value_offset != 0UL)
                    return CAUTEST_FRAMEWORK_ERROR_INVALID_DEFINITION;
                continue;
            }
            if (case_definition->parameter_rows == (const void *)0 ||
                case_definition->parameter_stride < sizeof(const char *) ||
                case_definition->parameter_value_offset >=
                    case_definition->parameter_stride ||
                case_definition->parameter_count >
                    (~0UL) / case_definition->parameter_stride)
                return CAUTEST_FRAMEWORK_ERROR_INVALID_DEFINITION;

            for (parameter_index = 0UL;
                 parameter_index < case_definition->parameter_count;
                 ++parameter_index) {
                const char *name;

                name = cautest_parameter_name(case_definition, parameter_index);
                if (name == (const char *)0)
                    return CAUTEST_FRAMEWORK_ERROR_INVALID_DEFINITION;
                for (other_parameter_index = 0UL;
                     other_parameter_index < parameter_index;
                     ++other_parameter_index) {
                    if (cautest_string_equal(
                            name, cautest_parameter_name(case_definition,
                                                         other_parameter_index)))
                        return CAUTEST_FRAMEWORK_ERROR_DUPLICATE_NAME;
                }
            }
        }
    }
    return CAUTEST_FRAMEWORK_ERROR_NONE;
}

unsigned long cautest_registry_instance_count(
    const struct cautest_registry *registry)
{
    unsigned long suite_index;
    unsigned long count;

    if (cautest_registry_validate(registry) != CAUTEST_FRAMEWORK_ERROR_NONE)
        return 0UL;
    count = 0UL;
    for (suite_index = 0UL; suite_index < registry->suite_count; ++suite_index) {
        const struct cautest_suite_definition *suite;
        unsigned long case_index;

        suite = registry->suites[suite_index];
        for (case_index = 0UL; case_index < suite->case_count; ++case_index) {
            unsigned long instances;

            instances = suite->cases[case_index].parameter_count;
            count += instances == 0UL ? 1UL : instances;
        }
    }
    return count;
}

static unsigned long cautest_aligned_size(unsigned long size)
{
    unsigned long alignment;
    unsigned long remainder;

    alignment = (unsigned long)sizeof(union cautest_workspace_alignment);
    remainder = size % alignment;
    if (remainder == 0UL)
        return size;
    if (size > (~0UL) - (alignment - remainder))
        return ~0UL;
    return size + alignment - remainder;
}

static void *cautest_workspace_allocate(struct cautest_workspace workspace,
                                        unsigned long offset,
                                        unsigned long size,
                                        unsigned long *next_offset)
{
    unsigned long allocated;

    if (size == 0UL) {
        *next_offset = offset;
        return (void *)0;
    }
    allocated = cautest_aligned_size(size);
    if (allocated == ~0UL || offset > workspace.capacity ||
        allocated > workspace.capacity - offset || workspace.data == 0)
        return (void *)0;
    *next_offset = offset + allocated;
    return workspace.data + offset;
}

static void cautest_context_initialize(struct cautest_context *context,
                                       struct cautest_runner_state *runner,
                                       const char *suite_name,
                                       const char *case_name,
                                       const char *parameter_name)
{
    context->runner = runner;
    context->suite_name = suite_name;
    context->case_name = case_name;
    context->parameter_name = parameter_name;
    context->status = CAUTEST_STATUS_PASS;
    context->fatal = 0;
}

static void cautest_add_case_result(struct cautest_run_result *result,
                                    enum cautest_status status)
{
    ++result->instance_count;
    if (status == CAUTEST_STATUS_PASS)
        ++result->passed;
    else if (status == CAUTEST_STATUS_FAIL)
        ++result->failed;
    else if (status == CAUTEST_STATUS_SKIP)
        ++result->skipped;
    else
        ++result->errors;
    result->status = cautest_status_merge(result->status, status);
}

static int cautest_should_stop(enum cautest_stop_policy policy,
                               enum cautest_status status)
{
    if (policy == CAUTEST_STOP_ON_ERROR)
        return status == CAUTEST_STATUS_ERROR;
    if (policy == CAUTEST_STOP_ON_FAILURE)
        return status == CAUTEST_STATUS_FAIL ||
               status == CAUTEST_STATUS_ERROR;
    return 0;
}

static enum cautest_status cautest_run_case(
    struct cautest_runner_state *runner,
    const struct cautest_suite_definition *suite,
    const struct cautest_case_definition *case_definition,
    const char *parameter_name,
    const void *parameter_value,
    struct cautest_workspace workspace,
    unsigned long suite_workspace_end,
    void *suite_fixture)
{
    struct cautest_context context;
    struct cautest_event event;
    void *case_fixture;
    unsigned long case_workspace_end;
    int case_setup_complete;

    cautest_context_initialize(&context, runner, suite->name,
                               case_definition->name, parameter_name);
    cautest_event_initialize(&event);
    event.kind = CAUTEST_EVENT_CASE_START;
    event.suite_name = suite->name;
    event.case_name = case_definition->name;
    event.parameter_name = parameter_name;
    if (cautest_emit(runner, &event) != 0) {
        context.status = CAUTEST_STATUS_ERROR;
        context.fatal = 1;
    }

    case_fixture = (void *)0;
    case_workspace_end = suite_workspace_end;
    if (!context.fatal && suite->case_fixture != 0) {
        case_fixture = cautest_workspace_allocate(
            workspace, suite_workspace_end, suite->case_fixture->size,
            &case_workspace_end);
        if (suite->case_fixture->size != 0UL && case_fixture == (void *)0) {
            context.status = CAUTEST_STATUS_ERROR;
            context.fatal = 1;
            cautest_record_framework_error(
                runner, CAUTEST_FRAMEWORK_ERROR_WORKSPACE_OVERFLOW,
                suite->name, case_definition->name, parameter_name);
        }
    }

    case_setup_complete = suite->case_fixture == 0 ||
                          suite->case_fixture->setup == (cautest_callback)0;
    if (!context.fatal && suite->case_fixture != 0 &&
        suite->case_fixture->setup != (cautest_callback)0) {
        suite->case_fixture->setup(&context, suite_fixture, case_fixture,
                                   parameter_value);
        case_setup_complete = !context.fatal;
    }

    if (!context.fatal)
        case_definition->callback(&context, suite_fixture, case_fixture,
                                  parameter_value);

    if (case_setup_complete && suite->case_fixture != 0 &&
        suite->case_fixture->teardown != (cautest_callback)0) {
        context.fatal = 0;
        suite->case_fixture->teardown(&context, suite_fixture, case_fixture,
                                      parameter_value);
    }

    if (runner->sink_failed)
        context.status = CAUTEST_STATUS_ERROR;
    cautest_event_initialize(&event);
    event.kind = CAUTEST_EVENT_CASE_END;
    event.status = context.status;
    event.suite_name = suite->name;
    event.case_name = case_definition->name;
    event.parameter_name = parameter_name;
    (void)cautest_emit(runner, &event);
    return context.status;
}

static enum cautest_status cautest_run_suite(
    struct cautest_runner_state *runner,
    const struct cautest_suite_definition *suite,
    const struct cautest_run_config *config,
    struct cautest_workspace workspace,
    int *stop)
{
    struct cautest_context suite_context;
    struct cautest_event event;
    enum cautest_status suite_status;
    void *suite_fixture;
    unsigned long suite_workspace_end;
    unsigned long case_index;
    int suite_setup_complete;

    suite_status = CAUTEST_STATUS_PASS;
    cautest_context_initialize(&suite_context, runner, suite->name,
                               (const char *)0, (const char *)0);
    cautest_event_initialize(&event);
    event.kind = CAUTEST_EVENT_TEST_GROUP_START;
    event.suite_name = suite->name;
    if (cautest_emit(runner, &event) != 0) {
        suite_context.status = CAUTEST_STATUS_ERROR;
        suite_context.fatal = 1;
    }

    suite_fixture = (void *)0;
    suite_workspace_end = 0UL;
    if (!suite_context.fatal && suite->suite_fixture != 0) {
        suite_fixture = cautest_workspace_allocate(
            workspace, 0UL, suite->suite_fixture->size,
            &suite_workspace_end);
        if (suite->suite_fixture->size != 0UL && suite_fixture == (void *)0) {
            suite_context.status = CAUTEST_STATUS_ERROR;
            suite_context.fatal = 1;
            cautest_record_framework_error(
                runner, CAUTEST_FRAMEWORK_ERROR_WORKSPACE_OVERFLOW,
                suite->name, (const char *)0, (const char *)0);
        }
    }

    suite_setup_complete = suite->suite_fixture == 0 ||
                           suite->suite_fixture->setup == (cautest_callback)0;
    if (!suite_context.fatal && suite->suite_fixture != 0 &&
        suite->suite_fixture->setup != (cautest_callback)0) {
        suite->suite_fixture->setup(&suite_context, suite_fixture,
                                     (void *)0, (const void *)0);
        if (suite_context.status != CAUTEST_STATUS_PASS) {
            suite_context.status = CAUTEST_STATUS_ERROR;
            suite_context.fatal = 1;
        }
        suite_setup_complete = !suite_context.fatal;
    }
    suite_status = cautest_status_merge(suite_status, suite_context.status);

    if (!suite_context.fatal) {
        for (case_index = 0UL; case_index < suite->case_count; ++case_index) {
            const struct cautest_case_definition *case_definition;
            unsigned long parameter_count;
            unsigned long parameter_index;

            case_definition = &suite->cases[case_index];
            parameter_count = case_definition->parameter_count == 0UL ?
                              1UL : case_definition->parameter_count;
            for (parameter_index = 0UL; parameter_index < parameter_count;
                 ++parameter_index) {
                const char *parameter_name;
                const void *parameter_value;
                enum cautest_status case_status;

                if (case_definition->parameter_count == 0UL) {
                    parameter_name = (const char *)0;
                    parameter_value = (const void *)0;
                } else {
                    parameter_name = cautest_parameter_name(case_definition,
                                                             parameter_index);
                    parameter_value = cautest_parameter_value(case_definition,
                                                               parameter_index);
                }
                case_status = cautest_run_case(
                    runner, suite, case_definition, parameter_name,
                    parameter_value, workspace, suite_workspace_end,
                    suite_fixture);
                cautest_add_case_result(runner->result, case_status);
                suite_status = cautest_status_merge(suite_status, case_status);
                if (runner->sink_failed ||
                    cautest_should_stop(config->stop_policy, case_status)) {
                    *stop = 1;
                    break;
                }
            }
            if (*stop)
                break;
        }
    }

    if (suite_setup_complete && suite->suite_fixture != 0 &&
        suite->suite_fixture->teardown != (cautest_callback)0) {
        suite_context.fatal = 0;
        suite->suite_fixture->teardown(&suite_context, suite_fixture,
                                        (void *)0, (const void *)0);
        if (suite_context.status != CAUTEST_STATUS_PASS)
            suite_context.status = CAUTEST_STATUS_ERROR;
        suite_status = cautest_status_merge(suite_status,
                                            suite_context.status);
    }
    if (runner->sink_failed)
        suite_status = CAUTEST_STATUS_ERROR;
    if (cautest_should_stop(config->stop_policy, suite_status))
        *stop = 1;

    cautest_event_initialize(&event);
    event.kind = CAUTEST_EVENT_TEST_GROUP_END;
    event.status = suite_status;
    event.suite_name = suite->name;
    (void)cautest_emit(runner, &event);
    runner->result->status = cautest_status_merge(runner->result->status,
                                                  suite_status);
    return suite_status;
}

int cautest_run(const struct cautest_registry *registry,
                const struct cautest_run_config *config,
                struct cautest_workspace workspace,
                struct cautest_event_sink sink,
                struct cautest_run_result *result)
{
    struct cautest_runner_state runner;
    struct cautest_run_config default_config;
    enum cautest_framework_error validation_error;
    unsigned long suite_index;
    int stop;

    if (result == (struct cautest_run_result *)0)
        return -1;
    result->status = CAUTEST_STATUS_PASS;
    result->framework_error = CAUTEST_FRAMEWORK_ERROR_NONE;
    result->passed = 0UL;
    result->failed = 0UL;
    result->skipped = 0UL;
    result->errors = 0UL;
    result->instance_count = 0UL;
    result->emitted_event_count = 0UL;

    default_config.stop_policy = CAUTEST_STOP_CONTINUE;
    if (config == (const struct cautest_run_config *)0)
        config = &default_config;
    if (config->stop_policy < CAUTEST_STOP_CONTINUE ||
        config->stop_policy > CAUTEST_STOP_ON_ERROR ||
        (workspace.capacity != 0UL && workspace.data == 0)) {
        result->status = CAUTEST_STATUS_ERROR;
        result->framework_error = CAUTEST_FRAMEWORK_ERROR_INVALID_ARGUMENT;
        return -1;
    }

    runner.registry = registry;
    runner.sink = sink;
    runner.result = result;
    runner.next_sequence = 1UL;
    runner.sink_failed = 0;

    validation_error = cautest_registry_validate(registry);
    if (validation_error != CAUTEST_FRAMEWORK_ERROR_NONE) {
        /* registry 为空时无法安全读取名称，因此不尝试发送事件。 */
        result->status = CAUTEST_STATUS_ERROR;
        result->framework_error = validation_error;
        if (registry != (const struct cautest_registry *)0 &&
            registry->name != (const char *)0)
            cautest_record_framework_error(&runner, validation_error,
                                           (const char *)0, (const char *)0,
                                           (const char *)0);
        return -1;
    }

    stop = 0;
    for (suite_index = 0UL; suite_index < registry->suite_count; ++suite_index) {
        (void)cautest_run_suite(&runner, registry->suites[suite_index], config,
                                workspace, &stop);
        if (stop)
            break;
    }
    if (runner.sink_failed) {
        result->status = CAUTEST_STATUS_ERROR;
        result->framework_error = CAUTEST_FRAMEWORK_ERROR_EVENT_SINK;
        return -1;
    }
    return result->framework_error == CAUTEST_FRAMEWORK_ERROR_NONE ? 0 : -1;
}

static struct cautest_execution_internal *cautest_execution_internal_of(
    struct cautest_execution *execution)
{
    if (execution == (struct cautest_execution *)0)
        return (struct cautest_execution_internal *)0;
    return (struct cautest_execution_internal *)execution->private_state.bytes;
}

static struct cautest_suite_execution_internal *
cautest_suite_execution_internal_of(
    struct cautest_suite_execution *suite_execution)
{
    if (suite_execution == (struct cautest_suite_execution *)0)
        return (struct cautest_suite_execution_internal *)0;
    return (struct cautest_suite_execution_internal *)
        suite_execution->private_state.bytes;
}

static const struct cautest_suite_execution_internal *
cautest_suite_execution_internal_const_of(
    const struct cautest_suite_execution *suite_execution)
{
    if (suite_execution == (const struct cautest_suite_execution *)0)
        return (const struct cautest_suite_execution_internal *)0;
    return (const struct cautest_suite_execution_internal *)
        suite_execution->private_state.bytes;
}

int cautest_execution_begin(
    struct cautest_execution *execution,
    const struct cautest_registry *registry,
    const struct cautest_run_config *config,
    struct cautest_workspace workspace,
    struct cautest_event_sink sink,
    struct cautest_run_result *result)
{
    struct cautest_execution_internal *internal;
    enum cautest_framework_error validation_error;

    if (execution == (struct cautest_execution *)0 ||
        result == (struct cautest_run_result *)0)
        return -1;
    internal = cautest_execution_internal_of(execution);
    internal->initialized = 0;
    result->status = CAUTEST_STATUS_PASS;
    result->framework_error = CAUTEST_FRAMEWORK_ERROR_NONE;
    result->passed = 0UL;
    result->failed = 0UL;
    result->skipped = 0UL;
    result->errors = 0UL;
    result->instance_count = 0UL;
    result->emitted_event_count = 0UL;
    internal->config.stop_policy = config ==
        (const struct cautest_run_config *)0 ? CAUTEST_STOP_CONTINUE :
        config->stop_policy;
    if (internal->config.stop_policy < CAUTEST_STOP_CONTINUE ||
        internal->config.stop_policy > CAUTEST_STOP_ON_ERROR ||
        (workspace.capacity != 0UL && workspace.data == 0)) {
        result->status = CAUTEST_STATUS_ERROR;
        result->framework_error = CAUTEST_FRAMEWORK_ERROR_INVALID_ARGUMENT;
        return -1;
    }
    internal->runner.registry = registry;
    internal->runner.sink = sink;
    internal->runner.result = result;
    internal->runner.next_sequence = 1UL;
    internal->runner.sink_failed = 0;
    internal->workspace = workspace;
    internal->active_suite = 0;
    validation_error = cautest_registry_validate(registry);
    if (validation_error != CAUTEST_FRAMEWORK_ERROR_NONE) {
        result->status = CAUTEST_STATUS_ERROR;
        result->framework_error = validation_error;
        if (registry != (const struct cautest_registry *)0 &&
            registry->name != (const char *)0)
            cautest_record_framework_error(&internal->runner,
                                           validation_error,
                                           (const char *)0,
                                           (const char *)0,
                                           (const char *)0);
        return -1;
    }
    internal->initialized = 1;
    return 0;
}

int cautest_execution_finish(struct cautest_execution *execution)
{
    struct cautest_execution_internal *internal =
        cautest_execution_internal_of(execution);
    if (internal == (struct cautest_execution_internal *)0 ||
        !internal->initialized || internal->active_suite)
        return -1;
    internal->initialized = 0;
    if (internal->runner.sink_failed) {
        internal->runner.result->status = CAUTEST_STATUS_ERROR;
        internal->runner.result->framework_error =
            CAUTEST_FRAMEWORK_ERROR_EVENT_SINK;
        return -1;
    }
    return internal->runner.result->framework_error ==
        CAUTEST_FRAMEWORK_ERROR_NONE ? 0 : -1;
}

int cautest_suite_execution_begin(
    struct cautest_execution *execution,
    unsigned long suite_index,
    struct cautest_suite_execution *suite_execution)
{
    struct cautest_execution_internal *owner =
        cautest_execution_internal_of(execution);
    struct cautest_suite_execution_internal *internal =
        cautest_suite_execution_internal_of(suite_execution);
    struct cautest_context context;
    struct cautest_event event;

    if (owner == (struct cautest_execution_internal *)0 ||
        internal == (struct cautest_suite_execution_internal *)0 ||
        !owner->initialized || owner->active_suite ||
        suite_index >= owner->runner.registry->suite_count)
        return -1;
    internal->execution = owner;
    internal->suite = owner->runner.registry->suites[suite_index];
    internal->suite_fixture = (void *)0;
    internal->suite_workspace_end = 0UL;
    internal->status = CAUTEST_STATUS_PASS;
    internal->setup_complete = internal->suite->suite_fixture == 0 ||
        internal->suite->suite_fixture->setup == (cautest_callback)0;
    internal->ready = 1;
    internal->active = 1;
    owner->active_suite = 1;

    cautest_context_initialize(&context, &owner->runner,
                               internal->suite->name,
                               (const char *)0, (const char *)0);
    cautest_event_initialize(&event);
    event.kind = CAUTEST_EVENT_TEST_GROUP_START;
    event.suite_name = internal->suite->name;
    if (cautest_emit(&owner->runner, &event) != 0) {
        context.status = CAUTEST_STATUS_ERROR;
        context.fatal = 1;
    }
    if (!context.fatal && internal->suite->suite_fixture != 0) {
        internal->suite_fixture = cautest_workspace_allocate(
            owner->workspace, 0UL,
            internal->suite->suite_fixture->size,
            &internal->suite_workspace_end);
        if (internal->suite->suite_fixture->size != 0UL &&
            internal->suite_fixture == (void *)0) {
            context.status = CAUTEST_STATUS_ERROR;
            context.fatal = 1;
            cautest_record_framework_error(
                &owner->runner, CAUTEST_FRAMEWORK_ERROR_WORKSPACE_OVERFLOW,
                internal->suite->name, (const char *)0, (const char *)0);
        }
    }
    if (!context.fatal && internal->suite->suite_fixture != 0 &&
        internal->suite->suite_fixture->setup != (cautest_callback)0) {
        internal->suite->suite_fixture->setup(
            &context, internal->suite_fixture, (void *)0, (const void *)0);
        if (context.status != CAUTEST_STATUS_PASS) {
            context.status = CAUTEST_STATUS_ERROR;
            context.fatal = 1;
        }
        internal->setup_complete = !context.fatal;
    }
    internal->status = cautest_status_merge(internal->status,
                                             context.status);
    internal->ready = !context.fatal && !owner->runner.sink_failed;
    return 0;
}

int cautest_suite_execution_is_ready(
    const struct cautest_suite_execution *suite_execution)
{
    const struct cautest_suite_execution_internal *internal =
        cautest_suite_execution_internal_const_of(suite_execution);
    return internal != (const struct cautest_suite_execution_internal *)0 &&
           internal->active && internal->ready;
}

unsigned long cautest_suite_execution_instance_count(
    const struct cautest_suite_execution *suite_execution)
{
    const struct cautest_suite_execution_internal *internal =
        cautest_suite_execution_internal_const_of(suite_execution);
    unsigned long case_index;
    unsigned long count = 0UL;
    if (internal == (const struct cautest_suite_execution_internal *)0 ||
        !internal->active)
        return 0UL;
    for (case_index = 0UL; case_index < internal->suite->case_count;
         ++case_index) {
        unsigned long instances =
            internal->suite->cases[case_index].parameter_count;
        count += instances == 0UL ? 1UL : instances;
    }
    return count;
}

static int cautest_suite_execution_find_instance(
    const struct cautest_suite_execution_internal *internal,
    unsigned long instance_index,
    const struct cautest_case_definition **case_definition,
    const char **parameter_name,
    const void **parameter_value)
{
    unsigned long case_index;
    for (case_index = 0UL; case_index < internal->suite->case_count;
         ++case_index) {
        const struct cautest_case_definition *definition =
            &internal->suite->cases[case_index];
        unsigned long count = definition->parameter_count == 0UL ?
                              1UL : definition->parameter_count;
        if (instance_index >= count) {
            instance_index -= count;
            continue;
        }
        *case_definition = definition;
        if (definition->parameter_count == 0UL) {
            *parameter_name = (const char *)0;
            *parameter_value = (const void *)0;
        } else {
            *parameter_name = cautest_parameter_name(definition,
                                                      instance_index);
            *parameter_value = cautest_parameter_value(definition,
                                                        instance_index);
        }
        return 0;
    }
    return -1;
}

int cautest_suite_execution_run_instance(
    struct cautest_suite_execution *suite_execution,
    unsigned long instance_index,
    enum cautest_status *status)
{
    struct cautest_suite_execution_internal *internal =
        cautest_suite_execution_internal_of(suite_execution);
    const struct cautest_case_definition *case_definition;
    const char *parameter_name;
    const void *parameter_value;
    enum cautest_status case_status;
    if (internal == (struct cautest_suite_execution_internal *)0 ||
        status == (enum cautest_status *)0 || !internal->active ||
        !internal->ready ||
        cautest_suite_execution_find_instance(
            internal, instance_index, &case_definition, &parameter_name,
            &parameter_value) != 0)
        return -1;
    case_status = cautest_run_case(
        &internal->execution->runner, internal->suite, case_definition,
        parameter_name, parameter_value, internal->execution->workspace,
        internal->suite_workspace_end, internal->suite_fixture);
    cautest_add_case_result(internal->execution->runner.result, case_status);
    internal->status = cautest_status_merge(internal->status, case_status);
    *status = case_status;
    return 0;
}

int cautest_suite_execution_record_external_result(
    struct cautest_suite_execution *suite_execution,
    enum cautest_status status)
{
    struct cautest_suite_execution_internal *internal =
        cautest_suite_execution_internal_of(suite_execution);
    if (internal == (struct cautest_suite_execution_internal *)0 ||
        !internal->active || status < CAUTEST_STATUS_PASS ||
        status > CAUTEST_STATUS_ERROR)
        return -1;
    cautest_add_case_result(internal->execution->runner.result, status);
    internal->status = cautest_status_merge(internal->status, status);
    return 0;
}

int cautest_suite_execution_end(
    struct cautest_suite_execution *suite_execution)
{
    struct cautest_suite_execution_internal *internal =
        cautest_suite_execution_internal_of(suite_execution);
    struct cautest_context context;
    struct cautest_event event;
    if (internal == (struct cautest_suite_execution_internal *)0 ||
        !internal->active)
        return -1;
    cautest_context_initialize(&context, &internal->execution->runner,
                               internal->suite->name,
                               (const char *)0, (const char *)0);
    context.status = internal->status;
    if (internal->setup_complete && internal->suite->suite_fixture != 0 &&
        internal->suite->suite_fixture->teardown != (cautest_callback)0) {
        enum cautest_status status_before_teardown = context.status;
        context.fatal = 0;
        internal->suite->suite_fixture->teardown(
            &context, internal->suite_fixture, (void *)0, (const void *)0);
        if (context.status > status_before_teardown)
            context.status = CAUTEST_STATUS_ERROR;
        internal->status = cautest_status_merge(internal->status,
                                                 context.status);
    }
    if (internal->execution->runner.sink_failed)
        internal->status = CAUTEST_STATUS_ERROR;
    cautest_event_initialize(&event);
    event.kind = CAUTEST_EVENT_TEST_GROUP_END;
    event.status = internal->status;
    event.suite_name = internal->suite->name;
    (void)cautest_emit(&internal->execution->runner, &event);
    internal->execution->runner.result->status = cautest_status_merge(
        internal->execution->runner.result->status, internal->status);
    internal->active = 0;
    internal->execution->active_suite = 0;
    return internal->execution->runner.sink_failed ? -1 : 0;
}
