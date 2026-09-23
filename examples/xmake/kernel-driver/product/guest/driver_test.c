#include <cautest/cautest.h>
#include <errno.h>
#include <fcntl.h>
#include <sys/ioctl.h>
#include <unistd.h>
#include "echo_abi.h"

CAUTEST_CASE(read_write)
{
    int fd = open("/dev/cautest_echo", O_RDWR), input = 42, output = 0;
    CAUTEST_EXPECT_EQ_INT(fd >= 0, 1);
    if (fd < 0) return;
    CAUTEST_EXPECT_EQ_INT(write(fd, &input, sizeof(input)), sizeof(input));
    CAUTEST_EXPECT_EQ_INT(read(fd, &output, sizeof(output)), sizeof(output));
    CAUTEST_EXPECT_EQ_INT(output, input);
    close(fd);
}
CAUTEST_CASE(ioctl_value)
{
    int fd = open("/dev/cautest_echo", O_RDWR), input = -7, output = 0;
    CAUTEST_EXPECT_EQ_INT(fd >= 0, 1);
    if (fd < 0) return;
    CAUTEST_EXPECT_EQ_INT(ioctl(fd, ECHO_SET_VALUE, &input), 0);
    CAUTEST_EXPECT_EQ_INT(ioctl(fd, ECHO_GET_VALUE, &output), 0);
    CAUTEST_EXPECT_EQ_INT(output, input);
    close(fd);
}
CAUTEST_CASE(invalid_input)
{
    int fd = open("/dev/cautest_echo", O_RDWR), input = 0;
    CAUTEST_EXPECT_EQ_INT(fd >= 0, 1);
    if (fd < 0) return;
    errno = 0; CAUTEST_EXPECT_EQ_INT(write(fd, &input, 1), -1); CAUTEST_EXPECT_EQ_INT(errno, EINVAL);
    errno = 0; CAUTEST_EXPECT_EQ_INT(read(fd, &input, 1), -1); CAUTEST_EXPECT_EQ_INT(errno, EINVAL);
    errno = 0; CAUTEST_EXPECT_EQ_INT(ioctl(fd, 0, &input), -1); CAUTEST_EXPECT_EQ_INT(errno, ENOTTY);
    errno = 0; CAUTEST_EXPECT_EQ_INT(ioctl(fd, ECHO_SET_VALUE, 0), -1); CAUTEST_EXPECT_EQ_INT(errno, EFAULT);
    close(fd);
}
CAUTEST_SUITE(driver_abi, CAUTEST_CASE_ENTRY(read_write), CAUTEST_CASE_ENTRY(ioctl_value), CAUTEST_CASE_ENTRY(invalid_input));
