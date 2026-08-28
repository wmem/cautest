# C Assertion API

Native、Kernel/UML、Driver Guest 和 Host MCU Test 共用 `#include <cautest/cautest.h>`。每类断言都同时提供 `CAUTEST_EXPECT_*` 和 `CAUTEST_ASSERT_*`：前者记录失败后继续当前 Case，后者记录失败后终止当前 Case。

常用 API：

- 布尔：`TRUE`、`FALSE`；
- 有符号整数：`EQ_INT`、`NE_INT`；
- 无符号整数：`EQ_UINT`、`NE_UINT`、`EQ_U32`、`NE_U32`、`EQ_U64`、`NE_U64`；
- 空指针：`NULL`、`NOT_NULL`；
- 指针：`PTR_EQ`、`PTR_NE`；
- 字符串：`STREQ`、`STRNE`；
- 内存块：`MEMEQ`、`MEMNE`。

示例：

```c
CAUTEST_EXPECT_FALSE(queue_empty(&queue));
CAUTEST_ASSERT_NOT_NULL(item);
CAUTEST_EXPECT_EQ_U32(4U, queue_size(&queue));
CAUTEST_EXPECT_STREQ("ready", item->state);
CAUTEST_EXPECT_MEMEQ(expected, actual, sizeof(expected));
```

整数、指针、字符串和内存比较不会退化成单个布尔值。CTP3 Event 会保留表达式、源码位置和结构化 `expected`/`actual`；CLI 的 `summary.json` 和 JSON 输出继续保留这些字段。
