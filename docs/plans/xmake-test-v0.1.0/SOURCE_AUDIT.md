# 源码核查记录

日期：2026-09-22。基线：用户上传的 `cautest.tar.gz`。本记录不是对上一轮文字描述的复述，而是对解包后的文件逐段核查。
归档 SHA-256：`bb03d5b417aca9b887ff1b21067640ba81af8d57fc5bc27fe84d3b50b254d35e`。
## 核查与测试范围

只读审查 `src/`、`assets/`、`docs/` 和版本/发行配置。运行下列 5 个已有 Node 测试文件，共 **20 项通过、0 项失败**：

```sh
node --test test/config.test.js test/factory.test.js test/glob.test.js test/schema.test.js test/workflow.test.js
```

运行使用包内既有 `dist/`，Node 为 `v22.16.0`；没有重新执行 TypeScript 构建，也没有完整执行 `pnpm test`。当前工作环境未发现 `xmake` 可执行文件，因此没有执行新 DSL、Xmake 锁/任务生命周期、Native Xmake 闭环或硬件验收。原始结果在 `evidence/baseline-subset.tap`。这些限制不能记为新 Adapter 已通过。

## 核查索引

| 编号 | 内容 | 基线位置 |
|---|---|---|
| B01 | 版本与发布约束 | `versions.json:1-29` |
| B02 | Job 公共元数据 | `src/config/schema/common.ts:52-82` |
| B03 | Job 与根配置的实际类型 | `src/config/schema/common.ts:290-369` |
| B04 | Job 筛选的实际布尔关系 | `src/runtime/cli.ts:226-234` |
| B05 | 运行选择与构建登记不同 | `src/config/schema/common.ts:84-125` |
| B06 | 旧 plan 是展示格式 | `src/config/plan.ts:1-60` |
| B07 | 执行函数保存在 Symbol 字段 | `src/workflow/step.ts:5-14` |
| B08 | Step 需要用构造函数重建 | `src/workflow/step.ts:23-79` |
| B09 | Native 输入还包含构建模型 | `src/config/schema/native.ts:52-89` |
| B10 | Native Registry 和入口生成 | `src/jobs/native.ts:106-112` |
| B11 | Native 默认元数据 | `src/jobs/native.ts:264-276` |
| B12 | MCU 现有输入与 Board 契约 | `src/config/schema/mcu.ts:12-80` |
| B13 | MCU 身份与固件指纹 | `src/jobs/mcu.ts:32-77` |
| B14 | MCU 资源准备与清理时序 | `src/jobs/mcu.ts:86-102` |
| B15 | Driver 不是单个可执行目标 | `src/config/schema/driver.ts:55-71` |
| B16 | 分散组织已经存在 | `docs/usage/project-organization.md:1-117` |
| B17 | 默认值合并语义 | `src/config/define.ts:107-124` |
| B18 | CLI Case 选择覆盖 | `src/protocol/workflow-session.ts:11-17` |
| B19 | 真实环境门禁 | `docs/tests/testing.md:1-43` |
| B20 | 发行内容与 Node 基线 | `package.json:1-39` |

## B01 — 版本与发布约束

上传基线为 0.2.1；CTP 为 3.1。适配层使用独立 Manifest 版本，不因新增 Xmake 前端而默认修改 C API/CTP。

来源：`versions.json:1-29`。

```text
   1 | {
   2 |   "release": "0.2.1",
   3 |   "cApi": { "major": 2, "minor": 1 },
   4 |   "ctp": { "major": 3, "minor": 1 },
   5 |   "kernelAbi": { "major": 3, "minor": 0, "magic": "0xca7e57U" },
   6 |   "probeAbi": { "major": 1, "minor": 0, "magic": "0xca7e50U" },
   7 |   "schemas": {
   8 |     "config": 2,
   9 |     "result": 1,
  10 |     "event": 1,
  11 |     "cli": 1,
  12 |     "buildInfo": 1,
  13 |     "portableManifest": 1,
  14 |     "cacheManifest": 1,
  15 |     "fingerprint": 1
  16 |   },
  17 |   "caches": {
  18 |     "nativeFingerprint": 1,
  19 |     "nativeManifest": 2,
  20 |     "kernelFingerprint": 3,
  21 |     "busyboxFingerprint": 2,
  22 |     "mcuFingerprint": 1,
  23 |     "moduleFingerprint": 2,
  24 |     "moduleManifest": 4,
  25 |     "agentFingerprint": 1,
  26 |     "guestFingerprint": 2,
  27 |     "rootfsFingerprint": 3
  28 |   }
  29 | }
```

## B02 — Job 公共元数据

level、tags、enabled、timeoutMs、env、policy 属于 Job，不属于单个 C Case。

来源：`src/config/schema/common.ts:52-82`。

```text
  52 | export interface TestJobCommonInput {
  53 |   /**
  54 |    * 全局唯一 Job ID，也是 `list`、`plan`、`run` 使用的稳定标识。
  55 |    *
  56 |    * 层级通过点表达，不通过嵌套对象表达。
  57 |    *
  58 |    * @example "unit.utils.cm_queue"
  59 |    */
  60 |   readonly id: string;
  61 | 
  62 |   /** 测试层级；各 Job 构造函数可以提供自己的默认值。 */
  63 |   readonly level?: TestLevel;
  64 | 
  65 |   /** 面向使用者的用途说明。 */
  66 |   readonly description?: string;
  67 | 
  68 |   /** 用于 `--tag` 过滤的标签。 */
  69 |   readonly tags?: readonly string[];
  70 | 
  71 |   /** 是否参与执行。@defaultValue true */
  72 |   readonly enabled?: boolean;
  73 | 
  74 |   /** 整个 Job 的超时，单位毫秒，必须为正数。 */
  75 |   readonly timeoutMs?: number;
  76 | 
  77 |   /** 注入到本 Job 所有 Step 的环境变量。 */
  78 |   readonly env?: EnvironmentVariables;
  79 | 
  80 |   /** Job 执行和空结果策略。 */
  81 |   readonly policy?: TestJobPolicyInput;
  82 | }
```

## B03 — Job 与根配置的实际类型

TestJob 持有线性 workflow；TestConfig 持有扁平 jobs。profiles 是数组，不能把先前讨论中的字典示意直接当作旧 API。

来源：`src/config/schema/common.ts:290-369`。

```text
 290 | declare const TEST_JOB_TYPE: unique symbol;
 291 | 
 292 | /**
 293 |  * 已完成校验并可展开为线性 Workflow 的 Test Job。
 294 |  *
 295 |  * 该类型只能由 `testJob()` 或标准 Job 构造函数创建，不能手写对象冒充。
 296 |  */
 297 | export interface TestJob {
 298 |   readonly [TEST_JOB_TYPE]: true;
 299 |   readonly id: string;
 300 |   readonly level: TestLevel;
 301 |   readonly description: string;
 302 |   readonly tags: readonly string[];
 303 |   readonly enabled: boolean;
 304 |   readonly timeoutMs?: number;
 305 |   readonly env: EnvironmentVariables;
 306 |   readonly policy: Readonly<Required<TestJobPolicyInput>>;
 307 |   readonly workflow: readonly WorkflowStep[];
 308 | }
 309 | 
 310 | /** 通用 `testJob()` 的参数 Schema。 */
 311 | export interface TestJobInput extends TestJobCommonInput {
 312 |   readonly level: TestLevel;
 313 |   readonly workflow: readonly WorkflowInput[];
 314 | }
 315 | 
 316 | /** Profile 的 Reporter 和环境变量覆盖。 */
 317 | export interface TestProfileInput {
 318 |   /** Profile 的稳定 ID。 */
 319 |   readonly id: string;
 320 | 
 321 |   /** Reporter 名称。 */
 322 |   readonly reporters?: readonly string[];
 323 | 
 324 |   /** 运行该 Profile 时注入的环境变量；覆盖 Job 同名值，并进入标准构建/运行进程和构建指纹。 */
 325 |   readonly env?: EnvironmentVariables;
 326 | }
 327 | 
 328 | /** 项目级默认目录和超时。 */
 329 | export interface TestConfigDefaultsInput {
 330 |   readonly resultDir?: DirectoryPath;
 331 |   readonly cacheDir?: DirectoryPath;
 332 |   readonly generatedDir?: DirectoryPath;
 333 |   readonly workDir?: DirectoryPath;
 334 |   readonly stepTimeoutMs?: number;
 335 |   readonly jobTimeoutMs?: number;
 336 | }
 337 | 
 338 | /** Cautest 填充目录和 Step 默认值后的项目配置默认项。 */
 339 | export interface ResolvedTestConfigDefaults {
 340 |   readonly resultDir: DirectoryPath;
 341 |   readonly cacheDir: DirectoryPath;
 342 |   readonly generatedDir: DirectoryPath;
 343 |   readonly workDir: DirectoryPath;
 344 |   readonly stepTimeoutMs: number;
 345 |   readonly jobTimeoutMs?: number;
 346 | }
 347 | 
 348 | /** `testConfig()` 的唯一根参数 Schema。 */
 349 | export interface TestConfigInput {
 350 |   /**
 351 |    * 最终 Job 列表。每个元素只能是 `TestJob`；配置片段必须先生成列表，再使用
 352 |    * JavaScript 展开运算符（`...`）合并。
 353 |    */
 354 |   readonly jobs: readonly TestJob[];
 355 | 
 356 |   readonly defaults?: TestConfigDefaultsInput;
 357 |   readonly profiles?: readonly TestProfileInput[];
 358 | }
 359 | 
 360 | declare const TEST_CONFIG_TYPE: unique symbol;
 361 | 
 362 | /** 经过 `testConfig()` 校验和归一化的项目配置。 */
 363 | export interface TestConfig {
 364 |   readonly [TEST_CONFIG_TYPE]: true;
 365 |   readonly jobs: readonly TestJob[];
 366 |   readonly defaults: Readonly<ResolvedTestConfigDefaults>;
 367 |   readonly profiles: readonly Readonly<Required<TestProfileInput>>[];
 368 | }
 369 | 
```

## B04 — Job 筛选的实际布尔关系

ID/Glob 多选为 OR；level 多选为 OR；多个 tag 为 AND；不同维度之间为 AND。仅 run 排除 enabled=false。

来源：`src/runtime/cli.ts:226-234`。

```text
 226 | function selectedJobs(jobs: readonly TestJob[], parsed: ParsedArguments): readonly TestJob[] {
 227 |   for (const level of parsed.levels) if (!["unit", "component", "integration", "system"].includes(level)) throw new CautestError(`--level 无效: ${level}`, { code: "config_error" });
 228 |   const matchers = parsed.selectors.map((selector) => globMatcher(selector));
 229 |   return jobs.filter((job) => (parsed.command !== "run" || job.enabled) && (matchers.length === 0 || matchers.some((match) => match(job.id))) && (parsed.levels.length === 0 || parsed.levels.includes(job.level)) && parsed.tags.every((tag) => job.tags.includes(tag)));
 230 | }
 231 | 
 232 | function hasExplicitJobSelection(parsed: ParsedArguments): boolean {
 233 |   return parsed.selectors.length > 0 || parsed.levels.length > 0 || parsed.tags.length > 0;
 234 | }
```

## B05 — 运行选择与构建登记不同

运行字段为 run.suite / case / parameter / include / exclude；需要与生成 Registry 所用的 suites 区分。

来源：`src/config/schema/common.ts:84-125`。

```text
  84 | /** C Test 的 Suite/Case 选择参数。 */
  85 | export interface CTestSelectionInput {
  86 |   /** 默认包含的 `suite/case` Pattern。 */
  87 |   readonly include?: readonly string[];
  88 | 
  89 |   /** 从默认集合排除的 `suite/case` Pattern。 */
  90 |   readonly exclude?: readonly string[];
  91 | 
  92 |   /** 发现阶段只保留指定 Suite。 */
  93 |   readonly suite?: string | readonly string[];
  94 | 
  95 |   /** 发现阶段只保留指定 Case。 */
  96 |   readonly case?: string | readonly string[];
  97 | 
  98 |   /** 发现阶段只保留指定参数化 Case 参数。 */
  99 |   readonly parameter?: string | readonly string[];
 100 | }
 101 | 
 102 | /** C Test Session 的超时参数。 */
 103 | export interface CTestTimeoutInput {
 104 |   /** 单个 Case 超时，单位毫秒。 */
 105 |   readonly caseTimeoutMs?: number;
 106 | 
 107 |   /** 整次 C Test Run 超时，单位毫秒。 */
 108 |   readonly runTimeoutMs?: number;
 109 | 
 110 |   /** 建连、握手、发现、关闭等 Session 阶段超时。 */
 111 |   readonly session?: Readonly<Partial<Record<
 112 |     "connect" | "handshake" | "discovery" | "run" | "drain" | "close",
 113 |     number
 114 |   >>>;
 115 | }
 116 | 
 117 | /** C Test 的运行参数。 */
 118 | export interface CTestRunInput extends CTestSelectionInput, CTestTimeoutInput {
 119 |   /** Suite 内的停止策略。@defaultValue "CONTINUE" */
 120 |   readonly suitePolicy?: SuitePolicy;
 121 | 
 122 |   /** 约束 Target 在 HELLO 中报告的 Build ID。 */
 123 |   readonly expectedBuildId?: string;
 124 | 
 125 |   /** 整个 Run Step 超时，单位毫秒。 */
```

## B06 — 旧 plan 是展示格式

PlannedStep 只有描述数据；planConfig 的输出不是可反序列化后直接执行的 Workflow。

来源：`src/config/plan.ts:1-60`。

```text
   1 | import type { TestConfig, TestJob, TestJobOrigin, WorkflowStep } from "./schema/common.js";
   2 | import { CautestError } from "../model/error.js";
   3 | import { getJobOrigin } from "./provenance.js";
   4 | 
   5 | export interface PlannedStep {
   6 |   readonly id: string;
   7 |   readonly index: number;
   8 |   readonly kind: string;
   9 |   readonly name: string;
  10 |   readonly phase: WorkflowStep["phase"];
  11 |   readonly runWhen: WorkflowStep["runWhen"];
  12 |   readonly timeoutMs?: number;
  13 |   readonly details: Readonly<Record<string, unknown>>;
  14 | }
  15 | 
  16 | export interface PlannedJob {
  17 |   readonly id: string;
  18 |   readonly level: TestJob["level"];
  19 |   readonly description: string;
  20 |   readonly tags: readonly string[];
  21 |   readonly enabled: boolean;
  22 |   readonly origin?: TestJobOrigin;
  23 |   readonly workflow: readonly PlannedStep[];
  24 | }
  25 | 
  26 | function plannedStep(step: WorkflowStep, index: number): PlannedStep {
  27 |   const position = String(index + 1).padStart(2, "0");
  28 |   return Object.freeze({
  29 |     id: `${position}-${step.phase}-${step.kind}-${step.name}`,
  30 |     index,
  31 |     kind: step.kind,
  32 |     name: step.name,
  33 |     phase: step.phase,
  34 |     runWhen: step.runWhen,
  35 |     details: step.details,
  36 |     ...(step.timeoutMs === undefined ? {} : { timeoutMs: step.timeoutMs }),
  37 |   });
  38 | }
  39 | 
  40 | /** 将最终 Test Job 转换为 CLI 可打印的稳定线性计划。 */
  41 | export function planConfig(config: TestConfig, selectors: readonly string[] = []): readonly PlannedJob[] {
  42 |   const requested = new Set(selectors);
  43 |   const selected = selectors.length === 0 ? config.jobs : config.jobs.filter((job) => requested.has(job.id));
  44 |   if (selectors.length > 0) {
  45 |     const found = new Set(selected.map((job) => job.id));
  46 |     const missing = selectors.filter((id) => !found.has(id));
  47 |     if (missing.length > 0) throw new CautestError(`未找到 Test Job: ${missing.join(", ")}`, { code: "selection_error" });
  48 |   }
  49 |   return Object.freeze(selected.map((job) => {
  50 |     const origin = getJobOrigin(job);
  51 |     return Object.freeze({
  52 |       id: job.id,
  53 |       level: job.level,
  54 |       description: job.description,
  55 |       tags: job.tags,
  56 |       enabled: job.enabled,
  57 |       ...(origin === undefined ? {} : { origin }),
  58 |       workflow: Object.freeze(job.workflow.map(plannedStep)),
  59 |     });
  60 |   }));
```

## B07 — 执行函数保存在 Symbol 字段

内部 Step Descriptor 的 Executor 不在可序列化的公共字段中。

来源：`src/workflow/step.ts:5-14`。

```text
   5 | const STEP = Symbol.for("@cautest/config/workflow-step");
   6 | const EXECUTOR = Symbol.for("@cautest/config/workflow-executor");
   7 | const phases: readonly WorkflowPhase[] = ["prepare", "build", "provision", "run", "collect"];
   8 | const runWhenValues = ["on-success", "always", "on-failure"] as const;
   9 | const fields = new Set(["kind", "name", "phase", "runWhen", "timeoutMs", "details", "execute"]);
  10 | 
  11 | type InternalStep = WorkflowStep & {
  12 |   readonly [STEP]: true;
  13 |   readonly [EXECUTOR]: (context: StepExecutionContext) => void | StepExecutionResult | Promise<void | StepExecutionResult>;
  14 | };
```

## B08 — Step 需要用构造函数重建

defineStep 校验 execute；normalizeWorkflow 要求非空、相位有序。Xmake Manifest 必须经过 JS Factory 重建，而不能伪造 Step。

来源：`src/workflow/step.ts:23-79`。

```text
  23 | export function defineStep(input: WorkflowStepInput): WorkflowStep {
  24 |   if (typeof input !== "object" || input === null || Array.isArray(input)) {
  25 |     throw new CautestError("defineStep() 需要对象参数", { code: "config_error" });
  26 |   }
  27 |   const unknown = Object.keys(input).filter((key) => !fields.has(key));
  28 |   if (unknown.length > 0) throw new CautestError(`Workflow Step 包含未知字段: ${unknown.join(", ")}`, { code: "config_error" });
  29 |   safeName(input.kind, "Step kind");
  30 |   const name = input.name ?? input.kind;
  31 |   safeName(name, "Step name");
  32 |   if (!phases.includes(input.phase)) throw new CautestError(`无效 Workflow phase: ${String(input.phase)}`, { code: "config_error" });
  33 |   const runWhen = input.runWhen ?? "on-success";
  34 |   if (!runWhenValues.includes(runWhen)) throw new CautestError(`无效 Step runWhen: ${String(runWhen)}`, { code: "config_error" });
  35 |   if (runWhen !== "on-success" && input.phase !== "collect") {
  36 |     throw new CautestError("只有 collect Step 可以使用 always/on-failure", { code: "config_error" });
  37 |   }
  38 |   if (input.timeoutMs !== undefined && (!Number.isFinite(input.timeoutMs) || input.timeoutMs <= 0)) {
  39 |     throw new CautestError("Step timeoutMs 必须为正数", { code: "config_error" });
  40 |   }
  41 |   if (typeof input.execute !== "function") throw new CautestError("Step execute 必须是函数", { code: "config_error" });
  42 |   if (input.details !== undefined && (typeof input.details !== "object" || input.details === null || Array.isArray(input.details))) {
  43 |     throw new CautestError("Step details 必须是对象", { code: "config_error" });
  44 |   }
  45 |   return Object.freeze({
  46 |     [STEP]: true,
  47 |     [EXECUTOR]: input.execute,
  48 |     kind: input.kind,
  49 |     name,
  50 |     phase: input.phase,
  51 |     runWhen,
  52 |     details: Object.freeze({ ...(input.details ?? {}) }),
  53 |     ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
  54 |   }) as InternalStep;
  55 | }
  56 | 
  57 | export function isWorkflowStep(value: unknown): value is WorkflowStep {
  58 |   return typeof value === "object" && value !== null && (value as Partial<InternalStep>)[STEP] === true;
  59 | }
  60 | 
  61 | export function stepExecutor(step: WorkflowStep): InternalStep[typeof EXECUTOR] {
  62 |   if (!isWorkflowStep(step)) throw new CautestError("Workflow 包含非 Step Descriptor", { code: "config_error" });
  63 |   return (step as InternalStep)[EXECUTOR];
  64 | }
  65 | 
  66 | export function normalizeWorkflow(value: unknown): readonly WorkflowStep[] {
  67 |   if (!Array.isArray(value)) {
  68 |     throw new CautestError("Test Job workflow 必须是非空 Step 数组", { code: "config_error" });
  69 |   }
  70 |   const flattened = flattenWorkflow(value);
  71 |   if (flattened.length === 0) throw new CautestError("Test Job workflow 必须是非空 Step 数组", { code: "config_error" });
  72 |   let previous = -1;
  73 |   const output = flattened.map((step, index) => {
  74 |     const current = phases.indexOf(step.phase);
  75 |     if (current < previous) throw new CautestError(`workflow[${index}] 的 phase ${step.phase} 发生逆序`, { code: "config_error" });
  76 |     previous = current;
  77 |     return step;
  78 |   });
  79 |   return Object.freeze(output);
```

## B09 — Native 输入还包含构建模型

旧 nativeCTestJob 需要 tests，可接受 sources/headers/build；尚不是单纯 artifact 执行入口。

来源：`src/config/schema/native.ts:52-89`。

```text
  52 | /** `nativeCTestJob()` 的完整参数 Schema。 */
  53 | export interface NativeCTestJobInput extends TestJobCommonInput {
  54 |   /**
  55 |    * 测试 C 源码；支持具体路径和 Glob，至少匹配一个文件。
  56 |    *
  57 |    * @example ["test/unit/utils/cm_queue_test.c"]
  58 |    */
  59 |   readonly tests: NonEmptyReadonlyArray<FilePattern>;
  60 | 
  61 |   /** 被测产品源码；支持具体路径和 Glob。 */
  62 |   readonly sources?: readonly FilePattern[];
  63 | 
  64 |   /**
  65 |    * 直接或间接参与编译的 Header。
  66 |    *
  67 |    * Header 自动进入构建指纹和 Doctor 检查，其父目录自动追加到 Include 路径。
  68 |    */
  69 |   readonly headers?: readonly FilePattern[];
  70 | 
  71 |   /**
  72 |    * 需要生成 Registry 的 Suite C 标识符。
  73 |    *
  74 |    * 省略时，从 Job ID 最后一段推导一个 Suite。
  75 |    */
  76 |   readonly suites?: readonly string[];
  77 | 
  78 |   /** Artifact/Step 名称；省略时由 Job ID 生成安全名称。 */
  79 |   readonly artifactName?: string;
  80 | 
  81 |   /** Native 编译配置。 */
  82 |   readonly build?: NativeCBuildInput;
  83 | 
  84 |   /** Case 选择、Session 策略和超时。 */
  85 |   readonly run?: CTestRunInput;
  86 | 
  87 |   /** 提供该对象时启用 Native GCOV。 */
  88 |   readonly coverage?: NativeCoverageInput;
  89 | }
```

## B10 — Native Registry 和入口生成

生成 Registry 的 suites 是 C 符号名；入口内嵌 Build ID。迁移时必须保持这一身份链。

来源：`src/jobs/native.ts:106-112`。

```text
 106 | function registrySource(suites: readonly string[]): string {
 107 |   return `#include <cautest/cautest.h>\n\n${suites.map((suite) => `CAUTEST_SUITE_DECLARE(${suite});`).join("\n")}\n\nCAUTEST_REGISTRY(cautest_generated_registry,\n${suites.map((suite) => `    CAUTEST_SUITE_REF(${suite})`).join(",\n")});\n`;
 108 | }
 109 | 
 110 | function entrySource(buildId: string, workspaceSize: number, caseTimeoutMs: number): string {
 111 |   return `#include "posix_target.h"\n\nextern const struct cautest_registry cautest_generated_registry;\n\nint main(void)\n{\n    const struct cautest_posix_target_config config = {\n        "${buildId}",\n        ${workspaceSize}UL,\n        ${caseTimeoutMs}UL\n    };\n    return cautest_posix_target_main(&cautest_generated_registry, &config);\n}\n`;
 112 | }
```

## B11 — Native 默认元数据

Native 默认 level=unit，默认 tags 只有对应 level；不会因为 native 类型就自动含 native tag。显式 tags 会替换该默认值。

来源：`src/jobs/native.ts:264-276`。

```text
 264 |   return testJob({
 265 |     id: input.id,
 266 |     level: input.level ?? "unit",
 267 |     tags: input.tags ?? [input.level ?? "unit"],
 268 |     workflow: [compile, execute, ...coverage],
 269 |     ...(input.description === undefined ? {} : { description: input.description }),
 270 |     ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
 271 |     ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
 272 |     ...(input.env === undefined ? {} : { env: input.env }),
 273 |     ...(input.policy === undefined ? {} : { policy: input.policy }),
 274 |   });
 275 | }
 276 | 
```

## B12 — MCU 现有输入与 Board 契约

MCU 已有 existing/command/host-simulated Firmware 输入；外部 Board 是有函数的 JS 对象，不能直接写进 JSON。

来源：`src/config/schema/mcu.ts:12-80`。

```text
  12 | /** 使用已经存在的 Firmware 文件。 */
  13 | export interface ExistingFirmwareInput {
  14 |   readonly kind: "existing";
  15 |   readonly file: string;
  16 |   readonly fingerprintInputs?: Readonly<Record<string, unknown>>;
  17 | }
  18 | 
  19 | /** 使用 Cautest 内置 Host Freestanding 模拟构建。 */
  20 | export interface HostSimulatedFirmwareInput {
  21 |   readonly kind: "host-simulated";
  22 |   readonly output: string;
  23 |   readonly sources: NonEmptyReadonlyArray<FilePattern>;
  24 |   readonly headers?: readonly FilePattern[];
  25 |   readonly compiler?: string;
  26 |   readonly cflags?: readonly string[];
  27 |   readonly env?: EnvironmentVariables;
  28 |   readonly timeoutMs?: number;
  29 | }
  30 | 
  31 | /** 使用外部命令构建 Firmware。 */
  32 | export interface CommandFirmwareInput extends CommandInput {
  33 |   readonly kind: "command";
  34 |   readonly output: string;
  35 |   readonly fingerprintInputs?: Readonly<Record<string, unknown>>;
  36 |   readonly timeoutMs?: number;
  37 | }
  38 | 
  39 | /**
  40 |  * Firmware 输入始终是带 `kind` 的对象；不会根据字符串或对象形状隐式猜测。
  41 |  */
  42 | export type McuFirmwareInput = ExistingFirmwareInput | HostSimulatedFirmwareInput | CommandFirmwareInput;
  43 | 
  44 | /** 使用 Cautest 内置 Host Process 模拟 Board。 */
  45 | export interface SimulatedMcuBoardInput {
  46 |   readonly kind: "simulated";
  47 |   /** Event Stream 每次喂给 Decoder 的最大字节数。@defaultValue 7 */
  48 |   readonly maxReadSize?: number;
  49 |   /** Command Stream 单次写入 Target 的最大字节数。@defaultValue 5 */
  50 |   readonly maxWriteSize?: number;
  51 |   /** 第一个 Transport 读取超过指定 Chunk 数后模拟一次断线。 */
  52 |   readonly disconnectOnce?: number;
  53 |   /** 第一次写命令时先注入一份损坏 Frame。@defaultValue false */
  54 |   readonly corruptWriteOnce?: boolean;
  55 | }
  56 | 
  57 | /** 外部 Board Adapter 必须实现的最小接口。 */
  58 | export interface McuCtpTransport {
  59 |   open?(options?: { readonly timeoutMs?: number; readonly signal?: AbortSignal }): void | Promise<void>;
  60 |   write(data: string): void | Promise<void>;
  61 |   nextLine(options?: { readonly timeoutMs?: number; readonly signal?: AbortSignal }): string | Promise<string>;
  62 |   close?(): void | Promise<void>;
  63 | }
  64 | 
  65 | export interface McuBoardAdapter {
  66 |   flash(firmware: { readonly path: string; readonly buildId: string }): void | Promise<void>;
  67 |   reset(): string | Promise<string>;
  68 |   openTransport(options?: Readonly<Record<string, unknown>>): McuCtpTransport | Promise<McuCtpTransport>;
  69 |   close?(): void | Promise<void>;
  70 | }
  71 | 
  72 | /** 使用项目提供的外部 Board Adapter。 */
  73 | export interface ExternalMcuBoardInput {
  74 |   readonly kind: "external";
  75 |   readonly adapter: McuBoardAdapter;
  76 |   readonly ownership?: "owned" | "borrowed";
  77 | }
  78 | 
  79 | /** Board 输入始终是带 `kind` 的对象。 */
  80 | export type McuBoardInput = SimulatedMcuBoardInput | ExternalMcuBoardInput;
```

## B13 — MCU 身份与固件指纹

MCU Session 强校验 artifact.buildId。existing 路径目前从文件内容计算 buildId；接入新产物时必须明确它与固件 HELLO 身份的对应，不能把文件 hash 自动当作嵌入 ID。

来源：`src/jobs/mcu.ts:32-77`。

```text
  32 |   let lastError: unknown;
  33 |   for (let attempt = 0; attempt <= options.reconnects; attempt += 1) {
  34 |     try {
  35 |       return await runCtpSession({ transport: await options.state.adapter.openTransport(options.serial), expectedBuildId: options.artifact.buildId, expectedBootId: options.state.bootId, run: options.run, signal: options.context.signal, ...options.callbacks });
  36 |     } catch (error) {
  37 |       lastError = error;
  38 |       const recoverable = error instanceof CautestError && (error.code === "transport_error" || (options.recoverTimeouts && error.code === "timeout_error"));
  39 |       if (!recoverable || attempt >= options.reconnects) throw error;
  40 |       options.context.events.emit("MCU_RECONNECT", { jobId: options.context.job.id, attempt: attempt + 1, reason: error.code, bootId: options.state.bootId });
  41 |     }
  42 |   }
  43 |   throw lastError;
  44 | }
  45 | 
  46 | async function firmware(input: McuCTestJobInput, context: Parameters<Parameters<typeof defineStep>[0]["execute"]>[0]): Promise<FirmwareArtifact> {
  47 |   const specification = input.firmware;
  48 |   let output: string;
  49 |   if (specification.kind === "existing") output = path.resolve(context.project.configDir, specification.file);
  50 |   else if (specification.kind === "command") {
  51 |     output = path.resolve(context.project.configDir, specification.output);
  52 |     const result = await runCommand({ program: specification.program, args: specification.args ?? [], cwd: path.resolve(context.project.configDir, specification.cwd ?? "."), env: effectiveEnvironment(context, specification.env), signal: context.signal, onOutput: context.output });
  53 |     if (result.exitCode !== 0) throw new CautestError(`MCU Firmware 命令失败 (exit ${result.exitCode})`, { code: "build_error" });
  54 |   } else {
  55 |     output = path.resolve(context.project.configDir, specification.output);
  56 |     const sources = await expandFilePatterns(specification.sources, { baseDir: context.project.configDir, label: `jobs.${input.id}.firmware.sources` });
  57 |     const headers = specification.headers === undefined ? [] : await expandFilePatterns(specification.headers, { baseDir: context.project.configDir, label: `jobs.${input.id}.firmware.headers` });
  58 |     const bytes = await Promise.all([
  59 |       ...[...sources, ...headers].map((file) => readFile(path.join(context.project.configDir, file))),
  60 |       readFile(path.join(kitRoot, "include/cautest/version.h")),
  61 |       ...kitSources.map((file) => readFile(path.join(kitRoot, file))),
  62 |     ]);
  63 |     const compiler = specification.compiler ?? "cc";
  64 |     const environment = effectiveEnvironment(context, specification.env);
  65 |     const version = await runCommand({ program: compiler, args: ["--version"], cwd: context.project.configDir, env: environment, signal: context.signal });
  66 |     const buildId = createHash("sha256").update(version.stdout).update(Buffer.concat(bytes)).update(JSON.stringify({ schema: CAUTEST_CACHE_VERSIONS.mcuFingerprint, cflags: specification.cflags ?? [], environment: declaredEnvironment(context, specification.env) })).digest("hex").slice(0, 24);
  67 |     await mkdir(path.dirname(output), { recursive: true });
  68 |     await mkdir(context.project.workDir, { recursive: true });
  69 |     const includeDirs = [...new Set(headers.map((header) => path.dirname(path.join(context.project.configDir, header))))];
  70 |     const result = await runCommand({ program: compiler, args: ["-std=c99", "-ffreestanding", "-fno-builtin", "-Wall", "-Wextra", `-I${path.join(kitRoot, "include")}`, `-I${path.join(kitRoot, "platform/freestanding")}`, `-I${path.join(kitRoot, "target/mcu-reference")}`, ...includeDirs.map((directory) => `-I${directory}`), `-DCAUTEST_MCU_BUILD_ID=\"${buildId}\"`, ...(specification.cflags ?? []), ...sources.map((source) => path.join(context.project.configDir, source)), ...kitSources.map((source) => path.join(kitRoot, source)), "-o", output], cwd: context.project.workDir, env: environment, signal: context.signal, onOutput: context.output });
  71 |     if (result.exitCode !== 0) throw new CautestError(`Host MCU Firmware 编译失败 (exit ${result.exitCode})`, { code: "build_error" });
  72 |     await chmod(output, 0o755);
  73 |     return Object.freeze({ path: output, buildId });
  74 |   }
  75 |   const contents = await readFile(output);
  76 |   const fingerprintInputs = specification.fingerprintInputs ?? {};
  77 |   return Object.freeze({ path: output, buildId: createHash("sha256").update(contents).update(JSON.stringify({ schema: CAUTEST_CACHE_VERSIONS.mcuFingerprint, fingerprintInputs })).digest("hex").slice(0, 24) });
```

## B14 — MCU 资源准备与清理时序

当前 flash/reset 在 close 的 defer 注册之前。若准备阶段出错，应在新增路径中验证提前登记清理的行为；这里只记录潜在失败路径，未宣称已复现硬件泄漏。

来源：`src/jobs/mcu.ts:86-102`。

```text
  86 |   const build = defineStep({ kind: "mcuFirmwareBuild", name: firmwareName, phase: "build", details: { ...input.firmware }, ...(("timeoutMs" in input.firmware && input.firmware.timeoutMs !== undefined) ? { timeoutMs: input.firmware.timeoutMs } : {}), async execute(context) { const artifact = await firmware(input, context); context.state.set(`firmware:${firmwareName}`, artifact); context.artifacts.publish({ kind: "mcu-firmware", name: firmwareName, path: artifact.path, fingerprint: artifact.buildId, buildId: artifact.buildId, metadata: { source: input.firmware.kind } }); return { diagnostics: [{ code: "firmware_ready", message: artifact.path }] }; } });
  87 |   const board = defineStep({
  88 |     kind: "mcuBoardStart", name: boardName, phase: "provision", details: { kind: input.board?.kind ?? "simulated" },
  89 |     async execute(context) {
  90 |       const artifact = context.state.get(`firmware:${firmwareName}`) as FirmwareArtifact | undefined;
  91 |       if (artifact === undefined) throw new CautestError("Firmware Artifact 不存在", { code: "provision_error" });
  92 |       const boardInput = input.board;
  93 |       const kind = boardInput?.kind ?? "simulated";
  94 |       const adapter = boardInput?.kind === "external" ? boardInput.adapter : new SimulatedMcuBoard(boardInput?.kind === "simulated" ? boardInput : {});
  95 |       const ownership = boardInput?.kind === "external" ? boardInput.ownership ?? "owned" : "owned";
  96 |       await adapter.flash(artifact);
  97 |       const bootId = await adapter.reset();
  98 |       if (typeof bootId !== "string" || bootId.length === 0) throw new CautestError("MCU Reset 必须返回非空 Boot ID", { code: "provision_error" });
  99 |       context.state.set(`board:${boardName}`, Object.freeze({ kind, bootId, adapter }) satisfies BoardState);
 100 |       context.resources.publish({ kind: "mcu-board", name: boardName, handle: adapter, metadata: { kind, bootId, ownership } });
 101 |       if (ownership !== "borrowed") context.defer(async () => await adapter.close?.(), `close-mcu-board:${boardName}`);
 102 |       return { diagnostics: [{ code: "board_ready", message: boardName }] };
```

## B15 — Driver 不是单个可执行目标

Driver ABI 至少需要 environment、drivers、guest；新 Adapter 应保留多产物角色，不把 target=driver 简化成全部输入。

来源：`src/config/schema/driver.ts:55-71`。

```text
  55 | /** `driverAbiCTestJob()` 的完整参数 Schema。 */
  56 | export interface DriverAbiCTestJobInput extends TestJobCommonInput {
  57 |   /** 与 Kernel C Test 共享的 UML 环境。 */
  58 |   readonly environment: UmlKernelEnvironment;
  59 | 
  60 |   /** 被测 Driver Module，至少一个；不接受字符串简写。 */
  61 |   readonly drivers: NonEmptyReadonlyArray<KernelModuleInput>;
  62 | 
  63 |   /** 在 UML Guest Userspace 执行的 C Test。 */
  64 |   readonly guest: DriverGuestCTestInput;
  65 | 
  66 |   /** Test-only Probe 的 Module Build 参数。 */
  67 |   readonly probe?: DriverProbeInput;
  68 | 
  69 |   /** Guest C Test 的选择、策略和超时。 */
  70 |   readonly run?: CTestRunInput;
  71 | }
```

## B16 — 分散组织已经存在

旧版允许一 Job 多文件，通过 Factory/namespace 分散定义，最终汇总普通 Job；旧文件 Pattern 基于根配置。

来源：`docs/usage/project-organization.md:1-117`。

```text
   1 | # 组织典型项目
   2 | 
   3 | 最小示例便于确认工具可以工作，但真实项目通常包含多个产品源码、多个测试文件和多个测试边界。Cautest 不把“一个文件”强制对应成“一个 Job”：文件是编译输入，Suite 是 C Test 的登记与筛选单位，Job 才是构建、运行环境、缓存和结果隔离边界。
   4 | 
   5 | ## 一个 Job 可以包含多个文件
   6 | 
   7 | 例如一个普通 C 模块可以这样组织：
   8 | 
   9 | ```text
  10 | include/math/
  11 | ├── arithmetic.h
  12 | └── limits.h
  13 | src/math/
  14 | ├── arithmetic.c
  15 | └── limits.c
  16 | test/unit/math/
  17 | ├── arithmetic_test.c
  18 | └── limits_test.c
  19 | ```
  20 | 
  21 | 共享同一 Compiler、宏和运行环境的文件可以进入一个 Native Job：
  22 | 
  23 | ```js
  24 | nativeCTestJob({
  25 |   id: "unit.math",
  26 |   tests: ["test/unit/math/**/*_test.c"],
  27 |   sources: ["src/math/**/*.c"],
  28 |   headers: ["include/math/**/*.h"],
  29 |   suites: ["math_arithmetic", "math_limits"],
  30 | });
  31 | ```
  32 | 
  33 | `tests` 和 `sources` 都会参与编译；区别在于前者表达测试入口，后者表达被测产品实现。`headers` 不单独编译，但会接受 `doctor` 检查、进入缓存指纹，并帮助 Native、Kernel Test Module 和 Guest Program 推导 Include 目录。`suites` 是需要进入自动生成 Registry 的 C 标识符列表，不是文件名列表。
  34 | 
  35 | File Pattern 支持具体路径、`*`、`**`、`?`、字符组、花括号和 `!` 排除。每个正向 Pattern 都必须至少匹配一个普通文件，结果按路径排序并去重。例如产品目录含有程序入口时可以排除：
  36 | 
  37 | ```js
  38 | sources: ["src/**/*.c", "!src/main.c"],
  39 | ```
  40 | 
  41 | 所有 File Pattern 都相对于根 `cautest.config.mjs` 所在目录解析，与启动命令时 Shell 的当前目录无关。
  42 | 
  43 | ## 什么时候拆成多个 Job
  44 | 
  45 | 满足以下任一条件时应拆 Job，而不是继续向同一个数组添加文件：
  46 | 
  47 | - Level 不同，例如快速单元测试与组件测试；
  48 | - Compiler、宏、Flag、Kernel/BusyBox、Board 或外部服务不同；
  49 | - 需要独立选择、缓存、超时、失败策略或结果归属；
  50 | - 两组测试不能共享同一个进程、Firmware、UML 或服务生命周期；
  51 | - 一组测试足够慢，需要在 CI 中单独分片或按 Tag 运行。
  52 | 
  53 | 只是源文件或测试文件数量增加、但上述边界不变时，通常仍保持一个 Job。不要为了目录层级创建空 Group；用稳定的点分隔 Job ID、Level 和 Tag 表达选择维度。
  54 | 
  55 | ## 多个同类 Job 的配置拆分
  56 | 
  57 | 同类 Job 应通过 Factory 绑定公共工具链，再按领域组织声明：
  58 | 
  59 | ```js
  60 | // test/config/native-jobs.mjs
  61 | import {
  62 |   jobNamespace,
  63 |   nativeCTestJobFactory,
  64 | } from "@cautest/config.js";
  65 | 
  66 | const nativeUnitJob = nativeCTestJobFactory({
  67 |   defaults: {
  68 |     level: "unit",
  69 |     tags: ["unit", "native"],
  70 |     build: { cflags: ["-Werror"] },
  71 |   },
  72 | });
  73 | 
  74 | export const nativeJobs = jobNamespace({
  75 |   namespace: "unit",
  76 |   source: import.meta.url,
  77 |   factory: nativeUnitJob,
  78 |   definitions: [
  79 |     {
  80 |       name: "math",
  81 |       tests: ["test/unit/math/**/*_test.c"],
  82 |       sources: ["src/math/**/*.c"],
  83 |       headers: ["include/math/**/*.h"],
  84 |       suites: ["math_arithmetic", "math_limits"],
  85 |     },
  86 |     {
  87 |       name: "queue",
  88 |       tests: ["test/unit/queue/**/*_test.c"],
  89 |       sources: ["src/queue/**/*.c"],
  90 |       headers: ["include/queue/**/*.h"],
  91 |       suites: ["queue_fifo", "queue_capacity"],
  92 |     },
  93 |   ],
  94 | });
  95 | ```
  96 | 
  97 | 根配置只负责合并普通 Job：
  98 | 
  99 | ```js
 100 | // cautest.config.mjs
 101 | import { testConfig } from "@cautest/config.js";
 102 | import { nativeJobs } from "./test/config/native-jobs.mjs";
 103 | import { systemJobs } from "./test/config/system-jobs.mjs";
 104 | 
 105 | export default testConfig({
 106 |   jobs: [...nativeJobs, ...systemJobs],
 107 | });
 108 | ```
 109 | 
 110 | `nativeCTestJobFactory()`、`kernelCTestJobFactory()` 和 `driverAbiCTestJobFactory()` 提供对应场景的公共默认绑定。没有专用 Factory 的 Job 可以用 `withJobDefaults()` 绑定公共字段；`jobNamespace()` 只批量生成普通 Job 和完整 ID，不会创建额外运行层级。
 111 | 
 112 | ## 一个项目中的推荐边界
 113 | 
 114 | ```text
 115 | cautest.config.mjs              # 唯一根配置
 116 | test/config/                    # Environment、Factory 和 Job 声明
 117 | test/unit/                      # 单元测试源码
```

## B17 — 默认值合并语义

withJobDefaults 是浅合并；不能无意改成自动继承/自动合并所有数组的模型。

来源：`src/config/define.ts:107-124`。

```text
 107 | /**
 108 |  * 为任意单 Job 工厂绑定公共默认项。合并是浅层的；嵌套对象由对应 Job Schema
 109 |  * 自己定义合并规则，避免通用层猜测工具链、Target 或 Runtime 的语义。
 110 |  */
 111 | export function withJobDefaults<
 112 |   TInput extends TestJobCommonInput,
 113 |   const TDefaults extends Partial<Omit<TInput, "id">>,
 114 | >(factory: TestJobFactory<TInput>, defaults: TDefaults): (
 115 |   input: JobInputWithDefaults<TInput, TDefaults>,
 116 | ) => TestJob {
 117 |   if (typeof factory !== "function") throw new CautestError("withJobDefaults() factory 必须是函数", { code: "config_error" });
 118 |   object(defaults, "withJobDefaults() defaults");
 119 |   if ("id" in defaults) throw new CautestError("withJobDefaults() 不能设置公共 Job ID", { code: "config_error" });
 120 |   const frozenDefaults = Object.freeze({ ...defaults });
 121 |   return (input) => {
 122 |     object(input, "绑定默认项后的 Job 参数");
 123 |     return factory({ ...frozenDefaults, ...input } as unknown as TInput);
 124 |   };
```

## B18 — CLI Case 选择覆盖

CLI 运行选择按字段覆盖配置默认值；Job 中 run.suite 不是不可突破的硬分区。

来源：`src/protocol/workflow-session.ts:11-17`。

```text
  11 | /** 合并本次 CLI Run 对指定 C Test Step 的临时覆盖。 */
  12 | export function effectiveWorkflowCTestRun(context: Pick<StepExecutionContext, "cTestRun">, configured: CTestRunInput, stepName: string): CTestRunInput {
  13 |   const overrides = context.cTestRun;
  14 |   if (overrides === undefined || (overrides.step !== undefined && overrides.step !== stepName)) return configured;
  15 |   const { step: _step, ...values } = overrides;
  16 |   return Object.freeze({ ...configured, ...values });
  17 | }
```

## B19 — 真实环境门禁

旧测试已区分默认测试、真实 UML、Driver UML 与物理 MCU。缺少环境不表示测试通过。

来源：`docs/tests/testing.md:1-43`。

```text
   1 | # 测试策略
   2 | 
   3 | Cautest 同时测试 Host 编排和真实 C Target 行为。只通过 TypeScript Build 不能证明 Kernel 隔离、协议事件或清理语义正确，因此默认门禁组合静态类型、Host 单元/集成测试和真实 C 编译执行。
   4 | 
   5 | | 入口 | 覆盖重点 |
   6 | | --- | --- |
   7 | | `pnpm typecheck` | TypeScript 实现与公开 `.d.ts` 一致性 |
   8 | | `pnpm test:c` | C Core、Assertion、CTP3、Freestanding、Kernel ABI/选择和 Probe 模型 |
   9 | | `pnpm test` | 以上 C 门禁加 Node Workflow、Cache、Native、UML 组件、Driver、MCU、CLI、Reporter 和安装测试 |
  10 | | `pnpm test:uml` | 真实 Linux UML、`examples/kernel-lib`、`examples/linux-driver-unit`、自动 Test Module、Rootfs、Guest Agent 和 CTP3 Case |
  11 | | `pnpm test:driver:uml` | 真实 Linux UML、Driver Module、test-only Probe、Guest ABI Test 和 CTP3 Case |
  12 | | `pnpm test:e2e` | 从固定 Git Commit 使用 npx 与 pnpm dlx 编译、安装和执行便携版本 |
  13 | | `pnpm versions:check` | 校验 Release、C API、CTP、Kernel/Probe ABI、Result/Event/CLI/Manifest/Cache 版本没有漂移 |
  14 | 
  15 | 默认 Node 测试使用临时目录和伪 Make 隔离外部成本，但不会用伪输出替代关键行为：Native/Driver Guest/MCU Firmware 会真实编译并执行；Kernel Module 测试会验证源码树前后文件集合、损坏 Manifest 重建和不同 ARCH/Kernel 并发。
  16 | 
  17 | 两个真实 UML 入口都必须显式提供 `KERNEL_SRC` 与 `BUSYBOX_SRC`，不使用开发者机器的私有默认路径：
  18 | 
  19 | ```bash
  20 | KERNEL_SRC=/path/to/linux BUSYBOX_SRC=/path/to/busybox pnpm test:uml
  21 | KERNEL_SRC=/path/to/linux BUSYBOX_SRC=/path/to/busybox pnpm test:driver:uml
  22 | ```
  23 | 
  24 | 前者在一次共享环境中执行 `examples/kernel-lib` 与 `examples/linux-driver-unit` 的 Kernel Test Module 闭环；后者执行 `examples/linux-driver` 的 Driver、可选 Probe 和 Guest ABI 闭环。源码树缺失或结构不正确时，入口输出 `status: "BLOCKED"`、`code: "uml_prerequisites_missing"` 并以 77 结束；该结果表示外部环境未就绪，不表示测试通过。
  25 | 
  26 | `doctor` 的 Host/Toolchain Probe 会在系统临时目录编译最小程序，不写入项目源码树；Kernel 污染检查只读 `.config`、`include/config/auto.conf` 和 `include/generated/autoconf.h`，不会自动清理源码。
  27 | 
  28 | 新增 Build 能力至少应验证输入变更会改变指纹、缓存命中不会跳过完整性校验、禁用缓存写入 Work 而非源码、并发发布是原子的。新增 Resource 应验证 ready、失败、owned/borrowed 和 Cleanup 后状态。新增 CTP3 Event 应同时验证任意分片、错误顺序和 C/JS 两侧。
  29 | 
  30 | 真实硬件 MCU 不属于默认仓库门禁；项目 Adapter 负责 Flash、Reset、Transport 和物理环境稳定性，Cautest 公共测试使用 Host Simulation 与 External Adapter Contract 覆盖其边界。
  31 | 
  32 | ## 版本维护与发布
  33 | 
  34 | [`versions.json`](../../versions.json) 是当前 Release 与所有协议、ABI、Schema、Manifest、Cache 版本的唯一机器可读权威来源。[版本记录](../changelog.md)保存各版本对使用者可见的变化和历史兼容性基线，两者职责不同：代码和构建读取前者，维护者和使用者查阅后者。
  35 | 
  36 | ### 何时升级版本
  37 | 
  38 | | 版本维度 | 升级条件 |
  39 | | --- | --- |
  40 | | Release Major | 已发布的公共配置、CLI、结果或运行行为发生不兼容变化 |
  41 | | Release Minor | 增加向后兼容的能力或公共接口 |
  42 | | Release Patch | 修复缺陷，或只调整向后兼容的文档、构建和交付内容 |
  43 | | C API、CTP、Kernel ABI、Probe ABI Major | 现有调用方或通信对端必须修改才能继续工作 |
```

## B20 — 发行内容与 Node 基线

现有分发 files 清单需要补充根 xmake.lua 和适配层目录；Node engines 为 >=20.6，不能承诺无需 Node。

来源：`package.json:1-39`。

```text
   1 | {
   2 |   "name": "cautest",
   3 |   "version": "0.2.1",
   4 |   "private": true,
   5 |   "type": "module",
   6 |   "bin": {
   7 |     "cautest-install": "dist/install.js"
   8 |   },
   9 |   "files": [
  10 |     "assets",
  11 |     "docs/usage",
  12 |     "examples",
  13 |     "dist",
  14 |     "README.md",
  15 |     "versions.json"
  16 |   ],
  17 |   "scripts": {
  18 |     "versions:sync": "node scripts/sync-versions.mjs --write",
  19 |     "versions:check": "node scripts/sync-versions.mjs",
  20 |     "build": "pnpm run versions:check && tsc -p tsconfig.json",
  21 |     "prepare": "pnpm run versions:check && tsc -p tsconfig.json && node dist/build-info.js",
  22 |     "pack:portable": "pnpm run build && node dist/build-info.js && node dist/archive.js",
  23 |     "test": "pnpm run build && pnpm run test:types && pnpm run test:c && node --test test/version.test.js test/interrupt.test.js test/schema.test.js test/config.test.js test/factory.test.js test/glob.test.js test/workflow.test.js test/protocol.test.js test/session.test.js test/cache.test.js test/native.test.js test/kernel.test.js test/kernel-build.test.js test/kernel-module.test.js test/uml.test.js test/driver.test.js test/mcu.test.js test/system.test.js test/script-test.test.js test/system-steps.test.js test/reporters.test.js test/cli.test.js test/install.test.js test/archive.test.js test/docs.test.js test/integration-entry.test.js",
  24 |     "test:e2e": "node --test test/git-install.test.js",
  25 |     "test:uml": "pnpm run build && node test/integration/uml-smoke.mjs",
  26 |     "test:driver:uml": "pnpm run build && node test/integration/uml-driver-smoke.mjs",
  27 |     "test:c": "sh scripts/test-c-runtime.sh",
  28 |     "test:types": "tsc --noEmit --strict --exactOptionalPropertyTypes --target ES2022 --module NodeNext --moduleResolution NodeNext test/types/config.mts",
  29 |     "typecheck": "tsc -p tsconfig.json --noEmit"
  30 |   },
  31 |   "devDependencies": {
  32 |     "@types/node": "24.3.0",
  33 |     "typescript": "5.9.2"
  34 |   },
  35 |   "engines": {
  36 |     "node": ">=20.6"
  37 |   },
  38 |   "packageManager": "pnpm@11.23.0"
  39 | }
```

## 外部接口核查（只用作设计依据，不代表已运行验证）

| 编号 | 官方资料 | 本方案使用的事实 |
|---|---|---|
| W1 | Xmake Global Interfaces，`https://xmake.io/api/description/global-interfaces.html` | `includes` 支持子配置；可用函数封装共享配置。 |
| W2 | Xmake Plugin and Task，`https://xmake.io/api/description/plugin-and-task.html` | 可定义 `task`、`on_run`、`set_menu`；公共菜单含 `--profile`。 |
| W3 | Xmake Project Targets，`https://xmake.io/api/description/project-target.html` | 配置存在 private/public/interface 可见性，不应把依赖关系当作任意完整 target 继承。 |

访问日期：2026-09-22。实际最低 Xmake 版本、表式 `ctest.*` DSL 的注册方法、跨任务锁行为、参数转发与多架构产物隔离，仍须由 PLAN 的 P0 实验验证。
