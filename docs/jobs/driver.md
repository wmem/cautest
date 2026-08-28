# Linux Driver ABI Test

Driver ABI Test 复用 Kernel/UML 环境，在 Guest Userspace 执行自动生成入口的 C Test：

```js
driverAbiCTestJob({
  id: "integration.driver.queue",
  environment,
  probe: {},
  drivers: [{
    name: "queue-driver",
    sourceDir: "src/driver",
    sandboxRoot: ".",
    output: "queue_driver.ko",
  }],
  guest: {
    tests: ["test/driver/queue_abi_test.c"],
    headers: ["include/queue_abi.h"],
    suites: ["queue_abi"],
  },
});
```

`probe: {}` 启用内置 test-only Probe Module，并向产品 Driver Kbuild 注入 `CONFIG_CAUTEST=y` 和 `CAUTEST_C_ROOT`。具体 Driver 可以用 `probe.makeVariables` 覆盖或追加变量。若 ABI 测试不使用 Probe，可省略 `probe`。

Cautest 自动生成 Guest Registry/入口并链接 CTP3 Runtime 和 Probe Client；不需要手写 Guest Makefile、Registry 或 `main()`。多个 Driver Module 按声明顺序进入 Rootfs，`extraModules` 用名称表达构建依赖。

调用链：`driverAbiCTestJob` → 公共 Kernel/BusyBox → 可选内置 Probe → 隔离 Driver Module → 自动 Guest C Test → Rootfs → UML → `cTestRun(process)` → Logs。

权威 Schema：`DriverAbiCTestJobInput`、`DriverGuestCTestInput`、`DriverProbeInput`，见源码 `src/config/schema/driver.ts` 或安装后的 `lib/config/schema/driver.d.ts`。
