# C Test API

本文是 Cautest C 测试模型的开发者参考。测试作者的渐进式写法见[编写 C 测试](../usage/write-c-tests.md)；宏、结构体和 ABI 的最终权威定义是仓库中的 `assets/cautest-c/include/cautest/cautest.h` 与 `version.h`。

## 描述符与注册

`CAUTEST_CASE(name)` 声明普通 Case 回调。`CAUTEST_PARAM_CASE(name, type, parameter)` 声明带强类型参数的 Case；`CAUTEST_PARAM_TABLE`、`CAUTEST_PARAM_ROW` 和 `CAUTEST_PARAM_CASE_ENTRY` 共同提供参数实例。

`CAUTEST_CASE_ENTRY` 把普通 Case 放入 Suite。`CAUTEST_SUITE` 创建无 Fixture 的 Suite；`CAUTEST_SUITE_WITH_FIXTURES` 同时绑定 Suite 和 Case Fixture。跨翻译单元使用 `CAUTEST_SUITE_DECLARE` 与 `CAUTEST_SUITE_REF`。`CAUTEST_REGISTRY` 把一个或多个 Suite 组合为 Registry。

所有名称和描述符都具有静态存储期。核心 Runtime 不依赖动态内存、链接段扫描或构造函数注册。

## Fixture 与 Workspace

`CAUTEST_FIXTURE_CALLBACK` 声明 setup/teardown 回调，签名与 Case 一致；`CAUTEST_FIXTURE(name, type, setup, teardown)` 定义所需内存大小和生命周期函数；`CAUTEST_NO_FIXTURE` 表示不分配对应 Fixture。

Runtime 从调用方提供的 `struct cautest_workspace` 分配 Suite 与 Case Fixture。`CAUTEST_WORKSPACE` 和 `CAUTEST_WORKSPACE_INIT` 可以创建满足 C99 基本类型自然对齐的静态 Workspace。容量不足产生 `CAUTEST_FRAMEWORK_ERROR_WORKSPACE_OVERFLOW`，属于 Framework Error。

Suite Fixture 在 Suite 开始和结束时执行一次；Case Fixture 为每个参数实例分别 setup/teardown。Fixture 失败会形成 Suite/Group 诊断，其事件边界不能伪造普通 Case 生命周期。

## 状态控制

- `CAUTEST_EXPECT_*`：记录失败，若没有其他致命状态则继续当前 Case；
- `CAUTEST_ASSERT_*`：记录失败并结束当前 Case；
- `CAUTEST_FAIL(reason)`：记录显式测试失败并结束 Case；
- `CAUTEST_SKIP(reason)`：标记当前 Case 不适用并结束 Case；
- `CAUTEST_ERROR(reason)`：标记测试环境或执行条件错误并结束 Case。

最终状态按 `PASS < SKIP < FAIL < ERROR` 合并。Suite 停止策略为 `CAUTEST_STOP_CONTINUE`、`CAUTEST_STOP_ON_FAILURE` 或 `CAUTEST_STOP_ON_ERROR`；Host 配置中的对应值是 `CONTINUE`、`STOP_ON_FAIL`、`STOP_ON_ERROR`。

## Assertion 族

每个 Assertion 族同时提供 `EXPECT` 和 `ASSERT` 形式：

- 布尔：`TRUE`、`FALSE`；
- 有符号整数：`EQ_INT`、`NE_INT`；
- 无符号整数：`EQ_UINT`、`NE_UINT`、`EQ_U32`、`NE_U32`、`EQ_U64`、`NE_U64`；
- 空指针：`NULL`、`NOT_NULL`；
- 指针：`PTR_EQ`、`PTR_NE`；
- 字符串：`STREQ`、`STRNE`；
- 内存：`MEMEQ`、`MEMNE`。

整数、指针、字符串和内存比较保留结构化 expected/actual、表达式、文件和行号。调用带副作用的表达式时仍应遵循 C 求值规则，不依赖宏对参数求值次数之外的未定义行为。

## 日志与事件

`CAUTEST_LOG_TRACE/DEBUG/INFO/WARN/ERROR(message)` 产生带 Level 的结构化日志。日志关联当前 Target、Execution、Suite 或 Case Scope，但不改变测试状态。

核心事件包括 Group Start/End、Case Start/End、Assertion、Skip、Framework Error 和 Log。Host 通过 CTP3 把这些事件持久化为统一 Result；协议顺序见 [CTP3](ctp3.md)。

## 平台注册边界

Native POSIX、自动 Kernel Test Module 和 Driver Guest Program 由相应 Job 根据配置的 `suites` 生成 Registry 与入口。测试作者不应在这些路径手写 `main()`、`module_init()` 或 Runtime 注册。

MCU/Freestanding 的 Firmware 入口和 Board 生命周期属于目标项目，通常需要显式 `CAUTEST_REGISTRY` 并把 Registry、Workspace 和 Transport 连接到 Freestanding Adapter。Kernel 源码不能依赖 libc；Driver Guest 是 UML Userspace 程序，可使用工具链提供的 POSIX API。

底层 `cautest_run()`、分阶段 `cautest_execution_*()` 和 `cautest_suite_execution_*()` 主要供 Platform Adapter 使用。普通测试代码应优先使用声明宏和标准 Job，避免直接依赖私有执行状态。
