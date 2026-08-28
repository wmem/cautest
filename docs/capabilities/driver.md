# Linux Driver ABI Test

Linux Driver ABI Test 在 Kernel/UML 环境中真实构建和加载产品 Driver，再从 Guest Userspace 执行 C Test。它用于验证设备节点、公开 ABI 和 Driver 边界；只验证可分离内部算法时，应使用 Kernel Test Module 形式的 Driver Unit Test。

## Driver、Guest 与 Probe 的协作

Job 声明一个或多个产品 Driver 以及 Guest C Test。Cautest 按声明顺序构建 Module 并放入 Rootfs，同时生成 Guest Registry 和程序入口、链接 CTP3 Runtime，最后在 UML 中加载 Driver 并执行 Guest Test。多个 Driver 的构建依赖通过名称表达，构建仍在专属 Sandbox 中完成，不污染产品源码树。

可选的 test-only Probe Module 为 Guest Test 提供受控的内部观测边界。启用 Probe 时，Cautest 向产品 Kbuild 注入 `CONFIG_CAUTEST=y` 和 `CAUTEST_C_ROOT`；产品 Kbuild 需要显式包含 Cautest 公共版本 Header 与 Probe API/ABI Header。未启用 Probe 的 ABI Test 不承担这项构建依赖。

## 结果与失败边界

Driver 构建、Module 装载、设备准备、Guest Program 和 CTP3 Session 分别保留自己的诊断与 Artifact。Guest 中的 Assertion 决定测试结果；构建失败、设备不可用、身份不匹配或协议错误属于基础设施错误。Host 上直接运行 Guest ELF 不能证明 Driver、Probe、Rootfs 和 UML 调用链成立。

测试作者从[运行 Linux Driver ABI 与 Probe 测试](../usage/linux-driver-abi.md)开始；内部算法测试见 [Linux Driver Unit](../usage/linux-driver-unit.md)。精确配置由 `DriverAbiCTestJobInput`、`DriverGuestCTestInput` 和 `DriverProbeInput` 定义，见源码 `src/config/schema/driver.ts` 或安装后的 `lib/config/schema/driver.d.ts`。

仓库维护者设置 `KERNEL_SRC`、`BUSYBOX_SRC` 后可用 `pnpm test:driver:uml` 验证真实 Driver、可选 Probe、Guest ABI、Rootfs、UML 和结果收集闭环；缺少外部源码树时入口以 `BLOCKED`/77 结束。
