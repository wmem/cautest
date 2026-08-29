# 在 Kernel UML 中运行 C 测试

Kernel UML Test 用于必须在 Linux Kernel 上下文中执行的源码。Cautest 构建 UML Kernel 和 BusyBox，把产品源码与测试源码编入自动生成的 Test Module，构建 Rootfs 后启动 UML，并通过 Guest Agent 收集结构化结果。测试作者不需要编写 Kbuild、`module_init()`、Registry 或 Cautest Runtime 注册代码。

最小 Job 需要可复用的 UML Environment 和至少一个测试源码：

```js
const environment = umlKernelEnvironment({
  kernel: { sourceDir: process.env.KERNEL_SRC, timeoutMs: 20 * 60_000 },
  busybox: { sourceDir: process.env.BUSYBOX_SRC, timeoutMs: 10 * 60_000 },
});

kernelCTestJob({
  id: "unit.kernel-math",
  environment,
  tests: ["test/kernel_math_test.c"],
});
```

小而典型的多文件示例位于 `examples/kernel-lib/`：

```text
examples/kernel-lib/
├── cautest.config.mjs
├── include/
│   ├── kernel_counter.h
│   └── kernel_counter_limits.h
├── src/
│   ├── kernel_counter.c
│   └── kernel_counter_limits.c
└── test/
    ├── kernel_counter_limits_test.c
    └── kernel_counter_test.c
```

配置通过环境变量接收可复用的 Kernel 和 BusyBox 源码树：

```js
import { kernelCTestJob, testConfig, umlKernelEnvironment } from "@cautest/config.js";

export function kernelCounterJob(baseDir = ".") {
  const fromExample = (relative) => baseDir === "." ? relative : `${baseDir}/${relative}`;
  const environment = umlKernelEnvironment({
    kernel: {
      sourceDir: process.env.KERNEL_SRC ?? fromExample("vendor/linux"),
      timeoutMs: 20 * 60_000,
    },
    busybox: {
      sourceDir: process.env.BUSYBOX_SRC ?? fromExample("vendor/busybox"),
      timeoutMs: 10 * 60_000,
    },
    moduleDefaults: {
      defines: { EXAMPLE_TEST: 1 },
      timeoutMs: 5 * 60_000,
    },
  });

  return kernelCTestJob({
    id: "component.kernel-counter",
    level: "component",
    environment,
    tests: [fromExample("test/**/*_test.c")],
    sources: [fromExample("src/**/*.c")],
    headers: [fromExample("include/**/*.h")],
    suites: ["kernel_counter", "kernel_counter_limits"],
  });
}

export default testConfig({ jobs: [kernelCounterJob()] });
```

设置源码树并运行：

```bash
export KERNEL_SRC=/path/to/linux
export BUSYBOX_SRC=/path/to/busybox
cd examples/kernel-lib
../../cautest.js doctor
../../cautest.js list
../../cautest.js plan component.kernel-counter
../../cautest.js run component.kernel-counter
```

第一次执行会构建 Kernel 和 BusyBox，耗时明显高于 Native；后续运行会按输入指纹复用缓存。成功结果包含 Kernel、Test Module、Rootfs、UML 日志，以及 `kernel_counter/increments`、`kernel_counter_limits/limits_counter_value` 两个 Case，保存在示例目录的 `.cautest/results/<run-id>/`。

这里的产品源码和测试源码共同编入一个 Test Module，因此使用一个 Job；需要不同 Kernel 配置、宏、加载边界或独立 CI 选择时再拆 Job。通用规则见[组织典型项目](project-organization.md)。

`kernel.timeoutMs` 和 `busybox.timeoutMs` 分别控制对应 Build Step；示例为首次构建预留 20 分钟和 10 分钟，`moduleDefaults.timeoutMs` 为 Cautest Kernel Runtime 和自动 Test Module 预留 5 分钟。应根据机器性能和源码配置调整。CLI 的 `--run-timeout` 只控制 C Test Run，不能延长 Kernel、BusyBox 或 Module 的构建时间。

`doctor` 报 Kernel 源码污染时，不要让 Cautest 清理源码树；换用未进行 in-tree 构建的源码树。缺少 `cpio`、静态链接能力或 UML ptrace 支持时，按诊断补齐宿主环境。`umlKernelEnvironment()` → `UmlKernelEnvironmentInput`、`kernelCTestJob()` → `KernelCTestJobInput`，均位于 `lib/config/schema/kernel.d.ts`；完整映射见[配置 API 索引](config-reference.md)。
