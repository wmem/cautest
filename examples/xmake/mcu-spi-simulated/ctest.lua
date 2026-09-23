ctest.project {defaults = {resultDir = ".cautest/results"}}
ctest.board {
    id = "simulated", resourceId = "cautest.example.spi-behavioral-simulation",
    provider = {module = "board.mjs", export = "create"},
    ownership = "owned", lockTimeoutMs = 10000,
    options = {maxReadSize = 2, maxWriteSize = 1, disconnectOnce = 4}
}
-- Share the compiled firmware, not a powered-on board or a session.
ctest.mcu {
    id = "integration.spi.protocol", target = "firmware.spi", board = "simulated",
    tags = {"simulated", "mcu", "spi"}, reconnects = 1,
    run = {suite = {"spi_protocol"}}
}
ctest.mcu {
    id = "integration.spi.transfer", target = "firmware.spi", board = "simulated",
    tags = {"simulated", "mcu", "spi"}, reconnects = 1,
    run = {suite = {"spi_transfer"}}
}
