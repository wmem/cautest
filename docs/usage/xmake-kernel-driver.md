# Xmake Kernel Test 与 Driver ABI

本页描述已实现的产物接入接口。**真实 Linux 6.6.157 UML 验收尚未通过**：本轮上传的 BusyBox 1.36.1 已实际构建为静态程序，Linux 配置构建实际停在缺少 flex。单元测试、真实 Xmake Guest 编译和 Rootfs 组装不替代真实 UML 启动及 Driver ABI 验收。

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

Environment 模块导出 `createEnvironment({projectRoot, origin, options})`，返回现有 `umlKernelEnvironment({...})` 描述符。同名 Environment 在一次 Manifest 加载中只创建一次，其本地静态 import 依赖进入配置来源和摘要。工厂必须是纯声明，不得编译、开串口、启动 VM；`list`/`plan` 会调用工厂，但不会执行工作流。路径应相对 `projectRoot` 解析，而不是生成 Manifest 所在目录。

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
缺源码、缺工具或 Host 不支持时为 **BLOCKED，退出码 77**；真实运行失败为 ERROR，退出码 2；
只有真实 CTP Case、日志、资源关闭及第二次缓存验证通过才返回 SUCCESS。
可用 `CAUTEST_UML_ACCEPTANCE_DIR` 指定保存验收工程、日志和结果的位置。

本轮离线实测 BusyBox 1.36.1 静态编译、运行、缓存命中及同大小损坏后重建均成功；
Linux 6.6.157 的实际配置命令首先失败在 `flex`，Doctor 同时发现缺少 `bison` 与 `bc`。
当前环境没有 libelf 开发头文件，但尚未执行到能证明它对该 UML 配置必需的构建阶段。
不把 Host 6.12 headers 下的模块编译、模拟控制通道或 BLOCKED 入口当成真实 UML 通过。

UML 进程由启动步骤独占 POSIX 进程组。取消、Ready 超时、错误 Catalog Build ID、早退及
spawn 错误会回收所属进程与后代；停止操作幂等，collect/defer 共同调用同一个清理动作。
控制通道的超时或取消等待器会移除，避免吞掉下一条命令的响应。
这些失败路径通过真实 OS 进程和明确的 Agent 模拟器验证，不等同于真实 UML 启动验收。

## 离线宿主依赖准备

仓库提供 `scripts/collect-uml-deps.sh`，在联网的 Debian/Ubuntu amd64 主机执行：

```bash
sudo apt-get update
bash tools/cautest/scripts/collect-uml-deps.sh --output "$PWD/cautest-uml-deps"
```

脚本只下载、不安装软件包；使用独立的空 dpkg 状态文件计算完整依赖闭包，避免普通 `apt install --download-only` 因软件已安装而漏掉 flex/bc。它校验七个指定软件包、体系结构和四个工具的实际文件，生成包清单及 SHA-256，再输出 `cautest-uml-deps.tar.gz`。支持 `--dry-run`，拒绝覆盖已有输出。联网更新索引和实际下载由提供依赖的人执行；仓库测试使用明确的离线 APT 替身及真实 `.deb` 解析，不声称验证了 Registry/镜像网络。

包内 `activate.sh` 仅设置工具 PATH 与 Bison 数据目录，不把 Ubuntu glibc 整体放入 Debian 的 `LD_LIBRARY_PATH`。跨发行版二进制是否兼容仍需实际执行检查；缺少的共享库应逐个处理，不能仅凭发行版新旧推断兼容。

Linux Doctor 使用任意精度算术而不是 GNU 专属 `bc --version` 检查计算器。Linux/BusyBox 的 `makeArgs` 现在贯穿 defconfig、配置更新、主体构建和 modules；变更这些参数会进入构建指纹。源码树仍保持只读，输出写入受管的 out-of-tree 缓存。
