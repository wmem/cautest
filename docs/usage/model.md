# 测试组织模型

Cautest 使用同一套结构描述 Native、Kernel、Driver、MCU 和系统测试。理解这几层边界后，可以只进入当前需要的场景教程，不必阅读执行器源码。

```text
TestConfig
├── defaults / profiles
└── TestJob[]
    └── Workflow Step[]
        └── Test Result
            └── Suite/Group → Case → Assertion/Diagnostic
```

## TestConfig 是项目入口

项目根目录的 `cautest.config.mjs` Default Export 必须由 `testConfig()` 创建：

```js
export default testConfig({
  defaults: { resultDir: ".cautest/results" },
  profiles: [{ id: "ci", reporters: ["json", "junit"] }],
  jobs,
});
```

`defaults` 只保存项目级受管目录和通用 Job/Step 超时。`profiles` 在运行时追加环境变量和 Reporter，不创建 Job，也不改变 Workflow 结构。

## Job 是隔离和选择边界

每个 Job 都有稳定 `id`、`level`、`tags`、`enabled`、超时、环境变量、失败策略和线性 Workflow。CLI 按 ID/Glob、Level 或 Tag 选择 Job；缓存、结果和 Job 超时也以 Job 为边界。

Level 固定为：

| Level | 含义 |
| --- | --- |
| `unit` | 单个模块或内部逻辑，外部依赖最少 |
| `component` | 多份产品源码组成的组件或子系统 |
| `integration` | Driver ABI、外部接口或多个组件协作 |
| `system` | 从进程或系统外部验证完整行为 |

一个 Job 可以包含多个测试源码、产品源码和 Suite。何时合并或拆分见[组织典型项目](project-organization.md)。

## Workflow 是严格有序的执行计划

所有标准 Job 最终都会展开为普通 Step，Phase 顺序固定为：

```text
prepare → build → provision → run → collect
```

`plan` 用于在执行前查看实际 Step。普通 Step 失败后不再启动后续普通 Step；`runWhen: "always"` 或 `"on-failure"` 的 Collect Step仍可运行，已登记的 Cleanup 按 LIFO 顺序执行。

只有多个能力确实需要共享一次生命周期、状态和失败传播时，才使用 `composeJobWorkflows()` 或 `standardJobFragment()`。多个独立 Job 不需要组合 Workflow。

## Suite 和 Case 是测试结果边界

C Test 源文件用 `CAUTEST_CASE`/`CAUTEST_PARAM_CASE` 声明 Case，用 `CAUTEST_SUITE` 组合 Case。Native、Kernel Test Module 和 Driver Guest Job 根据配置的 `suites` 生成 Registry；MCU/Freestanding 通常由 Firmware 显式声明 Registry。

CLI 可以按 Suite、Case 和 Parameter 覆盖标准 C Test Run 的选择，但不会改变 Job 的构建输入。Script System Test 使用 `defineScriptTest()` 声明 JavaScript Case，并产生相同的结构化 PASS、FAIL、SKIP、ERROR 结果。

## 每种测试使用什么构造函数

| 场景 | Job 和辅助入口 | 说明 |
| --- | --- | --- |
| Native C | `nativeCTestJob()`、`nativeCTestJobFactory()` | 本机编译和运行一个或多个 C 测试源码 |
| Kernel UML | `umlKernelEnvironment()`、`kernelCTestJob()`、`kernelCTestJobFactory()` | 复用 Kernel/BusyBox 环境，生成 Kernel Test Module |
| Driver Unit | Kernel UML 上述入口 | 产品源码与测试一起编入 Test Module，不加载真实 Driver ABI |
| Driver ABI | `driverAbiCTestJob()`、`driverAbiCTestJobFactory()` | 构建真实 Driver、可选 Probe 和 Guest C Test |
| MCU | `mcuCTestJob()` | 使用已有、命令构建或 Host 模拟 Firmware，通过 Board Adapter 运行 |
| System Script | `scriptSystemTestJob()`、`defineScriptTest()` | 用 JavaScript Case 验证服务、CLI 或外部系统行为 |
| 自定义 Workflow | `testJob()`、`defineStep()`、`defineFragment()` | 标准 Job 无法表达时才进入低级 Workflow |

所有场景都可以配合 `withJobDefaults()` 和 `jobNamespace()` 批量生成普通 Job。System Workflow 还提供 `processStart()`、`processAttach()`、`execStep()`、`externalTest()`、`collectLogs()` 等标准 Step。

## 配置、运行与结果的关系

根配置加载后先规范化公共默认项，再由 Job Factory 生成普通 Job。`list` 查看最终 Job 元数据，`plan` 查看 Workflow，`doctor` 对所选 Job 的实际输入和宿主工具做静态诊断，`run` 才启动执行器。

每次运行形成独立 Result，包含 Job、Step、Suite/Case、事件、诊断和 Artifact。标准文件和 Reporter 见[结果目录与 Reporter](results.md)。命令选择和退出状态见 [cautest.js 命令参考](cli.md)。

精确函数签名、Interface 名称和声明文件位置见[配置 API 索引](config-reference.md)。
