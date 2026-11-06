import { nativeCTestJob, testConfig } from "@cautest/config.js";

export function exampleMathJob(baseDir = ".") {
  const fromExample = (relative) => baseDir === "." ? relative : `${baseDir}/${relative}`;
  return nativeCTestJob({
    id: "unit.example-math",
    description: "验证数学接口的正常运算和边界行为",
    tests: [fromExample("test/**/*_test.c")],
    sources: [fromExample("src/**/*.c")],
    headers: [fromExample("include/**/*.h")],
    suites: ["example_math", "example_limits"],
  });
}

export default testConfig({ jobs: [exampleMathJob()] });
