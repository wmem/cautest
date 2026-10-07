#include <cautest/mcu.h>
#include <assert.h>
#include <string.h>

CAUTEST_CASE(pass_case)
{
    (void)suite_fixture; (void)case_fixture; (void)cautest_parameter;
    CAUTEST_EXPECT_TRUE(1);
}
CAUTEST_SUITE(sample, CAUTEST_CASE_ENTRY(pass_case));
CAUTEST_REGISTRY(registry, CAUTEST_SUITE_REF(sample));

struct io {
    const char *input;
    char output[4096];
    unsigned long size;
    long read_error;
    int write_error;
};

static long read_byte(void *context, unsigned char *data, unsigned long capacity)
{
    struct io *io = context;
    assert(capacity > 0UL);
    if (io->read_error)
        return io->read_error;
    if (*io->input == '\0')
        return 0;
    data[0] = (unsigned char)*io->input++;
    return 1;
}

static int write_all(void *context, const unsigned char *data, unsigned long size)
{
    struct io *io = context;
    if (io->write_error)
        return -1;
    assert(io->size + size < sizeof(io->output));
    memcpy(io->output + io->size, data, size);
    io->size += size;
    io->output[io->size] = '\0';
    return 0;
}

static enum cautest_mcu_poll_result drain(struct cautest_mcu *runtime)
{
    enum cautest_mcu_poll_result result;
    unsigned int remaining = 1000;
    do {
        assert(remaining-- > 0);
        result = cautest_mcu_poll(runtime);
    } while (result == CAUTEST_MCU_PROGRESS);
    return result;
}

int main(void)
{
    CAUTEST_WORKSPACE(storage, 1024);
    struct cautest_mcu runtime;
    struct io io = {"AT+HELLO\nAT+LIST\nAT+CASE=1,0,0,0\nAT+BYE\n", {0}, 0, 0, 0};
    struct cautest_mcu_config config = {0};
    struct cautest_run_config invalid_config;
    struct cautest_run_result invalid_result;
    struct cautest_event_sink empty_sink = {0};
    config.protocol.registry = &registry;
    config.protocol.build_id = "build";
    config.protocol.boot_id = "boot";
    config.protocol.workspace = (struct cautest_workspace)CAUTEST_WORKSPACE_INIT(storage);
    config.protocol.write = write_all;
    config.protocol.write_context = &io;
    config.read = read_byte;
    config.read_context = &io;
    invalid_config.stop_policy = (enum cautest_stop_policy)-1;
    assert(cautest_run(&registry, &invalid_config, config.protocol.workspace, empty_sink,
                       &invalid_result) == -1);
    assert(invalid_result.framework_error == CAUTEST_FRAMEWORK_ERROR_INVALID_ARGUMENT);
    assert(cautest_mcu_init(&runtime, &config) == 0);
    assert(drain(&runtime) == CAUTEST_MCU_CLOSED);
    assert(strstr(io.output, ",build,boot,64,512") != 0);
    assert(strstr(io.output, "+CASE:") != 0);
    assert(strstr(io.output, "+EXEC-END:1,PASS,1,0,0,0") != 0);
    assert(strstr(io.output, "OK:BYE") != 0);
    /* 即使枚举底层为无符号，也要拒绝负数及超范围值。 */
    assert(ctp3_server_log_target(&runtime.server, (enum cautest_log_level)-1, "invalid") == -1);
    assert(ctp3_server_log_target(&runtime.server, (enum cautest_log_level)999, "invalid") == -1);
    assert(cautest_mcu_poll(&runtime) == CAUTEST_MCU_CLOSED);

    io.input = "";
    assert(cautest_mcu_init(&runtime, &config) == 0);
    assert(cautest_mcu_poll(&runtime) == CAUTEST_MCU_IDLE);
    io.read_error = -1;
    assert(cautest_mcu_poll(&runtime) == CAUTEST_MCU_ERROR);
    io.read_error = 0;
    assert(cautest_mcu_poll(&runtime) == CAUTEST_MCU_ERROR);
    assert(cautest_mcu_init(&runtime, &config) == 0);
    io.read_error = 33;
    assert(cautest_mcu_poll(&runtime) == CAUTEST_MCU_ERROR);
    io.read_error = 0;
    io.input = "AT+HELLO\n";
    io.write_error = 1;
    assert(cautest_mcu_init(&runtime, &config) == 0);
    assert(drain(&runtime) == CAUTEST_MCU_ERROR);
    assert(cautest_mcu_init(&runtime, 0) == -1);
    assert(cautest_mcu_poll(&runtime) == CAUTEST_MCU_ERROR);
    assert(cautest_mcu_init(0, &config) == -1);
    assert(cautest_mcu_poll(0) == CAUTEST_MCU_ERROR);
    config.read = 0;
    assert(cautest_mcu_init(&runtime, &config) == -1);
    return 0;
}
