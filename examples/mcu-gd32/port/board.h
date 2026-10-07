#ifndef CAUTEST_GD32_BOARD_H
#define CAUTEST_GD32_BOARD_H
#include <stdint.h>
uint32_t board_millis(void);
uint32_t board_clock_hz(void);
int board_uart_ready(void);
#endif
