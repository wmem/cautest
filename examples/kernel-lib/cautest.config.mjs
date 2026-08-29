import { kernelCTestJob, testConfig, umlKernelEnvironment } from "@cautest/config.js";

export function kernelCounterJob(baseDir = ".") {
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
    moduleDefaults: {
      defines: { EXAMPLE_TEST: 1 },
      timeoutMs: 5 * 60_000,
    },
  });

  return kernelCTestJob({
    id: "component.kernel-counter",
    level: "component",
    environment,
    tests: [fromExample("test/**/*_test.c")],
    sources: [fromExample("src/**/*.c")],
    headers: [fromExample("include/**/*.h")],
    suites: ["kernel_counter", "kernel_counter_limits"],
  });
}

export default testConfig({ jobs: [kernelCounterJob()] });
