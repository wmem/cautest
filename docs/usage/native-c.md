# 运行 Native C 测试

Native C Test 适合在开发机直接编译和运行的 C 代码。Cautest 会生成 Registry 和程序入口，把产品源码、测试源码及 C Runtime 编译为本机程序，再通过 CTP3 收集 Suite、Case、Assertion 和日志。它不适合必须依赖 Kernel API、真实 Driver 或硬件外设的代码。

安装目录中的 `examples/c-lib/` 是完整示例：

```text
examples/c-lib/
├── cautest.config.mjs
├── include/example_math.h
├── src/example_math.c
└── test/example_math_test.c
```

配置完整内容如下：

```js
import { nativeCTestJob, testConfig } from "@cautest/config.js";

export default testConfig({ jobs: [nativeCTestJob({
  id: "unit.example-math",
  tests: ["test/example_math_test.c"],
  sources: ["src/example_math.c"],
  headers: ["include/example_math.h"],
  suites: ["example_math"],
})] });
```

测试文件用 `CAUTEST_CASE` 声明 Case，用 `CAUTEST_SUITE` 组合 Case。Cautest 根据 `suites` 自动生成 Registry，因此不需要手写 `main()`：

```c
#include <cautest/cautest.h>
#include "example_math.h"

CAUTEST_CASE(adds_two_numbers)
{
    (void)suite_fixture;
    (void)case_fixture;
    (void)cautest_parameter;
    CAUTEST_EXPECT_EQ_INT(5, example_add(2, 3));
}

CAUTEST_SUITE(example_math, CAUTEST_CASE_ENTRY(adds_two_numbers));
```

在安装目录运行示例：

```bash
cd examples/c-lib
../../cautest.js doctor
../../cautest.js list
../../cautest.js plan unit.example-math
../../cautest.js run unit.example-math
```

成功时 Console 显示 `SUCCESS` 和通过的 `example_math/adds_two_numbers`，完整结果位于 `examples/c-lib/.cautest/results/<run-id>/`。如果 `doctor` 报 Compiler 或静态链接错误，先安装可用的 C99 Compiler；如果报告 Pattern 未匹配，确认命令在示例目录执行，或使用 `--config` 指向配置文件。

组件测试仍使用 `nativeCTestJob()`，只需把 `level` 设为 `"component"` 并增加 `sources`、`headers`。Compiler、Flag、宏、覆盖率和缓存的精确字段请按需查看安装目录中的 `lib/config/schema/native.d.ts`。
