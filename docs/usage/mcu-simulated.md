# 使用主机模拟运行 MCU C 测试

MCU Host Simulation 用本机进程模拟 Firmware 与 Board Transport，适合先验证 Freestanding C Test、CTP3 分片、筛选和重连行为。它不验证真实编译器、Flash、串口或硬件外设；接入真实 Board 时需要项目实现 `McuBoardAdapter`。

最小 Host 模拟 Job 只要求输出路径和至少一个 Firmware 源码：

```js
mcuCTestJob({
  id: "component.mcu",
  firmware: {
    kind: "host-simulated",
    output: ".cautest/generated/mcu-target",
    sources: ["test/firmware_test.c"],
  },
});
```

小而典型的多文件示例位于 `examples/mcu-sim/`：

```text
examples/mcu-sim/
├── cautest.config.mjs
├── include/mcu_math.h
├── src/mcu_math.c
└── test/
    ├── mcu_limits_test.c
    ├── mcu_math_test.c
    └── registry.c
```

配置让 Cautest 构建 Host 模拟 Firmware，并只运行一个 Case：

```js
import { mcuCTestJob, testConfig } from "@cautest/config.js";

export function mcuSimJob(baseDir = ".") {
  const fromExample = (relative) => baseDir === "." ? relative : `${baseDir}/${relative}`;
  return mcuCTestJob({
    id: "component.mcu-sim",
    firmware: {
      kind: "host-simulated",
      output: ".cautest/generated/mcu-sim-target",
      sources: [fromExample("src/**/*.c"), fromExample("test/**/*.c")],
      headers: [fromExample("include/**/*.h")],
    },
  });
}

export default testConfig({ jobs: [mcuSimJob()] });
```

Freestanding 模型没有自动扫描 Registry，因此示例用独立 `registry.c` 汇总多个翻译单元中的 Suite：

```c
CAUTEST_SUITE_DECLARE(mcu_math);
CAUTEST_SUITE_DECLARE(mcu_limits);

CAUTEST_REGISTRY(cautest_mcu_registry,
    CAUTEST_SUITE_REF(mcu_math),
    CAUTEST_SUITE_REF(mcu_limits));
```

运行示例：

```bash
cd examples/mcu-sim
../../cautest.js doctor
../../cautest.js list
../../cautest.js plan component.mcu-sim
../../cautest.js run component.mcu-sim
```

成功时 `mcu_math/adds_values` 和 `mcu_limits/clamps_values` 为 PASS，结果中还包含 Firmware Artifact 和 Board 生命周期。同一个 Firmware、Board 和启动生命周期内可以继续增加产品源码、测试文件和 Registry Suite；工具链、硬件或独立 CI 选择不同时再拆 Job。通用规则见[组织典型项目](project-organization.md)。

需要模拟分片、断线或损坏 Frame 时配置 `board: { kind: "simulated", ... }`；接真实硬件时使用 `firmware.kind: "existing"` 或 `"command"` 并提供 External Adapter。`mcuCTestJob()` → `McuCTestJobInput` → `lib/config/schema/mcu.d.ts`，Board Adapter 也定义在同一文件；完整映射见[配置 API 索引](config-reference.md)。
