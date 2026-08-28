# 组合多个标准 Workflow

普通项目应优先声明多个独立 Job，再用 CLI 的 ID、Glob、Level 或 Tag 选择。只有多个能力必须共享同一次 Job 生命周期、状态和失败传播时，才把标准 Job 的 Workflow 合并成一个 Job。

`examples/workflow/` 提供一个完全在本机运行的组合示例：它把 Native C Test 与启动服务后的 Script System Test 合并到 `system.composed-local`。

```text
examples/workflow/
├── cautest.config.mjs
├── native/
│   ├── example_math.c
│   ├── example_math.h
│   └── example_math_test.c
└── system/
    ├── server.mjs
    └── system.test.mjs
```

配置完整内容如下：

```js
import {
  composeJobWorkflows,
  nativeCTestJob,
  processStart,
  scriptSystemTestJob,
  testConfig,
  testJob,
} from "@cautest/config.js";

const native = nativeCTestJob({
  id: "source.native-math",
  tests: ["native/example_math_test.c"],
  sources: ["native/example_math.c"],
  headers: ["native/example_math.h"],
  suites: ["example_math"],
});

const script = scriptSystemTestJob({
  id: "source.system-api",
  file: "system/system.test.mjs",
});

const service = testJob({
  ...script,
  workflow: [
    processStart({
      name: "server",
      program: process.execPath,
      args: ["system/server.mjs"],
      ready: { kind: "file", path: ".cautest/server.ready" },
    }),
    ...script.workflow,
  ],
});

export default testConfig({ jobs: [testJob({
  id: "system.composed-local",
  level: "system",
  description: "在一个 Job 中组合 Native C 与 Script System Test",
  workflow: [composeJobWorkflows(native, service)],
})] });
```

运行示例：

```bash
cd examples/workflow
../../cautest.js doctor
../../cautest.js list
../../cautest.js plan system.composed-local
../../cautest.js run system.composed-local
```

`composeJobWorkflows()` 按 `prepare → build → provision → run → collect` 重排多个来源的 Step，同时保留同一 Phase 内的声明顺序。任一普通 Step 出错后，后续普通 Step 不再运行，但 `always`/`on-failure` Collect 和 LIFO Cleanup 仍会执行。

不要把两个拥有独立 Kernel/UML Backbone 的 Job 直接合并，否则 Artifact、Resource 和 State 名称可能冲突。只复用部分能力时使用 `standardJobFragment()` 按 Phase、Kind 或 Name 选择；精确类型查看 `lib/config/index.d.ts`。
