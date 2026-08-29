# 组织典型项目

最小示例便于确认工具可以工作，但真实项目通常包含多个产品源码、多个测试文件和多个测试边界。Cautest 不把“一个文件”强制对应成“一个 Job”：文件是编译输入，Suite 是 C Test 的登记与筛选单位，Job 才是构建、运行环境、缓存和结果隔离边界。

## 一个 Job 可以包含多个文件

例如一个普通 C 模块可以这样组织：

```text
include/math/
├── arithmetic.h
└── limits.h
src/math/
├── arithmetic.c
└── limits.c
test/unit/math/
├── arithmetic_test.c
└── limits_test.c
```

共享同一 Compiler、宏和运行环境的文件可以进入一个 Native Job：

```js
nativeCTestJob({
  id: "unit.math",
  tests: ["test/unit/math/**/*_test.c"],
  sources: ["src/math/**/*.c"],
  headers: ["include/math/**/*.h"],
  suites: ["math_arithmetic", "math_limits"],
});
```

`tests` 和 `sources` 都会参与编译；区别在于前者表达测试入口，后者表达被测产品实现。`headers` 不单独编译，但会接受 `doctor` 检查、进入缓存指纹，并帮助 Native、Kernel Test Module 和 Guest Program 推导 Include 目录。`suites` 是需要进入自动生成 Registry 的 C 标识符列表，不是文件名列表。

File Pattern 支持具体路径、`*`、`**`、`?`、字符组、花括号和 `!` 排除。每个正向 Pattern 都必须至少匹配一个普通文件，结果按路径排序并去重。例如产品目录含有程序入口时可以排除：

```js
sources: ["src/**/*.c", "!src/main.c"],
```

所有 File Pattern 都相对于根 `cautest.config.mjs` 所在目录解析，与启动命令时 Shell 的当前目录无关。

## 什么时候拆成多个 Job

满足以下任一条件时应拆 Job，而不是继续向同一个数组添加文件：

- Level 不同，例如快速单元测试与组件测试；
- Compiler、宏、Flag、Kernel/BusyBox、Board 或外部服务不同；
- 需要独立选择、缓存、超时、失败策略或结果归属；
- 两组测试不能共享同一个进程、Firmware、UML 或服务生命周期；
- 一组测试足够慢，需要在 CI 中单独分片或按 Tag 运行。

只是源文件或测试文件数量增加、但上述边界不变时，通常仍保持一个 Job。不要为了目录层级创建空 Group；用稳定的点分隔 Job ID、Level 和 Tag 表达选择维度。

## 多个同类 Job 的配置拆分

同类 Job 应通过 Factory 绑定公共工具链，再按领域组织声明：

```js
// test/config/native-jobs.mjs
import {
  jobNamespace,
  nativeCTestJobFactory,
} from "@cautest/config.js";

const nativeUnitJob = nativeCTestJobFactory({
  defaults: {
    level: "unit",
    tags: ["unit", "native"],
    build: { cflags: ["-Werror"] },
  },
});

export const nativeJobs = jobNamespace({
  namespace: "unit",
  source: import.meta.url,
  factory: nativeUnitJob,
  definitions: [
    {
      name: "math",
      tests: ["test/unit/math/**/*_test.c"],
      sources: ["src/math/**/*.c"],
      headers: ["include/math/**/*.h"],
      suites: ["math_arithmetic", "math_limits"],
    },
    {
      name: "queue",
      tests: ["test/unit/queue/**/*_test.c"],
      sources: ["src/queue/**/*.c"],
      headers: ["include/queue/**/*.h"],
      suites: ["queue_fifo", "queue_capacity"],
    },
  ],
});
```

根配置只负责合并普通 Job：

```js
// cautest.config.mjs
import { testConfig } from "@cautest/config.js";
import { nativeJobs } from "./test/config/native-jobs.mjs";
import { systemJobs } from "./test/config/system-jobs.mjs";

export default testConfig({
  jobs: [...nativeJobs, ...systemJobs],
});
```

`nativeCTestJobFactory()`、`kernelCTestJobFactory()` 和 `driverAbiCTestJobFactory()` 提供对应场景的公共默认绑定。没有专用 Factory 的 Job 可以用 `withJobDefaults()` 绑定公共字段；`jobNamespace()` 只批量生成普通 Job 和完整 ID，不会创建额外运行层级。

## 一个项目中的推荐边界

```text
cautest.config.mjs              # 唯一根配置
test/config/                    # Environment、Factory 和 Job 声明
test/unit/                      # 单元测试源码
test/component/                 # 组件测试源码
test/integration/               # ABI、Guest 或系统集成测试
src/ 与 include/                # 产品源码，保持原有目录边界
```

目录名不是 Cautest 协议的一部分，可以沿用项目现状。重要的是根配置只有一个、Job ID 稳定、Pattern 基准明确，并且公共环境与具体测试输入分开维护。

整体层次和每种测试可用的 Job 构造函数见[测试组织模型](model.md)，精确参数类型见[配置 API 索引](config-reference.md)。
