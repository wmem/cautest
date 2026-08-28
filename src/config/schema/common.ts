/** Cautest 公共配置 Schema。这里的公开 JSDoc 会进入生成的 `.d.ts`。 */

import type { EventRecorder } from "../../workflow/events.js";
import type { ArtifactStore, ResourceStore, ResultRecorder } from "../../workflow/lifecycle.js";

/** Test Job 的测试层级。 */
export type TestLevel = "unit" | "component" | "integration" | "system";

/** Suite 内遇到失败或错误后的执行策略。 */
export type SuitePolicy = "CONTINUE" | "STOP_ON_FAIL" | "STOP_ON_ERROR";

/** 至少包含一个元素的只读数组。 */
export type NonEmptyReadonlyArray<T> = readonly [T, ...T[]];

/**
 * 相对于根配置文件目录的文件路径或 Glob。
 *
 * Glob 使用 `/` 作为分隔符，支持 `*`、`**`、`?`、字符组和花括号；以 `!`
 * 开头表示排除。展开结果按路径排序并去重。必填集合没有匹配项时属于配置错误。
 *
 * @example "src/utils/*.c"
 * @example "!src/utils/generated/**"
 */
export type FilePattern = string;

/** 相对于根配置文件目录的目录路径；目录字段不执行 Glob 展开。 */
export type DirectoryPath = string;

/** C 预处理宏的值；`null` 表示只定义宏名而不附加值。 */
export type CDefineValue = string | number | boolean | null;

/**
 * C 预处理宏表。
 *
 * 公共默认值与具体 Job 合并时采用浅合并，具体 Job 中的同名宏优先。
 */
export type CDefines = Readonly<Record<string, CDefineValue>>;

/** 只允许字符串值的进程环境变量。 */
export type EnvironmentVariables = Readonly<Record<string, string>>;

/** Test Job 的执行和结果策略。 */
export interface TestJobPolicyInput {
  /** Case 产生 FAIL 后是否停止后续普通 Run Step。@defaultValue false */
  readonly stopOnTestFailure?: boolean;

  /** 是否允许 Job 没有产生任何 Case Result。@defaultValue false */
  readonly allowEmpty?: boolean;
}

/** 所有 Test Job 构造函数共享的参数。 */
export interface TestJobCommonInput {
  /**
   * 全局唯一 Job ID，也是 `list`、`plan`、`run` 使用的稳定标识。
   *
   * 层级通过点表达，不通过嵌套对象表达。
   *
   * @example "unit.utils.cm_queue"
   */
  readonly id: string;

  /** 测试层级；各 Job 构造函数可以提供自己的默认值。 */
  readonly level?: TestLevel;

  /** 面向使用者的用途说明。 */
  readonly description?: string;

  /** 用于 `--tag` 过滤的标签。 */
  readonly tags?: readonly string[];

  /** 是否参与执行。@defaultValue true */
  readonly enabled?: boolean;

  /** 整个 Job 的超时，单位毫秒，必须为正数。 */
  readonly timeoutMs?: number;

  /** 注入到本 Job 所有 Step 的环境变量。 */
  readonly env?: EnvironmentVariables;

  /** Job 执行和空结果策略。 */
  readonly policy?: TestJobPolicyInput;
}

/** C Test 的 Suite/Case 选择参数。 */
export interface CTestSelectionInput {
  /** 默认包含的 `suite/case` Pattern。 */
  readonly include?: readonly string[];

  /** 从默认集合排除的 `suite/case` Pattern。 */
  readonly exclude?: readonly string[];

  /** 发现阶段只保留指定 Suite。 */
  readonly suite?: string | readonly string[];

  /** 发现阶段只保留指定 Case。 */
  readonly case?: string | readonly string[];

  /** 发现阶段只保留指定参数化 Case 参数。 */
  readonly parameter?: string | readonly string[];
}

/** C Test Session 的超时参数。 */
export interface CTestTimeoutInput {
  /** 单个 Case 超时，单位毫秒。 */
  readonly caseTimeoutMs?: number;

  /** 整次 C Test Run 超时，单位毫秒。 */
  readonly runTimeoutMs?: number;

  /** 建连、握手、发现、关闭等 Session 阶段超时。 */
  readonly session?: Readonly<Partial<Record<
    "connect" | "handshake" | "discovery" | "run" | "drain" | "close",
    number
  >>>;
}

/** C Test 的运行参数。 */
export interface CTestRunInput extends CTestSelectionInput, CTestTimeoutInput {
  /** Suite 内的停止策略。@defaultValue "CONTINUE" */
  readonly suitePolicy?: SuitePolicy;

  /** 约束 Target 在 HELLO 中报告的 Build ID。 */
  readonly expectedBuildId?: string;

  /** 整个 Run Step 超时，单位毫秒。 */
  readonly stepTimeoutMs?: number;
}

/** CLI 对标准 C Test Run Step 的临时覆盖；`step` 用于只匹配一个 Step Name。 */
export interface CTestRunOverrides extends CTestRunInput {
  readonly step?: string;
}

/** 可缓存构建的公共参数。 */
export interface BuildCacheInput {
  /** 是否启用构建缓存。@defaultValue true */
  readonly enabled?: boolean;

  /** Cache 根目录；Cautest 会在其下创建指纹专属目录。 */
  readonly directory?: DirectoryPath;

  /** 额外纳入构建指纹的环境变量名。 */
  readonly fingerprintEnv?: readonly string[];
}

/** 外部命令调用参数。 */
export interface CommandInput {
  /** 可执行文件名或路径。 */
  readonly program: string;

  /** 传给可执行文件的参数。 */
  readonly args?: readonly string[];

  /** 命令工作目录。 */
  readonly cwd?: DirectoryPath;

  /** 仅注入本命令的环境变量。 */
  readonly env?: EnvironmentVariables;
}

/** Workflow 固定阶段；Step 必须按该顺序排列。 */
export type WorkflowPhase = "prepare" | "build" | "provision" | "run" | "collect";

/** Step 在正常或失败路径中的执行条件。 */
export type StepRunWhen = "on-success" | "always" | "on-failure";

/** Step Executor 可以共享的 Job 内状态。 */
export interface StepExecutionContext {
  readonly job: TestJob;
  readonly signal: AbortSignal;
  readonly state: Map<string, unknown>;
  readonly project: WorkflowProjectContext;
  readonly output: (channel: "stdout" | "stderr", text: string) => void;
  /** Job 内构建产物注册表。 */
  readonly artifacts: ArtifactStore;
  /** Job 内长生命周期资源注册表。 */
  readonly resources: ResourceStore;
  /** 跨 Step 汇总结构化测试结果的 Recorder。 */
  readonly results: ResultRecorder;
  /** Run/Job/Step 生命周期事件记录器。 */
  readonly events: EventRecorder;
  /** 本次 Run 注入的 C Test 选择和超时覆盖，不修改长期 Job 定义。 */
  readonly cTestRun?: CTestRunOverrides;
  /** 注册 Job 结束时逆序执行的清理函数。 */
  readonly defer: (callback: () => unknown | Promise<unknown>, name?: string) => void;
}

/** Step Executor 返回的诊断信息。 */
export interface StepExecutionResult {
  readonly diagnostics?: readonly unknown[];
  readonly outcome?: "SUCCESS" | "FAIL" | "ERROR";
  readonly testResults?: readonly TestSuiteResult[];
  /** Step 已取得部分结果，但最终因 Target/Transport 等基础设施错误结束。 */
  readonly error?: unknown;
}

/** Workflow 执行时可写目录和配置根。所有路径均为绝对路径。 */
export interface WorkflowProjectContext {
  readonly configDir: string;
  readonly resultDir: string;
  readonly cacheDir: string;
  readonly generatedDir: string;
  readonly workDir: string;
}

/** 结构化 Assertion 值。 */
export interface TestAssertionValue {
  readonly type: "integer" | "u64" | "pointer" | "string" | "bytes";
  readonly value: string | number | null;
}

/** 结构化 Assertion 结果。 */
export interface TestAssertionResult {
  readonly status: "PASS" | "FAIL" | "ERROR" | "SKIP";
  readonly expression: string;
  readonly file?: string;
  readonly line?: number;
  readonly expected?: TestAssertionValue;
  readonly actual?: TestAssertionValue;
}

/** 单个 Test Case 的最终结果。 */
export interface TestCaseResult {
  readonly name: string;
  readonly status: "PASS" | "FAIL" | "ERROR" | "SKIP";
  readonly assertions: readonly TestAssertionResult[];
  readonly diagnostics: readonly unknown[];
  readonly durationMs?: number;
  readonly failures?: readonly Readonly<{ readonly message: string; readonly expected?: unknown; readonly actual?: unknown }>[];
  readonly logs?: readonly string[];
  readonly attachments?: readonly Readonly<{ readonly name: string; readonly value: unknown }>[];
  readonly error?: Readonly<{ readonly code?: string; readonly message: string }>;
}

/** Test Suite 的结构化结果。 */
export interface TestSuiteResult {
  readonly name: string;
  readonly cases: readonly TestCaseResult[];
}

/** 创建自定义 Workflow Step 的参数。 */
export interface WorkflowStepInput {
  /** 稳定 Step 类型。@example "nativeCompile" */
  readonly kind: string;

  /** 同类型 Step 在当前 Job 中的名称；省略时使用 `kind`。 */
  readonly name?: string;

  readonly phase: WorkflowPhase;

  /** @defaultValue "on-success" */
  readonly runWhen?: StepRunWhen;

  /** Step 超时，单位毫秒。 */
  readonly timeoutMs?: number;

  /** Doctor/plan 使用的只读静态配置，不包含 Executor 或运行时状态。 */
  readonly details?: Readonly<Record<string, unknown>>;

  /** Step 的实际执行函数。 */
  readonly execute: (
    context: StepExecutionContext,
  ) => void | StepExecutionResult | Promise<void | StepExecutionResult>;
}

declare const WORKFLOW_STEP_TYPE: unique symbol;

/** 由 `defineStep()` 或标准 Step 构造函数创建的不可变 Descriptor。 */
export interface WorkflowStep {
  readonly [WORKFLOW_STEP_TYPE]: true;
  readonly kind: string;
  readonly name: string;
  readonly phase: WorkflowPhase;
  readonly runWhen: StepRunWhen;
  readonly timeoutMs?: number;
  readonly details: Readonly<Record<string, unknown>>;
}

declare const WORKFLOW_FRAGMENT_TYPE: unique symbol;

/** 由 `defineFragment()` 创建、可递归嵌套的 Workflow 片段。 */
export interface WorkflowFragment {
  readonly [WORKFLOW_FRAGMENT_TYPE]: true;
  readonly entries: readonly WorkflowInput[];
}

/** `testJob.workflow` 支持的 Step、Fragment 或嵌套数组。 */
export type WorkflowInput = WorkflowStep | WorkflowFragment | readonly WorkflowInput[];

declare const TEST_JOB_TYPE: unique symbol;

/**
 * 已完成校验并可展开为线性 Workflow 的 Test Job。
 *
 * 该类型只能由 `testJob()` 或标准 Job 构造函数创建，不能手写对象冒充。
 */
export interface TestJob {
  readonly [TEST_JOB_TYPE]: true;
  readonly id: string;
  readonly level: TestLevel;
  readonly description: string;
  readonly tags: readonly string[];
  readonly enabled: boolean;
  readonly timeoutMs?: number;
  readonly env: EnvironmentVariables;
  readonly policy: Readonly<Required<TestJobPolicyInput>>;
  readonly workflow: readonly WorkflowStep[];
}

/** 通用 `testJob()` 的参数 Schema。 */
export interface TestJobInput extends TestJobCommonInput {
  readonly level: TestLevel;
  readonly workflow: readonly WorkflowInput[];
}

/** Profile 的 Reporter 和环境变量覆盖。 */
export interface TestProfileInput {
  /** Profile 的稳定 ID。 */
  readonly id: string;

  /** Reporter 名称。 */
  readonly reporters?: readonly string[];

  /** 运行该 Profile 时注入的环境变量；覆盖 Job 同名值，并进入标准构建/运行进程和构建指纹。 */
  readonly env?: EnvironmentVariables;
}

/** 项目级默认目录和超时。 */
export interface TestConfigDefaultsInput {
  readonly resultDir?: DirectoryPath;
  readonly cacheDir?: DirectoryPath;
  readonly generatedDir?: DirectoryPath;
  readonly workDir?: DirectoryPath;
  readonly stepTimeoutMs?: number;
  readonly jobTimeoutMs?: number;
}

/** Cautest 填充目录和 Step 默认值后的项目配置默认项。 */
export interface ResolvedTestConfigDefaults {
  readonly resultDir: DirectoryPath;
  readonly cacheDir: DirectoryPath;
  readonly generatedDir: DirectoryPath;
  readonly workDir: DirectoryPath;
  readonly stepTimeoutMs: number;
  readonly jobTimeoutMs?: number;
}

/** `testConfig()` 的唯一根参数 Schema。 */
export interface TestConfigInput {
  /**
   * 最终 Job 列表。每个元素只能是 `TestJob`；配置片段必须先生成列表，再使用
   * JavaScript 展开运算符（`...`）合并。
   */
  readonly jobs: readonly TestJob[];

  readonly defaults?: TestConfigDefaultsInput;
  readonly profiles?: readonly TestProfileInput[];
}

declare const TEST_CONFIG_TYPE: unique symbol;

/** 经过 `testConfig()` 校验和归一化的项目配置。 */
export interface TestConfig {
  readonly [TEST_CONFIG_TYPE]: true;
  readonly jobs: readonly TestJob[];
  readonly defaults: Readonly<ResolvedTestConfigDefaults>;
  readonly profiles: readonly Readonly<Required<TestProfileInput>>[];
}

/** 一个输入 Schema 明确、每次只产生一个 Test Job 的构造函数。 */
export type TestJobFactory<TInput extends TestJobCommonInput> = (input: TInput) => TestJob;

/** 把工厂公共默认项对应的字段变为可选，同时保留完整输入 Schema。 */
export type JobInputWithDefaults<
  TInput extends TestJobCommonInput,
  TDefaults extends Partial<Omit<TInput, "id">>,
> = Omit<TInput, keyof TDefaults> & Partial<Pick<TInput, Extract<keyof TInput, keyof TDefaults>>>;

/** Test Job 在配置文件中的来源，用于诊断、plan 和 configHash。 */
export interface TestJobOrigin {
  /** 定义该 Job 的配置片段文件。 */
  readonly source: string;

  /** 从根配置定位到 Job 的稳定逻辑路径。@example "jobs.unit.utils.cm_queue" */
  readonly configPath: string;
}

/** `jobNamespace()` 中每个声明项必须具有的稳定短名称。 */
export interface NamedJobDefinition {
  readonly name: string;
}

/**
 * 批量生成同类 Job 的命名空间参数。
 *
 * `definitions` 的具体 Schema 由 `factory` 唯一决定；函数返回值始终是
 * `readonly TestJob[]`，不会产生另一种 Group 节点。
 */
export interface JobNamespaceInput<TDefinition extends NamedJobDefinition> {
  /** 添加到每个短名称之前的 Job ID 前缀。@example "unit.utils" */
  readonly namespace: string;

  /** 配置片段来源，通常传入 `import.meta.url`。 */
  readonly source: string;

  /**
   * 接收推导出的完整 `id` 和 `name` 之外的声明字段，返回一个 Test Job。
   * `jobNamespace()` 消费 `name`，不会把它作为未知字段传给标准 Job 构造函数。
   */
  readonly factory: (
    input: Omit<TDefinition, "name"> & { readonly id: string },
  ) => TestJob;

  /** Schema 完全一致的声明项。 */
  readonly definitions: readonly TDefinition[];
}

/** `expandFilePatterns()` 的参数。 */
export interface FilePatternExpansionInput {
  /** 解析相对 Pattern 的绝对基准目录。 */
  readonly baseDir: string;

  /** 用于错误信息的字段路径。 */
  readonly label: string;

  /** 是否允许正向 Pattern 没有匹配文件。@defaultValue false */
  readonly allowEmpty?: boolean;
}
