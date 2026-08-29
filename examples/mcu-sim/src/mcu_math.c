#include "mcu_math.h"

uint32_t mcu_add(uint32_t left, uint32_t right)
{
    return left + right;
}

uint32_t mcu_limit(uint32_t value, uint32_t maximum)
{
    return value > maximum ? maximum : value;
}
