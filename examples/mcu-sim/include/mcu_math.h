#ifndef MCU_MATH_H
#define MCU_MATH_H

#include <stdint.h>

uint32_t mcu_add(uint32_t left, uint32_t right);
uint32_t mcu_limit(uint32_t value, uint32_t maximum);

#endif
