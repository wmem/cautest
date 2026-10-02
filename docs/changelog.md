# 版本记录

本文记录 Cautest 各版本对使用者可见的新增、变更、修复和兼容性影响。它不逐条复制 Git 提交，也不代替 [`versions.json`](../versions.json)：后者仍是当前 Release、协议、ABI、Schema 和 Cache 版本的机器可读权威来源。版本号的升级规则和发布步骤见[测试策略中的版本维护](tests/testing.md#版本维护与发布)。

尚未发布的变化应先记在文档顶部的“未发布”章节；正式发布时再将其改为带日期的版本章节。以下 `0.2.0` 是开始维护记录时对现有仓库状态建立的开发基线，不代表仓库已经存在对应的正式发布或 Git tag。

## 未发布

- 补齐 Xmake Native 的 gcov 链路：`cautest.gcov` 配置 GCC 插桩，`ctest.native.coverage` 在本轮测试后收集报告；旧 Native 编译入口共用收集实现。gcno 纳入 Artifact Receipt 的字节校验，gcda 按运行隔离，同名源码和显式插桩的共享库保留独立数据。覆盖率目标关闭只恢复 `.o` 的 Xmake 编译缓存，普通增量构建保留。
- Xmake Manifest 升至 v2，并兼容读取未声明 coverage 的 v1；Artifact Receipt、C API、CTP、Result 和 Cache 版本保持不变。尚未执行版本发布。
- 修复 `xmake ct` 在加载保存配置之前收集声明的问题；执行时重新解释配置相关声明，使 `has_config()` 和 `get_config()` 反映 `xmake f` 的选项。list/plan 的重解释不加载目标、不执行构建钩子，也不安装 addon/package。

## 0.3.1 — 2026-09-23

- 增加 MIT 许可证，并在源码、npm 包、便携包及 C Kit 安装结果中附带许可文本。C API、CTP、Kernel/Probe ABI、Schema 和 Cache 版本保持不变。

## 0.3.0 — 2026-09-23

- 修复 UML 控制管道先关闭时丢失实际加载/启动诊断的问题；保留 host stderr 和 console 尾部。示例关闭可能误用旧 libc 的 UML RUNPATH，不注入私有 glibc。取消相关回归改用明确同步，避免负载下 Ready/stdout 或 Board 工厂迟到的计时竞态。
- 修复多个 `xmake ct` 进程首次创建 Manifest 目录时的竞态，并补齐 Git 安装测试快照中的 Xmake 交付文件。

- 新增可直接 vendoring 的根 `xmake.lua`、分散 `ctest.*` 声明、Manifest/Receipt 与 `xmake ct`，继续复用既有 Workflow、CTP 和 Result。Native 与 MCU SPI 行为模拟已实测；实板 MCU/SPI 按用户范围延期，未标通过。
- 新增 Kernel Test / Driver ABI 的显式 Artifact 路线、共享声明式 Environment、静态 Driver Guest rule 和产品 Kbuild 示例。Linux 6.6.157 / BusyBox 1.36.1 已实际冷构建、启动并通过两条真实测试路线、12 个负向/恢复/缓存场景及旧入口等价检查。
- 修复 UML 所属进程组取消/超时/启动失败清理及过期控制等待器；Kernel/BusyBox/Agent/Guest/rootfs 缓存改为完整标记和字节校验。引入 Kernel Context v1 与 UML 构建 Manifest v1，提升对应 Cache 版本；保持 CTP 3.1、Kernel ABI 3.0 与 Probe ABI 1.0。
- 增加真实 Xmake 可见性/链接/GCC-Clang/输出隔离及 100/1000/2000 Job 测量入口；补充真实 Cortex-M ELF/BIN、启动/链接与宏隔离检查（不执行 ARM 固件）。仅声明已验证的平台。

- 增加源码仓库根 `cautest.js`、`npm run cli` 和 npm ESM 公共导出；直接 clone 到 `tools/cautest` 后可以使用原有 JS CLI。源码和便携入口共用中断与退出码处理。

- 抽出无副作用的公共 `selectJobs()`，旧 CLI 共用相同 ID/Level/Tag/enabled 规则；不改变 Suite/Case 覆盖语义。

- 开发、构建、安装与便携打包统一使用 npm；以 npm v3 `package-lock.json` 替代 pnpm 锁文件，保留原有依赖版本和完整性摘要。
- 保留固定 Git Commit 的 `npx` 安装器及旧 JS 配置入口；npm 迁移本身不改变 CTP、C API、ABI 或结果；后续缓存版本变化见本节上方说明。

## 0.2.1 — 2026-09-04

### 新增

- 建立面向维护者和使用者的版本记录，保存每次发布的可见变化与历史兼容性基线。
- 明确 Release、协议、ABI、Schema 和 Cache 的升级条件，以及版本同步、验证、归档和 tag 发布流程。

### 变更

- 版本相关测试改为读取统一的 Release 版本常量，后续发版不再需要同步修改硬编码的测试期望。

## 0.2.0 — 开发基线

基线记录于 2026-09-04，对应 Commit `b813581`。

### 新增

- 建立统一的 `TestJob → Workflow → Result` 测试模型，覆盖 Native C、Linux Kernel UML、Linux Driver、MCU 和系统脚本场景。
- 提供 C Test Runtime、CTP3 Host/Target 通信、Case 筛选、断言和结果收集能力。
- 提供配置检查、执行计划、测试运行、Doctor、结果 Reporter 和缓存管理命令。
- 支持从固定 Git Commit 安装自包含工具目录，并支持生成带 SHA-256 校验文件的便携归档。
- 提供可运行示例、使用指南、协议规格、架构说明和分层测试入口。

### 变更

- 将 V1 能力迁移到 V2 配置和工作流模型，移除运行时 V1 门禁。
- 精简便携包运行库内容，并补齐安装包所需的文档、示例和版本清单。
- 统一配置模块来源追踪、预检失败结果和 Kernel 构建超时约束。

### 兼容性基线

| 维度 | 基线版本 |
| --- | --- |
| Release | `0.2.0` |
| C API | `2.1` |
| CTP | `3.1` |
| Kernel ABI | `3.0` |
| Probe ABI | `1.0` |
| Schema | Config `2`；Result、Event、CLI、Build Info、Portable Manifest、Cache Manifest、Fingerprint 均为 `1` |
| Cache | Native Fingerprint `1`、Native Manifest `2`、Kernel Fingerprint `3`、BusyBox Fingerprint `2`、MCU Fingerprint `1`、Module Fingerprint `2`、Module Manifest `4`、Agent Fingerprint `1`、Guest Fingerprint `2`、Rootfs Fingerprint `3` |
