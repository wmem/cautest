# Cautest 开发者文档

Cautest 把不同目标环境的准备、构建、运行和收集过程统一为 `TestJob → Workflow → Result`。本入口面向开发、维护和诊断 Cautest 本身的读者；如果目标只是安装和运行测试，请从[使用指南](usage/index.md)开始，不需要预读内部实现。

先阅读[项目背景与边界](context.md)，了解 Cautest 负责与不负责的部分。需要理解一个目标环境如何形成系统行为时，再进入 Capability：

- [Native C](capabilities/native.md)
- [Kernel UML](capabilities/kernel.md)
- [Linux Driver ABI/Probe](capabilities/driver.md)
- [MCU](capabilities/mcu.md)
- [Script System Test](capabilities/system.md)

需要精确查阅公共规则时进入 Specification：

- [配置模型](specifications/configuration.md)
- [CLI、Doctor 与退出码](specifications/cli.md)
- [结果目录与 Reporter](specifications/results.md)
- [C Test API](specifications/c-test-api.md)
- [CTP3 协议](specifications/ctp3.md)

修改多个实现责任之间的协作时阅读[执行架构](architecture/overview.md)；维护独立 C Runtime 交付时阅读 [C Kit](architecture/c-kit.md)。准备验证变更或特殊环境时阅读[测试策略](tests/testing.md)。V1 迁移审计只保留在 `migration/` 领域，不参与正常阅读路径。

这些文档按 Project Docs V2 组织：Capability 描述面向场景的系统行为，Specification 保存需要精确查阅的规则，Architecture 解释实现责任如何协作，Test 保存长期验证知识。同一事实只在一个位置精确定义，其他页面通过上下文和自然链接连接。
