#ifndef CAUTEST_POSIX_PLATFORM_H
#define CAUTEST_POSIX_PLATFORM_H

#include <stddef.h>
#include <stdint.h>

int cautest_posix_read_all(int fd, void *data, size_t size);
int cautest_posix_write_all(int fd, const void *data, size_t size);
uint64_t cautest_posix_time_ms(void);

#endif
