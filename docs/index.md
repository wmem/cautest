# Cautest 项目知识入口

Cautest 用 JavaScript 配置和有序 Workflow 组织本地工程测试，并让同一套结构化 C Test 语义运行在 Native POSIX、Linux Kernel/UML、Driver Guest 和 MCU 环境中。V2 将所有测试统一为 `TestJob`，公共配置和具体 Job 声明可以分离，但最终执行对象始终是一条可由 `plan` 查看、由 Workflow Engine 顺序执行的工作流。

项目由配置与 CLI、Workflow 执行、C Runtime 与 CTP3、目标环境构建和结果收集几部分组成。第一次使用时先阅读[配置模型](configuration.md)，再按目标环境进入 Native、Kernel、Driver、MCU 或 System 使用说明；维护实现和验证行为时，从后续迁移进入本索引的 Architecture 与 Test 文档。

## 使用 Cautest

- [配置模型与分层组织](configuration.md)
- [Native C Test](jobs/native.md)
- [Kernel/UML C Test](jobs/kernel.md)
- [Linux Driver ABI Test](jobs/driver.md)
- [MCU C Test](jobs/mcu.md)
- [Script System Test](jobs/system.md)
- [C Assertion API](c-assertions.md)
- [CLI、Doctor 与结果](cli.md)

当前文档只把已经由 V2 实现和测试确认的行为描述为现状。V1 中有长期价值的项目上下文、Capability、Specification、Architecture、Test Knowledge 和 Usage 将在对应实现核对完成后迁移到各自权威位置；历史需求与缺陷只作为来源保存，不会冒充当前行为。
