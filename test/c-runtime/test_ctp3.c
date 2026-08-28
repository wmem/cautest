#include <cautest/ctp3.h>

#include <stdio.h>
#include <string.h>

static int failures;
static int suite_setups;
static int suite_teardowns;
static int failed_suite_bodies;
static int failed_suite_teardowns;

#define CHECK(condition) do {                                                \
    if (!(condition)) {                                                      \
        fprintf(stderr, "%s:%d: CHECK 失败: %s\n", __FILE__, __LINE__,      \
                #condition);                                                 \
        failures += 1;                                                       \
    }                                                                        \
} while (0)

CAUTEST_FIXTURE_CALLBACK(suite_setup)
{
    (void)cautest_ctx; (void)suite_fixture; (void)case_fixture;
    (void)cautest_parameter;
    ++suite_setups;
}

CAUTEST_FIXTURE_CALLBACK(suite_teardown)
{
    (void)cautest_ctx; (void)suite_fixture; (void)case_fixture;
    (void)cautest_parameter;
    ++suite_teardowns;
}

CAUTEST_FIXTURE(suite_fixture, int, suite_setup, suite_teardown);

CAUTEST_CASE(pass_case)
{
    (void)suite_fixture; (void)case_fixture; (void)cautest_parameter;
    CAUTEST_LOG_INFO("hello, line\nnext");
    CAUTEST_EXPECT_TRUE(1);
}

CAUTEST_CASE(fail_case)
{
    (void)suite_fixture; (void)case_fixture; (void)cautest_parameter;
    CAUTEST_EXPECT_EQ_INT(7, 9);
}

CAUTEST_SUITE_WITH_FIXTURES(protocol_suite, &suite_fixture,
    CAUTEST_NO_FIXTURE,
    CAUTEST_CASE_ENTRY(pass_case),
    CAUTEST_CASE_ENTRY(fail_case));

CAUTEST_FIXTURE_CALLBACK(failed_suite_setup)
{
    (void)suite_fixture; (void)case_fixture; (void)cautest_parameter;
    CAUTEST_ERROR("suite setup failed");
}

CAUTEST_FIXTURE_CALLBACK(failed_suite_teardown)
{
    (void)cautest_ctx; (void)suite_fixture; (void)case_fixture;
    (void)cautest_parameter;
    ++failed_suite_teardowns;
}

CAUTEST_FIXTURE(failed_suite_fixture, int, failed_suite_setup,
                failed_suite_teardown);

CAUTEST_CASE(should_not_run)
{
    (void)cautest_ctx; (void)suite_fixture; (void)case_fixture;
    (void)cautest_parameter;
    ++failed_suite_bodies;
}

CAUTEST_SUITE_WITH_FIXTURES(failed_suite, &failed_suite_fixture,
    CAUTEST_NO_FIXTURE, CAUTEST_CASE_ENTRY(should_not_run));
CAUTEST_REGISTRY(protocol_registry, CAUTEST_SUITE_REF(protocol_suite),
    CAUTEST_SUITE_REF(failed_suite));

struct output {
    unsigned char data[16384];
    unsigned long size;
};

static int capture(void *context, const unsigned char *data,
                   unsigned long size)
{
    struct output *output = (struct output *)context;
    if (size > sizeof(output->data) - output->size)
        return -1;
    memcpy(output->data + output->size, data, size);
    output->size += size;
    output->data[output->size] = '\0';
    return 0;
}

static void feed_one_byte(struct ctp3_server *server, const char *command)
{
    while (*command != '\0') {
        CHECK(ctp3_server_feed(server, (const unsigned char *)command, 1UL) == 0);
        ++command;
    }
}

int main(void)
{
    struct ctp3_server server;
    struct ctp3_server_config config;
    struct output output;
    CAUTEST_WORKSPACE(workspace_storage, 1024);
    struct cautest_workspace workspace = CAUTEST_WORKSPACE_INIT(workspace_storage);
    const char *text;
    unsigned char long_line[80];
    char long_log[700];

    memset(&output, 0, sizeof(output));
    config.registry = &protocol_registry;
    config.build_id = "build";
    config.boot_id = "boot";
    config.workspace = workspace;
    config.write = capture;
    config.write_context = &output;
    config.run_instance = (ctp3_run_instance_fn)0;
    config.run_instance_context = (void *)0;
    CHECK(ctp3_server_init(&server, &config) == 0);

    feed_one_byte(&server, "AT+HELLO\r\nAT+LIST\n");
    feed_one_byte(&server, "AT+CASE=1,0,0,0\n");
    feed_one_byte(&server, "AT+SUITE=2,0,CONTINUE\n");
    text = (const char *)output.data;
    CHECK(strstr(text, "+HELLO:3,1,build,boot,64,512\nOK:HELLO\n") != NULL);
    CHECK(strstr(text, "+CASE:0,0,0,protocol_suite,pass_case,\n") != NULL);
    CHECK(strstr(text, "+LIST:END,3\nOK:LIST\n") != NULL);
    CHECK(strstr(text, "+EXEC-START:1,CASE,0,0,0\n") != NULL);
    CHECK(strstr(text, "+LOG:1,CASE,0,0,0,TARGET,INFO,hello\\, line\\nnext\n") != NULL);
    CHECK(strstr(text, "+EXEC-END:1,PASS,1,0,0,0\nOK:CASE,1\n") != NULL);
    CHECK(strstr(text, "+EXEC-END:2,FAIL,1,1,0,0\nOK:SUITE,2\n") != NULL);
    CHECK(suite_setups == 2);
    CHECK(suite_teardowns == 2);

    feed_one_byte(&server, "AT+SUITE=3,1,CONTINUE\n");
    CHECK(strstr((const char *)output.data,
                 "+FAULT:3,SUITE,1,0,0,FIXTURE,suite setup failed\n") != NULL);
    CHECK(strstr((const char *)output.data,
                 "+EXEC-END:3,ERROR,0,0,0,0\nOK:SUITE,3\n") != NULL);
    CHECK(failed_suite_bodies == 0);
    CHECK(failed_suite_teardowns == 0);

    feed_one_byte(&server, "AT+CASE=2,0,0,0\n");
    CHECK(strstr((const char *)output.data,
                 "ERROR:CASE,2,OUT_OF_ORDER_EXECUTION_ID") != NULL);

    memset(long_line, 'X', sizeof(long_line));
    long_line[sizeof(long_line) - 1] = '\n';
    CHECK(ctp3_server_feed(&server, long_line, sizeof(long_line)) == 0);
    feed_one_byte(&server, "AT\n");
    CHECK(strstr((const char *)output.data, "ERROR:AT,LINE_TOO_LONG") != NULL);
    CHECK(strstr((const char *)output.data, "OK:AT\n") != NULL);

    memset(long_log, 'L', sizeof(long_log) - 1UL);
    long_log[sizeof(long_log) - 1UL] = '\0';
    CHECK(ctp3_server_log_target(&server, CAUTEST_LOG_LEVEL_WARN,
                                 long_log) == 0);
    CHECK(strstr((const char *)output.data,
                 "+LOG-TRUNC:0,TARGET,0,0,0,TARGET,WARN,") != NULL);

    {
        static const unsigned char invalid_command[] = {
            'A', 'T', '+', 0xffU, '\n'
        };
        CHECK(ctp3_server_feed(&server, invalid_command,
                               sizeof(invalid_command)) == 0);
        CHECK(strstr((const char *)output.data,
                     "ERROR:AT,BAD_ENCODING") != NULL);
    }

    {
        const unsigned char *cursor = output.data;
        const unsigned char *end = output.data + output.size;
        while (cursor < end) {
            const unsigned char *newline =
                (const unsigned char *)memchr(cursor, '\n',
                                              (size_t)(end - cursor));
            CHECK(newline != NULL);
            if (newline == NULL)
                break;
            CHECK((unsigned long)(newline - cursor + 1) <= CTP3_TX_LINE_MAX);
            cursor = newline + 1;
        }
    }

    if (failures) {
        fprintf(stderr, "CTP/3 C 测试失败: %d\n", failures);
        return 1;
    }
    printf("CTP/3 C 测试通过\n");
    return 0;
}
