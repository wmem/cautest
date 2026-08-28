# 使用主机模拟运行 MCU C 测试

MCU Host Simulation 用本机进程模拟 Firmware 与 Board Transport，适合先验证 Freestanding C Test、CTP3 分片、筛选和重连行为。它不验证真实编译器、Flash、串口或硬件外设；接入真实 Board 时需要项目实现 `McuBoardAdapter`。

完整示例位于 `examples/mcu-sim/`：

```text
examples/mcu-sim/
├── cautest.config.mjs
└── firmware_cases.c
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
      sources: [fromExample("firmware_cases.c")],
    },
    run: { include: ["mcu_example/passes"] },
  });
}

export default testConfig({ jobs: [mcuSimJob()] });
```

Freestanding 模型没有自动扫描 Registry，因此示例 C 文件显式声明：

```c
CAUTEST_REGISTRY(cautest_mcu_registry, CAUTEST_SUITE_REF(mcu_example));
```

运行示例：

```bash
cd examples/mcu-sim
../../cautest.js doctor
../../cautest.js list
../../cautest.js plan component.mcu-sim
../../cautest.js run component.mcu-sim
```

成功时 `mcu_example/passes` 为 PASS，结果中还包含 Firmware Artifact 和 Board 生命周期。需要模拟分片、断线或损坏 Frame 时配置 `board: { kind: "simulated", ... }`；接真实硬件时使用 `firmware.kind: "existing"` 或 `"command"` 并提供 External Adapter。精确接口位于 `lib/config/schema/mcu.d.ts`。
