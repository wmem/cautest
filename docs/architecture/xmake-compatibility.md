# Xmake 适配前的兼容基线

基线为 `062044d`，源码审计使用上传方案中的 SOURCE_AUDIT。本文件和测试固定的是现有契约，不代表 Xmake 前端已经实现或 Manifest 已冻结。

## 既有入口必须保留

`testConfig → TestJob[] → 有序 Workflow Step[] → Suite/Case Result` 不改变。相位仍为 prepare、build、provision、run、collect；Step 必须经正规 Factory 构造，`planConfig()` 只用于展示，不能把其 JSON 作为可执行工作流载入。

`withJobDefaults()` 为浅合并，具体 Job 的 env/tags 等字段整体覆盖默认值。Native 专用 Factory 按现有规则合并 build、defines、includeDirs 和 run，不扩大为任意 target 的配置克隆。

原始通用 Job 默认 enabled=true、空 tags/env、stopOnTestFailure=false、allowEmpty=false。配置默认目录为 `.cautest/results`、`.cautest/cache`、`.cautest/generated`、`.cautest/work`，Step 默认 60000ms，Job 默认不设置整体超时。

Native 默认 level=unit、tags=[最终 level]，不会自动追加 native。MCU 默认 level=component、tags=[component,mcu]；显式改变 MCU level 不会改写其历史默认 tags。Kernel 默认 level=unit、tags=[最终 level,kernel,uml]；Driver 默认 level=integration、tags=[integration,driver,uml]。显式 tags 替换默认 tags，不静默追加。

Profiles 是包含 id/env/reporters 的数组，不是 Job 分组。它们不改变 Job Registry，也不把 Level 当成有序数值。

## 共享选择器

实现位于 `src/config/select.ts`，旧 CLI 使用该模块。ID Pattern OR、Level OR、Tag AND、维度间 AND；disabled Job 不因显式 ID 而执行，list/plan/doctor 可展示。空选择及错误状态的 CLI 退出码保持原行为。详见 [测试模型](../usage/model.md)。

测试使用原 CLI 实现作为对照，验证 8192 个组合、对象身份与顺序、重复 Pattern、无执行副作用，以及 disabled Job 的 list/plan/doctor/run 行为；这不是对 Lua 收集或 Xmake 参数解析的验证。

`suites` 是合法 C 符号 Registry，`run.suite` 是运行期 Pattern。CLI 按字段覆盖运行选择，未覆盖字段保留；共享选择器不修改 Registry、Run 配置、Profile 或 Step。

## 基线结果

原始 C 门禁通过；完整 Node 102/103 通过，失败为 prepare 仍依赖缺失的 pnpm。npm 迁移后已消除此失败，详见 [npm 迁移验证](../tests/npm-migration.md)。旧 CTP、C API、Kernel/Probe ABI、结果和缓存版本均未改变。

XT-001 和 XT-005 的结果不能替代 XT-002 的真实 Xmake PoC。没有验证 `xmake ct → Node → xmake build` 锁安全、作用域、参数解析或取消之前，不宣布 G0 或任何 Xmake 平台闭环通过。

本阶段完整门禁为 113/113 Node 测试通过，包含 TypeScript 重建、公开类型检查、C Runtime 和旧入口回归。原始记录：[选择器独立验证](../tests/evidence/selection-20260923.log)、[完整门禁](../tests/evidence/selection-full-20260923.log)。
