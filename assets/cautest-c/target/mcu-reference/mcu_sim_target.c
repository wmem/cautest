#define _POSIX_C_SOURCE 200809L

#include "mcu_reference.h"
#include <cautest/ctp3.h>

#include <stddef.h>
#include <unistd.h>

#ifndef CAUTEST_MCU_REGISTRY
#define CAUTEST_MCU_REGISTRY cautest_mcu_registry
#endif
#ifndef CAUTEST_MCU_WORKSPACE_SIZE
#define CAUTEST_MCU_WORKSPACE_SIZE 4096UL
#endif
#ifndef CAUTEST_MCU_EVENT_CAPACITY
#define CAUTEST_MCU_EVENT_CAPACITY 64UL
#endif
#ifndef CAUTEST_MCU_SERIAL_CAPACITY
#define CAUTEST_MCU_SERIAL_CAPACITY 4096UL
#endif
#ifndef CAUTEST_MCU_IO_CHUNK
#define CAUTEST_MCU_IO_CHUNK 5UL
#endif
#ifndef CAUTEST_MCU_BUILD_ID
#define CAUTEST_MCU_BUILD_ID "unconfigured-mcu-build"
#endif

#define MCU_CONTROL_FD 3
#define MCU_EVENT_FD 4

extern const struct cautest_registry CAUTEST_MCU_REGISTRY;

struct target_state {
    struct cautest_mcu_reference_board board;
};

static CAUTEST_WORKSPACE(target_workspace, CAUTEST_MCU_WORKSPACE_SIZE);
static struct cautest_event target_events[CAUTEST_MCU_EVENT_CAPACITY];
static unsigned char receive_storage[CAUTEST_MCU_SERIAL_CAPACITY];
static unsigned char transmit_storage[CAUTEST_MCU_SERIAL_CAPACITY];

static int host_write_all(const unsigned char *data, unsigned long size)
{
    unsigned long offset = 0UL;
    while (offset < size) {
        ssize_t count = write(MCU_EVENT_FD, data + offset,
                              (size_t)(size - offset));
        if (count <= 0)
            return -1;
        offset += (unsigned long)count;
    }
    return 0;
}

static int flush_serial(struct target_state *state)
{
    unsigned char chunk[CAUTEST_MCU_IO_CHUNK];
    unsigned long count;
    do {
        count = cautest_mcu_reference_read(&state->board, chunk,
                                           sizeof(chunk));
        if (count != 0UL && host_write_all(chunk, count) != 0)
            return -1;
    } while (count != 0UL);
    return 0;
}

static int serial_write(void *context, const unsigned char *data,
                        unsigned long size)
{
    struct target_state *state = (struct target_state *)context;
    unsigned long offset = 0UL;
    while (offset < size) {
        unsigned long accepted = cautest_mcu_reference_target_send(
            &state->board, data + offset, size - offset);
        if (accepted == 0UL || flush_serial(state) != 0)
            return -1;
        offset += accepted;
    }
    return flush_serial(state);
}

int main(int argc, char **argv)
{
    struct target_state state;
    struct ctp3_server server;
    struct ctp3_server_config config;
    struct cautest_workspace workspace =
        CAUTEST_WORKSPACE_INIT(target_workspace);
    unsigned char host_input[32];
    unsigned char target_input[CAUTEST_MCU_IO_CHUNK];

    if (argc != 2)
        return 2;
    if (cautest_mcu_reference_init(
            &state.board, &CAUTEST_MCU_REGISTRY, workspace,
            target_events, CAUTEST_MCU_EVENT_CAPACITY,
            receive_storage, sizeof(receive_storage),
            transmit_storage, sizeof(transmit_storage),
            CAUTEST_MCU_IO_CHUNK) != 0 ||
        cautest_mcu_reference_flash(&state.board, CAUTEST_MCU_BUILD_ID) != 0 ||
        cautest_mcu_reference_reset(&state.board) != 0 ||
        cautest_mcu_reference_connect(&state.board) != 0)
        return 2;
    config.registry = &CAUTEST_MCU_REGISTRY;
    config.build_id = CAUTEST_MCU_BUILD_ID;
    config.boot_id = argv[1];
    config.workspace = workspace;
    config.write = serial_write;
    config.write_context = &state;
    config.run_instance = (ctp3_run_instance_fn)0;
    config.run_instance_context = (void *)0;
    if (ctp3_server_init(&server, &config) != 0)
        return 2;
    while (!ctp3_server_is_closing(&server)) {
        ssize_t host_count = read(MCU_CONTROL_FD, host_input,
                                  sizeof(host_input));
        unsigned long offset = 0UL;
        if (host_count == 0)
            break;
        if (host_count < 0)
            return 2;
        while (offset < (unsigned long)host_count) {
            unsigned long accepted = cautest_mcu_reference_write(
                &state.board, host_input + offset,
                (unsigned long)host_count - offset);
            unsigned long received;
            if (accepted == 0UL)
                return 2;
            offset += accepted;
            do {
                received = cautest_mcu_reference_target_receive(
                    &state.board, target_input, sizeof(target_input));
                if (received != 0UL &&
                    ctp3_server_feed(&server, target_input, received) != 0)
                    return 2;
            } while (received != 0UL);
        }
    }
    return 0;
}
