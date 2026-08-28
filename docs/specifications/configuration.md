# 配置模型与分层组织

## 唯一顶层模型

根配置只有一个稳定形状：

```ts
interface TestConfigInput {
  readonly jobs: readonly TestJob[];
  readonly defaults?: TestConfigDefaultsInput;
  readonly profiles?: readonly TestProfileInput[];
}
```

`jobs` 的每个元素必须由 `nativeCTestJob()`、`kernelCTestJob()`、`driverAbiCTestJob()`、`mcuCTestJob()`、`scriptSystemTestJob()` 或通用 `testJob()` 创建。同一名称不会在这里表示 Group、声明或 Job 等多种类型。所有 Job 最终都是线性 Workflow；`cautest plan` 可以在执行前完整打印。

公共字段由源码中的 `src/config/schema/common.ts` 定义：`id`、`level`、`tags`、`enabled`、Job 超时、环境变量和结果策略。安装后请查看 `lib/config/schema/common.d.ts`。

## 公共配置与最小声明

公共环境或工具链用 Job Factory 绑定，分类文件只保留变化的字段：

```js
// test/environments/kernel-unit.js
import { kernelCTestJobFactory, umlKernelEnvironment } from "@cautest/config.js";

const environment = umlKernelEnvironment({
  kernel: { sourceDir: "/opt/src/linux", arch: "um" },
  busybox: { sourceDir: "/opt/src/busybox" },
  moduleDefaults: {
    headers: ["include/**/*.h"],
    defines: { CONFIG_PRODUCT_TEST: 1 },
  },
  runtime: { maxRegistries: 64, eventCapacity: 512 },
});

export const kernelUnitJob = kernelCTestJobFactory({
  environment,
  defaults: { level: "unit", tags: ["unit", "kernel"] },
});
```

```js
// test/unit/utils/jobs.js
import { jobNamespace } from "@cautest/config.js";
import { kernelUnitJob } from "../../environments/kernel-unit.js";

export const utilsJobs = jobNamespace({
  namespace: "unit.utils",
  source: import.meta.url,
  factory: kernelUnitJob,
  definitions: [
    {
      name: "cm_queue",
      tests: ["test/unit/utils/cm_queue_test.c"],
      sources: ["src/utils/cm_queue.c"],
      headers: ["src/utils/cm_queue.h"],
    },
  ],
});
```

```js
// cautest.config.mjs
import { testConfig } from "@cautest/config.js";
import { utilsJobs } from "./test/unit/utils/jobs.js";
import { systemJobs } from "./test/system/jobs.js";

export default testConfig({
  jobs: [...utilsJobs, ...systemJobs],
});
```

这里的层级只负责生成稳定 ID `unit.utils.cm_queue`，不会创建另一种运行节点。重复 ID 在根配置合并时直接报错；错误、`plan`、`doctor` 和 `describe` 都保留 `import.meta.url` 来源及完整配置路径。

## Workflow Fragment 与标准能力复用

`defineFragment()` 允许把 Step、嵌套数组和其他 Fragment 组织为可复用单元，`testJob()` 会递归展开后统一校验 Phase 顺序。需要组合标准实现时，不要复制 Job 内部 Executor：`standardJobFragment(job, { phases, kinds, names })` 可从已经配置好的 Native、Kernel、Driver 或 MCU Job 选择标准 Step；`composeJobWorkflows(...jobs)` 会按 `prepare → build → provision → run → collect` 合并多个完整 Workflow。

```js
const native = nativeCTestJob({ id: "source.native", tests: ["test/native.c"] });
const service = testJob({ id: "source.service", level: "system", workflow: [
  processStart({ name: "api", program: "node", args: ["server.mjs"], ready: { type: "process-alive" } }),
  collectLogs({ name: "api", resource: "process:api" }),
] });

const combined = testJob({
  id: "system.combined",
  level: "system",
  workflow: [composeJobWorkflows(native, service)],
});
```

标准 Fragment 保留原 Job 的声明环境，组合 Job 的同名环境变量优先。Factory 输入中配置的编译、Target 和缓存逻辑原样复用；组合方仍需保证不同来源使用不冲突的 Artifact/Resource/State 名称，尤其不要把两个独立 Kernel/UML Backbone 合并进同一个 Job。

## Glob、继承和缓存边界

`tests`、`sources`、`headers` 和其他 `FilePattern` 字段支持 `*`、`**`、`?`、字符组、花括号及 `!` 排除。每个正向 Pattern 必须命中文件，结果排序并去重。`headers` 自动进入 Doctor 和缓存指纹，其父目录由 Native/自动 Guest 构建推导为 Include 目录。

公共默认与具体 Job 的普通字段浅合并；宏按名称合并，具体 Job 优先；文件列表和 Flag 的具体合并规则由相应 Factory 定义。Kernel、BusyBox、Module、Guest Program 分属不同指纹边界。修改 Module 的 `defines`、`cflags` 或 Header 不会重编 Kernel/BusyBox。

`configHash` 同时覆盖根配置、所有通过来源协议登记的片段，以及最终解析结果。它不依赖检出目录绝对路径。

## Profile 只覆盖运行视图

Profile 不创建 Job，也不改变 Workflow 结构。它只为选中的 Job 追加环境变量并选择附加 Reporter：

```js
testConfig({
  profiles: [{
    id: "ci",
    reporters: ["json", "junit", "html"],
    env: { CI: "true" },
  }],
  jobs,
});
```

使用 `cautest run --profile ci`。Profile 环境变量覆盖 Job 中的同名值，并进入 Native、Kernel、BusyBox、Module、Driver Guest、Rootfs、UML、MCU、System 和自定义 Step 的最终 `context.job.env`。标准构建器使用最终有效环境执行工具，并把声明式 Job/Profile 环境纳入 Cache 指纹；Step 专属环境仍具有最高优先级。Reporter 输出见[结果目录与 Reporter](results.md)。

## 编辑器类型提示

配置运行时仍是 JavaScript；安装目录自带 `.d.ts`。项目可用 `jsconfig.json` 把逻辑入口映射到声明：

```json
{
  "compilerOptions": {
    "checkJs": true,
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "paths": {
      "@cautest/config.js": ["./tools/cautest/lib/config/index.d.ts"]
    }
  }
}
```

函数到权威参数接口的映射：

- `testConfig()` → `TestConfigInput`（`common.d.ts`）
- `nativeCTestJob()` → `NativeCTestJobInput`（`native.d.ts`）
- `umlKernelEnvironment()` → `UmlKernelEnvironmentInput`（`kernel.d.ts`）
- `kernelCTestJob()` → `KernelCTestJobInput`（`kernel.d.ts`）
- `driverAbiCTestJob()` → `DriverAbiCTestJobInput`（`driver.d.ts`）
- `mcuCTestJob()` → `McuCTestJobInput`（`mcu.d.ts`）
- `scriptSystemTestJob()` → `ScriptSystemTestJobInput`（`system.d.ts`）
