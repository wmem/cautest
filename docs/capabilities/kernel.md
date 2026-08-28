# Kernel/UML C Test

Kernel/UML C Test 用于必须在 Linux Kernel 上下文中执行的源码。它把 Kernel、BusyBox 和 UML 组织为可复用环境，再把某个 Job 的产品源码与测试源码编入隔离的 Test Module；测试作者不需要维护 Kbuild、模块入口、Registry 或 Runtime 注册代码。

## 从 Test Module 到 UML 结果

一个 Job 依次准备 Kernel 和 BusyBox、构建 Runtime 与 Test Module、生成 Rootfs、启动 UML，再由 Guest Agent 把 Kernel Endpoint 接入 CTP3 Session。Host 在执行前获得 Catalog 并应用 Suite、Case、参数、超时和停止策略；测试事件最终进入与 Native、MCU 相同的 Result 模型。

Kernel、BusyBox、Module、Guest Program 和 Rootfs 各有独立缓存指纹。自动 Module 和已有 Kbuild Module 都在 `.cautest/work` 的专属 Sandbox 中构建，Kbuild 的 `M=` 不指向项目源码目录。发布 Cache 时校验 `.ko`、`Module.symvers`、`modules.order` 及可选 GCOV Artifact，因此同一源码可以为不同 Kernel 或 ARCH 并发构建。

## 身份、失败与覆盖率边界

Rootfs Catalog 把 Kernel Endpoint 绑定到当前 Build ID；Host 在 Ready、HELLO 和执行阶段校验 Image、Build 与 Boot 身份，拒绝旧 Rootfs、旧 Module 或旧启动实例的结果。Kernel/BusyBox 源码、宿主工具和 UML 能力缺失会阻止真实执行，而不是退化为 Host 上的伪 Module 测试。

启用覆盖率时，Cautest 打开 UML Kernel GCOV 和 HOSTFS，收集 Guest `.gcda`，再结合 Manifest 中的 `.gcno` 与源码生成逐行报告。覆盖率收集是标准测试完成后的附加结果。

测试作者从[在 Kernel UML 中运行 C 测试](../usage/kernel-uml.md)开始；Driver 内部源码测试可沿用[关联单元测试](../usage/linux-driver-unit.md)。精确配置由 `UmlKernelEnvironmentInput`、`LinuxKernelBuildInput`、`BusyBoxBuildInput`、`KernelModuleDefaultsInput` 和 `KernelCTestJobInput` 定义，见源码 `src/config/schema/kernel.ts` 或安装后的 `lib/config/schema/kernel.d.ts`。

仓库维护者设置 `KERNEL_SRC`、`BUSYBOX_SRC` 后可用 `pnpm test:uml` 验证真实 Kernel、Test Module、Rootfs、Guest Agent 和 CTP3 闭环。
