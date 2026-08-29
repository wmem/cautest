#include "kernel_counter_limits.h"

int kernel_counter_limit(int value, int maximum)
{
    return value > maximum ? maximum : value;
}
