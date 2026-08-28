# V1 → V2 功能差异修复清单

本清单以 V1 已实现且有测试证据的行为为基线。每项只有在实现、回归测试和必要的实际验证同时完成后才能标记为“完成”。架构调整可以改变 API 形状，但不能用 `intentional-change` 代替用户可见能力。

状态：`待修复`、`进行中`、`完成`、`受外部环境阻塞`。

## P0：结果可信度与运行安全

- [x] GAP-001（完成）保留完整 CTP Session 结果和语义事件
  - 标准 Native、Kernel、Driver、MCU Job 不得丢弃 `groupDiagnostics`、`executionErrors`、Catalog/Selection 和 Execution 统计。
  - `CASE_START`、`ASSERTION`、`SKIP`、`FAULT`、`CASE_END`、`EXEC_END` 与 Target Log Event 必须进入 Run EventRecorder。
  - Suite Fixture/Target 环境错误必须保留为基础设施 ERROR，不得退化为“没有选中 Case”。
  - UML、Driver 和外部 MCU 的 Target Log 必须落盘并通过 `logRef` 关联事件。
  - 证据：`test/session.test.js`、`test/native.test.js`、`test/workflow.test.js`、`test/mcu.test.js`；`pnpm test`（2026-08-28，75/75 Node 测试及全部 C 测试通过）。

- [x] GAP-002（完成）让 Profile 环境覆盖所有标准 Job
  - Profile env 必须覆盖 Job env，并实际进入 Native、Kernel、Driver、MCU、System、自定义 Step 的构建和运行进程。
  - 构建指纹必须使用最终有效环境，而不是配置构造时捕获的旧环境。
  - 证据：`test/cli.test.js`、`test/native.test.js`、`test/mcu.test.js`、`test/kernel-build.test.js`、`test/kernel-module.test.js`、`test/driver.test.js`、`test/install.test.js`；`pnpm test`（2026-08-28，78/78 Node 测试及全部 C 测试通过）。

- [x] GAP-003（完成）恢复统一版本来源和漂移门禁
  - Release、CTP、C API、Kernel ABI、Probe ABI、Result/Event、CLI、Manifest 与 Cache 版本必须有单一权威来源。
  - `package.json`、C Header、TS 常量和构建信息必须一致；测试和打包前拒绝漂移。
  - 证据：`versions.json`、`scripts/sync-versions.mjs`、`test/version.test.js`、`scripts/test-c-runtime.sh`、安装/归档测试；`pnpm test`（2026-08-28，79/79 Node 测试及全部 C 测试通过）。

- [x] GAP-004（完成）恢复 SIGINT 取消、清理和退出码 130
  - 首次 SIGINT 通过 AbortSignal 进入 Workflow，允许失败路径 Collect 和 LIFO Cleanup。
  - 第二次 SIGINT 可强制退出；最终退出码为 130。
  - 证据：`test/interrupt.test.js`、`test/install.test.js`（真实便携 CLI SIGINT、Collect、Cleanup、退出码）；`pnpm test`（2026-08-28，80/80 Node 测试及全部 C 测试通过）。

## P1：CLI、结果和平台能力

- [x] GAP-005（完成）恢复 CLI 选择、Direct Session、Reporter、输出目录和选择性清理
  - 恢复 V1 CLI 的 Case/Session 过滤、超时、Suite Policy、`--reporter`、`--output-dir`、选择性 clean 和 Direct Session。
  - `describe` 同时支持 Job 和公开 Job Factory/Preset 概要。
  - 证据：`test/cli.test.js`（真实 Native 编译、CLI Case 过滤、Reporter/输出目录、Direct Process Session、选择性清理与 Preset Describe）、`test/install.test.js`（便携包包含 Direct Session）；`pnpm test`（2026-08-28，83/83 Node 测试及全部 C 测试通过）。

- [x] GAP-006（完成）恢复稳定退出码和空选择语义
  - `0/1/2/3/4/130` 分别表示成功、测试失败、基础设施错误、CLI/Config/Plan 错误、显式空选择和中断。
  - disabled Job 或 Level/Tag/Glob 显式筛选为空不得静默成功。
  - 证据：`test/cli.test.js` 覆盖 PASS/FAIL/ERROR、非法 Level、disabled Job、Glob/Tag 空选择和未知 Describe；定向 CLI 测试 11/11 通过。

- [x] GAP-007（完成）恢复渐进式结果摘要和失败证据
  - `run --json` 只输出有版本的紧凑摘要。
  - `summary.json` 包含失败 Job；`failures.jsonl` 包含状态、Suite/Case、位置、Assertion/Diagnostic 摘要和 `detailRef`。
  - 默认 Console 和 JUnit 保留可操作的失败信息；Reporter 不依赖必须选择 Profile。
  - 证据：`test/cli.test.js`、`test/workflow.test.js`、`test/reporters.test.js` 覆盖紧凑 CLI JSON、失败 Job、Case 位置/Assertion/Diagnostic/detailRef、Console/JUnit 证据和无 Profile Reporter；定向测试 20/20 通过。

- [x] GAP-008（完成）恢复完整 Script Test API 与事件
  - 恢复 `assertEqual`、`fail`、`attach`、单 Case timeout、顶层 `exec/signal/env`。
  - Script Case 生命周期与 Assertion Event 进入统一 EventRecorder。
  - 证据：`test/script-test.test.js`、`test/system.test.js`、`test/types/config.mts` 覆盖深比较、assertEqual/fail/attach、Case timeout、顶层 exec/signal/env 和 Workflow Event；定向测试 15/15 通过。

- [x] GAP-009（完成）恢复 MCU Partial I/O、断线重连和超时恢复
  - 模拟 Board 支持读写分片、一次性损坏/断线、Reset/Boot ID 和可配置重连。
  - 重连后必须重新 HELLO/LIST，不能复用旧 ID。
  - 证据：`test/mcu.test.js` 真实 Host Firmware 覆盖 1/2-byte 分片、一次断线、两次 HELLO/LIST、新 Boot ID、一次损坏和 External timeout 恢复；MCU 定向测试 8/8 通过。

## P2：扩展性、诊断、交付与验收

- [x] GAP-010（完成）恢复可组合的标准底层 Step
  - 对外提供 Native/Kernel/BusyBox/Module/Guest/Rootfs/UML/MCU 标准 Step，或提供能力等价且不要求调用方复制内部实现的组合接口。
  - 恢复受支持的 Fragment/Workflow 组合方式。
  - 证据：`test/factory.test.js` 覆盖嵌套 Fragment、跨 Job Phase 合并并实际执行，以及 Native/Kernel/BusyBox/Module/Guest/Rootfs/UML/MCU 标准 Step 选择；`test/types/config.mts` 覆盖公开类型。

- [x] GAP-011（完成）补齐 Doctor Host 与 Toolchain 预检
  - 检查 Node、C Kit、编译器/Make/GCOV/CPIO、静态链接、UML ptrace、受管目录可写性和 Kernel 源码内污染。
  - 证据：`test/cli.test.js` 使用不可执行工具、失败静态链接/ptrace、不可创建目录和带 `.config` 的 Kernel 源码，覆盖全部稳定 Doctor Code；Doctor 定向测试 2/2 通过。

- [x] GAP-012（完成）补齐 C Kit 构建交付
  - 提供 C Core、Protocol、Freestanding、MCU Reference 的 Makefile 入口和包元数据，并加入安装包验证；C Kit 不要求 CMake。
  - 证据：`assets/cautest-c/Makefile`、可重定位 `cautest-c.mk` 和 `package.json`；`test/install.test.js` 从便携安装目录真实执行 Make 构建/安装，并用独立 Consumer Makefile 构建运行程序。

- [x] GAP-013（完成）让 V1 迁移审计验证行为证据
  - 清单项必须关联 V2 测试或明确批准的设计决策；审计不能只检查人工状态字符串。
  - `pnpm audit:v1` 默认在当前仓库布局可运行。
  - 证据：`migration/v1-inventory.json` 的 244 项逐项包含 V2 Evidence，100 个 intentional-change 关联 `migration/v1-decisions.json` 中 4 个批准决策；`test/parity.test.js` 会真实执行默认 `scripts/v1-audit.mjs`；`pnpm audit:v1` 通过。

- [x] GAP-014（完成）补齐真实 Kernel/UML/Driver ABI 验收
  - `test:uml` 验证真实 Kernel Test 闭环。
  - 增加真实 Driver + 可选 Probe + Guest ABI 的 UML 闭环入口；不能用 Host Guest ELF 测试代替。
  - 缺少 Kernel/BusyBox 环境时明确标记为“受外部环境阻塞”，不得写成已验证。
  - 已修复入口：`test/integration/uml-smoke.mjs` 不再回退到开发者私有路径，并正确持久化标准 Run 结果；新增 `test:driver:uml`，实际组合 Driver、Probe、Guest ABI、Rootfs 与 UML。
  - 回归证据：`test/integration-entry.test.js` 覆盖源码树结构预检、稳定 `BLOCKED` 输出和退出码 77，且确认两个入口都没有私有路径回退。
  - Kernel 实测：使用 Linux `ubuntu-kernel-src-6.8.0-138` 与 BusyBox `1.38.0` 执行 `pnpm test:uml`，Run `80b9ca72-e87d-4e1e-9c24-d2698f3b4399` 为 SUCCESS，`kernel_smoke/passes` 为 PASS，并产出真实 Kernel/Test Module/Rootfs/UML/Target Log。
  - Driver 实测：首次 Run `f46009fb-6941-426c-839d-f6b5693ba7f3` 暴露示例 Kbuild 缺少公共版本 Header 路径；修复并加入默认回归后，Run `21d312d0-e257-4d4f-9e8d-715c4a71be94` 为 SUCCESS，`driver_api/read_reaches_driver_boundary` 为 PASS，并产出 Probe/Driver Module、Guest Program、Rootfs、UML 和 Target Log。

## 完成定义

每项完成时必须同时满足：

1. 实现已经进入公开运行链，而不只是存在内部函数；
2. 至少有一个失败前可复现、修复后通过的回归测试；
3. 相关 TypeScript 声明、CLI Help 和长期文档同步；
4. `pnpm typecheck`、相关定向测试和 `pnpm test` 通过；
5. 需要真实 Kernel、Driver 或硬件的项目记录实际命令和结果，未执行时保持未完成或外部阻塞。

## 本轮最终回归（2026-08-28）

- `pnpm typecheck`：通过。
- `pnpm test`：98/98 Node 测试通过，C Core、CTP3、Kernel ABI/Selection 与 Probe C 测试全部通过。
- `pnpm audit:v1`：通过，244 个 V1 清单项均有关联证据，4 个设计决策均已批准。
- `pnpm test:uml`：真实 UML Kernel Test 闭环通过，1/1 Case PASS。
- `pnpm test:driver:uml`：真实 UML Driver + Probe + Guest ABI 闭环通过，1/1 Case PASS。

## 依赖精简复验（2026-08-28）

- C Kit 已从 CMake Package 改为 Makefile 构建/安装与 `cautest-c.mk` 消费，便携安装测试会真实构建并运行独立 Consumer。
- `picomatch` 及其类型包已从 Manifest、Lockfile、Loader 和便携包中移除；内置 Glob 覆盖文件路径与 V1 兼容的 Suite/Case 文本过滤。
- Kernel UML Run `af9c9e5c-405e-496e-b2e0-8bd9463e9a81` 与 Driver UML Run `df6e3b16-aeaa-47e3-ab35-aa4730a2ee8a` 均为 SUCCESS，分别 1/1 Case PASS。
