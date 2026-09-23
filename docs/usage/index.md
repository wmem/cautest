# 使用 Cautest

Cautest 把不同目标环境的测试都表示成 Test Job。第一次接入时只需选择最接近的场景教程；项目扩大、需要自动化或遇到问题时，再从本页进入对应参考，不需要按顺序读完全部 Usage。

以下命令假设安装目录为 `./tools/cautest`；如果安装在其他位置，只需修改 `CAUTEST`：

```bash
CAUTEST=./tools/cautest/cautest.js
"$CAUTEST" doctor
"$CAUTEST" list
"$CAUTEST" plan
"$CAUTEST" run
```

`doctor` 在构建前检查配置、工具和输入文件；`list` 给出最终 Job；`plan` 展开实际 Workflow；`run` 执行并把结果写入 `.cautest/results/<run-id>/`。命令参数、输出约定和退出码见 [cautest.js 命令参考](cli.md)。

## 先判断当前环境能运行什么

所有场景都需要 Node.js 20.6 或更新版本。其他主要成本如下；具体产品测试还可能需要自己的构建工具和外部服务：

| 类型 | 本机 C Compiler | Kernel/BusyBox 源码 | 外部硬件 | 首次运行成本 |
| --- | --- | --- | --- | --- |
| Native C | 需要 | 不需要 | 不需要 | 低 |
| Kernel UML | 需要 | 需要 | 不需要 | 高 |
| Linux Driver | 需要 | 需要 | 不需要 | 高 |
| MCU 主机模拟 | 需要 | 不需要 | 不需要 | 低 |
| System Script | 不一定 | 不需要 | 不需要 | 低 |

## 选择测试类型

如果测试普通用户态 C 代码，阅读 [Native C](native-c.md)。同一个 Job 可以用 `level: "unit"` 表示单元测试，或用 `level: "component"` 表示由多份产品源码组成的组件测试。

如果测试在 Linux Kernel 上下文中运行的代码，根据边界选择：

- 产品源码与测试一起编入自动生成的 Test Module：阅读 [Kernel UML](kernel-uml.md)；
- 对 Driver 内部算法或源码做关联单元测试：阅读 [Linux Driver Unit](linux-driver-unit.md)；
- 通过设备节点和可选 Probe 验证真实 Driver ABI：阅读 [Linux Driver ABI/Probe](linux-driver-abi.md)。

如果测试 Firmware 的 C Test 生命周期但暂时不接真实硬件，阅读 [MCU 主机模拟](mcu-simulated.md)。如果需要启动服务并用 JavaScript 验证外部行为，阅读 [System Script](system-script.md)。只有需要把多个标准 Workflow 合并为一个 Job 时，才阅读 [Workflow 组合](workflow.md)。

编写普通 C Case 只需看对应场景教程；需要参数化、Fixture、日志或状态控制时，再读[编写 C 测试](write-c-tests.md)。

一个项目通常把多个独立 Job 放入同一个 `jobs` 数组，再由 ID、Level 或 Tag 选择；它们不需要合并 Workflow。可运行结构见 [`examples/all-in-one.config.mjs`](../../examples/all-in-one.config.mjs)。便携示例导出的 `*Job(baseDir)` Factory 只是为了让这个聚合配置在构造 Job 前补全子目录；复制到普通项目时可以保留 Factory，也可以直接内联 Job 声明。

## 按需深入

- 项目不止一个产品源码或测试文件：阅读[组织典型项目](project-organization.md)，了解 File、Suite、Job 的边界、Glob 和多 Job 配置拆分；
- 需要理解整体结构或选择 Job Factory：阅读[测试组织模型](model.md)；
- 需要查询函数、Interface 和声明文件：阅读[配置 API 索引](config-reference.md)；
- 需要筛选 Job/Case、配置 CI 或判断退出状态：阅读 [cautest.js 命令参考](cli.md)；
- 需要消费 JSON、JUnit、HTML、日志或 Artifact：阅读[结果目录与 Reporter](results.md)；
- 运行或构建失败：从[故障排查](troubleshooting.md)开始。

## 迁入现有项目

选定最接近的教程后，按同一条路径迁移，不需要复制示例目录布局：

1. 在项目根目录创建或合并 `cautest.config.mjs`；
2. 添加测试源码，并保留产品自己的构建和目录边界；
3. 把示例中的 `tests`、`sources`、`headers`、`suites` 和环境路径改为项目实际位置；
4. 从项目根目录依次执行 `doctor`、`list`、`plan <job-id>` 和 `run <job-id>`。

## 精确接口在哪里

Usage 负责解释模型、常用路径和字段关系；安装目录中的 `.d.ts` 与公共 C Header 保存精确签名。不要从 `lib/` 目录结构猜测公开 API，统一从 `@cautest/config.js` 导入。函数到 Interface、`.d.ts` 和 C Header 的完整映射见[配置 API 索引](config-reference.md)。

安装目录同时携带本指南和 `examples/`。可以先直接运行最接近目标场景的示例，再按上面的迁移路径接入自己的项目。Kernel 和 Driver 示例必须设置 `KERNEL_SRC`、`BUSYBOX_SRC`；Native、MCU 模拟和 Workflow 示例需要本机 C Compiler，纯 System Script 示例不要求 C Compiler。

## 结果从哪里看

每次运行都有独立结果目录。先读 `summary.json` 判断整体状态；失败时读 `failures.jsonl`；需要完整 Job、Step、Case、日志和 Artifact 时再读 `result.json`。在 CI 中可使用：

```bash
"$CAUTEST" run --json
```

这时 stdout 只输出紧凑摘要，实时进度和 `--verbose` 构建日志写入 stderr。标准文件、Reporter 和 CI 消费方式见[结果目录与 Reporter](results.md)。

## Xmake 工程集成

[将 Cautest clone 到 tools/cautest 并使用 xmake ct](xmake.md)。
