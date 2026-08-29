import { driverAbiCTestJob, testConfig, umlKernelEnvironment } from "@cautest/config.js";

export function driverAbiJob(baseDir = ".") {
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
  });

  return driverAbiCTestJob({
    id: "integration.example-driver",
    environment,
    probe: {},
    drivers: [{ name: "example_driver", sourceDir: fromExample("driver"), sandboxRoot: baseDir, output: "example_driver.ko" }],
    guest: {
      tests: [fromExample("guest/driver_abi_test.c")],
      headers: [fromExample("include/example_driver_abi.h")],
      suites: ["driver_api"],
    },
  });
}

export default testConfig({ jobs: [driverAbiJob()] });
