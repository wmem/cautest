# SPI behavioral simulation

This example compiles the actual C model and test cases with Xmake and exchanges
CTP through the reference MCU target with fragmented serial I/O and one injected
disconnect. It is a host-executed behavioral model, not an instruction-set,
cycle-accurate, pin-level or electrical MCU/SPI simulator.

Clone Cautest into `tools/cautest`, prepare it with npm, then run:

```sh
xmake ct --tag=simulated,mcu,spi --reporter=json,junit
xmake ct --case=device_identity integration.spi.protocol
xmake f -y --spi-fault=y
xmake ct --reporter=json,junit
# The injected wrong device ID must produce FAIL / exit 1, not success.
xmake f -y --spi-fault=n
xmake ct --reporter=json,junit
```

Two Jobs share one compiled firmware but have separate flash/reset/transport and
cleanup lifecycles. Four C cases cover device identity, chip select/mode, memory
read/write and write enable, bounds/invalid command handling, and model reset.
The known-error variant corrupts the received ID and must fail the identity case.
A subsequent normal configuration must recover to four passing cases.

Per the user's revised delivery scope, MCU software acceptance can use this
simulation. The original plan's real-board SPI gate remains separately unrun;
no firmware download, GPIO waveform or physical-device claim follows from it.
