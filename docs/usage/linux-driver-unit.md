# 运行 Linux Driver 源码关联单元测试

Driver Unit Test 适合验证 Driver 内部算法、状态转换或可与模块入口分离的源码。产品源码与测试一起编入自动生成的 Kernel Test Module，不会加载产品 Driver 的设备节点，也不验证 userspace ABI。需要验证设备操作和 Probe 时应改用 [Linux Driver ABI/Probe](linux-driver-abi.md)。

最小配置与普通 `kernelCTestJob()` 相同；同类 Driver Unit Job 通常通过 `kernelCTestJobFactory()` 共享 UML Environment：

```js
const driverUnitTest = kernelCTestJobFactory({ environment });
const job = driverUnitTest({
  id: "unit.driver-core",
  tests: ["test/driver_core_test.c"],
});
```

小而典型的多文件示例位于 `examples/linux-driver-unit/`：

```text
examples/linux-driver-unit/
├── cautest.config.mjs
├── driver/
│   ├── example_driver_core.c
│   └── example_driver_state.c
├── include/
│   ├── example_driver_core.h
│   └── example_driver_state.h
└── test/
    ├── example_driver_core_test.c
    └── example_driver_state_test.c
```

同类测试通常共享一个 `kernelCTestJobFactory()`：

```js
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
```

运行方式与普通 Kernel UML Test 相同：

```bash
export KERNEL_SRC=/path/to/linux
export BUSYBOX_SRC=/path/to/busybox
cd examples/linux-driver-unit
../../cautest.js doctor
../../cautest.js list
../../cautest.js plan unit.example-driver-core
../../cautest.js run unit.example-driver-core
```

Cautest 自动生成 Kbuild、Registry、模块入口和 C Runtime 注册。成功时会看到 `example_driver_core/clamps_to_driver_limits` 和 `example_driver_state/transitions_driver_state` 通过。同一个 Driver 内部边界可以继续增加源码、测试和 Suite；编译宏、Level 或隔离边界不同时复用 Factory 创建新 Job。通用规则见[组织典型项目](project-organization.md)。

`kernel.timeoutMs` 和 `busybox.timeoutMs` 分别控制对应 Build Step；示例为首次构建预留 20 分钟和 10 分钟，`moduleDefaults.timeoutMs` 为 Runtime 和 Test Module 预留 5 分钟。CLI 的 `--run-timeout` 只控制 C Test Run，不能解决 Kernel、BusyBox 或 Module 的构建 Step 超时。

Driver Unit 使用 `KernelCTestJobInput` 和 `KernelCTestJobFactoryInput`，位于 `lib/config/schema/kernel.d.ts`。特殊宏和 Flag 放入单个 Job 的 `module.defines`、`module.cflags`；完整映射见[配置 API 索引](config-reference.md)。
