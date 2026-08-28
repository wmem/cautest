import { nativeCTestJob, testConfig } from "@cautest/config.js";

export default testConfig({ jobs: [nativeCTestJob({
  id: "unit.example-math",
  tests: ["test/example_math_test.c"],
  sources: ["src/example_math.c"],
  headers: ["include/example_math.h"],
  suites: ["example_math"],
})] });
