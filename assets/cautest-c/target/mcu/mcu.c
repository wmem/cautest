#include <cautest/mcu.h>

int cautest_mcu_init(struct cautest_mcu *runtime,
                     const struct cautest_mcu_config *config)
{
    if (runtime == (struct cautest_mcu *)0)
        return -1;
    runtime->failed = 1;
    if (config == (const struct cautest_mcu_config *)0 ||
        config->read == (cautest_mcu_read_fn)0 ||
        ctp3_server_init(&runtime->server, &config->protocol) != 0)
        return -1;
    runtime->read = config->read;
    runtime->read_context = config->read_context;
    runtime->failed = 0;
    return 0;
}

enum cautest_mcu_poll_result cautest_mcu_poll(struct cautest_mcu *runtime)
{
    long size;
    if (runtime == (struct cautest_mcu *)0 || runtime->failed)
        return CAUTEST_MCU_ERROR;
    if (ctp3_server_is_closing(&runtime->server))
        return CAUTEST_MCU_CLOSED;
    size = runtime->read(runtime->read_context, runtime->input,
                         sizeof(runtime->input));
    if (size < 0L || (unsigned long)size > sizeof(runtime->input) ||
        ctp3_server_feed(&runtime->server, runtime->input,
                         (unsigned long)size) != 0) {
        runtime->failed = 1;
        return CAUTEST_MCU_ERROR;
    }
    if (ctp3_server_is_closing(&runtime->server))
        return CAUTEST_MCU_CLOSED;
    return size == 0L ? CAUTEST_MCU_IDLE : CAUTEST_MCU_PROGRESS;
}
