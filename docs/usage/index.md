# 使用 Cautest

Cautest 把不同目标环境的测试都表示成 Test Job。通常只需要在项目根目录准备 `cautest.config.mjs` 和测试源码，然后依次确认环境、选择范围、检查计划并执行：

```bash
./tools/cautest/cautest.js doctor
./tools/cautest/cautest.js list
./tools/cautest/cautest.js plan
./tools/cautest/cautest.js run
```

`doctor` 在构建前检查配置、工具和输入文件；`list` 给出最终 Job；`plan` 展开实际 Workflow；`run` 执行并把结果写入 `.cautest/results/<run-id>/`。第一次使用时先运行这四条命令，不需要预先理解内部架构。

## 只读与你任务有关的教程

如果测试普通用户态 C 代码，阅读 [Native C](native-c.md)。同一个 Job 可以用 `level: "unit"` 表示单元测试，或用 `level: "component"` 表示由多份产品源码组成的组件测试。

如果测试在 Linux Kernel 上下文中运行的代码，根据边界选择：

- 产品源码与测试一起编入自动生成的 Test Module：阅读 [Kernel UML](kernel-uml.md)；
- 对 Driver 内部算法或源码做关联单元测试：阅读 [Linux Driver Unit](linux-driver-unit.md)；
- 通过设备节点和可选 Probe 验证真实 Driver ABI：阅读 [Linux Driver ABI/Probe](linux-driver-abi.md)。

如果测试 Firmware 的 C Test 生命周期但暂时不接真实硬件，阅读 [MCU 主机模拟](mcu-simulated.md)。如果需要启动服务并用 JavaScript 验证外部行为，阅读 [System Script](system-script.md)。只有需要把多个标准 Workflow 合并为一个 Job 时，才阅读 [Workflow 组合](workflow.md)。

编写普通 C Case 只需看对应场景教程；需要参数化、Fixture、日志或状态控制时，再读[编写 C 测试](write-c-tests.md)。运行失败时从[故障排查](troubleshooting.md)继续。

## 按需查询精确接口

教程只解释完成任务所需的最小字段。安装目录中的 `lib/config/index.d.ts` 和 `lib/config/schema/*.d.ts` 是 JavaScript 配置的精确查询入口；`assets/cautest-c/include/cautest/cautest.h` 是 C 测试宏和核心接口的权威定义。源码仓库构建后，对应声明位于 `dist/config/`。

安装目录同时携带本指南和 `examples/`。可以先直接运行最接近目标场景的示例，再把目录复制到自己的项目中。Kernel 和 Driver 示例必须设置 `KERNEL_SRC`、`BUSYBOX_SRC`；其他示例只要求 Node.js 和本机 C Compiler。

## 结果从哪里看

每次运行都有独立结果目录。先读 `summary.json` 判断整体状态；失败时读 `failures.jsonl`；需要完整 Job、Step、Case、日志和 Artifact 时再读 `result.json`。在 CI 中可使用：

```bash
./tools/cautest/cautest.js run --json
```

这时 stdout 只输出紧凑摘要，实时进度和 `--verbose` 构建日志写入 stderr。
