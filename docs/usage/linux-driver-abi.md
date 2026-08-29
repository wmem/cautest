# 运行 Linux Driver ABI 与 Probe 测试

Driver ABI Test 会真实构建并加载产品 Driver，在 UML Guest Userspace 运行 C Test，通过设备节点验证公开 ABI。需要观察 Driver 内部事件时，可以同时启用 Cautest test-only Probe。它适合接口集成测试，不替代只针对内部算法的 [Driver Unit Test](linux-driver-unit.md)。

完整示例位于 `examples/linux-driver/`：

```text
examples/linux-driver/
├── cautest.config.mjs
├── driver/Makefile
├── driver/example_driver.c
├── guest/driver_abi_test.c
└── include/example_driver_abi.h
```

配置声明被测 Module、Guest C Test 和 Probe：

```js
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
```

`probe: {}` 让 Cautest 构建 Probe Module，并向 Driver Kbuild 注入 `CONFIG_CAUTEST=y` 和 `CAUTEST_C_ROOT`。示例 Makefile 只在该开关启用时包含 Probe Header，因此正常产品构建不依赖 Cautest。

设置源码树并执行：

```bash
export KERNEL_SRC=/path/to/linux
export BUSYBOX_SRC=/path/to/busybox
cd examples/linux-driver
../../cautest.js doctor
../../cautest.js list
../../cautest.js plan integration.example-driver
../../cautest.js run integration.example-driver
```

成功结果包含 Kernel、Probe Module、产品 Driver、Guest Program、Rootfs、UML 日志和 `driver_api/read_reaches_driver_boundary`。Guest Test 的 Registry 和 `main()` 由 Cautest 生成，不需要 Guest Makefile。

`kernel.timeoutMs` 和 `busybox.timeoutMs` 分别控制对应 Build Step；示例为首次构建预留 20 分钟和 10 分钟，应根据机器性能和源码配置调整。CLI 的 `--run-timeout` 只控制 Guest 中的 C Test Run，不能解决 Kernel、BusyBox、Probe 或 Driver Module 的构建 Step 超时；这些 Step 需要在对应配置字段上单独设置 `timeoutMs`。

如果 Driver Module 构建失败，先确认 `sourceDir`、`sandboxRoot`、`output` 与实际 Kbuild 一致。使用 Probe 时，Driver Makefile 必须包含 `$(CAUTEST_C_ROOT)/include` 和 `$(CAUTEST_C_ROOT)/platform/linux-kernel/include`。Driver 和 Guest 的精确配置查看 `lib/config/schema/driver.d.ts`；Probe ABI 以 `assets/cautest-c/platform/linux-kernel/include/cautest/probe.h` 和 `assets/cautest-c/agent/uml-guest-agent/probe_client.h` 为准。
