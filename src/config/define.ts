import type {
  EnvironmentVariables,
  JobInputWithDefaults,
  TestConfig,
  TestConfigDefaultsInput,
  TestConfigInput,
  ResolvedTestConfigDefaults,
  TestJob,
  TestJobCommonInput,
  TestJobInput,
  TestJobFactory,
  TestJobPolicyInput,
  TestLevel,
  TestProfileInput,
} from "./schema/common.js";
import { CautestError } from "../model/error.js";
import { normalizeWorkflow } from "../workflow/step.js";
import { jobOriginText } from "./provenance.js";

const TEST_JOB = Symbol.for("@cautest/config/test-job");
const TEST_CONFIG = Symbol.for("@cautest/config/test-config");
const levels: readonly TestLevel[] = ["unit", "component", "integration", "system"];
const jobFields = new Set(["id", "level", "description", "tags", "enabled", "timeoutMs", "env", "policy", "workflow"]);
const configFields = new Set(["jobs", "defaults", "profiles"]);
const defaultFields = new Set(["resultDir", "cacheDir", "generatedDir", "workDir", "stepTimeoutMs", "jobTimeoutMs"]);
const profileFields = new Set(["id", "reporters", "env"]);

type InternalTestJob = TestJob & { readonly [TEST_JOB]: true };
type InternalTestConfig = TestConfig & { readonly [TEST_CONFIG]: true };

function object(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new CautestError(`${label} 必须是对象`, { code: "config_error" });
  }
}

function rejectUnknown(value: Record<string, unknown>, allowed: ReadonlySet<string>, label: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) throw new CautestError(`${label} 包含未知字段: ${unknown.join(", ")}`, { code: "config_error" });
}

function safeIdentity(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value) || value.includes("..")) {
    throw new CautestError(`${label} 必须是安全标识符`, { code: "config_error" });
  }
}

function positive(value: unknown, label: string): asserts value is number {
  if (!Number.isFinite(value) || (value as number) <= 0) throw new CautestError(`${label} 必须为正数`, { code: "config_error" });
}

function strings(value: unknown, label: string): readonly string[] {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.length === 0)) {
    throw new CautestError(`${label} 必须是非空字符串数组`, { code: "config_error" });
  }
  return Object.freeze([...value]);
}

function environment(value: unknown, label: string): EnvironmentVariables {
  if (value === undefined) return Object.freeze({});
  object(value, label);
  if (Object.values(value).some((item) => typeof item !== "string")) {
    throw new CautestError(`${label} 必须是字符串键值对象`, { code: "config_error" });
  }
  return Object.freeze({ ...value }) as EnvironmentVariables;
}

function policy(value: unknown): Readonly<Required<TestJobPolicyInput>> {
  if (value === undefined) return Object.freeze({ stopOnTestFailure: false, allowEmpty: false });
  object(value, "Job policy");
  rejectUnknown(value, new Set(["stopOnTestFailure", "allowEmpty"]), "Job policy");
  for (const key of ["stopOnTestFailure", "allowEmpty"] as const) {
    if (value[key] !== undefined && typeof value[key] !== "boolean") {
      throw new CautestError(`policy.${key} 必须是 boolean`, { code: "config_error" });
    }
  }
  return Object.freeze({
    stopOnTestFailure: value.stopOnTestFailure ?? false,
    allowEmpty: value.allowEmpty ?? false,
  }) as Readonly<Required<TestJobPolicyInput>>;
}

/** 创建一个具有明确 ID、公共元数据和线性 Workflow 的 Test Job。 */
export function testJob(input: TestJobInput): TestJob {
  object(input, "testJob() 参数");
  rejectUnknown(input, jobFields, "Test Job");
  safeIdentity(input.id, "Test Job ID");
  if (!levels.includes(input.level)) throw new CautestError(`无效 Test Job level: ${String(input.level)}`, { code: "config_error" });
  if (input.description !== undefined && typeof input.description !== "string") throw new CautestError("description 必须是字符串", { code: "config_error" });
  if (input.enabled !== undefined && typeof input.enabled !== "boolean") throw new CautestError("enabled 必须是 boolean", { code: "config_error" });
  if (input.timeoutMs !== undefined) positive(input.timeoutMs, "Job timeoutMs");
  return Object.freeze({
    [TEST_JOB]: true,
    id: input.id,
    level: input.level,
    description: input.description ?? "",
    tags: strings(input.tags, "tags"),
    enabled: input.enabled ?? true,
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
    env: environment(input.env, "Job env"),
    policy: policy(input.policy),
    workflow: normalizeWorkflow(input.workflow),
  }) as InternalTestJob;
}

/**
 * 为任意单 Job 工厂绑定公共默认项。合并是浅层的；嵌套对象由对应 Job Schema
 * 自己定义合并规则，避免通用层猜测工具链、Target 或 Runtime 的语义。
 */
export function withJobDefaults<
  TInput extends TestJobCommonInput,
  const TDefaults extends Partial<Omit<TInput, "id">>,
>(factory: TestJobFactory<TInput>, defaults: TDefaults): (
  input: JobInputWithDefaults<TInput, TDefaults>,
) => TestJob {
  if (typeof factory !== "function") throw new CautestError("withJobDefaults() factory 必须是函数", { code: "config_error" });
  object(defaults, "withJobDefaults() defaults");
  if ("id" in defaults) throw new CautestError("withJobDefaults() 不能设置公共 Job ID", { code: "config_error" });
  const frozenDefaults = Object.freeze({ ...defaults });
  return (input) => {
    object(input, "绑定默认项后的 Job 参数");
    return factory({ ...frozenDefaults, ...input } as unknown as TInput);
  };
}

export function isTestJob(value: unknown): value is TestJob {
  return typeof value === "object" && value !== null && (value as Partial<InternalTestJob>)[TEST_JOB] === true;
}

function normalizeDefaults(value: TestConfigDefaultsInput | undefined): Readonly<ResolvedTestConfigDefaults> {
  const candidate: unknown = value ?? {};
  object(candidate, "defaults");
  rejectUnknown(candidate, defaultFields, "defaults");
  const defaults = candidate as TestConfigDefaultsInput;
  for (const key of ["stepTimeoutMs", "jobTimeoutMs"] as const) {
    if (defaults[key] !== undefined) positive(defaults[key], `defaults.${key}`);
  }
  for (const key of ["resultDir", "cacheDir", "generatedDir", "workDir"] as const) {
    if (defaults[key] !== undefined && (typeof defaults[key] !== "string" || defaults[key].length === 0)) {
      throw new CautestError(`defaults.${key} 必须是非空字符串`, { code: "config_error" });
    }
  }
  return Object.freeze({
    resultDir: defaults.resultDir ?? ".cautest/results",
    cacheDir: defaults.cacheDir ?? ".cautest/cache",
    generatedDir: defaults.generatedDir ?? ".cautest/generated",
    workDir: defaults.workDir ?? ".cautest/work",
    stepTimeoutMs: defaults.stepTimeoutMs ?? 60_000,
    ...(defaults.jobTimeoutMs === undefined ? {} : { jobTimeoutMs: defaults.jobTimeoutMs }),
  });
}

function normalizeProfiles(value: readonly TestProfileInput[] | undefined): readonly Readonly<Required<TestProfileInput>>[] {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value)) throw new CautestError("profiles 必须是数组", { code: "config_error" });
  const ids = new Set<string>();
  return Object.freeze(value.map((profile, index) => {
    object(profile, `profiles[${index}]`);
    rejectUnknown(profile, profileFields, `profiles[${index}]`);
    safeIdentity(profile.id, `profiles[${index}].id`);
    if (ids.has(profile.id)) throw new CautestError(`Profile ID 重复: ${profile.id}`, { code: "config_error" });
    ids.add(profile.id);
    return Object.freeze({
      id: profile.id,
      reporters: strings(profile.reporters, `profiles[${index}].reporters`),
      env: environment(profile.env, `profiles[${index}].env`),
    });
  }));
}

/** 创建只包含统一 `TestJob[]` 的项目配置。 */
export function testConfig(input: TestConfigInput): TestConfig {
  object(input, "testConfig() 参数");
  rejectUnknown(input, configFields, "Test Config");
  if (!Array.isArray(input.jobs)) throw new CautestError("config.jobs 必须是 TestJob 数组", { code: "config_error" });
  const jobsById = new Map<string, TestJob>();
  const jobs = input.jobs.map((job, index) => {
    if (!isTestJob(job)) throw new CautestError(`jobs[${index}] 必须由 Test Job 构造函数创建`, { code: "config_error" });
    const first = jobsById.get(job.id);
    if (first !== undefined) {
      throw new CautestError(
        `Test Job ID 重复: ${job.id} (${jobOriginText(first)} 与 ${jobOriginText(job)})`,
        { code: "config_error" },
      );
    }
    jobsById.set(job.id, job);
    return job;
  });
  return Object.freeze({
    [TEST_CONFIG]: true,
    jobs: Object.freeze(jobs),
    defaults: normalizeDefaults(input.defaults),
    profiles: normalizeProfiles(input.profiles),
  }) as InternalTestConfig;
}

export function isTestConfig(value: unknown): value is TestConfig {
  return typeof value === "object" && value !== null && (value as Partial<InternalTestConfig>)[TEST_CONFIG] === true;
}
