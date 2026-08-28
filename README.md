# Cautest

Cautest 是面向 C、Linux Kernel/Driver、MCU 和系统脚本的工程测试工具。

一个项目往往同时存在多种测试：有些直接在开发机运行，有些必须编译成 Kernel
Module 后放进 UML，有些需要启动 Driver 和 Guest 程序，还有些需要烧录 MCU。它们的
构建方法、启动方式和日志格式各不相同，CI 很难用同一种方式发现、筛选和汇总结果。

Cautest 让这些测试使用同一套工作方式：

1. 用 JavaScript 声明测试需要的源码和目标环境；
2. 用 `doctor` 在昂贵构建前发现配置问题；
3. 用 `plan` 查看将要执行的完整步骤；
4. 用 `run` 构建并运行测试；
5. 得到统一的 Suite、Case、Assertion、日志、覆盖率和构建产物。

```text
cautest.config.mjs
        │
        ▼
  一个或多个 Test Job
        │
        ▼
 Build → Provision → Run → Collect
        │
        ▼
.cautest/results/<run-id>/
```

## 可以测试什么

| 场景 | Cautest 负责的工作 |
| --- | --- |
| Native C | 生成测试入口、编译产品源码和测试源码、运行 Case、收集 GCOV |
| Linux Kernel/UML | 构建 Kernel 和 BusyBox、隔离构建 Test Module、启动 UML、收集 Kernel 测试与覆盖率 |
| Linux Driver ABI | 构建 Driver 和可选 Probe，在 UML Guest 中运行 ABI 测试 |
| MCU | 构建或加载 Firmware，通过 Board Adapter 烧录、复位并运行 C Test；也支持 Host Simulation |
| Script System Test | 启动被测进程，等待就绪，执行 JavaScript 系统测试并收集日志 |

这些场景最终都是普通的 Test Job。每个 Job 在执行前展开成一条有序 Workflow，因此
可以混合放在同一个项目中，也可以按 ID、Glob、测试层级或 Tag 选择运行。

## 快速开始：运行一个 Native C Test

要求 Node.js 20.6 或更新版本，以及可用的 C Compiler。

### 1. 把 Cautest 安装到项目中

安装器会生成一个自包含目录，不要求项目另外安装 Cautest 的 npm 依赖。Git URL 应固定
到完整 Commit，便于本地和 CI 使用同一版本：

```bash
npx --yes 'git+ssh://<Cautest Git URL>#<完整 Commit>' ./tools/cautest
```

使用 pnpm 11 时：

```bash
cautest_spec='git+ssh://<Cautest Git URL>#<完整 Commit>'
pnpm dlx --allow-build="cautest@${cautest_spec}" "${cautest_spec}" ./tools/cautest
```

建议把生成的 `tools/cautest/` 加入 `.gitignore`，在项目中提交配置和测试源码。

### 2. 编写配置

假设项目已有以下文件：

```text
include/example_math.h
src/example_math.c
test/example_math_test.c
```

在项目根目录创建 `cautest.config.mjs`：

```js
import { nativeCTestJob, testConfig } from "@cautest/config.js";

export default testConfig({
  jobs: [
    nativeCTestJob({
      id: "unit.example-math",
      tests: ["test/example_math_test.c"],
      sources: ["src/example_math.c"],
      headers: ["include/example_math.h"],
    }),
  ],
});
```

测试源码只需要声明 Suite 和 Case；Registry 与程序入口由 Cautest 生成：

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

### 3. 检查并运行

```bash
./tools/cautest/cautest.js doctor
./tools/cautest/cautest.js plan
./tools/cautest/cautest.js run
```

`plan` 展示每个 Job 的实际执行顺序。`run` 实时输出 Job/Step 进度，并把完整结果写入
`.cautest/results/<run-id>/`。CI 可以使用结构化输出：

```bash
./tools/cautest/cautest.js run --json
```

此时 stdout 只包含 Run 摘要，实时进度和 `--verbose` 构建日志写入 stderr。

仓库内有一份可以直接阅读和运行的 [Native C 示例](examples/c-lib)。

## 从简单配置扩展到复杂项目

简单测试只声明 Job ID、测试源码和产品源码。项目变大后，可以逐步加入：

- Glob，例如 `tests: ["test/unit/**/*_test.c"]`；
- Compiler、宏、Include 目录、Flag 和缓存指纹环境变量；
- Suite/Case 选择、超时、Tag 和失败策略；
- 公共 Job Factory，让多个测试复用 Kernel、BusyBox、工具链或默认参数；
- Profile 和 JUnit、HTML、JSON Reporter；
- 自定义 Workflow Step。

顶层配置始终保持同一种形状：`jobs` 是 `TestJob[]`。Native、Kernel、Driver、MCU
等函数只是帮助使用者用更少的字段构造 Job，并不会形成另一套执行机制。所有 Job 最终
都能由 `plan` 完整打印。

```js
import { testConfig } from "@cautest/config.js";
import { nativeJobs } from "./test/native/jobs.js";
import { kernelJobs } from "./test/kernel/jobs.js";
import { systemJobs } from "./test/system/jobs.js";

export default testConfig({
  jobs: [...nativeJobs, ...kernelJobs, ...systemJobs],
});
```

配置继续使用 JavaScript。安装目录自带 `.d.ts`，编辑器可以显示每个构造函数的完整
参数、注释和类型检查。公共 API 使用稳定入口 `@cautest/config.js`，拆分配置文件时不
需要修改相对于 Cautest 安装目录的路径。

## 下一步

- [配置模型与公共 Job Factory](docs/configuration.md)
- [Native C Test](docs/jobs/native.md)
- [Kernel/UML C Test](docs/jobs/kernel.md)
- [Linux Driver ABI Test](docs/jobs/driver.md)
- [MCU C Test](docs/jobs/mcu.md)
- [Script System Test](docs/jobs/system.md)
- [C Assertion API](docs/c-assertions.md)
- [CLI、Doctor 与结果](docs/cli.md)
- [完整文档入口](docs/index.md)

## 维护和验证

以下命令用于开发 Cautest 本身，不是目标项目运行测试的前置步骤：

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm test:uml # 需要 Linux Kernel 与 BusyBox 源码
```

`./tools/cautest/cautest.js --version` 会同时输出软件版本和构建 Commit。本仓库从 V2
Schema 和便携安装链开始独立演进，不继承 Cautest V1 的 Git 历史。
