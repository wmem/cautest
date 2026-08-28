import {
  composeJobWorkflows,
  nativeCTestJob,
  processStart,
  scriptSystemTestJob,
  testConfig,
  testJob,
} from "@cautest/config.js";

const native = nativeCTestJob({
  id: "source.native-math",
  tests: ["native/example_math_test.c"],
  sources: ["native/example_math.c"],
  headers: ["native/example_math.h"],
  suites: ["example_math"],
});

const script = scriptSystemTestJob({
  id: "source.system-api",
  file: "system/system.test.mjs",
});

const service = testJob({
  ...script,
  workflow: [
    processStart({
      name: "server",
      program: process.execPath,
      args: ["system/server.mjs"],
      ready: { kind: "file", path: ".cautest/server.ready" },
    }),
    ...script.workflow,
  ],
});

export default testConfig({ jobs: [testJob({
  id: "system.composed-local",
  level: "system",
  description: "在一个 Job 中组合 Native C 与 Script System Test",
  workflow: [composeJobWorkflows(native, service)],
})] });
