#include "kernel_counter.h"
int kernel_counter_next(void) { static int value; return ++value; }
