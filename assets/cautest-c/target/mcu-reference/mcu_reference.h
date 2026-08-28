#ifndef CAUTEST_MCU_REFERENCE_H
#define CAUTEST_MCU_REFERENCE_H

#include "../../platform/freestanding/cautest_freestanding.h"

#ifdef __cplusplus
extern "C" {
#endif

#define CAUTEST_MCU_BUILD_ID_CAPACITY 32UL

struct cautest_mcu_ring {
    unsigned char *data;
    unsigned long capacity;
    unsigned long head;
    unsigned long count;
    unsigned long dropped;
};

struct cautest_mcu_reference_board {
    struct cautest_freestanding_runtime runtime;
    struct cautest_mcu_ring receive;
    struct cautest_mcu_ring transmit;
    char build_id[CAUTEST_MCU_BUILD_ID_CAPACITY];
    unsigned long boot_id;
    unsigned long max_io_size;
    int flashed;
    int connected;
};

int cautest_mcu_reference_init(
    struct cautest_mcu_reference_board *board,
    const struct cautest_registry *registry,
    struct cautest_workspace workspace,
    struct cautest_event *events,
    unsigned long event_capacity,
    unsigned char *receive_storage,
    unsigned long receive_capacity,
    unsigned char *transmit_storage,
    unsigned long transmit_capacity,
    unsigned long max_io_size);
int cautest_mcu_reference_flash(
    struct cautest_mcu_reference_board *board,
    const char *build_id);
int cautest_mcu_reference_reset(struct cautest_mcu_reference_board *board);
void cautest_mcu_reference_disconnect(
    struct cautest_mcu_reference_board *board);
int cautest_mcu_reference_connect(struct cautest_mcu_reference_board *board);
int cautest_mcu_reference_run(
    struct cautest_mcu_reference_board *board,
    const struct cautest_run_config *config,
    struct cautest_run_result *result);
int cautest_mcu_reference_run_selected(
    struct cautest_mcu_reference_board *board,
    const struct cautest_run_config *config,
    const struct cautest_freestanding_selection *selection,
    unsigned long selection_count,
    struct cautest_run_result *result);
unsigned long cautest_mcu_reference_write(
    struct cautest_mcu_reference_board *board,
    const unsigned char *data,
    unsigned long size);
unsigned long cautest_mcu_reference_read(
    struct cautest_mcu_reference_board *board,
    unsigned char *data,
    unsigned long size);
unsigned long cautest_mcu_reference_target_receive(
    struct cautest_mcu_reference_board *board,
    unsigned char *data,
    unsigned long size);
unsigned long cautest_mcu_reference_target_send(
    struct cautest_mcu_reference_board *board,
    const unsigned char *data,
    unsigned long size);

#ifdef __cplusplus
}
#endif

#endif
