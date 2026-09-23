#ifndef CAUTEST_EXAMPLE_ECHO_ABI_H
#define CAUTEST_EXAMPLE_ECHO_ABI_H
#include <linux/ioctl.h>
#define ECHO_GET_VALUE _IOR('E', 1, int)
#define ECHO_SET_VALUE _IOW('E', 2, int)
#endif
