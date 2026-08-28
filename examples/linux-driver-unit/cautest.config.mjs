import {
  kernelCTestJobFactory,
  testConfig,
  umlKernelEnvironment,
} from "@cautest/config.js";

export function driverUnitJob(baseDir = ".") {
  const fromExample = (relative) => baseDir === "." ? relative : `${baseDir}/${relative}`;
  const environment = umlKernelEnvironment({
    kernel: { sourceDir: process.env.KERNEL_SRC ?? fromExample("vendor/linux") },
    busybox: { sourceDir: process.env.BUSYBOX_SRC ?? fromExample("vendor/busybox") },
  });

  const driverUnitTest = kernelCTestJobFactory({
    environment,
    defaults: { level: "unit", tags: ["unit", "driver"] },
  });

  return driverUnitTest({
    id: "unit.example-driver-core",
    tests: [fromExample("test/example_driver_core_test.c")],
    sources: [fromExample("driver/example_driver_core.c")],
    headers: [fromExample("include/example_driver_core.h")],
    suites: ["example_driver_core"],
  });
}

export default testConfig({ jobs: [driverUnitJob()] });
