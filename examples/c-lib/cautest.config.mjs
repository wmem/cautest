import { nativeCTestJob, testConfig } from "@cautest/config.js";

export function exampleMathJob(baseDir = ".") {
  const fromExample = (relative) => baseDir === "." ? relative : `${baseDir}/${relative}`;
  return nativeCTestJob({
    id: "unit.example-math",
    tests: [fromExample("test/example_math_test.c")],
    sources: [fromExample("src/example_math.c")],
    headers: [fromExample("include/example_math.h")],
    suites: ["example_math"],
  });
}

export default testConfig({ jobs: [exampleMathJob()] });
