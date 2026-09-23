#include "spi_model.h"
#include <errno.h>
#ifndef SPI_SIM_INJECT_RX_FAULT
#define SPI_SIM_INJECT_RX_FAULT 0
#endif
void spi_model_reset(struct spi_model *d) {
    size_t i; for (i = 0; i < sizeof(d->memory); ++i) d->memory[i] = 0xff;
    d->selected = 0; d->write_enabled = 0;
}
void spi_model_select(struct spi_model *d, unsigned active) { d->selected = !!active; }
int spi_model_transfer(struct spi_model *d, unsigned mode, const uint8_t *tx, uint8_t *rx, size_t n) {
    size_t i, address;
    if (!d || !tx || !rx || !n) return -EINVAL;
    if (!d->selected) return -ENODEV;
    if (mode != 0) return -EINVAL;
    for (i = 0; i < n; ++i) rx[i] = 0;
    switch (tx[0]) {
    case 0x9f: /* deterministic device identity */
        if (n != 4) return -EINVAL;
        rx[1] = SPI_SIM_INJECT_RX_FAULT ? 0xee : 0x04;
        rx[2] = 0x7f; rx[3] = 0x03; return 0;
    case 0x06:
        if (n != 1) return -EINVAL;
        d->write_enabled = 1; return 0;
    case 0x02: case 0x03:
        if (n < 3) return -EINVAL;
        address = tx[1];
        if (n - 2 > sizeof(d->memory) - address) return -ERANGE;
        if (tx[0] == 0x02 && !d->write_enabled) return -EACCES;
        for (i = 2; i < n; ++i) {
            if (tx[0] == 0x02) d->memory[address + i - 2] = tx[i];
            else rx[i] = d->memory[address + i - 2];
        }
        if (tx[0] == 0x02) d->write_enabled = 0;
        return 0;
    default: return -EINVAL;
    }
}
