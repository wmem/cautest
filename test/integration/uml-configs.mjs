import { driverAbiCTestJob, kernelCTestJob, kernelCTestJobFactory, testConfig, umlKernelEnvironment } from "../../dist/config/index.js";

function realEnvironment(prerequisites) {
  return umlKernelEnvironment({
    kernel: { sourceDir: prerequisites.kernelSource, timeoutMs: 20 * 60_000 },
    busybox: { sourceDir: prerequisites.busyboxSource, timeoutMs: 10 * 60_000 },
    moduleDefaults: { timeoutMs: 5 * 60_000 },
    machine: { readyTimeoutMs: 60_000, startTimeoutMs: 90_000 },
  });
}

export function kernelUmlSmokeConfig(prerequisites) {
  const environment = realEnvironment(prerequisites);
  const driverUnitTest = kernelCTestJobFactory({ environment, defaults: { level: "unit", tags: ["unit", "driver"] } });
  return testConfig({ jobs: [kernelCTestJob({
    id: "component.kernel-counter",
    environment,
    tests: ["examples/kernel-lib/test/kernel_counter_test.c"],
    sources: ["examples/kernel-lib/src/kernel_counter.c"],
    headers: ["examples/kernel-lib/include/kernel_counter.h"],
    suites: ["kernel_counter"],
    run: { include: ["kernel_counter/increments"], caseTimeoutMs: 2_000, runTimeoutMs: 20_000, stepTimeoutMs: 60_000 },
    timeoutMs: 30 * 60_000,
  }), driverUnitTest({
    id: "unit.example-driver-core",
    tests: ["examples/linux-driver-unit/test/example_driver_core_test.c"],
    sources: ["examples/linux-driver-unit/driver/example_driver_core.c"],
    headers: ["examples/linux-driver-unit/include/example_driver_core.h"],
    suites: ["example_driver_core"],
    run: { include: ["example_driver_core/clamps_to_driver_limits"], caseTimeoutMs: 2_000, runTimeoutMs: 20_000, stepTimeoutMs: 60_000 },
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
