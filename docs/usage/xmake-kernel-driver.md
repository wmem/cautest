# Xmake Kernel Test 与 Driver ABI

本页描述已实现并执行过真实验收的 Xmake 产物接入接口。验证环境为 Linux x86_64、Xmake 3.1.1、Node 22.16.0、GCC 14.2.0、Linux 6.6.157 和 BusyBox 1.36.1；Driver 的 read/write/ioctl/非法输入及 Kernel C Test 都在实际 UML 内执行。其他平台与实板 MCU 不由此推定通过。

## 单一 Environment、两条测试路线

完整工程在 [kernel-driver 示例](../../examples/xmake/kernel-driver/xmake.lua)。把本仓库 clone 到该工程的 `tools/cautest` 后执行 `npm ci`；工程使用 `includes("tools/cautest/xmake.lua")`、根 `ctest.lua` 及各模块 `test.lua`。

```lua
ctest.environment {
    id = "uml",
    provider = {module = "environment.mjs", export = "createEnvironment"}
}
ctest.kernel {
    id = "unit.kernel.math", target = "test.kernel", output = "ko",
    environment = "uml"
}
ctest.driver {
    id = "integration.driver.abi", environment = "uml",
    drivers = {{target = "product.driver", output = "ko"}},
    guest = {target = "test.driver-guest"}
}
```

Environment 模块导出 `createEnvironment({projectRoot, origin, options})`，返回现有 `umlKernelEnvironment({...})` 描述符。同名 Environment 在一次 Manifest 加载中只创建一次，其本地静态 import 依赖进入配置来源和摘要。工厂必须是纯声明，不得编译、开串口、启动 VM；`list`/`plan` 会调用工厂，但不会执行工作流。源码目录等普通路径应相对 `projectRoot` 解析，而不是生成 Manifest 所在目录。`configFragments` 是相对配置根的 File Pattern，必须写成 `{"uml-host.config"}` 对应的 JS 数组 `["uml-host.config"]`，不能传绝对路径。

Kernel/BusyBox/Rootfs 仍由既有 JS build Steps 构建和缓存，所有 Job 使用同一个 Environment 描述。产品 `.ko` 与 Driver Guest 只由引用的 Xmake target 构建，JS 不复制其产品源码列表、宏或 Kbuild 模型。每个 Job 独立启动并清理 UML；共享产物不表示共享 VM 会话。

Kernel 路线：Environment → Cautest Kernel Runtime `.ko` → Xmake Test `.ko` → Rootfs → Kernel CTP Endpoint。Test Module 使用 Runtime 导出的注册 API；Runtime 的 `Module.symvers` 由执行层传给模块 target。

Driver 路线：Environment → 一个或多个产品 `.ko` → 独立静态 Guest ELF → Rootfs → Guest CTP Endpoint。示例 Guest 包含 read/write、ioctl 和无效输入用例。**不会在宿主机执行或加载 `.ko`，也不会把 `.ko` 代替 Guest 程序。**

## 构建上下文与多角色 Receipt

模块 target 显式导出 `ko`、`symbols`、`order`、`kernel-context` 四种角色。所有文件先经过通用 Receipt 的路径、大小、SHA-256 校验，随后检查 `.ko` 是 x86_64 ELF relocatable object、vermagic release 正确，并将 `kernel-context` JSON 与当前 Environment 严格比较。

Kernel Context v1 由 `versions.json.schemas.kernelContext` 管理。包含 Kernel 构建目录、实际 image 路径、ARCH、crossCompile、release，以及 `.config`、`Module.symvers`、Kernel image 的内容摘要。它独立于 Xmake BuildContext，也独立于 CTP Build ID。现有 CTP 3.1 和 Kernel ABI 3.0 未改变。

执行层仅在模块 build Step 的子进程环境中提供：

```text
CAUTEST_KERNEL_BUILD
CAUTEST_KERNEL_CONTEXT
CAUTEST_KERNEL_ARCH
CAUTEST_KERNEL_CROSS_COMPILE
CAUTEST_EXTRA_SYMBOLS
```

这些变量不修改全局 `process.env`，不能通过 Job/profile `env` 覆盖为冲突值。模块 target 必须使用提供的上下文，构建前后验证内容未变化，并把同一 Context 写入导出文件。示例 [product_build.lua](../../examples/xmake/kernel-driver/product_build.lua) 在临时源码副本中执行产品原有 Makefile，结束后清理暂存目录，不使用 `M=<产品源码树>` 污染源码。

多个 Driver refs 按声明顺序构建、加载；之前模块的 symbols 进入后续模块的 Kbuild extra symbols。重复 ref 明确报错。Kbuild 对空白路径的限制不由 Cautest 隐藏；示例要求 Kernel 和模块构建路径无空白。

## 静态 Guest target

```lua
target("test.driver-guest")
    set_kind("binary")
    set_default(false)
    add_rules("cautest.driver-guest")
    add_files("guest/driver_test.c")
    add_values("cautest.registry.suites", "driver_abi")
target_end()
```

此规则复用 Native Registry/CTP 构建方式，额外加入 Probe Client 和静态链接。真实 Xmake 测试已独立验证静态 ELF、CTP 正常响应、Case 选择，以及编译失败阻止运行。Artifact Loader 拒绝动态链接 Guest（PT_INTERP/DT_NEEDED）、非 x86_64 ELF、`.ko` 冒充可执行程序，以及缺失 protocolBuildId。

## 运行与验收

```sh
export KERNEL_SRC=/absolute/path/linux-6.6.157
export BUSYBOX_SRC=/absolute/path/busybox-1.36.1
xmake ct --list
xmake ct --plan --tag=uml
xmake ct --doctor --tag=uml
xmake ct --reporter=json,junit --tag=uml
```

源码目录不存在不会使纯 `list`/`plan` 编译或部署；`doctor`/真实运行会报告输入和工具问题。首次 Kernel/BusyBox 构建须配置专用 timeout，示例已提供。最终真实验收应同时保存两个 Job 的结果、UML console/host-stderr、模块与 Guest Receipt 和 Kernel Context，并记录源码、工具版本和宿主环境。

本接口当前限制为 Linux x86_64 宿主、原生编译的 64-bit `ARCH=um`。真实 host/SSH Driver、跨架构 UML、Artifact Kernel Coverage 及 Xmake Driver Probe DSL 不在本接口当前范围；旧 standalone JS helper 的既有功能保留。不得把本接口的组件验证标成真实 UML 或 MCU/SPI 通过。

## 缓存与真实验收入口

Kernel、BusyBox、Agent、Guest 和 rootfs 缓存均以完整构建结束时原子发布的
`.cautest-build-manifest.json` 为准；命中时校验文件大小、权限和 SHA-256，不能仅凭路径存在
认定产物有效。Kernel 同时校验镜像、`.config`、`Module.symvers` 和 `kernel.release`。
rootfs 指纹纳入实际 BusyBox/Agent/模块/Guest 字节、Overlay 顺序，以及 Guest Endpoint 和安装路径，
避免相同声明 ID 下的不同输入复用镜像。更改这些契约只提升对应 Cache 版本，不改 CTP/Kernel ABI。
这是缓存完整性检查，不是对任意工具链、隐藏依赖或跨进程并发构建的完整证明。

真实 Xmake UML 验收不属于默认单元测试。提供明确的源码与工具路径后执行：

```sh
CAUTEST_XMAKE=/absolute/path/xmake \
KERNEL_SRC=/absolute/path/linux-6.6.157 \
BUSYBOX_SRC=/absolute/path/busybox-1.36.1 \
npm run test:xmake:uml
```

入口先验证真实 `list/plan/doctor`，随后才执行 Kernel Test 与 Driver ABI 的冷构建和缓存复跑。
缺源码、缺工具或明确不支持的宿主平台时为 **BLOCKED，退出码 77**；实际启动/运行/断言验证失败为 ERROR，退出码 2；
只有真实 CTP Case、日志、资源关闭、第二次缓存验证以及默认失败矩阵全部通过才返回 SUCCESS。
可用 `CAUTEST_UML_ACCEPTANCE_DIR` 指定保存验收工程、日志和结果的位置。

### 宿主加载器与日志

示例携带 `uml-host.config`，开启 `CONFIG_EXPERT` 并关闭 `CONFIG_LD_SCRIPT_DYN_RPATH`。Linux 6.6 的默认 `/lib:/lib64` RUNPATH 在存在旧兼容 libc 的多架构宿主上可能先加载错误版本；关闭该项让宿主 ELF 加载器按正常规则选择库，不需要把私有 glibc 或绝对机器路径放进配置。

首次实际运行遇到过上述 GLIBC 加载错误。现在启动步骤会在控制管道先 EOF 的情况下保留真实 host-stderr 和 console 尾部，完整日志仍独立保存；不会只显示“Control Channel 已关闭”。依赖包的 `activate.sh` 不会替用户设置整套 `LD_LIBRARY_PATH`。

### 有界、可观察的验收

验收工程下有 `acceptance-pending.json`、`commands.json`、各阶段的 `*-stdout.log` / `*-stderr.log` 和最终 `acceptance.json`。耗时命令每 30 秒输出进度，日志实时写入文件。`CAUTEST_UML_TIMEOUT_MS` 设置总命令预算（毫秒，默认 55 分钟）；Ctrl+C 会取消正在执行的命令。`CAUTEST_UML_MATRIX=0` 明确选择仅冷/热 smoke，报告把完整矩阵记为 `NOT_RUN`，不能代替完整 G6 验收。

默认负向矩阵使用真实内核及 initramfs，覆盖 Ready 超时、取消、错误 Catalog/Guest Build ID、Guest Case 失败、Guest 早退、模块初始化失败、编译失败时拒用旧模块、Kernel Case 失败、恢复及损坏缓存重建。被测 Job 的预期 FAIL/ERROR 不等于验收程序失败；验收程序检查准确阶段、Case、退出码、日志与资源关闭。

UML 进程由启动步骤独占 POSIX 进程组。取消、Ready 超时、错误身份、早退及 spawn 错误都会回收所属进程与后代；停止操作幂等，collect/defer 共用同一清理动作。单元测试的明确 Agent 模拟器只验证故障机制；真实验收另检查实际 Linux 控制台和所启动进程组没有存活成员。

## 离线宿主依赖准备

仓库提供 `scripts/collect-uml-deps.sh`，在联网的 Debian/Ubuntu amd64 主机执行：

```bash
sudo apt-get update
bash tools/cautest/scripts/collect-uml-deps.sh --output "$PWD/cautest-uml-deps"
```

脚本只下载、不安装软件包；使用独立的空 dpkg 状态文件计算完整依赖闭包，避免普通 `apt install --download-only` 因软件已安装而漏掉 flex/bc。它校验七个指定软件包、体系结构和四个工具的实际文件，生成包清单及 SHA-256，再输出 `cautest-uml-deps.tar.gz`。支持 `--dry-run`，拒绝覆盖已有输出。联网更新索引和实际下载由提供依赖的人执行；仓库测试使用明确的离线 APT 替身及真实 `.deb` 解析，不声称验证了 Registry/镜像网络。

包内 `activate.sh` 仅设置工具 PATH 与 Bison 数据目录，不把 Ubuntu glibc 整体放入 Debian 的 `LD_LIBRARY_PATH`。跨发行版二进制是否兼容仍需实际执行检查；缺少的共享库应逐个处理，不能仅凭发行版新旧推断兼容。

Linux Doctor 使用任意精度算术而不是 GNU 专属 `bc --version` 检查计算器。Linux/BusyBox 的 `makeArgs` 现在贯穿 defconfig、配置更新、主体构建和 modules；变更这些参数会进入构建指纹。源码树仍保持只读，输出写入受管的 out-of-tree 缓存。

只有 BusyBox 源码而没有宿主 bc 时，可以先构建一个私有的静态 bc：

```bash
bash tools/cautest/scripts/build-busybox-bc.sh /absolute/busybox-1.36.1 "$PWD/busybox-bc"
export PATH="$PWD/busybox-bc:$PATH"
```

该辅助脚本已用提供的 BusyBox 1.36.1 实际构建并检查任意精度整数运算，不安装系统文件，也不修改源码树。它仅解决 bc 工具，不解决 Linux Kconfig 所需的 flex/bison；不是“真实 UML 已通过”的证明。内核构建中还需以实际输出验证其所用的 bc 脚本，不能由一个算术探测推断所有 GNU 扩展兼容。
