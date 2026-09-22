# 版本记录

本文记录 Cautest 各版本对使用者可见的新增、变更、修复和兼容性影响。它不逐条复制 Git 提交，也不代替 [`versions.json`](../versions.json)：后者仍是当前 Release、协议、ABI、Schema 和 Cache 版本的机器可读权威来源。版本号的升级规则和发布步骤见[测试策略中的版本维护](tests/testing.md#版本维护与发布)。

尚未发布的变化应先记在文档顶部的“未发布”章节；正式发布时再将其改为带日期的版本章节。以下 `0.2.0` 是开始维护记录时对现有仓库状态建立的开发基线，不代表仓库已经存在对应的正式发布或 Git tag。

## 未发布

- 抽出无副作用的公共 `selectJobs()`，旧 CLI 共用相同 ID/Level/Tag/enabled 规则；不改变 Suite/Case 覆盖语义。

- 开发、构建、安装与便携打包统一使用 npm；以 npm v3 `package-lock.json` 替代 pnpm 锁文件，保留原有依赖版本和完整性摘要。
- 保留固定 Git Commit 的 `npx` 安装器及旧 JS 配置入口；不改变 CTP、C API、ABI、结果和缓存版本。

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
