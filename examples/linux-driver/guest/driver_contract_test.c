#define _POSIX_C_SOURCE 200809L
#include <cautest/cautest.h>
#include <errno.h>
#include <fcntl.h>
#include <stdint.h>
#include <unistd.h>
#include "example_driver_abi.h"

CAUTEST_CASE(rejects_short_read_buffer)
{
    uint8_t value = 0;
    int driver;
    (void)suite_fixture;
    (void)case_fixture;
    (void)cautest_parameter;

    driver = open(EXAMPLE_DRIVER_DEVICE, O_RDONLY | O_CLOEXEC);
    CAUTEST_ASSERT_TRUE(driver >= 0);
    errno = 0;
    CAUTEST_EXPECT_EQ_INT(-1, read(driver, &value, sizeof(value)));
    CAUTEST_EXPECT_EQ_INT(EINVAL, errno);
    close(driver);
}

CAUTEST_SUITE(driver_contract,
    CAUTEST_CASE_ENTRY(rejects_short_read_buffer));
