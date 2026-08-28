# 运行 Linux Driver 源码关联单元测试

Driver Unit Test 适合验证 Driver 内部算法、状态转换或可与模块入口分离的源码。产品源码与测试一起编入自动生成的 Kernel Test Module，不会加载产品 Driver 的设备节点，也不验证 userspace ABI。需要验证设备操作和 Probe 时应改用 [Linux Driver ABI/Probe](linux-driver-abi.md)。

完整示例位于 `examples/linux-driver-unit/`：

```text
examples/linux-driver-unit/
├── cautest.config.mjs
├── driver/example_driver_core.c
├── include/example_driver_core.h
└── test/example_driver_core_test.c
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

Cautest 自动生成 Kbuild、Registry、模块入口和 C Runtime 注册。成功时会看到 `example_driver_core/clamps_to_driver_limits` 通过。需要测试多个内部模块时，可以继续复用 Factory；特殊宏和 Flag 放入单个 Job 的 `module.defines`、`module.cflags`，精确字段查看 `lib/config/schema/kernel.d.ts`。
