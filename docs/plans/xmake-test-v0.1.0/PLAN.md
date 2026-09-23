# 实施 Plan：Cautest Xmake-Test 适配层

版本：v0.1.0；日期：2026-09-22。设计依据：`SOLUTION.md`。所有任务默认 **待实施**；本次只产出方案、源码核查与旧版测试抽查，不把任何新 Adapter 功能记为完成。

## 1. 实施策略

先固定现有契约和关键技术约束，再完成 Native 的纵向闭环；在该闭环可靠后接入 MCU 与 Kernel/Driver。不能一开始就全量改写 helper，也不能只实现 DSL 外观而把 Artifact、身份和失败清理留到最后。

以小提交为单位实施。每个任务包含实现、测试、文档和兼容性说明；某一阶段的文档集成任务不是此前不写文档的理由。这里不提供未经估算的日历排期，按依赖和验收门禁推进。

**可交付增量：** G3 为 Native 可演示闭环；G4 为可靠的 Native 增量；G5 增加 MCU；G6 增加 Kernel/Driver；G7 才是本方案声明范围的完整发行候选。阶段验收的通过不能替代后续平台验收。

## 2. 实施顺序与并行范围

```text
P0：契约 / Xmake PoC / 构建复用 / Schema
  ├─ P1：JS selector、Artifact、Factory、Manifest Loader
  └─ P2：Lua 入口、分散收集、CLI 导出
             │
             ▼
P3：Native 实构建与运行闭环 + 共享构建定义
             │
             ▼
P4：去重、陈旧检测、失败兼容、规模
             │
       ┌─────┴─────┐
       ▼           ▼
P5：MCU          P6：Kernel/Driver
       └─────┬─────┘
             ▼
P7：发行包、文档、版本、总验收
```

P1 的选择器抽取可在 P0 期间进行；P1 与 P2 在契约冻结后可以并行。P5/P6 可由不同实现者推进，但共用 Build Provider 与 Artifact 契约的更改需要同步评审。机器可读精确依赖在 `plan.json`。

## 3. 阶段总表

| 阶段 | 目标 | 放行条件 |
|---|---|---|
| P0 — 基线与技术阻断项 | 确认可以稳定接入，先解决 DSL/锁、构建复用和协议契约，不先堆平台功能。 | G0：最小 Xmake PoC 真实运行通过；锁与配置复用边界明确；Manifest v1 冻结。 |
| P1 — Cautest 后端解耦 | 保留原引擎，把产物消费、选择器与构建提供方抽成可复用接口。 | G1：旧 JS 入口不退化；Manifest 可重建正规 Job；假 Provider 能覆盖失败路径。 |
| P2 — Xmake 前端与分散收集 | 根 ctest.lua + 多 test.lua 可被收集、展示、选择与追溯。 | G2：list/plan 正确且无 Adapter 执行动作；新增 fragment 自动进入 Registry。 |
| P3 — Native 首个纵向闭环 | 实际完成 Lua → Manifest → Xmake 构建 → JS CTP → 报告，再补便捷构建复用。 | G3：两个以上模块、多 Suite/Case 的 Native 示例真实运行；错误和选择均正确。 |
| P4 — 可靠性、规模与兼容 | 把去重、陈旧产物、环境隔离、大规模和失败语义补齐，避免只跑通 happy path。 | G4：增量/隔离/旧入口回归及规模门禁通过，形成可依赖的 Native 增量。 |
| P5 — MCU 编码阶段与真实硬件测试 | 接入固件、Board、独占、烧写、复位、协议身份与清理，包含真实 SPI 验收。 | G5：模拟契约与真实 SPI 分别有证据；实板缺失则明确受阻。 |
| P6 — Kernel 与 Linux Driver | 保留 Kernel 内部测试与 Driver ABI 两条路线，复用真实 UML 并统一产品 Driver 构建来源。 | G6：真实 Kernel Test Module 与 Driver Guest ABI 闭环均完成。 |
| P7 — 分发、文档与总验收 | 完成 tools/cautest 接入、版本与发行内容、回归和支持矩阵。 | G7：声明支持的每个平台有对应证据，旧 standalone 入口仍可用。 |

## 4. 任务清单

验收编号对应 `ACCEPTANCE.md`。代码路径是建议改动位置，并不是声称这些新文件已存在。

### P0 — 基线与技术阻断项

确认可以稳定接入，先解决 DSL/锁、构建复用和协议契约，不先堆平台功能。

#### XT-001：固化兼容基线与测试管理契约

状态：待实施。依赖：无。优先级：必需。

改动位置：`src/config/schema/common.ts`、`src/runtime/cli.ts`、`src/config/define.ts`、`docs/usage/model.md`、`test/config.test.js`、`test/factory.test.js`。

实施内容：

1. 以 SOURCE_AUDIT 的实际源码为起点，记录公开 API、默认值、浅合并与 enabled 行为。
2. 补充 selector 真值表与 Registry/运行选择的差异；记录旧、新入口预期相同的行为。
3. 重新构建 TypeScript 后运行完整旧版默认门禁；已有 20 项抽查只作证据，不等于完成此任务。

交付：兼容契约文档、旧版完整基线结果。

验收：REG-01、SEL-01、SEL-02、CFG-05。

#### XT-002：验证 Xmake DSL、task 生命周期与锁

状态：待实施。依赖：XT-001。优先级：必需。

改动位置：`adapters/xmake-test/ 下的临时 PoC`、`examples/xmake/poc/`。

实施内容：

1. 验证 includes 工具入口后注册表式 ctest.*，局部文件作用域、重复加载与原工程 target 隔离。
2. 验证 xmake ct 导出后等待 Node，Node 在 Workflow build Step 调同项目 xmake build 不死锁、不递归触发 ct；测试失败与 Ctrl+C。
3. 验证 CLI 参数、逗号多值与重复参数是否保留；保留 Xmake --profile，将 Cautest Profile 映射为 --test-profile。
4. 验证普通 xmake 不需要 Node；确认能够只 list/plan 而不执行 Adapter 的构建与部署。
5. 据实验锁定最低 Xmake 版本及首批宿主平台；未通过前阻断业务平台接入。

交付：可运行的最小 PoC、版本兼容矩阵、构建桥 ADR。

验收：XMK-01、XMK-02、XMK-03、PKG-02。

#### XT-003：验证产品构建复用与测试变体边界

状态：待实施。依赖：XT-001、XT-002。优先级：必需。

改动位置：`examples/xmake/poc/`、`测试用共享 rule/组件函数`。

实施内容：

1. 分别验证已存在 target、共享库依赖、共享源码构建定义三条路径。
2. 用私有宏、条件源码、生成头文件、include 可见性、Mock、main/启动文件和链接脚本构造反例。
3. 验证消费者私有宏不会被误当作能反向改变已编译依赖；需要重新编译时使用显式源码复用。
4. 验证当前配置与跨架构产物隔离；未支持的跨配置组合报错，不自动反复 xmake f。

交付：共享构建契约及其正反例；不支持项清单。

验收：BLD-01、BLD-02、BLD-03、BLD-07。

#### XT-004：冻结 Lua 声明、Manifest 与 Artifact Receipt v1

状态：待实施。依赖：XT-002、XT-003。优先级：必需。

改动位置：`新 Adapter Schema/契约文档`、`versions.json 的新增版本设计`、`examples/xmake/契约 fixture`。

实施内容：

1. 冻结 ctest.project/include/native/mcu/kernel/driver/workflow 的字段、路径基准、来源与类型判别。
2. 明确 target 是产物引用；测试源码构建与 Job 运行选择分离；Registry 使用 C 符号，run.suite 才可用 Pattern。
3. 定义 ArtifactRef、BuildContext、Receipt、module/export/options 和独立 schemaVersion；保持旧 planConfig 的展示职责。
4. 定义 Build ID、内容摘要、构建上下文身份三者的区别，明确错误分类和兼容升级规则。

交付：Schema 草案定版、成功/失败输入 fixture、ADR 集合。

验收：CFG-05、WF-01、BLD-05。

**阶段门禁：G0：最小 Xmake PoC 真实运行通过；锁与配置复用边界明确；Manifest v1 冻结。**

### P1 — Cautest 后端解耦

保留原引擎，把产物消费、选择器与构建提供方抽成可复用接口。

#### XT-005：抽出统一 Job 选择器

状态：待实施。依赖：XT-001。优先级：必需。

改动位置：`src/config/select.ts（新增）`、`src/runtime/cli.ts`、`test/selection.test.js（新增）`。

实施内容：

1. 把现有 ID glob/level/tag/enabled 筛选迁入无副作用模块。
2. 旧 JS CLI 先改用该模块并保持行为；新 Adapter 仅做参数规范化。
3. 保留 run.suite/case/parameter 覆盖逻辑，明确不同维度的 AND/OR。

交付：新旧前端共享 selector 与真值表测试。

验收：SEL-01、SEL-02、SEL-03。

#### XT-006：抽出可复用的 Artifact 与 Build Provider 契约

状态：待实施。依赖：XT-004。优先级：必需。

改动位置：`src/jobs/native.ts`、`src/jobs/mcu.ts`、`src/artifacts/ 或等效新模块`、`src/build/ 或等效新模块`。

实施内容：

1. 把 Native/MCU 内部 Artifact state 结构集中成可校验契约，不让 Adapter 手写私有 state key。
2. 支持 build/resolve 两阶段：调度器持 ArtifactRef，执行后获得 Receipt。
3. 规定 config/env 冲突、产物不存在/陈旧、protocolBuildId 缺失和输出角色错误的处理。

交付：公共产物契约、假 Provider 和失败注入测试。

验收：BLD-05、BLD-06、WF-02。

#### XT-007：拆出 Native/MCU 的构建与运行部分

状态：待实施。依赖：XT-006。优先级：必需。

改动位置：`src/jobs/native.ts`、`src/jobs/mcu.ts`、`src/config/schema/native.ts`、`src/config/schema/mcu.ts`、`test/native.test.js`、`test/mcu.test.js`。

实施内容：

1. 从现有 helper 抽出消费 Artifact 的 Runtime Steps，旧 helper 仍按旧配置构建并调用相同 Runtime。
2. 为新 Adapter 增加产物驱动的 factory/内部接口；不要假设旧 nativeCTestJob 已能接受单个 artifact 字段。
3. 保留 Node CTP、现有 Native 传输、Run 选择、日志与结果语义；MCU 复用现有 Board 接口。

交付：旧、新构建提供方共用的一组 Runtime Steps。

验收：WF-02、NAT-01、REG-02。

#### XT-008：实现 Manifest Loader 与 JS 扩展工厂

状态：待实施。依赖：XT-004、XT-005、XT-007。优先级：必需。

改动位置：`src/adapters/xmake/manifest.ts`、`src/adapters/xmake/load.ts`、`src/adapters/xmake/factories.ts`、`src/adapters/xmake/providers.ts`。

实施内容：

1. 严格验证 Manifest 版本与字段，用正规 testConfig/testJob/defineStep 重建工作流。
2. 支持命名 Board/Environment 与 module/export/options 引用；通用 workflow provider 返回现有 Step/Fragment，公共 Job 元数据保持来自 Lua；加载失败指向原始 Lua 文件。
3. 把 projectRoot、来源、配置摘要、CLI 运行覆盖传到原执行入口，不把生成目录误作项目根。
4. 构造阶段不执行烧写、启动设备、编译；不要反序列化旧 planConfig 或函数源码。

交付：固定 JS 入口、Loader、Provider 引用与确定性快照。

验收：WF-01、CFG-04、CFG-05、PKG-03。

**阶段门禁：G1：旧 JS 入口不退化；Manifest 可重建正规 Job；假 Provider 能覆盖失败路径。**

### P2 — Xmake 前端与分散收集

根 ctest.lua + 多 test.lua 可被收集、展示、选择与追溯。

#### XT-009：加入可 vendoring 的 Xmake 入口与 DSL 注册

状态：待实施。依赖：XT-002、XT-004。优先级：必需。

改动位置：`xmake.lua（新增）`、`adapters/xmake-test/xmake.lua`、`adapters/xmake-test/modules/`。

实施内容：

1. 根 xmake.lua 只注册 DSL、rule、task 与相对模块路径，不配置产品测试。
2. 实现 ctest.project 及按 kind 的声明收集；支持正常 Xmake target/rule 与局部测试声明并存。
3. 重复 includes 幂等，不覆盖已有任务；ct 名称冲突要明确报错或采用冻结后的命名策略。

交付：tools/cautest 引入即可注册能力的最小发行布局。

验收：XMK-01、CFG-01、PKG-02。

#### XT-010：实现分散定义收集与 provenance

状态：待实施。依赖：XT-009。优先级：必需。

改动位置：`adapters/xmake-test/modules/collector.lua`、`adapters/xmake-test/modules/registry.lua`、`test/xmake-collector/`。

实施内容：

1. 按明确 roots 展开 test.lua，稳定排序、规范化路径、全局去重、循环检测。
2. 路径相对声明文件解析，target 标识保持工程级；显式 optional 与必需 Pattern 分开。
3. 重复 Job ID 报两处来源；新增/删除 fragment 改变定义摘要，不能遗漏动态发现。
4. 记录原始文件、声明定位与 import/include 链，不依赖生成 .mjs 的行号排错。

交付：可扩展的扁平 Job Registry 与文件来源索引。

验收：CFG-01、CFG-02、CFG-03、CFG-04、SCL-01。

#### XT-011：实现 xmake ct 命令与 Manifest 导出

状态：待实施。依赖：XT-008、XT-010。优先级：必需。

改动位置：`adapters/xmake-test/tasks/`、`adapters/xmake-test/modules/manifest.lua`、`src/adapters/xmake/入口`、`test/xmake-cli/`。

实施内容：

1. 提供 run 默认动作与 --list/--plan/--doctor；规范化 level/tag、Job ID 和 Case 选择。
2. Manifest 原子写入受管目录，调用固定 Node 入口；--test-profile 不抢占 Xmake 参数。
3. 错误时保留原始诊断，传播可区分的退出结果；不要对硬件命令自动重试。
4. 普通 build 不启动 Node；list/plan 不构建、不烧写、不加载驱动。

交付：从 Lua 到 JS 正常展示 Job 与工作流的链路。

验收：XMK-03、SEL-01、SEL-03、WF-01、PKG-02。

**阶段门禁：G2：list/plan 正确且无 Adapter 执行动作；新增 fragment 自动进入 Registry。**

### P3 — Native 首个纵向闭环

实际完成 Lua → Manifest → Xmake 构建 → JS CTP → 报告，再补便捷构建复用。

#### XT-012：实现 Xmake Build Provider 与 Receipt 导出

状态：待实施。依赖：XT-003、XT-006、XT-011。优先级：必需。

改动位置：`src/build/xmake.ts 或等效模块`、`adapters/xmake-test/内部产物查询`、`adapters/xmake-test/rules/artifacts.lua`。

实施内容：

1. 按 P0 确认的锁安全路径在 build 相位调用 Xmake，使用 argv 数组与明确 cwd。
2. 解析实际 target 输出；为 ELF/BIN/.ko/Rootfs 等提供具名 output，不猜后缀。
3. 记录构建日志与 Receipt，校验文件、摘要和上下文；失败时生成 build_error 并禁止下游部署。
4. 将取消信号、进程树终止与 Job 超时贯通；不吞掉子进程失败。

交付：真实 Xmake 构建桥与可追踪产物。

验收：XMK-02、BLD-04、BLD-05、BLD-06、WF-03。

#### XT-013：实现 Native C Runtime、Registry 与入口规则

状态：待实施。依赖：XT-007、XT-009、XT-012。优先级：必需。

改动位置：`adapters/xmake-test/rules/native.lua`、`adapters/xmake-test/生成模块`、`assets/cautest-c/ 构建接入`。

实施内容：

1. 在测试 target 下加入正确平台的 C Runtime；配置敏感源码按当前测试上下文编译。
2. 按显式 suites 生成 Registry 和入口；不扫描 C 宏猜 Suite，不带入产品 main。
3. 在合适构建阶段生成并保存 protocolBuildId，再发布实际内容摘要；重复构建不产生无谓重编。
4. 跟踪测试文件集合、Suite 列表、生成依赖和 Cautest Runtime 版本。

交付：可由 Xmake 直接构建的 Native Cautest 测试程序。

验收：NAT-01、NAT-02、BLD-02、BLD-04、BLD-05。

#### XT-014：打通第一个 Native 完整示例

状态：待实施。依赖：XT-005、XT-008、XT-011、XT-012、XT-013。优先级：必需。

改动位置：`examples/xmake/native/`、`test/xmake-native.test.js`、`docs/usage/xmake-test-native.md`。

实施内容：

1. 用根 ctest.lua 收集至少两个模块的 test.lua；每个 Job 含多个文件/Suite/Case。
2. 验证 level/tag/ID/Case 选择、真实构建与 CTP 运行、JSON/JUnit、失败日志和退出状态。
3. 证明确实先选 Job 再构建，未选 Job 的构建工具/硬件不会被触发。
4. 建立与旧 JS 入口相同测试目标的语义对比。

交付：首个可用 Native 增量及可复现运行记录。

验收：NAT-01、NAT-02、SEL-03、REG-02。

#### XT-015：补齐共享构建定义的便捷接入

状态：待实施。依赖：XT-003、XT-013、XT-014。优先级：必需。

改动位置：`examples/xmake/shared-component/`、`adapters/xmake-test/可选薄 target helper`、`docs/usage/xmake-test-build-reuse.md`。

实施内容：

1. 先给出标准 Xmake rule/函数共享模式，消除产品与测试源码列表及宏的重复维护。
2. 仅在已验证边界内提供 helper，输入只描述复用定义、测试源与 Registry；额外编译选项仍用标准 Xmake API。
3. 为依赖最终 app 宏的 C 源码、Mock 替换与生成头文件提供正反例。
4. 不支持的 arbitrary target clone 应明确报错，不能通过复制字段伪装支持。

交付：两种以上可复用项目模板与清晰的不支持边界。

验收：BLD-01、BLD-02、BLD-03。

**阶段门禁：G3：两个以上模块、多 Suite/Case 的 Native 示例真实运行；错误和选择均正确。**

### P4 — 可靠性、规模与兼容

把去重、陈旧产物、环境隔离、大规模和失败语义补齐，避免只跑通 happy path。

#### XT-016：实现构建去重、陈旧检测与上下文隔离

状态：待实施。依赖：XT-012、XT-014。优先级：必需。

改动位置：`Build Provider 会话缓存`、`Artifact Receipt 校验`、`test/xmake-build.test.js`。

实施内容：

1. 同次 run 相同 target/context/构建 env 去重，运行选择不同不重复编译。
2. 更改源码、头文件、宏、Suite 列表、生成器后触发正确增量；不自行重复建立 Native 编译缓存。
3. 删除/损坏 Receipt 或产物时重建或明确失败，不执行旧文件。
4. 相同输出上的不同 env/架构请求拒绝或使用显式隔离变体；构建失败的共享 target 正确归属所有受影响 Job。

交付：可靠的多 Job 共享产物机制。

验收：BLD-04、BLD-05、BLD-06、BLD-07。

#### XT-017：验证结果、失败与旧入口兼容

状态：待实施。依赖：XT-014。优先级：必需。

改动位置：`test/xmake-parity.test.js`、`test/reporters.test.js`、`src/result/run.ts（仅必要调整）`、`docs/usage/results.md`。

实施内容：

1. 对比 PASS/FAIL/ERROR/SKIP、allowEmpty、stopOnTestFailure、超时、Step 失败及 LIFO Cleanup。
2. 验证每 Job 的 build/provision/run/collect 结果与来源，不能把构建 ERROR 映射为断言 FAIL。
3. 共用 Reporter，不在 Lua 再实现一份 JUnit；新增字段遵循版本规则。

交付：新旧行为差异清单为零或有明确兼容说明。

验收：WF-02、WF-03、WF-04、REG-01、REG-02。

#### XT-018：验证大量分散测试与工程隔离

状态：待实施。依赖：XT-010、XT-015、XT-016、XT-017。优先级：必需。

改动位置：`test/xmake-scale/`、`examples/xmake/multi-config/`、`兼容矩阵文档`。

实施内容：

1. 生成 100/1000 Job 与大量 Case fixture，验证不要求根文件逐条登记。
2. 测试顺序确定、重复 Pattern、fragment 增删、特殊字符路径、不同 cwd、受管目录清理范围。
3. 记录发现/筛选耗时和内存，不按 Case 数生成相同数量的 target/进程；检测明显二次复杂度。
4. 冻结首批支持的 host/config 组合；无法隔离的多架构输入明确报错。

交付：规模与工程隔离测试报告。

验收：SCL-01、SCL-02、CFG-03、CFG-04、BLD-07、PKG-01。

**阶段门禁：G4：增量/隔离/旧入口回归及规模门禁通过，形成可依赖的 Native 增量。**

### P5 — MCU 编码阶段与真实硬件测试

接入固件、Board、独占、烧写、复位、协议身份与清理，包含真实 SPI 验收。

#### XT-019：接入 MCU Firmware Artifact 与协议身份

状态：待实施。依赖：XT-007、XT-012、XT-016。优先级：必需。

改动位置：`src/adapters/xmake/MCU factory`、`src/jobs/mcu.ts`、`adapters/xmake-test/firmware 产物规则`。

实施内容：

1. 实现 ctest.mcu 的 firmware target/output 到既有运行流程的映射。
2. 区分 ELF/BIN/HEX 与 metadata，明确协议 Build ID 的生成/传递；不把 file hash 冒充 HELLO ID。
3. 验证同固件多个 Job 的 Suite 默认选择和独立运行生命周期。

交付：能接受 Xmake 固件并严格验证身份的 MCU 路径。

验收：MCU-01、BLD-05、BLD-06。

#### XT-020：接入外部 Board、独占资源与失败清理

状态：待实施。依赖：XT-008、XT-019。优先级：必需。

改动位置：`src/adapters/xmake/providers.ts`、`MCU Board Provider/lease 模块`、`test/xmake-mcu.test.js`。

实施内容：

1. 实现 module/export/options 引用，序列化部分不含函数或密钥。
2. 对物理 probe/板卡身份进行跨进程锁；不同逻辑名称指向同设备时仍互斥。
3. 在可能失败的准备动作之前登记必要 cleanup；验证 owned/borrowed、flash/reset 异常、串口打开失败与中断。
4. 不自动实现跨 Job 共用烧写/会话；保持显式隔离。

交付：真实 Board 可安全接入的执行契约。

验收：MCU-02、MCU-03、WF-03、PKG-03。

#### XT-021：完成 MCU 模拟与真实 SPI 验收

状态：待实施。依赖：XT-019、XT-020。优先级：必需。

改动位置：`examples/xmake/mcu-sim/`、`examples/xmake/mcu-board/`、`项目提供的真实 Board Adapter`、`硬件验收记录`。

实施内容：

1. 先跑 Host Simulation、错误 Build/Boot ID、分片/断线、超时与假 Board 失败注入。
2. 在指定真实板上构建/烧写测试固件，执行 SPI 正常收发或外设识别用例，并验证已知错误条件会失败。
3. 记录板卡、连接、固件摘要、工具版本、命令、结果与清理；未具备设备时标记受阻，不算 MCU 实板支持完成。

交付：MCU 仿真通过记录与单独的实板证据。

验收：MCU-01、MCU-02、MCU-03、MCU-04。

**阶段门禁：G5：模拟契约与真实 SPI 分别有证据；实板缺失则明确受阻。**

### P6 — Kernel 与 Linux Driver

保留 Kernel 内部测试与 Driver ABI 两条路线，复用真实 UML 并统一产品 Driver 构建来源。

#### XT-022：接入 Kbuild 产品 target 与多产物契约

状态：待实施。依赖：XT-012、XT-016。优先级：必需。

改动位置：`adapters/xmake-test/Kbuild 对接示例`、`src/kernel/module-build.ts（只提取必要能力）`、`src/adapters/xmake/Driver artifact provider`。

实施内容：

1. 以 Xmake target 包装/引用产品 Driver 原有 Kbuild，统一驱动源码、宏和 Kernel 上下文来源。
2. 导出 .ko、Kernel 身份、Module.symvers 等必要数据，验证实际路径及兼容性。
3. 明确 JS 过渡性 Kernel/BusyBox/Rootfs build Step 的单一 Environment 来源，不复制产品 Driver 构建模型。

交付：Driver/Kernel 可消费的多角色 Artifact 及过渡边界文档。

验收：DRV-01、DRV-02、BLD-05。

#### XT-023：分别接入 Kernel Test 与 Driver ABI 工作流

状态：待实施。依赖：XT-008、XT-022。优先级：必需。

改动位置：`src/jobs/kernel.ts`、`src/jobs/driver.ts`、`src/adapters/xmake/factories.ts`、`examples/xmake/kernel/`、`examples/xmake/driver/`。

实施内容：

1. Kernel Test 复用内部测试模块路线；Driver ABI 复用真实 Driver + Guest C Test 路线。
2. 抽出消费外部 Artifact 的步骤，保留 Rootfs、UML、CTP、日志与原生命周期。
3. Guest target 引用和 Driver target 引用分开；不能执行 .ko，也不能把 Driver target 当作唯一输入。
4. 保留真实 host/SSH 模式为显式后续 Provider，不假定已有。

交付：两类完整 Job 的可展示与可执行工作流。

验收：DRV-01、DRV-02、WF-02、REG-02。

#### XT-024：完成真实 UML 与 Driver ABI 验收

状态：待实施。依赖：XT-023。优先级：必需。

改动位置：`test/integration/ 新 Xmake 入口`、`examples/xmake/kernel/`、`examples/xmake/driver/`、`真实 UML 验收记录`。

实施内容：

1. 在明确 KERNEL_SRC/BUSYBOX_SRC 前提下执行真实 Kernel Test Module 和 Driver Guest ABI 测试。
2. 验证接口 read/write/ioctl 成功及无效输入失败、Guest/模块出错、启动超时与 cleanup。
3. 验证源码树不被污染、模块/Kernel 身份匹配、产物缓存损坏不能假命中。
4. 保留环境缺失的未执行/受阻状态；不能以 Fake Make 或只有 plan 快照替代实跑。

交付：Kernel 与 Driver UML 的独立真实运行报告。

验收：DRV-02、DRV-03、DRV-04。

**阶段门禁：G6：真实 Kernel Test Module 与 Driver Guest ABI 闭环均完成。**

### P7 — 分发、文档与总验收

完成 tools/cautest 接入、版本与发行内容、回归和支持矩阵。

#### XT-025：完善发布包、vendoring 与离线消费

状态：待实施。依赖：XT-018、XT-021、XT-024。优先级：必需。

改动位置：`package.json files`、`src/portable.ts`、`src/archive.ts`、`新 root xmake.lua`、`发布包验证测试`。

实施内容：

1. 确保源码仓库与便携包都包含根 xmake.lua、Lua Adapter、dist Bridge、C Runtime 及必要资源。
2. 从 tools/cautest 固定版本接入；消费项目无需建立 pnpm 工作区，但明确 Node 与第三方依赖前提。
3. 检查 JS module 解析根与文件 URL、特殊路径、缺少 Node/未构建 dist 的诊断。
4. 不自动联网安装工具；可选第三方原生模块按平台验证，不承诺一文件 bundle 无条件解决。

交付：从解压目录可接入的发行候选包及内容清单。

验收：PKG-01、PKG-02、PKG-03、PKG-04。

#### XT-026：同步文档、版本与 CI 验收入口

状态：待实施。依赖：XT-018、XT-021、XT-024、XT-025。优先级：必需。

改动位置：`versions.json`、`scripts/sync-versions.mjs`、`docs/index.md`、`docs/usage/`、`docs/tests/testing.md`、`test/docs.test.js`、`新增 CI 测试入口`。

实施内容：

1. 更新新旧入口对比、最小项目、分散收集、level/tag、构建复用、MCU/Driver、错误诊断与支持矩阵。
2. 为 Manifest/Receipt 引入独立版本规则；只升级实际变更的 schema/ABI，不能默认更改 CTP。
3. 配置默认离线/无硬件门禁与显式真实环境门禁，输出受阻原因和证据路径。
4. 所有示例区分已实现 API 与未来设想，删除未兑现的自动继承/自动扫描承诺。

交付：完整维护文档、版本检查与自动门禁。

验收：REG-01、REG-02、PKG-04、DOC-01。

#### XT-027：执行发布候选总验收与兼容复核

状态：待实施。依赖：XT-026。优先级：必需。

改动位置：`验收证据目录`、`支持矩阵`、`迁移说明与 changelog`。

实施内容：

1. 按 ACCEPTANCE 的矩阵重新执行全部必需门禁，归档命令、版本、结果与环境。
2. Native、MCU 实板、Kernel/Driver UML 分别列状态；任何必需项受阻都不能标成全部平台完成。
3. 验证旧 standalone/JS 配置路径仍可用，新增方案没有引入第二个执行器或产品构建事实来源。
4. 更新版本与发布记录，但不自动 push、打远程 tag 或发布；这些是独立授权操作。

交付：可审阅的候选版本及完整验收包。

验收：REG-01、REG-02、MCU-04、DRV-04、DOC-01。

**阶段门禁：G7：声明支持的每个平台有对应证据，旧 standalone 入口仍可用。**

### Later — 首版以外的可选工作

只在需求或规模证明必要后实施。

#### XT-028：按实际重复量增加 namespace/preset 语法

状态：待实施。依赖：XT-018。优先级：可选，首版外。

改动位置：`可选 ctest namespace/preset helper`。

实施内容：

1. 先观察真实项目的重复量，再复用旧 factory/default 语义增加语法糖。
2. 最终仍生成扁平 Job，不新增执行层级，不改变 tags 合并规则。

交付：可选简化语法及兼容测试。

验收：CFG-05、SEL-01。

#### XT-029：显式共享硬件会话与受控并发

状态：待实施。依赖：XT-021、XT-024。优先级：可选，首版外。

改动位置：`Resource 调度与会话复用模块`。

实施内容：

1. 只有需求明确后才共享一次烧写/启动；显式声明隔离边界和失效条件。
2. 跨进程资源锁、失败传播、状态复位与重试幂等性先于并发优化。

交付：可选性能能力；不属于首版完成条件。

验收：MCU-02、WF-03。

#### XT-030：扩展真实宿主 Driver 或 Case 级标签

状态：待实施。依赖：XT-027。优先级：可选，首版外。

改动位置：`独立 Provider 或 CTP 演进方案`。

实施内容：

1. 真实 host/SSH Driver 单独做权限、部署与恢复设计。
2. Case tag 只有在 Job/Suite 选择不足时再提出；需要单独评估 C API、发现、协议与报告版本，不能作为当前计划的隐含工作。

交付：独立提案，不默认纳入当前适配层。

验收：DRV-04、REG-02。

**阶段门禁：不阻断首版，也不能提前塞进基础 Schema。**

## 5. 跨任务约束与决策记录

| ADR | 决策 | 必须在何处验证 |
|---|---|---|
| ADR-01 | 单 JS Workflow Engine，不增加 Lua executor | XT-007、XT-008 |
| ADR-02 | 根入口 + 分散 fragment，最终仍为扁平 Job | XT-004、XT-010 |
| ADR-03 | target 是明确产物引用，源码复用不是任意 target 克隆 | XT-003、XT-015 |
| ADR-04 | 新 Manifest 与旧 display plan 不混用 | XT-004、XT-008 |
| ADR-05 | 首选 JS build Step 调 Xmake；外层不持构建锁 | XT-002；未通过则阻断并修订 ADR |
| ADR-06 | 构建产物共享不等于硬件会话共享 | XT-016、XT-019、XT-020 |
| ADR-07 | 新 Adapter 使用 --test-profile，避免 Xmake 公共选项冲突 | XT-002、XT-011 |
| ADR-08 | level/tag 继续只在 Job 上；Case 标签不属于当前范围 | XT-001、XT-005 |
| ADR-09 | 旧 standalone/JS 入口不删除，新增能力采用增量接入 | XT-007、XT-017、XT-027 |
| ADR-10 | 物理 MCU 与真实 UML 分别验收，模拟不能代替真实环境 | XT-021、XT-024 |

P0 如发现建议 API 在目标 Xmake 版本下不可可靠实现，要先修订方案与契约 fixture，再继续编码；不允许边实现边增加隐式全局变量或私有字段依赖来掩盖问题。

## 6. 每个任务的完成定义

实现者应交付代码差异、对应验收项的命令与日志、文档变更、兼容性说明、剩余限制。测试必须说明使用的源码/发行构建、工具版本与环境。与物理环境有关的任务必须留存板卡/Kernel/工具信息。

任务状态统一为 `todo / doing / blocked / done`。`blocked` 必须注明缺失环境或依赖；没有运行的验收不记 PASS。允许先交付已有平台，但支持矩阵不得提前勾选其他平台。

合并前运行受影响的旧测试。阶段门禁运行完整所需门禁，不能一直拿本次 20 项抽查结果替代正式回归。

## 7. 回退与变更控制

先保留旧 JS 配置入口，新的 Xmake 路径用独立 Adapter 入口启用。后端解耦每一步都保持旧 helper 可调用；出现行为退化先回退该小步改动，不要求用户迁移回另一套新 DSL。

Manifest 版本变更由 `versions.json` 管理，Reader 对未知版本明确报错。禁止通过忽略未知字段或删除失效 Receipt 检查“兼容”旧数据。已经发布的新语法若需变化，应提供清楚迁移说明，不能将当前草案在未实现前标为稳定 API。

## 8. 建议首先执行的任务批次

第一批只做 XT-001～XT-004，以及可并行的 XT-005。产出应是：真实可运行的 Xmake task/锁 PoC、产品与测试构建复用的正反例、Manifest v1 和兼容选择器测试。

这一批完成后，再开始 XT-006～XT-014 的 Native 闭环。不要在基础边界尚未验证时，同时重构 MCU 烧写、Driver UML 和发布安装流程。
