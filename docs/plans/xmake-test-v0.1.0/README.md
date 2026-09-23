# Cautest Xmake-Test 方案与实施计划包

版本：v0.1.0  
日期：2026-09-22  
用途：供后续开发、Agent 实施和代码审阅使用。**本包只含规划、API 草案与核查证据，不含已实现的 Xmake Adapter。**

## 阅读入口

| 文件 | 内容 |
|---|---|
| `SOLUTION.md` | 架构、职责、ctest.lua/test.lua 组织、构建复用、Manifest、平台边界与兼容策略 |
| `PLAN.md` | 8 个阶段、27 项必需任务、3 项首版外工作、依赖与完成门禁 |
| `ACCEPTANCE.md` | 配置、选择、Xmake 锁、构建、Native、MCU、Driver、分发及回归验收矩阵 |
| `SOURCE_AUDIT.md` | 上传包 20 组源码证据、关键修正、官方 Xmake 接入依据及验证范围 |
| `examples/API_DRAFT.md` | 根入口、分散 Native/MCU/Driver 声明、共享源码构建定义示例 |
| `plan.json` | 与 PLAN.md 对应的机器可读任务清单，所有实施任务初始为 todo |
| `evidence/baseline-subset.tap` | 包内既有 dist 的 20 项配置/工作流测试通过记录 |
| `SHA256SUMS.txt` | 本规划包文件的校验和 |

## 决策摘要

在 Cautest 内增加 Xmake-Test 适配层。Xmake 是产品与测试构建配置的权威；根 ctest.lua 收集分散 test.lua；Job 继续用稳定 ID、level/tag 和 Suite/Case 两层选择；现有 JS Factory/Workflow/CTP/Reporter 保留。真实 MCU 与 Linux Driver 编码阶段测试仍在范围内。

首版不做任意 target 自动克隆，不把旧 planConfig 输出当成可执行 JSON，不增加 Lua 测试执行器。先完成 Xmake task/锁与构建复用 PoC，再跑通 Native，之后接 MCU 和 Kernel/Driver。

## 本次实际核查

基线为上传的 Cautest 0.2.1。对解包源码和文档进行了核查，并运行 5 个已有 Node 测试文件，共 20 项通过、0 项失败。测试使用包内既有 dist；没有重新构建 TS，也没有运行完整旧版门禁。

当前环境未发现 xmake 可执行文件；新 DSL、构建桥、实际 Xmake Native、物理 MCU 和真实 UML 均未验收。因此本包不能被当作新功能已实现的发布包。

## 开始实施

先执行 PLAN.md 的 XT-001～XT-004，XT-005 可并行。不要越过锁安全与构建上下文复用验证，直接开发所有平台 helper。每个任务随实现更新测试、文档和 evidence；硬件/Kernel 环境缺失应记录 blocked，而非 done。
