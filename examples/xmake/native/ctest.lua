ctest.project {
    defaults = {resultDir = ".cautest/results"},
    profiles = {{id = "ci", env = {CAUTEST_EXAMPLE_PROFILE = "ci"}}}
}
-- Explicit root: no implicit scan of vendor/dependency trees.
ctest.include {patterns = {"modules/**/test.lua"}}
