#include "mcu_reference.h"

static void cautest_mcu_ring_reset(struct cautest_mcu_ring *ring)
{
    ring->head = 0UL;
    ring->count = 0UL;
    ring->dropped = 0UL;
}

static unsigned long cautest_mcu_ring_write(struct cautest_mcu_ring *ring,
                                             const unsigned char *data,
                                             unsigned long size)
{
    unsigned long written;
    unsigned long tail;

    written = 0UL;
    while (written < size && ring->count < ring->capacity) {
        tail = (ring->head + ring->count) % ring->capacity;
        ring->data[tail] = data[written];
        ring->count += 1UL;
        written += 1UL;
    }
    ring->dropped += size - written;
    return written;
}

static unsigned long cautest_mcu_ring_read(struct cautest_mcu_ring *ring,
                                            unsigned char *data,
                                            unsigned long size)
{
    unsigned long read_count;

    read_count = 0UL;
    while (read_count < size && ring->count != 0UL) {
        data[read_count] = ring->data[ring->head];
        ring->head = (ring->head + 1UL) % ring->capacity;
        ring->count -= 1UL;
        read_count += 1UL;
    }
    return read_count;
}

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
    unsigned long max_io_size)
{
    unsigned long index;

    if (board == (struct cautest_mcu_reference_board *)0 ||
        receive_storage == (unsigned char *)0 || receive_capacity == 0UL ||
        transmit_storage == (unsigned char *)0 || transmit_capacity == 0UL ||
        max_io_size == 0UL)
        return -1;
    if (cautest_freestanding_init(&board->runtime, registry, workspace,
                                  events, event_capacity) != 0)
        return -1;
    board->receive.data = receive_storage;
    board->receive.capacity = receive_capacity;
    board->transmit.data = transmit_storage;
    board->transmit.capacity = transmit_capacity;
    cautest_mcu_ring_reset(&board->receive);
    cautest_mcu_ring_reset(&board->transmit);
    for (index = 0UL; index < CAUTEST_MCU_BUILD_ID_CAPACITY; ++index)
        board->build_id[index] = '\0';
    board->boot_id = 0UL;
    board->max_io_size = max_io_size;
    board->flashed = 0;
    board->connected = 0;
    return 0;
}

int cautest_mcu_reference_flash(
    struct cautest_mcu_reference_board *board,
    const char *build_id)
{
    unsigned long index;

    if (board == (struct cautest_mcu_reference_board *)0 ||
        build_id == (const char *)0)
        return -1;
    index = 0UL;
    while (build_id[index] != '\0' &&
           index + 1UL < CAUTEST_MCU_BUILD_ID_CAPACITY) {
        board->build_id[index] = build_id[index];
        index += 1UL;
    }
    if (build_id[index] != '\0')
        return -1;
    board->build_id[index] = '\0';
    board->flashed = 1;
    return 0;
}

int cautest_mcu_reference_reset(struct cautest_mcu_reference_board *board)
{
    if (board == (struct cautest_mcu_reference_board *)0 || !board->flashed)
        return -1;
    board->connected = 0;
    board->boot_id += 1UL;
    if (board->boot_id == 0UL)
        board->boot_id = 1UL;
    cautest_freestanding_reset(&board->runtime);
    cautest_mcu_ring_reset(&board->receive);
    cautest_mcu_ring_reset(&board->transmit);
    return 0;
}

void cautest_mcu_reference_disconnect(
    struct cautest_mcu_reference_board *board)
{
    if (board != (struct cautest_mcu_reference_board *)0)
        board->connected = 0;
}

int cautest_mcu_reference_connect(struct cautest_mcu_reference_board *board)
{
    if (board == (struct cautest_mcu_reference_board *)0 || !board->flashed ||
        board->boot_id == 0UL)
        return -1;
    board->connected = 1;
    return 0;
}

int cautest_mcu_reference_run(
    struct cautest_mcu_reference_board *board,
    const struct cautest_run_config *config,
    struct cautest_run_result *result)
{
    if (board == (struct cautest_mcu_reference_board *)0 ||
        !board->connected)
        return -1;
    return cautest_freestanding_run(&board->runtime, config, result);
}

int cautest_mcu_reference_run_selected(
    struct cautest_mcu_reference_board *board,
    const struct cautest_run_config *config,
    const struct cautest_freestanding_selection *selection,
    unsigned long selection_count,
    struct cautest_run_result *result)
{
    if (board == (struct cautest_mcu_reference_board *)0 ||
        !board->connected)
        return -1;
    return cautest_freestanding_run_selected(&board->runtime, config,
                                              selection, selection_count,
                                              result);
}

unsigned long cautest_mcu_reference_write(
    struct cautest_mcu_reference_board *board,
    const unsigned char *data,
    unsigned long size)
{
    if (board == (struct cautest_mcu_reference_board *)0 ||
        data == (const unsigned char *)0 || !board->connected)
        return 0UL;
    if (size > board->max_io_size)
        size = board->max_io_size;
    return cautest_mcu_ring_write(&board->receive, data, size);
}

unsigned long cautest_mcu_reference_read(
    struct cautest_mcu_reference_board *board,
    unsigned char *data,
    unsigned long size)
{
    if (board == (struct cautest_mcu_reference_board *)0 ||
        data == (unsigned char *)0 || !board->connected)
        return 0UL;
    if (size > board->max_io_size)
        size = board->max_io_size;
    return cautest_mcu_ring_read(&board->transmit, data, size);
}

unsigned long cautest_mcu_reference_target_receive(
    struct cautest_mcu_reference_board *board,
    unsigned char *data,
    unsigned long size)
{
    if (board == (struct cautest_mcu_reference_board *)0 ||
        data == (unsigned char *)0)
        return 0UL;
    return cautest_mcu_ring_read(&board->receive, data, size);
}

unsigned long cautest_mcu_reference_target_send(
    struct cautest_mcu_reference_board *board,
    const unsigned char *data,
    unsigned long size)
{
    if (board == (struct cautest_mcu_reference_board *)0 ||
        data == (const unsigned char *)0)
        return 0UL;
    return cautest_mcu_ring_write(&board->transmit, data, size);
}
