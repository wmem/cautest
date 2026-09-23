# Xmake 接入实施进度

更新：2026-09-23。原始方案位于 [xmake-test-v0.1.0](xmake-test-v0.1.0/PLAN.md)，九个原始文件保持逐字节一致。本页与 [机器可读进度](xmake-test-progress.json) 单独记录实施状态，不改写原方案验收条件。

## 当前结论

Native、MCU SPI 软件行为模拟和 **真实 Linux 6.6.157 UML 的 Kernel Test / Driver ABI** 已执行验证。此前缺 flex 的阻断已解除，完整离线包中的工具已实际运行；没有安装系统 `.deb`、访问 Registry、加载宿主 `.ko` 或使用 VM 模拟器代替真实 UML。

本轮的主体证据在 [真实验收记录](../evidence/xmake-uml-20260923/acceptance.json)、[12 项负向/恢复矩阵](../evidence/xmake-uml-20260923/matrix.json) 和 [旧入口等价检查](../evidence/xmake-uml-20260923/legacy-parity.json)。候选包已独立克隆并完成真实 UML 冷/热、12 项矩阵及旧入口等价复验；便携包在无 dist/node_modules 的目录完成两条真实 UML 路线及清单校验。最终封存时间、精确 HEAD 的完整复验记录在交付旁的工作报告中。

## 已验证内容

| 范围 | 结果与边界 |
|---|---|
| 默认回归 | 158/158；旧入口、类型、C Runtime、版本与文档检查通过 |
| 真实 Xmake | 21/21；Native、多 Job、生成代码、MCU/SPI、并发、来源与便携组件 |
| Kbuild 组件 | 2/2，显式 Host 6.12 headers；与真实 6.6.157 UML 验收分开 |
| 构建与规模 | 5/5；100/1000/2000 Job、1024 C Case、GCC/Clang、Cortex-M ELF/BIN |
| 实际 UML | 冷构建及热缓存两次均为 2 Job / 5 C Case 成功，所有 VM 清理关闭 |
| 真实错误路径 | Ready 超时、取消、错误 Catalog/Guest 身份、Guest 断言/早退、模块初始化错误、编译失败拒用旧模块、Kernel Case 失败、恢复、Rootfs/BusyBox 同大小损坏重建 |
| 旧/新入口 | 同一产品、同一 5 个 C Case，legacy helpers 与 Xmake Artifact Job 的 CTP 结果逐项一致 |
| 源码完整性 | Linux 81,703 文件、BusyBox 2,788 文件字节核对无修改/新增；原计划九文件未修改 |

Cortex-M 项目只做真实 ARM ELF32/BIN 编译，检查显式启动向量、Thumb 入口、Flash/RAM 布局、消费者宏和重复 Reset 链接失败；不执行 ARM 固件。MCU 运行期仍由实际编译的 SPI 行为模型、CTP 与受控故障验证，不冒充引脚、电气、指令集或实板测试。

## 已修复的实际问题

UML 默认 `/lib:/lib64` RUNPATH 在本宿主加载到了旧兼容 libc。示例加入相对配置根的 `uml-host.config`，关闭该 RUNPATH，重新冷构建和启动通过；不依赖临时 `LD_LIBRARY_PATH`。控制管道先 EOF 的错误现在保留宿主加载器与内核控制台诊断。

与真实内核编译并行的原始回归曾出现 155/157：两个已有取消测试使用过短固定等待。测试改为实际 AbortSignal/执行器结束同步，并保留负载、超时和迟到资源断言；重复专项及完整 158/158 通过。原始失败日志保留，不把失败试验计为通过。

## 范围与剩余事项

G6 在上述明确环境中通过。G5 的原始物理 MCU-04 门禁按用户要求延期，**没有标为通过**；G7 在声明的 Linux + MCU 软件模拟发布候选范围完成验证，原始全平台结论不会因模拟而自动通过。最终候选验证仅覆盖声明的 Linux x86_64 / Xmake 3.1.1 / Node 22.16.0、GCC 14.2.0 / Clang 17 和指定 Kernel/BusyBox。

当前不再需要额外上传构建依赖。实板烧写、物理 SPI、其他主机/Node 版本、网络 Registry 冷安装及任意第三方原生扩展均不在本次证据内。可选 namespace/preset、共享硬件会话、host/SSH Provider 与额外 Artifact Probe/Coverage DSL 单独列为后续，不通过隐式功能承诺冒充已实现。

## 复现

```bash
npm ci
CAUTEST_XMAKE=/absolute/path/xmake \
KERNEL_SRC=/absolute/path/linux-6.6.157 \
BUSYBOX_SRC=/absolute/path/busybox-1.36.1 \
CAUTEST_UML_ACCEPTANCE_DIR=/absolute/path/evidence \
npm run test:xmake:uml
```

需要先激活完整离线工具包，或在宿主提供对应工具。验收入口输出实时日志和 30 秒进度，缺前提为 BLOCKED/77，实际失败为 ERROR/2；默认包含冷/热、负向矩阵及旧入口等价验证。仅指定 `CAUTEST_UML_MATRIX=0` 的 smoke 不满足完整 G6。

原有工程继续使用 `includes("tools/cautest/xmake.lua")`、根 `ctest.lua` 和分散模块声明。Git bundle 只含源码及历史，不携带 node_modules、dist、Linux、BusyBox、Xmake 或宿主工具。开发依赖复验使用原始上传包，不是联网的冷 Registry 安装。
