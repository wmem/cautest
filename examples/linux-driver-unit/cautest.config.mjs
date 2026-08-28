import {
  kernelCTestJobFactory,
  testConfig,
  umlKernelEnvironment,
} from "@cautest/config.js";

const environment = umlKernelEnvironment({
  kernel: { sourceDir: process.env.KERNEL_SRC ?? "vendor/linux" },
  busybox: { sourceDir: process.env.BUSYBOX_SRC ?? "vendor/busybox" },
});

const driverUnitTest = kernelCTestJobFactory({
  environment,
  defaults: { level: "unit", tags: ["unit", "driver"] },
});

export default testConfig({ jobs: [driverUnitTest({
  id: "unit.example-driver-core",
  tests: ["test/example_driver_core_test.c"],
  sources: ["driver/example_driver_core.c"],
  headers: ["include/example_driver_core.h"],
  suites: ["example_driver_core"],
})] });
