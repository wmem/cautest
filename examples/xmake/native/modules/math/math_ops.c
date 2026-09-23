#include "math_ops.h"
#ifndef MATH_SCALE
#define MATH_SCALE 1
#endif
int math_add(int a, int b) { return a + b; }
int math_scale(int value) { return value * MATH_SCALE; }
