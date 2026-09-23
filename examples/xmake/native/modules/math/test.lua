target("test.math")
    set_kind("binary")
    set_default(false)
    add_rules("example.math.sources", "cautest.native")
    add_defines("MATH_SCALE=2")
    add_files("math_test.c", "math_second.c")
    add_values("cautest.registry.suites", "math_test", "math_second")
target_end()
ctest.native {
    id = "unit.math", target = "test.math", level = "unit", tags = {"host", "math"},
    run = {case = {"adds", "scales", "smoke"}}
}
ctest.native {
    id = "unit.math.expected-failure", target = "test.math", enabled = false,
    tags = {"host", "negative"}, run = {case = "deliberate_failure"}
}
