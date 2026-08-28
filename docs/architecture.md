# 执行架构

Cautest 的边界不是某一种测试框架，而是把不同目标环境的准备、执行和收集过程收敛为相同的 `TestJob → Workflow → Result` 路径。Native、UML、Driver、MCU 和 System 构造函数只负责减少声明量；它们返回的仍是普通 `TestJob`，不会在 Engine 中得到隐藏分支。

## 从配置到结果

配置加载器执行根 JavaScript 模块，校验 `TestConfig`，并记录通过 `jobNamespace()` 等正式来源协议创建的 Job 来源。每个 Job 在配置阶段已经展开为按 `prepare → build → provision → run → collect` 排序的 Step。`plan` 读取这一结果而不执行 Step，因此打印顺序就是运行顺序。

Workflow Engine 为每个 Job 建立五类共享状态：Artifact Store 保存可供下游和 CI 使用的构建/日志产物；Resource Store 管理进程、UML 和 Board 的所有权及生命周期；Result Recorder 汇总结构化 Suite/Case；Event Recorder 实时记录 Run、Job、Step、Artifact 和 Resource 事件；Cleanup Stack 在结束时按注册逆序执行一次。普通 Step 出错后只运行声明为 `always` 或 `on-failure` 的 collect Step，清理始终执行。

构建缓存不是跨 Step 的隐式全局变量。Native Binary、Kernel、BusyBox、Kernel Module、Guest Program 和 Rootfs 各有独立指纹边界。Module 构建在专属 Sandbox 中执行，源码树不会作为 Kbuild 的 `M=`；发布时校验 Manifest 内所有必需 Artifact。这个边界使同一源码可以由不同 Kernel/ARCH Job 并发构建。

## Target 与 Host 的分工

C Runtime 负责 Suite/Case 生命周期、Assertion、Fixture、选择结果和事件。Host 负责源码选择、构建、Target 启停、Timeout、结果持久化与恢复。两者通过 [CTP3](protocol-ctp3.md) 交换目录和执行事件；Native Pipe、UML Endpoint 和 MCU Adapter 只是不同 Transport。

Kernel/UML 还包含一个 Guest Agent。Rootfs 中的 Catalog 把 `kernel` 或 Guest Process Endpoint 映射到 Build ID；Host 在 Ready、HELLO 和执行阶段持续校验 Image、Build 与 Boot 身份，避免把旧 Target 的结果记到当前 Run。

## 主要实现入口

- 配置和 Schema：`src/config/`、`src/config/schema/`
- Workflow 生命周期：`src/workflow/`
- CTP3 与 Session：`src/protocol/`、`assets/cautest-c/protocol/`
- 各类 Job：`src/jobs/`
- Kernel Module 隔离构建：`src/kernel/module-build.ts`
- UML/Rootfs/Guest Agent：`src/uml/`
- 结果和 Reporter：`src/result/`、`src/reporters/`

修改这些责任时，先看[测试策略](testing.md)中的对应验证层级。
