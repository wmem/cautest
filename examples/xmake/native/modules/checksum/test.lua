target("test.checksum")
    set_kind("binary")
    set_default(false)
    add_rules("cautest.native")
    if has_config("coverage") then add_rules("cautest.gcov") end
    add_files("checksum_test.c")
    add_values("cautest.registry.suites", "checksum_test")
target_end()
ctest.native {id = "unit.checksum", target = "test.checksum", tags = {"host", "checksum"}, coverage = has_config("coverage") and {} or nil}
