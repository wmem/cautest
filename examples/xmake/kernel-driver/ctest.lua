ctest.project {defaults = {resultDir = ".cautest/results"}}
ctest.environment {
    id = "uml",
    provider = {module = "environment.mjs", export = "createEnvironment"}
}
ctest.include {patterns = {"product/**/test.lua"}}
