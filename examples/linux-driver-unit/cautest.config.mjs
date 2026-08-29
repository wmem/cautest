import {
  kernelCTestJobFactory,
  testConfig,
  umlKernelEnvironment,
} from "@cautest/config.js";

export function driverUnitJob(baseDir = ".") {
  const fromExample = (relative) => baseDir === "." ? relative : `${baseDir}/${relative}`;
  const environment = umlKernelEnvironment({
    kernel: {
      sourceDir: process.env.KERNEL_SRC ?? fromExample("vendor/linux"),
      timeoutMs: 20 * 60_000,
    },
    busybox: {
      sourceDir: process.env.BUSYBOX_SRC ?? fromExample("vendor/busybox"),
      timeoutMs: 10 * 60_000,
    },
    moduleDefaults: { timeoutMs: 5 * 60_000 },
  });

  const driverUnitTest = kernelCTestJobFactory({
    environment,
    defaults: { level: "unit", tags: ["unit", "driver"] },
  });

  return driverUnitTest({
    id: "unit.example-driver-core",
    tests: [fromExample("test/**/*_test.c")],
    sources: [fromExample("driver/**/*.c")],
    headers: [fromExample("include/**/*.h")],
    suites: ["example_driver_core", "example_driver_state"],
  });
}

export default testConfig({ jobs: [driverUnitJob()] });
