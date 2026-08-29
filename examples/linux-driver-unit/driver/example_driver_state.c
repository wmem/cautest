#include "example_driver_state.h"

int example_driver_next_state(int current, int event_ok)
{
    if (!event_ok)
        return EXAMPLE_DRIVER_ERROR;
    if (current == EXAMPLE_DRIVER_IDLE)
        return EXAMPLE_DRIVER_READY;
    return current;
}
