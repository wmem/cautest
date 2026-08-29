#include "example_driver_abi.h"
#include "example_driver_internal.h"

__u32 example_driver_current_value(void)
{
    return EXAMPLE_DRIVER_VALUE;
}
