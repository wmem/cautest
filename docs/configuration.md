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

## Glob、继承和缓存边界

`tests`、`sources`、`headers` 和其他 `FilePattern` 字段支持 `*`、`**`、`?`、字符组、花括号及 `!` 排除。每个正向 Pattern 必须命中文件，结果排序并去重。`headers` 自动进入 Doctor 和缓存指纹，其父目录由 Native/自动 Guest 构建推导为 Include 目录。

公共默认与具体 Job 的普通字段浅合并；宏按名称合并，具体 Job 优先；文件列表和 Flag 的具体合并规则由相应 Factory 定义。Kernel、BusyBox、Module、Guest Program 分属不同指纹边界。修改 Module 的 `defines`、`cflags` 或 Header 不会重编 Kernel/BusyBox。

`configHash` 同时覆盖根配置、所有通过来源协议登记的片段，以及最终解析结果。它不依赖检出目录绝对路径。

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
