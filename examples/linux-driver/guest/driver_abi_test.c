#define _POSIX_C_SOURCE 200809L
#include <cautest/cautest.h>
#include <fcntl.h>
#include <stdint.h>
#include <unistd.h>
#include "example_driver_abi.h"
#include "probe_client.h"

CAUTEST_CASE(read_reaches_driver_boundary)
{
    struct cautest_probe_client probe;
    struct cautest_probe_event_record event;
    uint32_t value = 0;
    int driver;
    (void)suite_fixture; (void)case_fixture; (void)cautest_parameter;
    probe.fd = -1;
    CAUTEST_ASSERT_EQ_INT(0, cautest_probe_client_open(&probe, "/dev/cautest-probe", EXAMPLE_DRIVER_PROBE));
    driver = open(EXAMPLE_DRIVER_DEVICE, O_RDONLY | O_CLOEXEC);
    CAUTEST_ASSERT_TRUE(driver >= 0);
    CAUTEST_EXPECT_EQ_INT(sizeof(value), read(driver, &value, sizeof(value)));
    CAUTEST_EXPECT_EQ_U32(EXAMPLE_DRIVER_VALUE, value);
    CAUTEST_EXPECT_EQ_INT(0, cautest_probe_client_wait(&probe, 1000));
    CAUTEST_EXPECT_EQ_INT(0, cautest_probe_client_read(&probe, &event));
    CAUTEST_EXPECT_EQ_U32(1U, event.kind);
    close(driver);
    cautest_probe_client_close(&probe);
}
CAUTEST_SUITE(driver_api, CAUTEST_CASE_ENTRY(read_reaches_driver_boundary));
