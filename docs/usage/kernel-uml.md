# 在 Kernel UML 中运行 C 测试

Kernel UML Test 用于必须在 Linux Kernel 上下文中执行的源码。Cautest 构建 UML Kernel 和 BusyBox，把产品源码与测试源码编入自动生成的 Test Module，构建 Rootfs 后启动 UML，并通过 Guest Agent 收集结构化结果。测试作者不需要编写 Kbuild、`module_init()`、Registry 或 Cautest Runtime 注册代码。

完整示例位于 `examples/kernel-lib/`：

```text
examples/kernel-lib/
├── cautest.config.mjs
├── include/kernel_counter.h
├── src/kernel_counter.c
└── test/kernel_counter_test.c
```

配置通过环境变量接收可复用的 Kernel 和 BusyBox 源码树：

```js
import { kernelCTestJob, testConfig, umlKernelEnvironment } from "@cautest/config.js";

const environment = umlKernelEnvironment({
  kernel: { sourceDir: process.env.KERNEL_SRC ?? "vendor/linux" },
  busybox: { sourceDir: process.env.BUSYBOX_SRC ?? "vendor/busybox" },
  moduleDefaults: { headers: ["include/**/*.h"], defines: { EXAMPLE_TEST: 1 } },
});

export default testConfig({ jobs: [kernelCTestJob({
  id: "component.kernel-counter",
  environment,
  tests: ["test/kernel_counter_test.c"],
  sources: ["src/kernel_counter.c"],
  headers: ["include/kernel_counter.h"],
  suites: ["kernel_counter"],
})] });
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

第一次执行会构建 Kernel 和 BusyBox，耗时明显高于 Native；后续运行会按输入指纹复用缓存。成功结果包含 Kernel、Test Module、Rootfs、UML 日志和 `kernel_counter/increments` Case，保存在示例目录的 `.cautest/results/<run-id>/`。

`doctor` 报 Kernel 源码污染时，不要让 Cautest 清理源码树；换用未进行 in-tree 构建的源码树。缺少 `cpio`、静态链接能力或 UML ptrace 支持时，按诊断补齐宿主环境。Kernel、BusyBox、Module、Rootfs 和 Machine 的高级选项位于安装目录的 `lib/config/schema/kernel.d.ts`。
