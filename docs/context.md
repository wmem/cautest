# 项目背景与边界

C 工程经常同时包含本机单元测试、Kernel 或 Driver 测试、MCU Firmware 测试和进程级系统测试。这些环境使用不同的构建工具、启动方式和日志格式，导致项目和 CI 需要重复实现发现、筛选、超时、清理与结果汇总。

Cautest 的目标是让这些测试共享同一种声明与执行模型。项目用 JavaScript 生成一个或多个 Test Job；每个 Job 在执行前展开为按阶段排序的 Workflow；Host 统一管理 Artifact、Resource、取消与结果，C Target 通过 CTP3 报告结构化 Suite、Case、Assertion 和日志。

Cautest 负责配置加载、输入检查、标准构建编排、Target 生命周期、测试选择、超时、缓存和结果持久化。它不替代产品自身的构建系统，不提供 Linux Kernel、BusyBox、交叉工具链或 MCU 硬件，也不猜测项目未声明的 Driver Kbuild 和 Board 生命周期。

V2 的公共配置边界只有 `TestConfig.jobs: TestJob[]`。Native、Kernel、Driver、MCU 和 System 构造函数是生成普通 Test Job 的受支持入口，不在 Workflow Engine 中形成隐藏分支。源码仓库中的 TypeScript Schema、生成的 `.d.ts`、C 公共头文件和版本文件分别承担可执行实现与精确接口事实。

目标运行环境包括 POSIX Host Process、Linux UML Kernel/Guest、由项目 Adapter 管理的 MCU，以及普通 Host System Process。真实 Kernel/Driver 验收需要外部源码树；真实 MCU 的物理可靠性属于项目 Adapter 和实验环境边界。
