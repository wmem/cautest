ctest.project {defaults = {resultDir = ".cautest/results"}}
-- Physical identity, not this configuration alias, controls cross-process locking.
ctest.board {
    id = "simulated", resourceId = "cautest.example.simulated-board",
    provider = {module = "board.mjs", export = "create"},
    ownership = "owned", lockTimeoutMs = 10000,
    options = {maxReadSize = 2, maxWriteSize = 1}
}
ctest.mcu {
    id = "integration.mcu", target = "firmware.simulated", board = "simulated",
    tags = {"simulated", "mcu"}, reconnects = 1
}
