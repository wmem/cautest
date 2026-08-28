#include <assert.h>
#include <string.h>

#include <cautest/cautest.h>
#include "cautest_freestanding.h"
#include "mcu_reference.h"

CAUTEST_CASE(smoke)
{
    (void)suite_fixture;
    (void)case_fixture;
    (void)cautest_parameter;
    CAUTEST_EXPECT_EQ_INT(1, 1);
}

CAUTEST_SUITE(mcu, CAUTEST_CASE_ENTRY(smoke));
CAUTEST_REGISTRY(registry, CAUTEST_SUITE_REF(mcu));

struct large_fixture { unsigned char bytes[512]; };
CAUTEST_FIXTURE(large_case_fixture, struct large_fixture, 0, 0);
CAUTEST_SUITE_WITH_FIXTURES(workspace_overflow, CAUTEST_NO_FIXTURE,
                            &large_case_fixture,
                            CAUTEST_CASE_ENTRY(smoke));
CAUTEST_REGISTRY(overflow_registry,
                 CAUTEST_SUITE_REF(workspace_overflow));

int main(void)
{
    CAUTEST_WORKSPACE(workspace_storage, 256);
    struct cautest_workspace workspace = CAUTEST_WORKSPACE_INIT(workspace_storage);
    struct cautest_event events[32];
    struct cautest_freestanding_runtime runtime;
    struct cautest_run_result result;
    struct cautest_event event;
    struct cautest_run_config config = { CAUTEST_STOP_CONTINUE };
    struct cautest_mcu_reference_board board;
    unsigned char receive[8];
    unsigned char transmit[8];
    unsigned char data[8];
    unsigned long first_boot;

    assert(cautest_freestanding_init(&runtime, &registry, workspace,
                                     events, 32UL) == 0);
    assert(cautest_freestanding_run(&runtime, &config, &result) == 0);
    assert(result.status == CAUTEST_STATUS_PASS);
    assert(cautest_freestanding_poll(&runtime, &event) == 1);

    assert(cautest_mcu_reference_init(&board, &registry, workspace,
                                      events, 32UL, receive, 8UL,
                                      transmit, 8UL, 2UL) == 0);
    assert(cautest_mcu_reference_flash(&board, "build-1") == 0);
    assert(cautest_mcu_reference_reset(&board) == 0);
    first_boot = board.boot_id;
    assert(cautest_mcu_reference_connect(&board) == 0);
    assert(cautest_mcu_reference_run(&board, &config, &result) == 0);
    assert(result.status == CAUTEST_STATUS_PASS);
    assert(cautest_mcu_reference_write(&board,
                                       (const unsigned char *)"abcd", 4UL) == 2UL);
    assert(cautest_mcu_reference_target_receive(&board, data, 8UL) == 2UL);
    assert(memcmp(data, "ab", 2) == 0);
    assert(cautest_mcu_reference_target_send(&board,
                                             (const unsigned char *)"xyz", 3UL) == 3UL);
    assert(cautest_mcu_reference_read(&board, data, 8UL) == 2UL);
    assert(cautest_mcu_reference_read(&board, data + 2, 8UL) == 1UL);
    assert(memcmp(data, "xyz", 3) == 0);
    cautest_mcu_reference_disconnect(&board);
    assert(cautest_mcu_reference_write(&board,
                                       (const unsigned char *)"x", 1UL) == 0UL);
    assert(cautest_mcu_reference_connect(&board) == 0);
    assert(cautest_mcu_reference_reset(&board) == 0);
    assert(board.boot_id != first_boot);

    assert(cautest_freestanding_init(&runtime, &overflow_registry,
                                     workspace, events, 32UL) == 0);
    assert(cautest_freestanding_run(&runtime, &config, &result) != 0);
    assert(result.status == CAUTEST_STATUS_ERROR);
    assert(result.framework_error ==
           CAUTEST_FRAMEWORK_ERROR_WORKSPACE_OVERFLOW);

    assert(cautest_freestanding_init(&runtime, &registry, workspace,
                                     events, 1UL) == 0);
    assert(cautest_freestanding_run(&runtime, &config, &result) != 0);
    assert(result.status == CAUTEST_STATUS_ERROR);
    assert(runtime.dropped_events > 0UL);
    return 0;
}
