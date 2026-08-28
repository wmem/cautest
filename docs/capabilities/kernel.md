# Kernel/UML C Test

Kernel、BusyBox 和 UML 是可复用环境；具体 Job 通常只写测试、产品源码和 Header：

```js
const environment = umlKernelEnvironment({
  kernel: { sourceDir: "/opt/src/linux", arch: "um", jobs: 16 },
  busybox: { sourceDir: "/opt/src/busybox", jobs: 16 },
  moduleDefaults: {
    headers: ["include/**/*.h"],
    defines: { CONFIG_PRODUCT_TEST: 1 },
  },
  runtime: {
    maxRegistries: 64,
    eventCapacity: 512,
    workspaceSize: 65536,
  },
});

const kernelUnit = kernelCTestJobFactory({ environment });

kernelUnit({
  id: "unit.utils.cm_queue",
  tests: ["test/unit/utils/cm_queue_test.c"],
  sources: ["src/utils/cm_queue.c"],
  headers: ["src/utils/cm_queue.h"],
});
```

Cautest 自动生成 Kbuild/Makefile、Registry、`module_init/module_exit`、`MODULE_LICENSE` 和 Runtime 注册入口。Suite 默认由 ID 最后一段推导，默认选择相应 Suite。复杂测试可以覆盖 `suites`、Module 名称、`includeDirs`、`defines`、`cflags`、Make 变量、额外 Module、Guest Program、UML 参数和超时。

`sources` 支持 Glob。自动 Module 和已有 Kbuild Module 始终在 `.cautest/work` 的专属 Sandbox 构建；Kbuild 的 `M=` 从不指向项目源码目录。发布 Cache Manifest 校验 `.ko`、`Module.symvers`、`modules.order` 及可选 GCOV Artifact，相同源码可并发构建不同 Kernel/ARCH。

提供 `coverage: {}` 后，Cautest 自动启用 UML Kernel GCOV 和 HOSTFS，收集 Guest `.gcda`，结合 Manifest 中的 `.gcno`/源码生成逐行 `.gcov` 报告。

调用链：`kernelCTestJob` → `kernelBuild` → `busyboxBuild` → Runtime/额外/自动 Test Module → 可选 `umlGuestProgramBuild` → `umlRootfsBuild` → `umlStart` → `cTestRun(kernel)` → 可选 `kernelCoverage` → `umlLogs`。所有节点都在执行前由 `plan` 展开。

仓库维护者可设置 `KERNEL_SRC`、`BUSYBOX_SRC` 后执行 `pnpm test:uml`。该入口实际运行 `examples/kernel-lib` 和 `examples/linux-driver-unit`，而不是用伪 Module 替代目标行为。

权威 Schema：`UmlKernelEnvironmentInput`、`LinuxKernelBuildInput`、`BusyBoxBuildInput`、`KernelModuleDefaultsInput`、`KernelCTestJobInput`，见源码 `src/config/schema/kernel.ts` 或安装后的 `lib/config/schema/kernel.d.ts`。
