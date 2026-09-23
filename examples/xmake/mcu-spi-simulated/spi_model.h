#ifndef CAUTEST_EXAMPLE_SPI_MODEL_H
#define CAUTEST_EXAMPLE_SPI_MODEL_H
#include <stddef.h>
#include <stdint.h>
/* Behavioral SPI memory peripheral. No electrical/timing claim is made. */
struct spi_model { uint8_t memory[256]; unsigned selected; unsigned write_enabled; };
void spi_model_reset(struct spi_model *device);
void spi_model_select(struct spi_model *device, unsigned active);
int spi_model_transfer(struct spi_model *device, unsigned mode, const uint8_t *tx, uint8_t *rx, size_t length);
#endif
