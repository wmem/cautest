import { kernelCTestJob, testConfig, umlKernelEnvironment } from "@cautest/config.js";

export function kernelCounterJob(baseDir = ".") {
  const fromExample = (relative) => baseDir === "." ? relative : `${baseDir}/${relative}`;
  const environment = umlKernelEnvironment({
    kernel: { sourceDir: process.env.KERNEL_SRC ?? fromExample("vendor/linux") },
    busybox: { sourceDir: process.env.BUSYBOX_SRC ?? fromExample("vendor/busybox") },
    moduleDefaults: { headers: [fromExample("include/**/*.h")], defines: { EXAMPLE_TEST: 1 } },
  });

  return kernelCTestJob({
    id: "component.kernel-counter",
    level: "component",
    environment,
    tests: [fromExample("test/kernel_counter_test.c")],
    sources: [fromExample("src/kernel_counter.c")],
    headers: [fromExample("include/kernel_counter.h")],
    suites: ["kernel_counter"],
  });
}

export default testConfig({ jobs: [kernelCounterJob()] });
