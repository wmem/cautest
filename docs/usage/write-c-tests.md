# 编写 C 测试

Native、Kernel UML、Driver Guest 和 MCU/Freestanding 使用同一套 C Test 语义。普通测试从 `#include <cautest/cautest.h>` 开始，先写 Case，再把 Case 组合为 Suite；对应 Job 负责选择 Registry 的生成或接入方式。

## 从 Case 和 Suite 开始

Case 回调会收到 Suite Fixture、Case Fixture 和参数。当前测试不使用它们时显式转换为 `void`：

```c
#include <cautest/cautest.h>

CAUTEST_CASE(adds_two_numbers)
{
    (void)suite_fixture;
    (void)case_fixture;
    (void)cautest_parameter;
    CAUTEST_EXPECT_EQ_INT(5, 2 + 3);
}

CAUTEST_SUITE(example_math,
    CAUTEST_CASE_ENTRY(adds_two_numbers));
```

Native、Kernel 和 Driver Guest Job 根据配置中的 `suites` 生成 Registry 与入口。MCU/Freestanding 的 Firmware 自己拥有启动入口，因此通常还要显式公开 Registry：

```c
CAUTEST_REGISTRY(cautest_mcu_registry,
    CAUTEST_SUITE_REF(example_math));
```

Suite 分散在多个翻译单元时，在组合 Registry 的文件使用 `CAUTEST_SUITE_DECLARE(name)` 和 `CAUTEST_SUITE_REF(name)`。

## 添加参数化 Case

参数表的每一行包含稳定标签和一个值。Case 通过强类型指针读取该值：

```c
struct addition_input {
    int left;
    int right;
    int expected;
};

CAUTEST_PARAM_TABLE(addition_rows, struct addition_input,
    CAUTEST_PARAM_ROW("positive", { 2, 3, 5 }),
    CAUTEST_PARAM_ROW("negative", { -2, 3, 1 }));

CAUTEST_PARAM_CASE(adds, struct addition_input, input)
{
    (void)suite_fixture;
    (void)case_fixture;
    CAUTEST_EXPECT_EQ_INT(input->expected, input->left + input->right);
}

CAUTEST_SUITE(addition,
    CAUTEST_PARAM_CASE_ENTRY(adds, addition_rows));
```

参数标签会进入 `suite/case/parameter` 选择和最终结果，应保持稳定且可读。

## 使用 Fixture

Fixture 的内存来自 Cautest Workspace，不使用动态分配。先定义类型和 setup/teardown 回调，再用 `CAUTEST_FIXTURE()` 声明：

```c
struct counter_fixture { int value; };

CAUTEST_FIXTURE_CALLBACK(counter_setup)
{
    struct counter_fixture *fixture = case_fixture;
    (void)cautest_ctx;
    (void)suite_fixture;
    (void)cautest_parameter;
    fixture->value = 41;
}

CAUTEST_FIXTURE_CALLBACK(counter_teardown)
{
    (void)cautest_ctx;
    (void)suite_fixture;
    (void)case_fixture;
    (void)cautest_parameter;
}

CAUTEST_FIXTURE(counter_case_fixture, struct counter_fixture,
    counter_setup, counter_teardown);
```

Case 中把 `case_fixture` 转成相应类型，然后用 `CAUTEST_SUITE_WITH_FIXTURES()` 绑定 Suite Fixture 和 Case Fixture。没有某类 Fixture 时传 `CAUTEST_NO_FIXTURE`。setup 或 teardown 发生 ERROR 会记录为 Fixture/Group 诊断，不会伪装成普通 Assertion 失败。

## 选择断言和状态

`CAUTEST_EXPECT_*` 记录失败后继续当前 Case；`CAUTEST_ASSERT_*` 记录失败并立即结束当前 Case。支持布尔、有符号整数、无符号整数、u32、u64、空指针、指针、字符串和内存比较。例如：

```c
CAUTEST_EXPECT_TRUE(device_ready());
CAUTEST_ASSERT_NOT_NULL(buffer);
CAUTEST_EXPECT_EQ_U32(4U, length);
CAUTEST_EXPECT_STREQ("ready", state);
CAUTEST_EXPECT_MEMEQ(expected, actual, sizeof(expected));
```

无法用比较表达的失败使用 `CAUTEST_FAIL(reason)`；当前条件不适用使用 `CAUTEST_SKIP(reason)`；测试环境或 Fixture 已不可继续使用 `CAUTEST_ERROR(reason)`。三者都会结束当前 Case，不要用 FAIL 表示基础设施损坏。

## 记录 Target 日志

`CAUTEST_LOG_TRACE/DEBUG/INFO/WARN/ERROR(message)` 发送带级别的结构化 Target Log。日志用于诊断，不改变 Case 状态；决定结果仍应使用 Assertion、FAIL、SKIP 或 ERROR。

## 注意平台边界

Native 默认 Workspace 为 65536 字节，通过 `nativeCTestJob({ build: { workspaceSize: 131072 } })` 调整。Kernel Runtime 默认 16384 字节，通过 `umlKernelEnvironment({ runtime: { workspaceSize: 32768 }, ... })` 调整。Fixture 总量超过对应 Workspace 会产生 Framework Error；`workspaceSize` 不是这两类 Job 共用的顶层字段。

Kernel 测试代码必须满足内核构建约束，不能假设 libc。Driver Guest 运行在 UML Userspace，可以使用 Guest Toolchain 提供的 POSIX API。MCU/Freestanding 不依赖 libc 或自动注册机制，需要由 Firmware 接入 Registry、Workspace、Transport 和启动生命周期。

宏签名和底层结构的最终定义位于安装目录的 `assets/cautest-c/include/cautest/cautest.h`；协议接口位于同目录的 `ctp3.h`。教程只覆盖测试作者常用路径。
