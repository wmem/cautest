#include <cautest/cautest.h>
#include "board.h"

CAUTEST_CASE(clock_and_tick)
{
    uint32_t start = board_millis();
    (void)suite_fixture; (void)case_fixture; (void)cautest_parameter;
    CAUTEST_EXPECT_EQ_U32(200000000U, board_clock_hz());
    while ((uint32_t)(board_millis() - start) < 10U) {}
    CAUTEST_EXPECT_TRUE(board_millis() != start);
}

CAUTEST_CASE(uart_enabled)
{
    (void)suite_fixture; (void)case_fixture; (void)cautest_parameter;
    CAUTEST_EXPECT_TRUE(board_uart_ready());
}

CAUTEST_SUITE(board, CAUTEST_CASE_ENTRY(clock_and_tick), CAUTEST_CASE_ENTRY(uart_enabled));
