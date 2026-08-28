import { driverAbiCTestJob, kernelCTestJob, testConfig, umlKernelEnvironment } from "../../dist/config/index.js";

function realEnvironment(prerequisites) {
  return umlKernelEnvironment({
    kernel: { sourceDir: prerequisites.kernelSource, timeoutMs: 20 * 60_000 },
    busybox: { sourceDir: prerequisites.busyboxSource, timeoutMs: 10 * 60_000 },
    moduleDefaults: { timeoutMs: 5 * 60_000 },
    machine: { readyTimeoutMs: 60_000, startTimeoutMs: 90_000 },
  });
}

export function kernelUmlSmokeConfig(prerequisites) {
  return testConfig({ jobs: [kernelCTestJob({
    id: "integration.uml.smoke",
    environment: realEnvironment(prerequisites),
    tests: ["test/fixtures/kernel/smoke_test.c"],
    suites: ["kernel_smoke"],
    run: { include: ["kernel_smoke/passes"], caseTimeoutMs: 2_000, runTimeoutMs: 20_000, stepTimeoutMs: 60_000 },
    timeoutMs: 30 * 60_000,
  })] });
}

export function driverUmlSmokeConfig(prerequisites) {
  return testConfig({ jobs: [driverAbiCTestJob({
    id: "integration.uml.driver-probe-smoke",
    environment: realEnvironment(prerequisites),
    probe: {},
    drivers: [{
      name: "example_driver",
      sourceDir: "examples/linux-driver/driver",
      sandboxRoot: "examples/linux-driver",
      output: "example_driver.ko",
    }],
    guest: {
      tests: ["examples/linux-driver/guest/driver_abi_test.c"],
      headers: ["examples/linux-driver/include/example_driver_abi.h"],
      suites: ["driver_api"],
    },
    run: { include: ["driver_api/read_reaches_driver_boundary"], caseTimeoutMs: 2_000, runTimeoutMs: 20_000, stepTimeoutMs: 60_000 },
    timeoutMs: 30 * 60_000,
  })] });
}
