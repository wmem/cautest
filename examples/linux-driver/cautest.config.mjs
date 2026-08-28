import { driverAbiCTestJob, testConfig, umlKernelEnvironment } from "@cautest/config.js";

const environment = umlKernelEnvironment({
  kernel: { sourceDir: process.env.KERNEL_SRC ?? "vendor/linux" },
  busybox: { sourceDir: process.env.BUSYBOX_SRC ?? "vendor/busybox" },
});

export default testConfig({ jobs: [driverAbiCTestJob({
  id: "integration.example-driver",
  environment,
  probe: {},
  drivers: [{ name: "example_driver", sourceDir: "driver", sandboxRoot: ".", output: "example_driver.ko" }],
  guest: {
    tests: ["guest/driver_abi_test.c"],
    headers: ["include/example_driver_abi.h"],
    suites: ["driver_api"],
  },
})] });
