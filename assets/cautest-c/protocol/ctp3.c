#include <cautest/ctp3.h>

#define CTP3_U32_MAX 4294967295ULL

struct ctp3_line {
    unsigned char data[CTP3_TX_LINE_MAX];
    unsigned long size;
    int overflow;
};

static int line_escaped(struct ctp3_line *line, const char *value,
                        int allow_truncate);

static unsigned long ctp3_strlen(const char *text)
{
    unsigned long size = 0UL;
    if (text == (const char *)0)
        return 0UL;
    while (text[size] != '\0')
        ++size;
    return size;
}

static int ctp3_equal(const unsigned char *line, unsigned long size,
                      const char *text)
{
    unsigned long index;
    unsigned long text_size = ctp3_strlen(text);
    if (size != text_size)
        return 0;
    for (index = 0UL; index < size; ++index) {
        if (line[index] != (unsigned char)text[index])
            return 0;
    }
    return 1;
}

static int ctp3_starts_with(const unsigned char *line, unsigned long size,
                            const char *prefix, unsigned long *offset)
{
    unsigned long index;
    unsigned long prefix_size = ctp3_strlen(prefix);
    if (size < prefix_size)
        return 0;
    for (index = 0UL; index < prefix_size; ++index) {
        if (line[index] != (unsigned char)prefix[index])
            return 0;
    }
    *offset = prefix_size;
    return 1;
}

static void line_init(struct ctp3_line *line)
{
    line->size = 0UL;
    line->overflow = 0;
}

static void line_byte(struct ctp3_line *line, unsigned char value)
{
    if (line->overflow)
        return;
    if (line->size >= CTP3_TX_LINE_MAX - 1UL) {
        line->overflow = 1;
        return;
    }
    line->data[line->size++] = value;
}

static void line_ascii(struct ctp3_line *line, const char *text)
{
    while (text != (const char *)0 && *text != '\0')
        line_byte(line, (unsigned char)*text++);
}

static void line_u32(struct ctp3_line *line, unsigned long value)
{
    unsigned char digits[10];
    unsigned long count = 0UL;
    do {
        digits[count++] = (unsigned char)('0' + value % 10UL);
        value /= 10UL;
    } while (value != 0UL && count < sizeof(digits));
    while (count != 0UL)
        line_byte(line, digits[--count]);
}

static void line_i64(struct ctp3_line *line, long long value)
{
    unsigned char digits[20];
    unsigned long count = 0UL;
    unsigned long long magnitude;
    if (value < 0) {
        line_byte(line, (unsigned char)'-');
        magnitude = (unsigned long long)(-(value + 1LL)) + 1ULL;
    } else {
        magnitude = (unsigned long long)value;
    }
    do {
        digits[count++] = (unsigned char)('0' + magnitude % 10ULL);
        magnitude /= 10ULL;
    } while (magnitude != 0ULL && count < sizeof(digits));
    while (count != 0UL)
        line_byte(line, digits[--count]);
}

static void line_u64(struct ctp3_line *line, unsigned long long value)
{
    unsigned char digits[20];
    unsigned long count = 0UL;
    do {
        digits[count++] = (unsigned char)('0' + value % 10ULL);
        value /= 10ULL;
    } while (value != 0ULL && count < sizeof(digits));
    while (count != 0UL)
        line_byte(line, digits[--count]);
}

static const char *value_kind_name(enum cautest_value_kind kind)
{
    switch (kind) {
    case CAUTEST_VALUE_U64: return "u64";
    case CAUTEST_VALUE_POINTER: return "pointer";
    case CAUTEST_VALUE_STRING: return "string";
    case CAUTEST_VALUE_BYTES: return "bytes";
    case CAUTEST_VALUE_NONE:
    default: return "none";
    }
}

static void line_hex(struct ctp3_line *line, const void *data,
                     unsigned long size)
{
    static const char digits[] = "0123456789ABCDEF";
    const unsigned char *bytes = (const unsigned char *)data;
    unsigned long index;
    unsigned long limit = size > 32UL ? 32UL : size;
    for (index = 0UL; index < limit; ++index) {
        line_byte(line, (unsigned char)digits[bytes[index] >> 4]);
        line_byte(line, (unsigned char)digits[bytes[index] & 0x0fU]);
    }
    if (size > limit)
        line_ascii(line, "...");
}

static void line_typed_value(struct ctp3_line *line,
                             const struct cautest_event *event,
                             int expected)
{
    unsigned int null_flag = expected ? CAUTEST_VALUE_EXPECTED_NULL :
                                        CAUTEST_VALUE_ACTUAL_NULL;
    const void *data = expected ? event->expected_data : event->actual_data;
    unsigned long size = expected ? event->expected_size : event->actual_size;
    unsigned long long number = expected ? event->expected_unsigned :
                                           event->actual_unsigned;
    if ((event->value_flags & null_flag) != 0U) {
        line_ascii(line, "null");
    } else if (event->value_kind == CAUTEST_VALUE_U64 ||
               event->value_kind == CAUTEST_VALUE_POINTER) {
        line_u64(line, number);
    } else if (event->value_kind == CAUTEST_VALUE_STRING) {
        char text[97];
        unsigned long index;
        unsigned long limit = size > 96UL ? 96UL : size;
        for (index = 0UL; index < limit; ++index)
            text[index] = ((const char *)data)[index];
        text[limit] = '\0';
        if (line_escaped(line, text, 0) != 0)
            line->overflow = 1;
        if (size > limit)
            line_ascii(line, "...");
    } else if (event->value_kind == CAUTEST_VALUE_BYTES) {
        line_hex(line, data, size);
    }
}

static int utf8_unit(const unsigned char *text, unsigned long remaining)
{
    unsigned char first;
    unsigned long length;
    unsigned long index;
    if (remaining == 0UL)
        return -1;
    first = text[0];
    if (first < 0x80U)
        return 1;
    if (first >= 0xc2U && first <= 0xdfU)
        length = 2UL;
    else if (first >= 0xe0U && first <= 0xefU)
        length = 3UL;
    else if (first >= 0xf0U && first <= 0xf4U)
        length = 4UL;
    else
        return -1;
    if (remaining < length)
        return -1;
    for (index = 1UL; index < length; ++index) {
        if ((text[index] & 0xc0U) != 0x80U)
            return -1;
    }
    if ((first == 0xe0U && text[1] < 0xa0U) ||
        (first == 0xedU && text[1] >= 0xa0U) ||
        (first == 0xf0U && text[1] < 0x90U) ||
        (first == 0xf4U && text[1] >= 0x90U))
        return -1;
    return (int)length;
}

static int text_valid(const char *value, unsigned long max_size)
{
    const unsigned char *text = (const unsigned char *)value;
    unsigned long remaining;
    if (value == (const char *)0)
        return 0;
    remaining = ctp3_strlen(value);
    if (remaining > max_size)
        return 0;
    while (remaining != 0UL) {
        int unit = utf8_unit(text, remaining);
        if (unit < 0)
            return 0;
        text += unit;
        remaining -= (unsigned long)unit;
    }
    return 1;
}

/* 返回 0 表示完整，1 表示按边界截断，-1 表示非法 UTF-8。 */
static int line_escaped(struct ctp3_line *line, const char *value,
                        int allow_truncate)
{
    static const char hex[] = "0123456789ABCDEF";
    const unsigned char *text = (const unsigned char *)value;
    unsigned long remaining = ctp3_strlen(value);
    while (remaining != 0UL) {
        int unit = utf8_unit(text, remaining);
        unsigned long required;
        unsigned long index;
        if (unit < 0)
            return -1;
        if (unit == 1 && (*text == '\\' || *text == ',' || *text == '\n' ||
                          *text == '\r'))
            required = 2UL;
        else if (unit == 1 && (*text < 0x20U || *text == 0x7fU))
            required = 4UL;
        else
            required = (unsigned long)unit;
        if (line->size + required >= CTP3_TX_LINE_MAX) {
            if (allow_truncate)
                return 1;
            line->overflow = 1;
            return 0;
        }
        if (unit == 1 && *text == '\\')
            line_ascii(line, "\\\\");
        else if (unit == 1 && *text == ',')
            line_ascii(line, "\\,");
        else if (unit == 1 && *text == '\n')
            line_ascii(line, "\\n");
        else if (unit == 1 && *text == '\r')
            line_ascii(line, "\\r");
        else if (unit == 1 && (*text < 0x20U || *text == 0x7fU)) {
            line_ascii(line, "\\x");
            line_byte(line, (unsigned char)hex[*text >> 4]);
            line_byte(line, (unsigned char)hex[*text & 0x0fU]);
        } else {
            for (index = 0UL; index < (unsigned long)unit; ++index)
                line_byte(line, text[index]);
        }
        text += unit;
        remaining -= (unsigned long)unit;
    }
    return 0;
}

static int server_send(struct ctp3_server *server, struct ctp3_line *line)
{
    if (server->io_failed || line->overflow ||
        line->size >= CTP3_TX_LINE_MAX) {
        server->io_failed = 1;
        return -1;
    }
    line->data[line->size++] = (unsigned char)'\n';
    if (server->config.write(server->config.write_context, line->data,
                             line->size) != 0) {
        server->io_failed = 1;
        return -1;
    }
    return 0;
}

static int send_simple(struct ctp3_server *server, const char *text)
{
    struct ctp3_line line;
    line_init(&line);
    line_ascii(&line, text);
    return server_send(server, &line);
}

static int send_error(struct ctp3_server *server, const char *command,
                      int has_execution, unsigned long execution_id,
                      const char *code, const char *message)
{
    struct ctp3_line line;
    line_init(&line);
    line_ascii(&line, "ERROR:");
    line_ascii(&line, command);
    line_byte(&line, (unsigned char)',');
    if (has_execution) {
        line_u32(&line, execution_id);
        line_byte(&line, (unsigned char)',');
    }
    line_ascii(&line, code);
    line_byte(&line, (unsigned char)',');
    if (line_escaped(&line, message, 0) != 0)
        line.overflow = 1;
    return server_send(server, &line);
}

static const char *status_name(enum cautest_status status)
{
    if (status == CAUTEST_STATUS_PASS)
        return "PASS";
    if (status == CAUTEST_STATUS_SKIP)
        return "SKIP";
    if (status == CAUTEST_STATUS_FAIL)
        return "FAIL";
    return "ERROR";
}

static const char *level_name(enum cautest_log_level level)
{
    if (level == CAUTEST_LOG_LEVEL_TRACE)
        return "TRACE";
    if (level == CAUTEST_LOG_LEVEL_DEBUG)
        return "DEBUG";
    if (level == CAUTEST_LOG_LEVEL_WARN)
        return "WARN";
    if (level == CAUTEST_LOG_LEVEL_ERROR)
        return "ERROR";
    return "INFO";
}

static const char *framework_fault(enum cautest_framework_error error)
{
    if (error == CAUTEST_FRAMEWORK_ERROR_WORKSPACE_OVERFLOW)
        return "WORKSPACE";
    if (error == CAUTEST_FRAMEWORK_ERROR_DUPLICATE_NAME ||
        error == CAUTEST_FRAMEWORK_ERROR_INVALID_DEFINITION)
        return "REGISTRY";
    if (error == CAUTEST_FRAMEWORK_ERROR_EVENT_SINK)
        return "RESULT_IO";
    return "RUNTIME";
}

static int emit_exec_start(struct ctp3_server *server, int suite_command)
{
    struct ctp3_line line;
    line_init(&line);
    line_ascii(&line, "+EXEC-START:");
    line_u32(&line, server->execution_id);
    line_ascii(&line, suite_command ? ",SUITE," : ",CASE,");
    line_u32(&line, server->suite_id);
    line_byte(&line, (unsigned char)',');
    line_u32(&line, suite_command ? 0UL : server->case_id);
    line_byte(&line, (unsigned char)',');
    line_u32(&line, suite_command ? 0UL : server->param_id);
    return server_send(server, &line);
}

static int emit_exec_end(struct ctp3_server *server,
                         const struct cautest_run_result *result,
                         int synthetic_case_error)
{
    struct ctp3_line line;
    unsigned long errors = result->errors;
    enum cautest_status status = result->status;
    if (synthetic_case_error) {
        errors = 1UL;
        status = CAUTEST_STATUS_ERROR;
    }
    line_init(&line);
    line_ascii(&line, "+EXEC-END:");
    line_u32(&line, server->execution_id);
    line_byte(&line, (unsigned char)',');
    line_ascii(&line, status_name(status));
    line_byte(&line, (unsigned char)',');
    line_u32(&line, result->passed);
    line_byte(&line, (unsigned char)',');
    line_u32(&line, result->failed);
    line_byte(&line, (unsigned char)',');
    line_u32(&line, result->skipped);
    line_byte(&line, (unsigned char)',');
    line_u32(&line, errors);
    return server_send(server, &line);
}

static int emit_fault(struct ctp3_server *server, const char *scope,
                      const char *code, const char *message)
{
    struct ctp3_line line;
    line_init(&line);
    line_ascii(&line, "+FAULT:");
    line_u32(&line, server->execution_id);
    line_byte(&line, (unsigned char)',');
    line_ascii(&line, scope);
    line_byte(&line, (unsigned char)',');
    line_u32(&line, server->suite_id);
    line_byte(&line, (unsigned char)',');
    line_u32(&line, ctp3_equal((const unsigned char *)scope,
                               ctp3_strlen(scope), "CASE") ?
             server->case_id : 0UL);
    line_byte(&line, (unsigned char)',');
    line_u32(&line, ctp3_equal((const unsigned char *)scope,
                               ctp3_strlen(scope), "CASE") ?
             server->param_id : 0UL);
    line_byte(&line, (unsigned char)',');
    line_ascii(&line, code);
    line_byte(&line, (unsigned char)',');
    if (line_escaped(&line, message, 0) != 0)
        line.overflow = 1;
    return server_send(server, &line);
}

static int emit_log(struct ctp3_server *server, unsigned long execution_id,
                    const char *scope, unsigned long suite_id,
                    unsigned long case_id, unsigned long param_id,
                    enum cautest_log_level level, const char *message)
{
    struct ctp3_line line;
    int escaped;
    line_init(&line);
    line_ascii(&line, "+LOG:");
    line_u32(&line, execution_id);
    line_byte(&line, (unsigned char)',');
    line_ascii(&line, scope);
    line_byte(&line, (unsigned char)',');
    line_u32(&line, suite_id);
    line_byte(&line, (unsigned char)',');
    line_u32(&line, case_id);
    line_byte(&line, (unsigned char)',');
    line_u32(&line, param_id);
    line_ascii(&line, ",TARGET,");
    line_ascii(&line, level_name(level));
    line_byte(&line, (unsigned char)',');
    escaped = line_escaped(&line, message, 1);
    if (escaped < 0)
        return -1;
    if (escaped == 0)
        return server_send(server, &line);

    line_init(&line);
    line_ascii(&line, "+LOG-TRUNC:");
    line_u32(&line, execution_id);
    line_byte(&line, (unsigned char)',');
    line_ascii(&line, scope);
    line_byte(&line, (unsigned char)',');
    line_u32(&line, suite_id);
    line_byte(&line, (unsigned char)',');
    line_u32(&line, case_id);
    line_byte(&line, (unsigned char)',');
    line_u32(&line, param_id);
    line_ascii(&line, ",TARGET,");
    line_ascii(&line, level_name(level));
    line_byte(&line, (unsigned char)',');
    if (line_escaped(&line, message, 1) < 0)
        return -1;
    return server_send(server, &line);
}

static int core_event_sink(void *context, const struct cautest_event *event)
{
    struct ctp3_server *server = (struct ctp3_server *)context;
    struct ctp3_line line;
    const char *scope;
    if (event->kind == CAUTEST_EVENT_LOG) {
        scope = event->case_name != (const char *)0 ? "CASE" : "SUITE";
        return emit_log(server, server->execution_id, scope,
                        server->suite_id,
                        event->case_name != (const char *)0 ?
                            server->case_id : 0UL,
                        event->case_name != (const char *)0 ?
                            server->param_id : 0UL,
                        event->log_level, event->message);
    }
    line_init(&line);
    if (event->kind == CAUTEST_EVENT_TEST_GROUP_START) {
        line_ascii(&line, "+SUITE-START:");
        line_u32(&line, server->execution_id);
        line_byte(&line, (unsigned char)',');
        line_u32(&line, server->suite_id);
    } else if (event->kind == CAUTEST_EVENT_TEST_GROUP_END) {
        line_ascii(&line, "+SUITE-END:");
        line_u32(&line, server->execution_id);
        line_byte(&line, (unsigned char)',');
        line_u32(&line, server->suite_id);
        line_byte(&line, (unsigned char)',');
        line_ascii(&line, status_name(event->status));
    } else if (event->kind == CAUTEST_EVENT_CASE_START) {
        server->assertion_id = 0UL;
        line_ascii(&line, "+CASE-START:");
        line_u32(&line, server->execution_id);
        line_byte(&line, (unsigned char)',');
        line_u32(&line, server->suite_id);
        line_byte(&line, (unsigned char)',');
        line_u32(&line, server->case_id);
        line_byte(&line, (unsigned char)',');
        line_u32(&line, server->param_id);
    } else if (event->kind == CAUTEST_EVENT_CASE_END) {
        line_ascii(&line, "+CASE-END:");
        line_u32(&line, server->execution_id);
        line_byte(&line, (unsigned char)',');
        line_u32(&line, server->suite_id);
        line_byte(&line, (unsigned char)',');
        line_u32(&line, server->case_id);
        line_byte(&line, (unsigned char)',');
        line_u32(&line, server->param_id);
        line_byte(&line, (unsigned char)',');
        line_ascii(&line, status_name(event->status));
    } else if (event->kind == CAUTEST_EVENT_ASSERTION &&
               event->case_name == (const char *)0) {
        return emit_fault(server, "SUITE", "FIXTURE",
                          event->expression == (const char *)0 ?
                              "suite fixture failed" : event->expression);
    } else if (event->kind == CAUTEST_EVENT_ASSERTION) {
        line_ascii(&line, event->value_kind == CAUTEST_VALUE_NONE ?
                          "+ASSERT:" : "+ASSERT2:");
        line_u32(&line, server->execution_id);
        line_byte(&line, (unsigned char)',');
        line_u32(&line, server->suite_id);
        line_byte(&line, (unsigned char)',');
        line_u32(&line, server->case_id);
        line_byte(&line, (unsigned char)',');
        line_u32(&line, server->param_id);
        line_byte(&line, (unsigned char)',');
        line_u32(&line, server->assertion_id++);
        line_byte(&line, (unsigned char)',');
        line_ascii(&line, status_name(event->status));
        line_byte(&line, (unsigned char)',');
        if (line_escaped(&line, event->file == (const char *)0 ? "" :
                         event->file, 0) != 0)
            line.overflow = 1;
        line_byte(&line, (unsigned char)',');
        line_u32(&line, event->line);
        line_byte(&line, (unsigned char)',');
        if (line_escaped(&line, event->expression == (const char *)0 ? "" :
                         event->expression, 0) != 0)
            line.overflow = 1;
        line_byte(&line, (unsigned char)',');
        if (event->value_kind == CAUTEST_VALUE_NONE) {
            line_i64(&line, event->expected);
            line_byte(&line, (unsigned char)',');
            line_i64(&line, event->actual);
        } else {
            line_ascii(&line, value_kind_name(event->value_kind));
            line_byte(&line, (unsigned char)',');
            line_u32(&line, event->value_flags);
            line_byte(&line, (unsigned char)',');
            line_typed_value(&line, event, 1);
            line_byte(&line, (unsigned char)',');
            line_typed_value(&line, event, 0);
        }
    } else if (event->kind == CAUTEST_EVENT_SKIP &&
               event->case_name == (const char *)0) {
        return emit_fault(server, "SUITE", "FIXTURE",
                          event->expression == (const char *)0 ?
                              "suite fixture skipped" : event->expression);
    } else if (event->kind == CAUTEST_EVENT_SKIP) {
        line_ascii(&line, "+SKIP:");
        line_u32(&line, server->execution_id);
        line_byte(&line, (unsigned char)',');
        line_u32(&line, server->suite_id);
        line_byte(&line, (unsigned char)',');
        line_u32(&line, server->case_id);
        line_byte(&line, (unsigned char)',');
        line_u32(&line, server->param_id);
        line_byte(&line, (unsigned char)',');
        if (line_escaped(&line, event->expression == (const char *)0 ? "" :
                         event->expression, 0) != 0)
            line.overflow = 1;
    } else if (event->kind == CAUTEST_EVENT_FRAMEWORK_ERROR) {
        return emit_fault(server,
                          event->case_name != (const char *)0 ?
                              "CASE" : "SUITE",
                          framework_fault(event->framework_error),
                          "C Common Core framework error");
    } else {
        return 0;
    }
    return server_send(server, &line);
}

static unsigned long instance_index_of(
    const struct cautest_suite_definition *suite,
    unsigned long case_id, unsigned long param_id)
{
    unsigned long index = 0UL;
    unsigned long current;
    for (current = 0UL; current < case_id; ++current) {
        unsigned long count = suite->cases[current].parameter_count;
        index += count == 0UL ? 1UL : count;
    }
    return index + param_id;
}

static void instance_ids_of(const struct cautest_suite_definition *suite,
                            unsigned long instance_index,
                            unsigned long *case_id,
                            unsigned long *param_id)
{
    unsigned long current;
    for (current = 0UL; current < suite->case_count; ++current) {
        unsigned long count = suite->cases[current].parameter_count;
        count = count == 0UL ? 1UL : count;
        if (instance_index < count) {
            *case_id = current;
            *param_id = instance_index;
            return;
        }
        instance_index -= count;
    }
    *case_id = 0UL;
    *param_id = 0UL;
}

static int default_run_instance(void *context,
                                struct cautest_suite_execution *suite_execution,
                                unsigned long instance_index,
                                struct ctp3_instance_outcome *outcome)
{
    enum cautest_status status = CAUTEST_STATUS_ERROR;
    (void)context;
    if (cautest_suite_execution_run_instance(suite_execution, instance_index,
                                             &status) != 0)
        return -1;
    outcome->status = status;
    outcome->fault = CTP3_PLATFORM_FAULT_NONE;
    outcome->message = (const char *)0;
    outcome->result_recorded = 1;
    outcome->events_complete = 1;
    return 0;
}

static int should_stop(enum cautest_stop_policy policy,
                       enum cautest_status status)
{
    if (policy == CAUTEST_STOP_ON_ERROR)
        return status == CAUTEST_STATUS_ERROR;
    if (policy == CAUTEST_STOP_ON_FAILURE)
        return status == CAUTEST_STATUS_FAIL ||
               status == CAUTEST_STATUS_ERROR;
    return 0;
}

static int emit_synthetic_case_end(struct ctp3_server *server,
                                   const struct ctp3_instance_outcome *outcome)
{
    struct ctp3_line line;
    const char *code = outcome->fault == CTP3_PLATFORM_FAULT_TIMEOUT ?
                       "TIMEOUT" : outcome->fault == CTP3_PLATFORM_FAULT_CRASH ?
                       "CRASH" : "RUNTIME";
    if (emit_fault(server, "CASE", code,
                   outcome->message == (const char *)0 ?
                       "platform execution failed" : outcome->message) != 0)
        return -1;
    line_init(&line);
    line_ascii(&line, "+CASE-END:");
    line_u32(&line, server->execution_id);
    line_byte(&line, (unsigned char)',');
    line_u32(&line, server->suite_id);
    line_byte(&line, (unsigned char)',');
    line_u32(&line, server->case_id);
    line_byte(&line, (unsigned char)',');
    line_u32(&line, server->param_id);
    line_ascii(&line, ",ERROR");
    return server_send(server, &line);
}

static int execute(struct ctp3_server *server, int suite_command,
                   enum cautest_stop_policy policy)
{
    struct cautest_execution execution;
    struct cautest_suite_execution suite_execution;
    struct cautest_run_result result;
    struct cautest_run_config run_config;
    struct cautest_event_sink sink;
    const struct cautest_suite_definition *suite =
        server->config.registry->suites[server->suite_id];
    ctp3_run_instance_fn runner = server->config.run_instance ==
        (ctp3_run_instance_fn)0 ? default_run_instance :
        server->config.run_instance;
    unsigned long first;
    unsigned long count;
    unsigned long current;
    int synthetic_case_error = 0;
    int status;

    if (emit_exec_start(server, suite_command) != 0)
        return -1;
    sink.emit = core_event_sink;
    sink.context = server;
    run_config.stop_policy = policy;
    if (cautest_execution_begin(&execution, server->config.registry,
                                &run_config, server->config.workspace,
                                sink, &result) != 0)
        return -1;
    status = cautest_suite_execution_begin(&execution, server->suite_id,
                                            &suite_execution);
    if (status != 0)
        return -1;
    if (suite_command) {
        first = 0UL;
        count = cautest_suite_execution_instance_count(&suite_execution);
    } else {
        first = instance_index_of(suite, server->case_id, server->param_id);
        count = 1UL;
    }
    if (!cautest_suite_execution_is_ready(&suite_execution)) {
        if (!suite_command)
            synthetic_case_error = 1;
    } else {
        for (current = 0UL; current < count; ++current) {
            struct ctp3_instance_outcome outcome;
            unsigned long instance = first + current;
            outcome.status = CAUTEST_STATUS_ERROR;
            outcome.fault = CTP3_PLATFORM_FAULT_RUNTIME;
            outcome.message = "instance runner failed";
            outcome.result_recorded = 0;
            outcome.events_complete = 0;
            instance_ids_of(suite, instance, &server->case_id,
                            &server->param_id);
            if (runner(server->config.run_instance_context,
                       &suite_execution, instance, &outcome) != 0) {
                outcome.status = CAUTEST_STATUS_ERROR;
                outcome.fault = CTP3_PLATFORM_FAULT_RUNTIME;
                outcome.message = "instance runner failed";
                outcome.result_recorded = 0;
                outcome.events_complete = 0;
            }
            if (!outcome.events_complete &&
                emit_synthetic_case_end(server, &outcome) != 0)
                return -1;
            if (!outcome.result_recorded &&
                cautest_suite_execution_record_external_result(
                    &suite_execution, outcome.status) != 0)
                return -1;
            if (should_stop(policy, outcome.status))
                break;
        }
    }
    if (cautest_suite_execution_end(&suite_execution) != 0)
        return -1;
    status = cautest_execution_finish(&execution);
    /* Workspace and other framework failures are controlled test outcomes.
     * Only an output failure makes the protocol response incomplete. */
    if (status != 0 &&
        (result.framework_error == CAUTEST_FRAMEWORK_ERROR_EVENT_SINK ||
         server->io_failed))
        return -1;
    if (emit_exec_end(server, &result, synthetic_case_error) != 0)
        return -1;
    return 0;
}

static int parse_u32(const unsigned char *line, unsigned long size,
                     unsigned long *offset, unsigned long *value,
                     int final)
{
    unsigned long start = *offset;
    unsigned long long number = 0ULL;
    if (start >= size || line[start] < '0' || line[start] > '9')
        return -1;
    if (line[start] == '0' && start + 1UL < size &&
        line[start + 1UL] >= '0' && line[start + 1UL] <= '9')
        return -1;
    while (*offset < size && line[*offset] >= '0' && line[*offset] <= '9') {
        number = number * 10ULL + (unsigned long long)(line[*offset] - '0');
        if (number > CTP3_U32_MAX)
            return -1;
        ++*offset;
    }
    if (final) {
        if (*offset != size)
            return -1;
    } else if (*offset >= size || line[*offset] != ',') {
        return -1;
    } else {
        ++*offset;
    }
    *value = (unsigned long)number;
    return 0;
}

static int send_hello(struct ctp3_server *server)
{
    struct ctp3_line line;
    line_init(&line);
    line_ascii(&line, "+HELLO:");
    line_u32(&line, CTP3_PROTOCOL_MAJOR);
    line_byte(&line, (unsigned char)',');
    line_u32(&line, CTP3_PROTOCOL_MINOR);
    line_byte(&line, (unsigned char)',');
    if (line_escaped(&line, server->config.build_id, 0) != 0)
        line.overflow = 1;
    line_byte(&line, (unsigned char)',');
    if (line_escaped(&line, server->config.boot_id, 0) != 0)
        line.overflow = 1;
    line_byte(&line, (unsigned char)',');
    line_u32(&line, CTP3_RX_LINE_MAX);
    line_byte(&line, (unsigned char)',');
    line_u32(&line, CTP3_TX_LINE_MAX);
    if (server_send(server, &line) != 0)
        return -1;
    server->handshaken = 1;
    return send_simple(server, "OK:HELLO");
}

static const char *parameter_name(
    const struct cautest_case_definition *definition,
    unsigned long param_id)
{
    const unsigned char *row;
    const char *const *name;
    if (definition->parameter_count == 0UL)
        return "";
    row = (const unsigned char *)definition->parameter_rows +
          definition->parameter_stride * param_id;
    name = (const char *const *)(const void *)row;
    return *name;
}

static unsigned long long signature_byte(unsigned long long signature,
                                         unsigned char value)
{
    return (signature ^ (unsigned long long)value) * 1099511628211ULL;
}

static unsigned long long signature_u32(unsigned long long signature,
                                        unsigned long value)
{
    unsigned long shift;
    for (shift = 0UL; shift < 32UL; shift += 8UL)
        signature = signature_byte(
            signature, (unsigned char)((value >> shift) & 0xffUL));
    return signature;
}

static unsigned long long signature_text(unsigned long long signature,
                                         const char *text)
{
    while (*text != '\0')
        signature = signature_byte(signature, (unsigned char)*text++);
    return signature_byte(signature, 0U);
}

static unsigned long long registry_signature(
    const struct cautest_registry *registry)
{
    unsigned long long signature = 1469598103934665603ULL;
    unsigned long suite_id;
    signature = signature_text(signature, registry->name);
    signature = signature_u32(signature, registry->suite_count);
    for (suite_id = 0UL; suite_id < registry->suite_count; ++suite_id) {
        const struct cautest_suite_definition *suite =
            registry->suites[suite_id];
        unsigned long case_id;
        signature = signature_text(signature, suite->name);
        signature = signature_u32(signature, suite->case_count);
        for (case_id = 0UL; case_id < suite->case_count; ++case_id) {
            const struct cautest_case_definition *definition =
                &suite->cases[case_id];
            unsigned long param_id;
            signature = signature_text(signature, definition->name);
            signature = signature_u32(signature,
                                      definition->parameter_count);
            for (param_id = 0UL; param_id < definition->parameter_count;
                 ++param_id)
                signature = signature_text(
                    signature, parameter_name(definition, param_id));
        }
    }
    return signature;
}

static int registry_unchanged(const struct ctp3_server *server)
{
    return server->config.registry->suite_count ==
               server->registry_suite_count &&
           cautest_registry_instance_count(server->config.registry) ==
               server->registry_instance_count &&
           registry_signature(server->config.registry) ==
               server->registry_signature;
}

static int registry_fields_valid(const struct cautest_registry *registry)
{
    unsigned long suite_id;
    if (!text_valid(registry->name, CTP3_NAME_MAX))
        return 0;
    for (suite_id = 0UL; suite_id < registry->suite_count; ++suite_id) {
        const struct cautest_suite_definition *suite =
            registry->suites[suite_id];
        unsigned long case_id;
        if (!text_valid(suite->name, CTP3_NAME_MAX))
            return 0;
        for (case_id = 0UL; case_id < suite->case_count; ++case_id) {
            const struct cautest_case_definition *definition =
                &suite->cases[case_id];
            unsigned long param_id;
            if (!text_valid(definition->name, CTP3_NAME_MAX))
                return 0;
            for (param_id = 0UL; param_id < definition->parameter_count;
                 ++param_id) {
                if (!text_valid(parameter_name(definition, param_id),
                                CTP3_NAME_MAX))
                    return 0;
            }
        }
    }
    return 1;
}

static int send_list(struct ctp3_server *server)
{
    unsigned long suite_id;
    unsigned long count = 0UL;
    if (!registry_unchanged(server))
        return send_error(server, "LIST", 0, 0UL, "REGISTRY_CHANGED",
                          "registry changed during connection");
    if (send_simple(server, "+LIST:START") != 0)
        return -1;
    for (suite_id = 0UL; suite_id < server->config.registry->suite_count;
         ++suite_id) {
        const struct cautest_suite_definition *suite =
            server->config.registry->suites[suite_id];
        unsigned long case_id;
        for (case_id = 0UL; case_id < suite->case_count; ++case_id) {
            const struct cautest_case_definition *definition =
                &suite->cases[case_id];
            unsigned long params = definition->parameter_count == 0UL ?
                                   1UL : definition->parameter_count;
            unsigned long param_id;
            for (param_id = 0UL; param_id < params; ++param_id) {
                struct ctp3_line line;
                line_init(&line);
                line_ascii(&line, "+CASE:");
                line_u32(&line, suite_id);
                line_byte(&line, (unsigned char)',');
                line_u32(&line, case_id);
                line_byte(&line, (unsigned char)',');
                line_u32(&line, param_id);
                line_byte(&line, (unsigned char)',');
                if (line_escaped(&line, suite->name, 0) != 0)
                    line.overflow = 1;
                line_byte(&line, (unsigned char)',');
                if (line_escaped(&line, definition->name, 0) != 0)
                    line.overflow = 1;
                line_byte(&line, (unsigned char)',');
                if (line_escaped(&line, parameter_name(definition, param_id),
                                 0) != 0)
                    line.overflow = 1;
                if (line.overflow)
                    return send_error(server, "LIST", 0, 0UL,
                                      "FIELD_TOO_LONG",
                                      "catalog field exceeds line limit");
                if (server_send(server, &line) != 0)
                    return -1;
                ++count;
            }
        }
    }
    {
        struct ctp3_line line;
        line_init(&line);
        line_ascii(&line, "+LIST:END,");
        line_u32(&line, count);
        if (server_send(server, &line) != 0)
            return -1;
    }
    return send_simple(server, "OK:LIST");
}

static int validate_selection(struct ctp3_server *server,
                              unsigned long suite_id,
                              unsigned long case_id,
                              unsigned long param_id,
                              int suite_command)
{
    const struct cautest_suite_definition *suite;
    const struct cautest_case_definition *definition;
    if (suite_id >= server->config.registry->suite_count)
        return -1;
    if (suite_command)
        return 0;
    suite = server->config.registry->suites[suite_id];
    if (case_id >= suite->case_count)
        return -1;
    definition = &suite->cases[case_id];
    if (definition->parameter_count == 0UL)
        return param_id == 0UL ? 0 : -1;
    return param_id < definition->parameter_count ? 0 : -1;
}

static int handle_case(struct ctp3_server *server,
                       const unsigned char *line, unsigned long size,
                       unsigned long offset)
{
    unsigned long execution_id;
    unsigned long suite_id;
    unsigned long case_id;
    unsigned long param_id;
    struct ctp3_line response;
    if (parse_u32(line, size, &offset, &execution_id, 0) != 0)
        return send_error(server, "CASE", 0, 0UL, "BAD_ARGUMENT",
                          "invalid execution id");
    if (execution_id == 0UL)
        return send_error(server, "CASE", 1, execution_id, "BAD_ARGUMENT",
                          "execution id must be nonzero");
    if (parse_u32(line, size, &offset, &suite_id, 0) != 0 ||
        parse_u32(line, size, &offset, &case_id, 0) != 0 ||
        parse_u32(line, size, &offset, &param_id, 1) != 0)
        return send_error(server, "CASE", 1, execution_id, "BAD_ARGUMENT",
                          "CASE requires execution,suite,case,param ids");
    if (!server->handshaken)
        return send_error(server, "CASE", 1, execution_id, "BAD_STATE",
                          "HELLO required");
    if (!registry_unchanged(server))
        return send_error(server, "CASE", 1, execution_id,
                          "REGISTRY_CHANGED",
                          "registry changed during connection");
    if (execution_id <= server->last_execution_id)
        return send_error(server, "CASE", 1, execution_id,
                          "OUT_OF_ORDER_EXECUTION_ID",
                          "execution id must increase");
    if (validate_selection(server, suite_id, case_id, param_id, 0) != 0)
        return send_error(server, "CASE", 1, execution_id, "NOT_FOUND",
                          "case id not found");
    server->last_execution_id = execution_id;
    server->execution_id = execution_id;
    server->suite_id = suite_id;
    server->case_id = case_id;
    server->param_id = param_id;
    if (execute(server, 0, CAUTEST_STOP_CONTINUE) != 0)
        return server->io_failed ? -1 :
            send_error(server, "CASE", 1, execution_id, "INTERNAL",
                       "execution did not produce a reliable result");
    line_init(&response);
    line_ascii(&response, "OK:CASE,");
    line_u32(&response, execution_id);
    return server_send(server, &response);
}

static int parse_policy(const unsigned char *line, unsigned long size,
                        unsigned long offset, enum cautest_stop_policy *policy)
{
    if (ctp3_equal(line + offset, size - offset, "CONTINUE"))
        *policy = CAUTEST_STOP_CONTINUE;
    else if (ctp3_equal(line + offset, size - offset, "STOP_ON_FAIL"))
        *policy = CAUTEST_STOP_ON_FAILURE;
    else if (ctp3_equal(line + offset, size - offset, "STOP_ON_ERROR"))
        *policy = CAUTEST_STOP_ON_ERROR;
    else
        return -1;
    return 0;
}

static int handle_suite(struct ctp3_server *server,
                        const unsigned char *line, unsigned long size,
                        unsigned long offset)
{
    unsigned long execution_id;
    unsigned long suite_id;
    enum cautest_stop_policy policy;
    struct ctp3_line response;
    if (parse_u32(line, size, &offset, &execution_id, 0) != 0)
        return send_error(server, "SUITE", 0, 0UL, "BAD_ARGUMENT",
                          "invalid execution id");
    if (execution_id == 0UL)
        return send_error(server, "SUITE", 1, execution_id, "BAD_ARGUMENT",
                          "execution id must be nonzero");
    if (parse_u32(line, size, &offset, &suite_id, 0) != 0 ||
        parse_policy(line, size, offset, &policy) != 0)
        return send_error(server, "SUITE", 1, execution_id, "BAD_ARGUMENT",
                          "SUITE requires execution,suite,policy");
    if (!server->handshaken)
        return send_error(server, "SUITE", 1, execution_id, "BAD_STATE",
                          "HELLO required");
    if (!registry_unchanged(server))
        return send_error(server, "SUITE", 1, execution_id,
                          "REGISTRY_CHANGED",
                          "registry changed during connection");
    if (execution_id <= server->last_execution_id)
        return send_error(server, "SUITE", 1, execution_id,
                          "OUT_OF_ORDER_EXECUTION_ID",
                          "execution id must increase");
    if (validate_selection(server, suite_id, 0UL, 0UL, 1) != 0)
        return send_error(server, "SUITE", 1, execution_id, "NOT_FOUND",
                          "suite id not found");
    server->last_execution_id = execution_id;
    server->execution_id = execution_id;
    server->suite_id = suite_id;
    server->case_id = 0UL;
    server->param_id = 0UL;
    if (execute(server, 1, policy) != 0)
        return server->io_failed ? -1 :
            send_error(server, "SUITE", 1, execution_id, "INTERNAL",
                       "execution did not produce a reliable result");
    line_init(&response);
    line_ascii(&response, "OK:SUITE,");
    line_u32(&response, execution_id);
    return server_send(server, &response);
}

static int handle_line(struct ctp3_server *server,
                       const unsigned char *line, unsigned long size)
{
    unsigned long offset = 0UL;
    if (size == 0UL)
        return 0;
    if (ctp3_equal(line, size, "AT"))
        return send_simple(server, "OK:AT");
    if (ctp3_equal(line, size, "AT+HELLO"))
        return send_hello(server);
    if (ctp3_equal(line, size, "AT+LIST")) {
        if (!server->handshaken)
            return send_error(server, "LIST", 0, 0UL, "BAD_STATE",
                              "HELLO required");
        return send_list(server);
    }
    if (ctp3_equal(line, size, "AT+BYE")) {
        server->closing = 1;
        return send_simple(server, "OK:BYE");
    }
    if (ctp3_starts_with(line, size, "AT+CASE=", &offset))
        return handle_case(server, line, size, offset);
    if (ctp3_starts_with(line, size, "AT+SUITE=", &offset))
        return handle_suite(server, line, size, offset);
    return send_error(server, "AT", 0, 0UL, "UNKNOWN_COMMAND",
                      "unknown command");
}

int ctp3_server_init(struct ctp3_server *server,
                     const struct ctp3_server_config *config)
{
    if (server == (struct ctp3_server *)0 ||
        config == (const struct ctp3_server_config *)0 ||
        config->registry == (const struct cautest_registry *)0 ||
        config->build_id == (const char *)0 ||
        config->boot_id == (const char *)0 ||
        config->write == (ctp3_write_fn)0 ||
        (config->workspace.capacity != 0UL &&
         config->workspace.data == (unsigned char *)0) ||
        cautest_registry_validate(config->registry) !=
            CAUTEST_FRAMEWORK_ERROR_NONE ||
        !text_valid(config->build_id, CTP3_IDENTITY_MAX) ||
        !text_valid(config->boot_id, CTP3_IDENTITY_MAX) ||
        !registry_fields_valid(config->registry))
        return -1;
    server->config = *config;
    server->rx_size = 0UL;
    server->last_execution_id = 0UL;
    server->execution_id = 0UL;
    server->suite_id = 0UL;
    server->case_id = 0UL;
    server->param_id = 0UL;
    server->assertion_id = 0UL;
    server->registry_suite_count = config->registry->suite_count;
    server->registry_instance_count =
        cautest_registry_instance_count(config->registry);
    server->registry_signature = registry_signature(config->registry);
    server->handshaken = 0;
    server->discarding = 0;
    server->closing = 0;
    server->io_failed = 0;
    return 0;
}

int ctp3_server_feed(struct ctp3_server *server,
                     const unsigned char *data,
                     unsigned long size)
{
    unsigned long index;
    if (server == (struct ctp3_server *)0 ||
        (size != 0UL && data == (const unsigned char *)0) ||
        server->io_failed || server->closing)
        return -1;
    for (index = 0UL; index < size; ++index) {
        unsigned char byte = data[index];
        if (server->discarding) {
            if (byte == '\n') {
                server->discarding = 0;
                server->rx_size = 0UL;
                if (send_error(server, "AT", 0, 0UL, "LINE_TOO_LONG",
                               "input line exceeds rx limit") != 0)
                    return -1;
            }
            continue;
        }
        if (byte == '\n') {
            unsigned long line_size = server->rx_size;
            unsigned long line_index;
            int encoding_ok = 1;
            if (line_size != 0UL && server->rx[line_size - 1UL] == '\r')
                --line_size;
            for (line_index = 0UL; line_index < line_size; ++line_index) {
                if (server->rx[line_index] < 0x20U ||
                    server->rx[line_index] > 0x7eU) {
                    encoding_ok = 0;
                    break;
                }
            }
            if (!encoding_ok) {
                if (send_error(server, "AT", 0, 0UL, "BAD_ENCODING",
                               "command must be printable ASCII") != 0)
                    return -1;
            } else if (handle_line(server, server->rx, line_size) != 0)
                return -1;
            server->rx_size = 0UL;
            if (server->closing)
                return 0;
        } else if (server->rx_size >= CTP3_RX_LINE_MAX - 1UL) {
            server->discarding = 1;
        } else {
            server->rx[server->rx_size++] = byte;
        }
    }
    return 0;
}

int ctp3_server_is_closing(const struct ctp3_server *server)
{
    return server != (const struct ctp3_server *)0 && server->closing;
}

int ctp3_server_log_target(struct ctp3_server *server,
                           enum cautest_log_level level,
                           const char *message)
{
    if (server == (struct ctp3_server *)0 || message == (const char *)0 ||
        level < CAUTEST_LOG_LEVEL_TRACE || level > CAUTEST_LOG_LEVEL_ERROR)
        return -1;
    return emit_log(server, 0UL, "TARGET", 0UL, 0UL, 0UL, level, message);
}
