#ifndef CAUTEST_CAUTEST_H
#define CAUTEST_CAUTEST_H

#include <cautest/version.h>

#ifdef __cplusplus
extern "C" {
#endif

/*
 * Common Core 只使用 C99 语言本身，不依赖 libc、动态内存或注册魔法。
 * 所有描述符及名称字符串都由测试程序以静态存储期提供。
 */

enum cautest_status {
    CAUTEST_STATUS_PASS = 0,
    CAUTEST_STATUS_SKIP = 1,
    CAUTEST_STATUS_FAIL = 2,
    CAUTEST_STATUS_ERROR = 3
};

enum cautest_event_kind {
    CAUTEST_EVENT_TEST_GROUP_START = 0,
    CAUTEST_EVENT_CASE_START,
    CAUTEST_EVENT_ASSERTION,
    CAUTEST_EVENT_SKIP,
    CAUTEST_EVENT_CASE_END,
    CAUTEST_EVENT_TEST_GROUP_END,
    CAUTEST_EVENT_FRAMEWORK_ERROR,
    CAUTEST_EVENT_LOG
};

enum cautest_log_level {
    CAUTEST_LOG_LEVEL_TRACE = 0,
    CAUTEST_LOG_LEVEL_DEBUG,
    CAUTEST_LOG_LEVEL_INFO,
    CAUTEST_LOG_LEVEL_WARN,
    CAUTEST_LOG_LEVEL_ERROR
};

enum cautest_value_kind {
    CAUTEST_VALUE_NONE = 0,
    CAUTEST_VALUE_U64,
    CAUTEST_VALUE_POINTER,
    CAUTEST_VALUE_STRING,
    CAUTEST_VALUE_BYTES
};

#define CAUTEST_VALUE_EXPECTED_NULL (1U << 0)
#define CAUTEST_VALUE_ACTUAL_NULL (1U << 1)

enum cautest_stop_policy {
    CAUTEST_STOP_CONTINUE = 0,
    CAUTEST_STOP_ON_FAILURE,
    CAUTEST_STOP_ON_ERROR
};

enum cautest_framework_error {
    CAUTEST_FRAMEWORK_ERROR_NONE = 0,
    CAUTEST_FRAMEWORK_ERROR_INVALID_ARGUMENT,
    CAUTEST_FRAMEWORK_ERROR_DUPLICATE_NAME,
    CAUTEST_FRAMEWORK_ERROR_INVALID_DEFINITION,
    CAUTEST_FRAMEWORK_ERROR_WORKSPACE_OVERFLOW,
    CAUTEST_FRAMEWORK_ERROR_EVENT_SINK
};

struct cautest_context;

typedef void (*cautest_callback)(struct cautest_context *context,
                                void *suite_fixture,
                                void *case_fixture,
                                const void *parameter);

struct cautest_fixture_definition {
    unsigned long size;
    cautest_callback setup;
    cautest_callback teardown;
};

struct cautest_case_definition {
    const char *name;
    cautest_callback callback;
    const void *parameter_rows;
    unsigned long parameter_count;
    unsigned long parameter_stride;
    unsigned long parameter_value_offset;
};

struct cautest_suite_definition {
    const char *name;
    const struct cautest_case_definition *cases;
    unsigned long case_count;
    const struct cautest_fixture_definition *suite_fixture;
    const struct cautest_fixture_definition *case_fixture;
};

struct cautest_registry {
    const char *name;
    const struct cautest_suite_definition *const *suites;
    unsigned long suite_count;
};

struct cautest_event {
    unsigned long sequence;
    enum cautest_event_kind kind;
    enum cautest_status status;
    enum cautest_framework_error framework_error;
    const char *registry_name;
    const char *suite_name;
    const char *case_name;
    const char *parameter_name;
    const char *expression;
    const char *file;
    unsigned long line;
    long long expected;
    long long actual;
    enum cautest_log_level log_level;
    const char *message;
    enum cautest_value_kind value_kind;
    unsigned int value_flags;
    unsigned long long expected_unsigned;
    unsigned long long actual_unsigned;
    const void *expected_data;
    const void *actual_data;
    unsigned long expected_size;
    unsigned long actual_size;
};

struct cautest_event_sink {
    int (*emit)(void *context, const struct cautest_event *event);
    void *context;
};

struct cautest_workspace {
    unsigned char *data;
    unsigned long capacity;
};

struct cautest_run_config {
    enum cautest_stop_policy stop_policy;
};

struct cautest_run_result {
    enum cautest_status status;
    enum cautest_framework_error framework_error;
    unsigned long passed;
    unsigned long failed;
    unsigned long skipped;
    unsigned long errors;
    unsigned long instance_count;
    unsigned long emitted_event_count;
};

/*
 * 分阶段执行状态使用调用方提供的静态存储，POSIX backend 可在 Suite Setup
 * 后 fork，并让每个 Child 从相同 fixture 快照执行一个 Case Instance。
 * private_state 不属于 ABI 可解释字段，调用方只能通过下列 API 使用。
 */
#define CAUTEST_EXECUTION_STATE_SIZE 128UL
#define CAUTEST_SUITE_EXECUTION_STATE_SIZE 192UL

struct cautest_execution {
    union {
        union cautest_workspace_alignment *alignment;
        unsigned char bytes[CAUTEST_EXECUTION_STATE_SIZE];
    } private_state;
};

struct cautest_suite_execution {
    union {
        union cautest_workspace_alignment *alignment;
        unsigned char bytes[CAUTEST_SUITE_EXECUTION_STATE_SIZE];
    } private_state;
};

/* 提供覆盖 C99 基本类型自然对齐要求的静态 workspace。 */
union cautest_workspace_alignment {
    void *pointer_value;
    long long integer_value;
    long double floating_value;
};

#define CAUTEST_ARRAY_SIZE(array_) \
    ((unsigned long)(sizeof(array_) / sizeof((array_)[0])))
#define CAUTEST_OFFSET_OF(type_, member_) \
    ((unsigned long)&(((type_ *)0)->member_))
#define CAUTEST_WORKSPACE(name_, size_) \
    union { \
        union cautest_workspace_alignment alignment; \
        unsigned char bytes[(size_)]; \
    } name_
#define CAUTEST_WORKSPACE_INIT(name_) \
    { (name_).bytes, (unsigned long)sizeof((name_).bytes) }

#define CAUTEST_NO_FIXTURE ((const struct cautest_fixture_definition *)0)

#define CAUTEST_CASE(name_) \
    static void cautest_case_##name_(struct cautest_context *cautest_ctx, \
                                     void *suite_fixture, \
                                     void *case_fixture, \
                                     const void *cautest_parameter)

#define CAUTEST_PARAM_CASE(name_, type_, parameter_) \
    static void cautest_param_impl_##name_( \
        struct cautest_context *cautest_ctx, void *suite_fixture, \
        void *case_fixture, const type_ *parameter_); \
    static void cautest_case_##name_(struct cautest_context *cautest_ctx, \
                                     void *suite_fixture, \
                                     void *case_fixture, \
                                     const void *cautest_parameter) \
    { \
        cautest_param_impl_##name_(cautest_ctx, suite_fixture, case_fixture, \
                                   (const type_ *)cautest_parameter); \
    } \
    static void cautest_param_impl_##name_( \
        struct cautest_context *cautest_ctx, void *suite_fixture, \
        void *case_fixture, const type_ *parameter_)

#define CAUTEST_FIXTURE_CALLBACK(name_) \
    static void name_(struct cautest_context *cautest_ctx, \
                      void *suite_fixture, void *case_fixture, \
                      const void *cautest_parameter)

#define CAUTEST_FIXTURE(name_, type_, setup_, teardown_) \
    static const struct cautest_fixture_definition name_ = { \
        (unsigned long)sizeof(type_), (setup_), (teardown_) \
    }

#define CAUTEST_PARAM_TABLE(name_, type_, ...) \
    static const struct name_##_cautest_parameter_row { \
        const char *name; \
        type_ value; \
    } name_[] = { __VA_ARGS__ }

#define CAUTEST_PARAM_ROW(label_, ...) { (label_), __VA_ARGS__ }

#define CAUTEST_CASE_ENTRY(name_) \
    { #name_, cautest_case_##name_, (const void *)0, 0UL, 0UL, 0UL }

#define CAUTEST_PARAM_CASE_ENTRY(name_, table_) \
    { #name_, cautest_case_##name_, (const void *)(table_), \
      CAUTEST_ARRAY_SIZE(table_), (unsigned long)sizeof((table_)[0]), \
      CAUTEST_OFFSET_OF(struct table_##_cautest_parameter_row, value) }

#define CAUTEST_SUITE(name_, ...) \
    static const struct cautest_case_definition cautest_cases_##name_[] = { \
        __VA_ARGS__ \
    }; \
    const struct cautest_suite_definition cautest_suite_##name_ = { \
        #name_, cautest_cases_##name_, CAUTEST_ARRAY_SIZE(cautest_cases_##name_), \
        CAUTEST_NO_FIXTURE, CAUTEST_NO_FIXTURE \
    }

#define CAUTEST_SUITE_WITH_FIXTURES(name_, suite_fixture_, case_fixture_, ...) \
    static const struct cautest_case_definition cautest_cases_##name_[] = { \
        __VA_ARGS__ \
    }; \
    const struct cautest_suite_definition cautest_suite_##name_ = { \
        #name_, cautest_cases_##name_, CAUTEST_ARRAY_SIZE(cautest_cases_##name_), \
        (suite_fixture_), (case_fixture_) \
    }

#define CAUTEST_SUITE_DECLARE(name_) \
    extern const struct cautest_suite_definition cautest_suite_##name_
#define CAUTEST_SUITE_REF(name_) (&cautest_suite_##name_)

#define CAUTEST_REGISTRY(name_, ...) \
    static const struct cautest_suite_definition *const \
        cautest_registry_suites_##name_[] = { __VA_ARGS__ }; \
    const struct cautest_registry name_ = { \
        #name_, cautest_registry_suites_##name_, \
        CAUTEST_ARRAY_SIZE(cautest_registry_suites_##name_) \
    }

enum cautest_status cautest_status_merge(enum cautest_status left,
                                         enum cautest_status right);

int cautest_expect_true(struct cautest_context *context,
                        int condition,
                        const char *expression,
                        const char *file,
                        unsigned long line);
int cautest_assert_true(struct cautest_context *context,
                        int condition,
                        const char *expression,
                        const char *file,
                        unsigned long line);
int cautest_expect_eq_int(struct cautest_context *context,
                          long long expected,
                          long long actual,
                          const char *file,
                          unsigned long line);
int cautest_assert_eq_int(struct cautest_context *context,
                          long long expected,
                          long long actual,
                          const char *file,
                          unsigned long line);
int cautest_expect_false(struct cautest_context *context, int condition,
                         const char *expression, const char *file,
                         unsigned long line);
int cautest_assert_false(struct cautest_context *context, int condition,
                         const char *expression, const char *file,
                         unsigned long line);
int cautest_expect_ne_int(struct cautest_context *context, long long expected,
                          long long actual, const char *file,
                          unsigned long line);
int cautest_assert_ne_int(struct cautest_context *context, long long expected,
                          long long actual, const char *file,
                          unsigned long line);
int cautest_expect_compare_u64(struct cautest_context *context,
                               unsigned long long expected,
                               unsigned long long actual, int equal,
                               int fatal, const char *expression,
                               const char *file, unsigned long line);
int cautest_expect_pointer(struct cautest_context *context,
                           const void *expected, const void *actual,
                           int equal, int fatal, const char *expression,
                           const char *file, unsigned long line);
int cautest_expect_string(struct cautest_context *context,
                          const char *expected, const char *actual,
                          int equal, int fatal, const char *expression,
                          const char *file, unsigned long line);
int cautest_expect_memory(struct cautest_context *context,
                          const void *expected, const void *actual,
                          unsigned long size, int equal, int fatal,
                          const char *expression, const char *file,
                          unsigned long line);
int cautest_fail(struct cautest_context *context,
                 const char *reason,
                 const char *file,
                 unsigned long line);
int cautest_skip(struct cautest_context *context,
                 const char *reason,
                 const char *file,
                 unsigned long line);
int cautest_error(struct cautest_context *context,
                  const char *reason,
                  const char *file,
                  unsigned long line);
int cautest_context_has_fatal(const struct cautest_context *context);
int cautest_log(struct cautest_context *context,
                enum cautest_log_level level,
                const char *message);

enum cautest_framework_error cautest_registry_validate(
    const struct cautest_registry *registry);
unsigned long cautest_registry_instance_count(
    const struct cautest_registry *registry);
int cautest_run(const struct cautest_registry *registry,
                const struct cautest_run_config *config,
                struct cautest_workspace workspace,
                struct cautest_event_sink sink,
                struct cautest_run_result *result);

int cautest_execution_begin(
    struct cautest_execution *execution,
    const struct cautest_registry *registry,
    const struct cautest_run_config *config,
    struct cautest_workspace workspace,
    struct cautest_event_sink sink,
    struct cautest_run_result *result);
int cautest_execution_finish(struct cautest_execution *execution);

int cautest_suite_execution_begin(
    struct cautest_execution *execution,
    unsigned long suite_index,
    struct cautest_suite_execution *suite_execution);
int cautest_suite_execution_is_ready(
    const struct cautest_suite_execution *suite_execution);
unsigned long cautest_suite_execution_instance_count(
    const struct cautest_suite_execution *suite_execution);
int cautest_suite_execution_run_instance(
    struct cautest_suite_execution *suite_execution,
    unsigned long instance_index,
    enum cautest_status *status);
int cautest_suite_execution_record_external_result(
    struct cautest_suite_execution *suite_execution,
    enum cautest_status status);
int cautest_suite_execution_end(
    struct cautest_suite_execution *suite_execution);

#define CAUTEST_EXPECT_TRUE(expression_) \
    do { \
        if (cautest_expect_true(cautest_ctx, !!(expression_), #expression_, \
                                __FILE__, (unsigned long)__LINE__)) \
            return; \
    } while (0)

#define CAUTEST_ASSERT_TRUE(expression_) \
    do { \
        if (cautest_assert_true(cautest_ctx, !!(expression_), #expression_, \
                                __FILE__, (unsigned long)__LINE__)) \
            return; \
    } while (0)

#define CAUTEST_EXPECT_EQ_INT(expected_, actual_) \
    do { \
        if (cautest_expect_eq_int(cautest_ctx, (long long)(expected_), \
                                  (long long)(actual_), __FILE__, \
                                  (unsigned long)__LINE__)) \
            return; \
    } while (0)

#define CAUTEST_ASSERT_EQ_INT(expected_, actual_) \
    do { \
        if (cautest_assert_eq_int(cautest_ctx, (long long)(expected_), \
                                  (long long)(actual_), __FILE__, \
                                  (unsigned long)__LINE__)) \
            return; \
    } while (0)

#define CAUTEST_EXPECT_FALSE(expression_) \
    do { \
        if (cautest_expect_false(cautest_ctx, !!(expression_), #expression_, \
                                 __FILE__, (unsigned long)__LINE__)) \
            return; \
    } while (0)

#define CAUTEST_ASSERT_FALSE(expression_) \
    do { \
        if (cautest_assert_false(cautest_ctx, !!(expression_), #expression_, \
                                 __FILE__, (unsigned long)__LINE__)) \
            return; \
    } while (0)

#define CAUTEST_EXPECT_NE_INT(expected_, actual_) \
    do { \
        long long cautest_expected_ = (long long)(expected_); \
        long long cautest_actual_ = (long long)(actual_); \
        if (cautest_expect_ne_int(cautest_ctx, cautest_expected_, \
                                  cautest_actual_, __FILE__, \
                                  (unsigned long)__LINE__)) \
            return; \
    } while (0)

#define CAUTEST_ASSERT_NE_INT(expected_, actual_) \
    do { \
        long long cautest_expected_ = (long long)(expected_); \
        long long cautest_actual_ = (long long)(actual_); \
        if (cautest_assert_ne_int(cautest_ctx, cautest_expected_, \
                                  cautest_actual_, __FILE__, \
                                  (unsigned long)__LINE__)) \
            return; \
    } while (0)

#define CAUTEST_PRIVATE_U64(expected_, actual_, equal_, fatal_, expression_) \
    do { \
        unsigned long long cautest_expected_ = \
            (unsigned long long)(expected_); \
        unsigned long long cautest_actual_ = (unsigned long long)(actual_); \
        if (cautest_expect_compare_u64(cautest_ctx, cautest_expected_, \
                cautest_actual_, (equal_), (fatal_), (expression_), __FILE__, \
                (unsigned long)__LINE__)) \
            return; \
    } while (0)

#define CAUTEST_EXPECT_EQ_UINT(expected_, actual_) \
    CAUTEST_PRIVATE_U64(expected_, actual_, 1, 0, "unsigned equality")
#define CAUTEST_ASSERT_EQ_UINT(expected_, actual_) \
    CAUTEST_PRIVATE_U64(expected_, actual_, 1, 1, "unsigned equality")
#define CAUTEST_EXPECT_NE_UINT(expected_, actual_) \
    CAUTEST_PRIVATE_U64(expected_, actual_, 0, 0, "unsigned inequality")
#define CAUTEST_ASSERT_NE_UINT(expected_, actual_) \
    CAUTEST_PRIVATE_U64(expected_, actual_, 0, 1, "unsigned inequality")
#define CAUTEST_EXPECT_EQ_U32(expected_, actual_) \
    CAUTEST_PRIVATE_U64((unsigned long)(expected_), (unsigned long)(actual_), \
                        1, 0, "u32 equality")
#define CAUTEST_ASSERT_EQ_U32(expected_, actual_) \
    CAUTEST_PRIVATE_U64((unsigned long)(expected_), (unsigned long)(actual_), \
                        1, 1, "u32 equality")
#define CAUTEST_EXPECT_NE_U32(expected_, actual_) \
    CAUTEST_PRIVATE_U64((unsigned long)(expected_), (unsigned long)(actual_), \
                        0, 0, "u32 inequality")
#define CAUTEST_ASSERT_NE_U32(expected_, actual_) \
    CAUTEST_PRIVATE_U64((unsigned long)(expected_), (unsigned long)(actual_), \
                        0, 1, "u32 inequality")
#define CAUTEST_EXPECT_EQ_U64(expected_, actual_) \
    CAUTEST_PRIVATE_U64(expected_, actual_, 1, 0, "u64 equality")
#define CAUTEST_ASSERT_EQ_U64(expected_, actual_) \
    CAUTEST_PRIVATE_U64(expected_, actual_, 1, 1, "u64 equality")
#define CAUTEST_EXPECT_NE_U64(expected_, actual_) \
    CAUTEST_PRIVATE_U64(expected_, actual_, 0, 0, "u64 inequality")
#define CAUTEST_ASSERT_NE_U64(expected_, actual_) \
    CAUTEST_PRIVATE_U64(expected_, actual_, 0, 1, "u64 inequality")

#define CAUTEST_PRIVATE_POINTER(expected_, actual_, equal_, fatal_, expr_) \
    do { \
        const void *cautest_expected_ = (const void *)(expected_); \
        const void *cautest_actual_ = (const void *)(actual_); \
        if (cautest_expect_pointer(cautest_ctx, cautest_expected_, \
                cautest_actual_, (equal_), (fatal_), (expr_), __FILE__, \
                (unsigned long)__LINE__)) \
            return; \
    } while (0)

#define CAUTEST_EXPECT_NULL(actual_) \
    CAUTEST_PRIVATE_POINTER((const void *)0, actual_, 1, 0, "pointer is null")
#define CAUTEST_ASSERT_NULL(actual_) \
    CAUTEST_PRIVATE_POINTER((const void *)0, actual_, 1, 1, "pointer is null")
#define CAUTEST_EXPECT_NOT_NULL(actual_) \
    CAUTEST_PRIVATE_POINTER((const void *)0, actual_, 0, 0, "pointer is not null")
#define CAUTEST_ASSERT_NOT_NULL(actual_) \
    CAUTEST_PRIVATE_POINTER((const void *)0, actual_, 0, 1, "pointer is not null")
#define CAUTEST_EXPECT_PTR_EQ(expected_, actual_) \
    CAUTEST_PRIVATE_POINTER(expected_, actual_, 1, 0, "pointer equality")
#define CAUTEST_ASSERT_PTR_EQ(expected_, actual_) \
    CAUTEST_PRIVATE_POINTER(expected_, actual_, 1, 1, "pointer equality")
#define CAUTEST_EXPECT_PTR_NE(expected_, actual_) \
    CAUTEST_PRIVATE_POINTER(expected_, actual_, 0, 0, "pointer inequality")
#define CAUTEST_ASSERT_PTR_NE(expected_, actual_) \
    CAUTEST_PRIVATE_POINTER(expected_, actual_, 0, 1, "pointer inequality")

#define CAUTEST_PRIVATE_STRING(expected_, actual_, equal_, fatal_, expr_) \
    do { \
        const char *cautest_expected_ = (expected_); \
        const char *cautest_actual_ = (actual_); \
        if (cautest_expect_string(cautest_ctx, cautest_expected_, \
                cautest_actual_, (equal_), (fatal_), (expr_), __FILE__, \
                (unsigned long)__LINE__)) \
            return; \
    } while (0)

#define CAUTEST_EXPECT_STREQ(expected_, actual_) \
    CAUTEST_PRIVATE_STRING(expected_, actual_, 1, 0, "string equality")
#define CAUTEST_ASSERT_STREQ(expected_, actual_) \
    CAUTEST_PRIVATE_STRING(expected_, actual_, 1, 1, "string equality")
#define CAUTEST_EXPECT_STRNE(expected_, actual_) \
    CAUTEST_PRIVATE_STRING(expected_, actual_, 0, 0, "string inequality")
#define CAUTEST_ASSERT_STRNE(expected_, actual_) \
    CAUTEST_PRIVATE_STRING(expected_, actual_, 0, 1, "string inequality")

#define CAUTEST_PRIVATE_MEMORY(expected_, actual_, size_, equal_, fatal_, expr_) \
    do { \
        const void *cautest_expected_ = (const void *)(expected_); \
        const void *cautest_actual_ = (const void *)(actual_); \
        unsigned long cautest_size_ = (unsigned long)(size_); \
        if (cautest_expect_memory(cautest_ctx, cautest_expected_, \
                cautest_actual_, cautest_size_, (equal_), (fatal_), (expr_), \
                __FILE__, (unsigned long)__LINE__)) \
            return; \
    } while (0)

#define CAUTEST_EXPECT_MEMEQ(expected_, actual_, size_) \
    CAUTEST_PRIVATE_MEMORY(expected_, actual_, size_, 1, 0, "memory equality")
#define CAUTEST_ASSERT_MEMEQ(expected_, actual_, size_) \
    CAUTEST_PRIVATE_MEMORY(expected_, actual_, size_, 1, 1, "memory equality")
#define CAUTEST_EXPECT_MEMNE(expected_, actual_, size_) \
    CAUTEST_PRIVATE_MEMORY(expected_, actual_, size_, 0, 0, "memory inequality")
#define CAUTEST_ASSERT_MEMNE(expected_, actual_, size_) \
    CAUTEST_PRIVATE_MEMORY(expected_, actual_, size_, 0, 1, "memory inequality")

#define CAUTEST_FAIL(reason_) \
    do { \
        (void)cautest_fail(cautest_ctx, (reason_), __FILE__, \
                           (unsigned long)__LINE__); \
        return; \
    } while (0)

#define CAUTEST_SKIP(reason_) \
    do { \
        (void)cautest_skip(cautest_ctx, (reason_), __FILE__, \
                           (unsigned long)__LINE__); \
        return; \
    } while (0)

#define CAUTEST_ERROR(reason_) \
    do { \
        (void)cautest_error(cautest_ctx, (reason_), __FILE__, \
                            (unsigned long)__LINE__); \
        return; \
    } while (0)

#define CAUTEST_LOG_TRACE(message_) \
    ((void)cautest_log(cautest_ctx, CAUTEST_LOG_LEVEL_TRACE, (message_)))
#define CAUTEST_LOG_DEBUG(message_) \
    ((void)cautest_log(cautest_ctx, CAUTEST_LOG_LEVEL_DEBUG, (message_)))
#define CAUTEST_LOG_INFO(message_) \
    ((void)cautest_log(cautest_ctx, CAUTEST_LOG_LEVEL_INFO, (message_)))
#define CAUTEST_LOG_WARN(message_) \
    ((void)cautest_log(cautest_ctx, CAUTEST_LOG_LEVEL_WARN, (message_)))
#define CAUTEST_LOG_ERROR(message_) \
    ((void)cautest_log(cautest_ctx, CAUTEST_LOG_LEVEL_ERROR, (message_)))

#ifdef __cplusplus
}
#endif

#endif
