import { kernelCTestJob, testConfig, umlKernelEnvironment } from "@cautest/config.js";

const environment = umlKernelEnvironment({
  kernel: { sourceDir: process.env.KERNEL_SRC ?? "vendor/linux" },
  busybox: { sourceDir: process.env.BUSYBOX_SRC ?? "vendor/busybox" },
  moduleDefaults: { headers: ["include/**/*.h"], defines: { EXAMPLE_TEST: 1 } },
});

export default testConfig({ jobs: [kernelCTestJob({
  id: "component.kernel-counter",
  environment,
  tests: ["test/kernel_counter_test.c"],
  sources: ["src/kernel_counter.c"],
  headers: ["include/kernel_counter.h"],
  suites: ["kernel_counter"],
})] });
