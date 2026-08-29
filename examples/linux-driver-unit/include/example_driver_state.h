#ifndef EXAMPLE_DRIVER_STATE_H
#define EXAMPLE_DRIVER_STATE_H

enum example_driver_state {
    EXAMPLE_DRIVER_IDLE = 0,
    EXAMPLE_DRIVER_READY = 1,
    EXAMPLE_DRIVER_ERROR = 2,
};

int example_driver_next_state(int current, int event_ok);

#endif
