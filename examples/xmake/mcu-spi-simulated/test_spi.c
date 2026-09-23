#include <cautest/cautest.h>
#include <errno.h>
#include "spi_model.h"
CAUTEST_CASE(device_identity) {
    struct spi_model d; uint8_t tx[4] = {0x9f, 0, 0, 0}, rx[4];
    spi_model_reset(&d); spi_model_select(&d, 1);
    CAUTEST_EXPECT_EQ_INT(0, spi_model_transfer(&d, 0, tx, rx, 4));
    CAUTEST_EXPECT_EQ_U32(0x04, rx[1]);
    CAUTEST_EXPECT_EQ_U32(0x7f, rx[2]);
    CAUTEST_EXPECT_EQ_U32(0x03, rx[3]);
}
CAUTEST_CASE(chip_select_and_mode) {
    struct spi_model d; uint8_t tx[4] = {0x9f, 0, 0, 0}, rx[4];
    spi_model_reset(&d);
    CAUTEST_EXPECT_EQ_INT(-ENODEV, spi_model_transfer(&d, 0, tx, rx, 4));
    spi_model_select(&d, 1);
    CAUTEST_EXPECT_EQ_INT(-EINVAL, spi_model_transfer(&d, 3, tx, rx, 4));
    spi_model_select(&d, 0);
    CAUTEST_EXPECT_EQ_INT(-ENODEV, spi_model_transfer(&d, 0, tx, rx, 4));
}
CAUTEST_CASE(read_write_and_write_enable) {
    struct spi_model d; uint8_t write[6] = {0x02, 17, 0x12, 0x34, 0xab, 0xcd};
    uint8_t read[6] = {0x03, 17, 0, 0, 0, 0}, enable[1] = {0x06}, rx[6];
    size_t i; spi_model_reset(&d); spi_model_select(&d, 1);
    CAUTEST_EXPECT_EQ_INT(-EACCES, spi_model_transfer(&d, 0, write, rx, 6));
    CAUTEST_EXPECT_EQ_INT(0, spi_model_transfer(&d, 0, enable, rx, 1));
    CAUTEST_EXPECT_EQ_INT(0, spi_model_transfer(&d, 0, write, rx, 6));
    CAUTEST_EXPECT_EQ_INT(0, spi_model_transfer(&d, 0, read, rx, 6));
    for (i = 2; i < 6; ++i) CAUTEST_EXPECT_EQ_U32(write[i], rx[i]);
    CAUTEST_EXPECT_EQ_INT(-EACCES, spi_model_transfer(&d, 0, write, rx, 6));
}
CAUTEST_CASE(invalid_inputs_and_reset) {
    struct spi_model d; uint8_t tx[4] = {0x03, 255, 0, 0}, rx[4];
    spi_model_reset(&d); spi_model_select(&d, 1);
    CAUTEST_EXPECT_EQ_INT(-ERANGE, spi_model_transfer(&d, 0, tx, rx, 4));
    CAUTEST_EXPECT_EQ_INT(-EINVAL, spi_model_transfer(&d, 0, tx, rx, 0));
    tx[0] = 0xff;
    CAUTEST_EXPECT_EQ_INT(-EINVAL, spi_model_transfer(&d, 0, tx, rx, 4));
    d.memory[17] = 0; d.write_enabled = 1; spi_model_reset(&d);
    CAUTEST_EXPECT_EQ_U32(0xff, d.memory[17]);
    CAUTEST_EXPECT_EQ_U32(0, d.write_enabled);
    CAUTEST_EXPECT_EQ_U32(0, d.selected);
}
CAUTEST_SUITE(spi_protocol, CAUTEST_CASE_ENTRY(device_identity), CAUTEST_CASE_ENTRY(chip_select_and_mode));
CAUTEST_SUITE(spi_transfer, CAUTEST_CASE_ENTRY(read_write_and_write_enable), CAUTEST_CASE_ENTRY(invalid_inputs_and_reset));
