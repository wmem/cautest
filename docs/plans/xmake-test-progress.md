# Cautest npm / Xmake 实施进度

## 本轮边界

开始时间：2026-09-23 **07:46:49（UTC+8）**，等价于 08:46:49（Asia/Seoul）。一小时截止：2026-09-23 **08:46:49（UTC+8）**。本轮未用满一小时；在完成 npm 优先项及可独立验证的任务后，由 XT-002 的实际工具依赖阻断，不是因为达到时间上限。

先解压并阅读上传的 [实施方案](xmake-test-v0.1.0/SOLUTION.md)、[实施计划](xmake-test-v0.1.0/PLAN.md)、[验收标准](xmake-test-v0.1.0/ACCEPTANCE.md)。原方案全套文件原样保存在本目录下，原 `plan.json` 仍保留 planning-only，避免把旧方案改写成已验收承诺。[机器可读进度](xmake-test-progress.json) 单独记录状态。

上传 `cautest.tar.gz` 的 SHA-256 与计划内 baselineArchiveSha256 完全一致，起点为 `062044d`。没有联网，也没有下载替代版本。

## 已完成与提交

| 提交 | 内容 | 独立验证 |
| --- | --- | --- |
| `55ff886` | npm 优先迁移：全部开发/安装脚本、v3 锁文件、版本检查、文档和 npm 安装测试 | 完整 105/105；空 Cache 的本地 tarball 安装与 npm exec、实际 Workflow |
| `b9aceb1` | XT-001 兼容契约、XT-005 共享选择器 | 8192 组真值表；完整 113/113；既有筛选及 disabled 语义 |
| `b8d7e27` | clone-friendly Node 入口、npm ESM 导出、源码/便携共用进程入口 | 特殊路径迁移、无 node_modules 运行、Native CTP/JSON/JUnit、真实 SIGINT 清理；完整 117/117 |

每项均先运行验证再提交；当前不升级 Release/CTP/C API/ABI/Schema/Cache，也未创建新的发布 tag。

## 现在能用的方式

```bash
git clone /path/to/cautest.git.bundle tools/cautest
npm --prefix tools/cautest ci
node tools/cautest/cautest.js --version
node tools/cautest/cautest.js --config ./cautest.config.mjs list
node tools/cautest/cautest.js --config ./cautest.config.mjs plan
node tools/cautest/cautest.js --config ./cautest.config.mjs run --level unit
```

`npm ci` 为开发检出安装锁定的开发依赖并执行 prepare；离线运行 ci 需要预先缓存这些包。完成构建后，Node 运行不需要 node_modules。已有的便携安装器和 JS helper 保留。Git bundle 不包含被忽略的 node_modules、dist、Kernel 源码或 xmake 二进制；这不是含 dist 的完整便携发行包。

## 当前阻断与未实现项

Xmake 包能查询到文件记录，但文件接口返回没有可授权的原始字节物化路径；本轮实际挂载的文件只有方案、Cautest 和 Linux 源码归档。系统也没有安装 xmake。没有把只检查 Lua 文本或模拟调用当成 XT-002 的实际执行证据。

**尚无 root `xmake.lua`，`includes("tools/cautest/xmake.lua")`、`ctest.*` 和 `xmake ct` 当前不可用。** 这是最终接入方向，不是本次已完成的功能。

| 阶段 / 任务 | 剩余工作与依赖 |
| --- | --- |
| P0 / XT-002～004 | 取得可运行的 xmake 3.1.1，验证 DSL 作用域、task/锁与 Node 嵌套构建、CLI 参数和中断；验证共享构建边界，再冻结 Manifest/Receipt。最低版本仍待实测。 |
| P1 / XT-006～008 | Artifact/Build Provider 公共契约、Native/MCU Runtime 拆分、Manifest Loader 与 JS Factory。 |
| P2～P3 / XT-009～015 | root xmake.lua、分散 test.lua 收集、ct 命令、实际 Build Provider、Native C Runtime Rule、真实多模块示例和源码复用。 |
| P4 / XT-016～018 | 构建去重、陈旧产物、环境/配置隔离、失败兼容、100/1000 Job 规模。 |
| P5 / XT-019～021 | MCU 固件身份、物理资源锁、异常清理、模拟门禁和真实 SPI；本轮未提供实板。 |
| P6 / XT-022～024 | Kbuild 多产物、Kernel Test / Driver ABI 两条工作流、真实 UML；Linux 6.6.157 归档已提供，但尚未构建，BusyBox 源码未提供。 |
| P7 / XT-025～027 | 含 Adapter/dist 的发布包、完整 vendoring 支持、版本/文档/支持矩阵与总验收。clone 的 Node 基础完成不等于 G7。 |

G0～G7 均未宣布通过。XT-028～030 按原计划保留为 Later，不纳入本轮完成项。

## 验证记录

详情见 [npm 迁移验证](../tests/npm-migration.md)、[兼容契约](../architecture/xmake-compatibility.md)、[源码入口验证](../tests/repository-entry.md)。最后一次完整 Node 门禁为 **118 通过、0 失败、0 跳过**，并包含真实旧 Native、Driver Guest 和 MCU Host Simulation 测试；不把这些既有路径误写为 Xmake 平台闭环或真实 SPI/UML 验收。

原方案的 Source Audit 包含以代码块展示的 Markdown 源码片段；文档链接检查已修正为不将 fenced code 中的字面量当作当前文档链接，同时新增回归测试。原方案文件未被改写。[交付前完整门禁](../tests/evidence/pre-bundle-full-20260923.log) 记录 118/118 的结果。

固定 Git Commit 的 npx/npm exec 源码安装 E2E、空 Registry Cache 的 npm ci 未在本轮离线环境执行。下一轮先恢复 XT-002 所需工具，不能跳过 G0 直接宣称 P3～P7 完成。
