# Cautest 项目知识入口

Cautest 用 JavaScript 配置和有序 Workflow 组织本地工程测试，并让同一套结构化 C Test 语义运行在 Native POSIX、Linux Kernel/UML、Driver Guest 和 MCU 环境中。V2 将所有测试统一为 `TestJob`，公共配置和具体 Job 声明可以分离，但最终执行对象始终是一条可由 `plan` 查看、由 Workflow Engine 顺序执行的工作流。

项目由配置与 CLI、Workflow 执行、C Runtime 与 CTP3、目标环境构建和结果收集几部分组成。第一次使用时先阅读[配置模型](configuration.md)，再按目标环境进入 Native、Kernel、Driver、MCU 或 System 使用说明；维护实现时从[执行架构](architecture.md)继续，排查 Target 交互时查阅 [CTP3](protocol-ctp3.md)。

## 使用 Cautest

- [配置模型与分层组织](configuration.md)
- [Native C Test](jobs/native.md)
- [Kernel/UML C Test](jobs/kernel.md)
- [Linux Driver ABI Test](jobs/driver.md)
- [MCU C Test](jobs/mcu.md)
- [Script System Test](jobs/system.md)
- [C Assertion API](c-assertions.md)
- [CLI、Doctor 与结果](cli.md)
- [结果目录与 Reporter](results.md)

## 理解和维护实现

- [执行架构与责任边界](architecture.md)
- [CTP3 行协议](protocol-ctp3.md)
- [测试策略与验证入口](testing.md)

当前文档只把 V2 已实现的行为描述为现状。V1 中仍有效的配置、协议、架构、测试和使用知识已合并到上述权威入口；V1 的阶段性 Requirement 与 Defect 由迁移审计保留来源，不再作为当前使用说明重复维护。
