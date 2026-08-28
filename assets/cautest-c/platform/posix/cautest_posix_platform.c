#define _POSIX_C_SOURCE 200809L

#include "posix_platform.h"

#include <errno.h>
#include <time.h>
#include <unistd.h>

int cautest_posix_read_all(int fd, void *data, size_t size)
{
    unsigned char *cursor = (unsigned char *)data;

    while (size != 0u) {
        ssize_t count = read(fd, cursor, size);
        if (count == 0)
            return 1;
        if (count < 0) {
            if (errno == EINTR)
                continue;
            return -1;
        }
        cursor += (size_t)count;
        size -= (size_t)count;
    }
    return 0;
}

int cautest_posix_write_all(int fd, const void *data, size_t size)
{
    const unsigned char *cursor = (const unsigned char *)data;

    while (size != 0u) {
        ssize_t count = write(fd, cursor, size);
        if (count < 0) {
            if (errno == EINTR)
                continue;
            return -1;
        }
        cursor += (size_t)count;
        size -= (size_t)count;
    }
    return 0;
}

uint64_t cautest_posix_time_ms(void)
{
    struct timespec value;

    if (clock_gettime(CLOCK_MONOTONIC, &value) != 0)
        return 0u;
    return (uint64_t)value.tv_sec * 1000u +
           (uint64_t)value.tv_nsec / 1000000u;
}
