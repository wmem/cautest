import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { loadConfig, type LoadedConfig } from "../config/load.js";
import { planConfig } from "../config/plan.js";
import type { CTestRunOverrides, SuitePolicy, TestJob } from "../config/schema/common.js";
import { CAUTEST_CLI_SCHEMA_VERSION } from "../config/versions.js";
import { doctorJobs } from "../doctor/index.js";
import { CautestError } from "../model/error.js";
import { selectJobs } from "../config/select.js";
import { executeRun, writeRunDirectory } from "../result/run.js";
import { formatConsoleReport, writeReports } from "../reporters/index.js";
import { executeDirectSession, type DirectSessionMode } from "./direct-session.js";

interface CliStreams {
  readonly stdout: { write(text: string): unknown };
  readonly stderr: { write(text: string): unknown };
}

export interface CliRunOptions {
  /** Prepared configuration supplied by a trusted frontend; retains the same CLI engine. */
  readonly loadedConfig?: LoadedConfig;
  readonly signal?: AbortSignal;
}

interface ParsedArguments {
  readonly command: string;
  readonly selectors: readonly string[];
  readonly config?: string;
  readonly json: boolean;
  readonly verbose: boolean;
  readonly all: boolean;
  readonly cleanResults: boolean;
  readonly cleanCache: boolean;
  readonly cleanGenerated: boolean;
  readonly cleanWork: boolean;
  readonly help: boolean;
  readonly profile?: string;
  readonly levels: readonly string[];
  readonly tags: readonly string[];
  readonly failFast: boolean;
  readonly reporters: readonly string[];
  readonly outputDir?: string;
  readonly includes: readonly string[];
  readonly excludes: readonly string[];
  readonly suites: readonly string[];
  readonly cases: readonly string[];
  readonly parameters: readonly string[];
  readonly step?: string;
  readonly caseTimeoutMs?: number;
  readonly runTimeoutMs?: number;
  readonly suitePolicy?: SuitePolicy;
  readonly target?: string;
  readonly socket?: string;
  readonly device?: string;
  readonly baud?: number;
  readonly buildId?: string;
}

const usage = `用法: cautest [全局选项] <命令> [Job ID...]

命令:
  list                 列出最终 Test Job
  plan [Job ID...]     打印按顺序展开的 Workflow
  describe [Job ID...] 显示配置来源、继承结果和 Workflow
  doctor [Job ID...]   在执行前检查配置和静态输入
  run [Job ID...]      执行 Test Job
  session <模式>       直接连接 CTP3 Target（process/attach/serial）
  clean [范围]         选择性清理受管目录
  help [命令]          显示帮助

全局选项:
  --config <文件>      指定根配置文件
  --json               stdout 只输出结构化 JSON
  --verbose            实时转发 Step 输出到 stderr
  --profile <名称>     应用 Profile 的 Reporter 和环境变量
  --level <层级>       按 unit/component/integration/system 筛选
  --tag <标签>         按标签筛选；可重复
  --fail-fast          第一个失败 Job 后停止
  --reporter <名称>    console/json/junit/html，可逗号分隔或重复
  --output-dir <目录>  覆盖本次结果根目录
  --include/--exclude <Pattern>  C Test Case 过滤，可重复
  --suite/--case/--parameter <名称>  C Test 精确过滤
  --case-timeout <ms>  单 Case 超时
  --run-timeout <ms>   整次 C Test Run 超时
  --suite-policy <值>  CONTINUE/STOP_ON_FAIL/STOP_ON_ERROR
  --version            显示版本和构建 Commit
`;

const commandHelp: Readonly<Record<string, string>> = Object.freeze({
  list: "用法: cautest [--config <文件>] list [--json]\n",
  plan: "用法: cautest [--config <文件>] plan [Job ID...] [--json]\n",
  describe: "用法: cautest [--config <文件>] describe [Job ID...] [--json]\n",
  doctor: "用法: cautest [--config <文件>] doctor [Job ID...] [--json]\n",
  run: "用法: cautest [--config <文件>] run [Job ID...] [--profile <名称>] [--reporter <名称>] [--output-dir <目录>] [C Test 过滤和超时选项] [--fail-fast] [--json] [--verbose]\n",
  session: "用法: cautest session <process|attach|serial> [--target <程序> | --socket <路径> | --device <路径> --baud <数值>] [C Test 过滤和超时选项]\n",
  clean: "用法: cautest [--config <文件>] clean [--results] [--cache] [--generated] [--work] [--all]\n",
});

function positiveInteger(value: string | undefined, option: string): number {
  if (value === undefined || !/^[1-9][0-9]*$/u.test(value)) throw new CautestError(`${option} 必须是正整数`, { code: "config_error" });
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new CautestError(`${option} 超出安全整数范围`, { code: "config_error" });
  return parsed;
}

function parseArguments(args: readonly string[]): ParsedArguments {
  let config: string | undefined;
  let json = false;
  let verbose = false;
  let all = false;
  let cleanResults = false;
  let cleanCache = false;
  let cleanGenerated = false;
  let cleanWork = false;
  let help = false;
  let profile: string | undefined;
  const levels: string[] = [];
  const tags: string[] = [];
  let failFast = false;
  const reporters: string[] = [];
  let outputDir: string | undefined;
  const includes: string[] = [];
  const excludes: string[] = [];
  const suites: string[] = [];
  const cases: string[] = [];
  const parameters: string[] = [];
  let step: string | undefined;
  let caseTimeoutMs: number | undefined;
  let runTimeoutMs: number | undefined;
  let suitePolicy: SuitePolicy | undefined;
  let target: string | undefined;
  let socket: string | undefined;
  let device: string | undefined;
  let baud: number | undefined;
  let buildId: string | undefined;
  const positional: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--config") {
      const value = args[index + 1];
      if (value === undefined) throw new CautestError("--config 缺少文件路径", { code: "config_error" });
      config = value;
      index += 1;
    } else if (argument === "--json") json = true;
    else if (argument === "--verbose") verbose = true;
    else if (["--profile", "--level", "--tag", "--reporter", "--output-dir", "--include", "--exclude", "--suite", "--case", "--parameter", "--step", "--case-timeout", "--run-timeout", "--suite-policy", "--target", "--socket", "--device", "--baud", "--build-id"].includes(argument ?? "")) {
      const value = args[index + 1];
      if (value === undefined) throw new CautestError(`${argument} 缺少值`, { code: "config_error" });
      if (argument === "--profile") profile = value;
      else if (argument === "--level") levels.push(value);
      else if (argument === "--tag") tags.push(value);
      else if (argument === "--reporter") reporters.push(...value.split(",").filter((item) => item.length > 0));
      else if (argument === "--output-dir") outputDir = value;
      else if (argument === "--include") includes.push(value);
      else if (argument === "--exclude") excludes.push(value);
      else if (argument === "--suite") suites.push(value);
      else if (argument === "--case") cases.push(value);
      else if (argument === "--parameter") parameters.push(value);
      else if (argument === "--step") step = value;
      else if (argument === "--case-timeout") caseTimeoutMs = positiveInteger(value, argument);
      else if (argument === "--run-timeout") runTimeoutMs = positiveInteger(value, argument);
      else if (argument === "--suite-policy") {
        if (!["CONTINUE", "STOP_ON_FAIL", "STOP_ON_ERROR"].includes(value)) throw new CautestError(`--suite-policy 无效: ${value}`, { code: "config_error" });
        suitePolicy = value as SuitePolicy;
      } else if (argument === "--target") target = value;
      else if (argument === "--socket") socket = value;
      else if (argument === "--device") device = value;
      else if (argument === "--baud") baud = positiveInteger(value, argument);
      else buildId = value;
      index += 1;
    }
    else if (argument === "--fail-fast") failFast = true;
    else if (argument === "--all") all = true;
    else if (argument === "--results") cleanResults = true;
    else if (argument === "--cache") cleanCache = true;
    else if (argument === "--generated") cleanGenerated = true;
    else if (argument === "--work") cleanWork = true;
    else if (argument === "--help" || argument === "-h") help = true;
    else if (argument?.startsWith("-")) throw new CautestError(`未知选项: ${argument}`, { code: "config_error" });
    else if (argument !== undefined) positional.push(argument);
  }
  return {
    command: positional[0] ?? "help",
    selectors: positional.slice(1),
    ...(config === undefined ? {} : { config }),
    json,
    verbose,
    all,
    cleanResults,
    cleanCache,
    cleanGenerated,
    cleanWork,
    help,
    ...(profile === undefined ? {} : { profile }),
    levels: Object.freeze(levels),
    tags: Object.freeze(tags),
    failFast,
    reporters: Object.freeze(reporters),
    ...(outputDir === undefined ? {} : { outputDir }),
    includes: Object.freeze(includes),
    excludes: Object.freeze(excludes),
    suites: Object.freeze(suites),
    cases: Object.freeze(cases),
    parameters: Object.freeze(parameters),
    ...(step === undefined ? {} : { step }),
    ...(caseTimeoutMs === undefined ? {} : { caseTimeoutMs }),
    ...(runTimeoutMs === undefined ? {} : { runTimeoutMs }),
    ...(suitePolicy === undefined ? {} : { suitePolicy }),
    ...(target === undefined ? {} : { target }),
    ...(socket === undefined ? {} : { socket }),
    ...(device === undefined ? {} : { device }),
    ...(baud === undefined ? {} : { baud }),
    ...(buildId === undefined ? {} : { buildId }),
  };
}

async function versionText(): Promise<string> {
  let contents: string;
  try { contents = await readFile(new URL("../build-info.json", import.meta.url), "utf8"); }
  catch { contents = await readFile(new URL("../../build-info.json", import.meta.url), "utf8"); }
  const value = JSON.parse(contents) as {
    version?: unknown; commit?: unknown; dirty?: unknown;
  };
  return `Cautest ${String(value.version)} (commit ${String(value.commit)}${value.dirty === true ? ", dirty" : ""})`;
}


function hasExplicitJobSelection(parsed: ParsedArguments): boolean {
  return parsed.selectors.length > 0 || parsed.levels.length > 0 || parsed.tags.length > 0;
}

function json(value: unknown): string {
  return `${JSON.stringify(value, (_key, candidate: unknown) => candidate instanceof Error
    ? { name: candidate.name, message: candidate.message }
    : candidate, 2)}\n`;
}

function cliRunSummary(run: { readonly id: string; readonly status: string }, resultDir: string, configHash?: string): Readonly<Record<string, unknown>> {
  return Object.freeze({
    schemaVersion: CAUTEST_CLI_SCHEMA_VERSION,
    command: "run",
    runId: run.id,
    status: run.status,
    ...(configHash === undefined ? {} : { configHash }),
    resultDir,
    resultPath: path.join(resultDir, "result.json"),
    summaryPath: path.join(resultDir, "summary.json"),
    failuresPath: path.join(resultDir, "failures.jsonl"),
  });
}

function managedPath(configDir: string, configured: string): string {
  const root = path.resolve(configDir);
  const target = path.resolve(root, configured);
  const relative = path.relative(root, target);
  if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new CautestError(`拒绝清理配置目录外或配置根目录: ${configured}`, { code: "config_error" });
  }
  return target;
}

function line(streams: CliStreams, channel: "stdout" | "stderr", text: string): void {
  streams[channel].write(`${text}\n`);
}

const presetDescriptions = Object.freeze([
  { name: "nativeCTestJob", kind: "Job Factory", summary: "构建并通过本机 FD3/FD4 CTP3 管道运行 C Test。" },
  { name: "nativeCTestJobFactory", kind: "Preset Factory", summary: "为 Native C Test 绑定公共编译和运行默认值。" },
  { name: "kernelCTestJob", kind: "Job Factory", summary: "构建 Kernel Module、Rootfs，并在 UML 中运行 Kernel C Test。" },
  { name: "kernelCTestJobFactory", kind: "Preset Factory", summary: "为 UML Kernel C Test 绑定 Environment 和模块默认值。" },
  { name: "driverAbiCTestJob", kind: "Job Factory", summary: "在 UML Guest 中验证 Driver ABI，可选加载 Probe。" },
  { name: "driverAbiCTestJobFactory", kind: "Preset Factory", summary: "为 Driver ABI C Test 绑定 UML Environment。" },
  { name: "scriptSystemTestJob", kind: "Job Factory", summary: "执行 TypeScript/JavaScript Script System Test。" },
  { name: "mcuCTestJob", kind: "Job Factory", summary: "构建固件并通过 Board Adapter 执行 MCU CTP3 Session。" },
]);

function reporters(parsed: ParsedArguments, profileReporters: readonly string[] | undefined): readonly string[] {
  const selected = parsed.reporters.length > 0 ? parsed.reporters : (profileReporters?.length ?? 0) > 0 ? profileReporters! : ["console"];
  const invalid = selected.filter((item) => !["console", "json", "junit", "html"].includes(item));
  if (invalid.length > 0) throw new CautestError(`未知 Reporter: ${invalid.join(", ")}`, { code: "config_error" });
  return Object.freeze([...new Set(selected)]);
}

function cTestOverrides(parsed: ParsedArguments, jobs: readonly TestJob[]): CTestRunOverrides | undefined {
  const hasSelection = parsed.includes.length > 0 || parsed.excludes.length > 0 || parsed.suites.length > 0 || parsed.cases.length > 0 || parsed.parameters.length > 0;
  const hasOverride = hasSelection || parsed.step !== undefined || parsed.caseTimeoutMs !== undefined || parsed.runTimeoutMs !== undefined || parsed.suitePolicy !== undefined || parsed.buildId !== undefined;
  if (!hasOverride) return undefined;
  if (parsed.step !== undefined && parsed.cases.length === 0) throw new CautestError("--step 只能与 --case 一起使用", { code: "config_error" });
  const steps = jobs.flatMap((job) => job.workflow.filter((item) => item.kind === "cTestRun" || item.kind === "mcuCTestRun"));
  if (steps.length === 0) throw new CautestError("所选 Job 没有标准 C Test Run Step", { code: "selection_error" });
  let step = parsed.step;
  if (step !== undefined) {
    const named = steps.filter((item) => item.name === step);
    if (named.length === 0) throw new CautestError(`未找到 C Test Run Step: ${step}`, { code: "config_error" });
    if (named.length > 1) throw new CautestError(`C Test Run Step 名称不唯一: ${step}`, { code: "config_error" });
    step = named[0]!.name;
  }
  return Object.freeze({
    ...(parsed.includes.length === 0 ? {} : { include: parsed.includes }),
    ...(parsed.excludes.length === 0 ? {} : { exclude: parsed.excludes }),
    ...(parsed.suites.length === 0 ? {} : { suite: parsed.suites }),
    ...(parsed.cases.length === 0 ? {} : { case: parsed.cases }),
    ...(parsed.parameters.length === 0 ? {} : { parameter: parsed.parameters }),
    ...(step === undefined ? {} : { step }),
    ...(parsed.caseTimeoutMs === undefined ? {} : { caseTimeoutMs: parsed.caseTimeoutMs }),
    ...(parsed.runTimeoutMs === undefined ? {} : { runTimeoutMs: parsed.runTimeoutMs }),
    ...(parsed.suitePolicy === undefined ? {} : { suitePolicy: parsed.suitePolicy }),
    ...(parsed.buildId === undefined ? {} : { expectedBuildId: parsed.buildId }),
  });
}

async function runCommand(parsed: ParsedArguments, streams: CliStreams, options: CliRunOptions): Promise<number> {
  if (parsed.command === "session") {
    const mode = parsed.selectors[0] as DirectSessionMode | undefined;
    if (mode === undefined || !["process", "attach", "serial"].includes(mode) || parsed.selectors.length !== 1) throw new CautestError("session 要求一个模式: process/attach/serial", { code: "config_error" });
    const resultRoot = path.resolve(process.cwd(), parsed.outputDir ?? ".cautest/results");
    const selectedReporters = reporters(parsed, undefined);
    const run = await executeDirectSession({
      mode,
      resultRoot,
      ...(parsed.target === undefined ? {} : { target: path.resolve(parsed.target) }),
      ...(parsed.socket === undefined ? {} : { socket: path.resolve(parsed.socket) }),
      ...(parsed.device === undefined ? {} : { device: path.resolve(parsed.device) }),
      ...(parsed.baud === undefined ? {} : { baud: parsed.baud }),
      run: {
        ...(parsed.includes.length === 0 ? {} : { include: parsed.includes }),
        ...(parsed.excludes.length === 0 ? {} : { exclude: parsed.excludes }),
        ...(parsed.suites.length === 0 ? {} : { suite: parsed.suites }),
        ...(parsed.cases.length === 0 ? {} : { case: parsed.cases }),
        ...(parsed.parameters.length === 0 ? {} : { parameter: parsed.parameters }),
        ...(parsed.caseTimeoutMs === undefined ? {} : { caseTimeoutMs: parsed.caseTimeoutMs }),
        ...(parsed.runTimeoutMs === undefined ? {} : { runTimeoutMs: parsed.runTimeoutMs }),
        ...(parsed.suitePolicy === undefined ? {} : { suitePolicy: parsed.suitePolicy }),
        ...(parsed.buildId === undefined ? {} : { expectedBuildId: parsed.buildId }),
      },
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    const resultDir = await writeRunDirectory(run, resultRoot);
    await writeReports(run, resultDir, selectedReporters);
    if (parsed.json) streams.stdout.write(json(cliRunSummary(run, resultDir)));
    else streams.stdout.write(formatConsoleReport(run));
    if (options.signal?.aborted === true) return 130;
    return run.status === "ERROR" ? 2 : run.status === "FAIL" ? 1 : 0;
  }
  const loaded = options.loadedConfig ?? await loadConfig(parsed.config);
  if (parsed.command === "describe" && parsed.selectors.length === 1 && !loaded.config.jobs.some((job) => job.id === parsed.selectors[0])) {
    const preset = presetDescriptions.find((item) => item.name === parsed.selectors[0]);
    if (preset === undefined) { line(streams, "stderr", `未找到 Test Job 或公开 Job Factory/Preset: ${parsed.selectors[0]}`); return 4; }
    streams.stdout.write(json({ preset }));
    return 0;
  }
  const jobs = selectJobs(loaded.config.jobs, { selectors: parsed.selectors, levels: parsed.levels, tags: parsed.tags, includeDisabled: parsed.command !== "run" });
  const selectedIds = new Set(jobs.map((job) => job.id));
  const planned = planConfig(loaded.config).filter((job) => selectedIds.has(job.id));
  if (jobs.length === 0 && parsed.command !== "clean" && parsed.command !== "describe" && (parsed.command !== "list" || hasExplicitJobSelection(parsed))) {
    line(streams, "stderr", "未选择任何 Test Job");
    return 4;
  }
  if (parsed.command === "list") {
    if (parsed.json) streams.stdout.write(json(planned.map(({ workflow: _workflow, ...job }) => job)));
    else for (const job of planned) line(streams, "stdout", `${job.id}\t${job.level}\t${job.enabled ? "enabled" : "disabled"}\t${job.tags.join(",")}`);
    return 0;
  }
  if (parsed.command === "plan") {
    if (parsed.json) streams.stdout.write(json(planned));
    else for (const job of planned) {
      line(streams, "stdout", `${job.id}${job.origin === undefined ? "" : ` (${job.origin.configPath} @ ${job.origin.source})`}`);
      for (const step of job.workflow) line(streams, "stdout", `  ${step.id}`);
    }
    return 0;
  }
  if (parsed.command === "describe") {
    const description = { config: loaded.path, configHash: loaded.hash, sources: loaded.sources, defaults: loaded.config.defaults, jobs: planned, presets: parsed.selectors.length === 0 ? presetDescriptions : undefined };
    if (parsed.json) streams.stdout.write(json(description));
    else streams.stdout.write(json(description));
    return 0;
  }
  if (parsed.command === "doctor") {
    const issues = await doctorJobs(jobs, loaded.dir, loaded.config.defaults);
    const result = { status: issues.some((issue) => issue.severity === "error") ? "ERROR" : "SUCCESS", issues };
    if (parsed.json) streams.stdout.write(json(result));
    else if (issues.length === 0) line(streams, "stdout", "Doctor: OK");
    else for (const issue of issues) line(streams, "stdout", `${issue.severity.toUpperCase()} ${issue.code} ${issue.jobId}/${issue.step}: ${issue.message}\n  修复: ${issue.hint}`);
    return result.status === "SUCCESS" ? 0 : 2;
  }
  if (parsed.command === "clean") {
    if (!parsed.all && !parsed.cleanResults && !parsed.cleanCache && !parsed.cleanGenerated && !parsed.cleanWork) throw new CautestError("clean 要求至少一个范围: --results/--cache/--generated/--work/--all", { code: "config_error" });
    const defaults = loaded.config.defaults;
    const configured = [
      ...(parsed.all || parsed.cleanResults ? [defaults.resultDir] : []),
      ...(parsed.all || parsed.cleanCache ? [defaults.cacheDir] : []),
      ...(parsed.all || parsed.cleanGenerated ? [defaults.generatedDir] : []),
      ...(parsed.all || parsed.cleanWork ? [defaults.workDir] : []),
    ];
    const targets = configured.map((item) => managedPath(loaded.dir, item));
    for (const target of new Set(targets)) await rm(target, { recursive: true, force: true });
    if (parsed.json) streams.stdout.write(json({ status: "SUCCESS", removed: targets }));
    else for (const target of targets) line(streams, "stdout", `已清理 ${target}`);
    return 0;
  }
  if (parsed.command !== "run") throw new CautestError(`未知命令: ${parsed.command}`, { code: "config_error" });

  const profile = parsed.profile === undefined ? undefined : loaded.config.profiles.find((candidate) => candidate.id === parsed.profile);
  if (parsed.profile !== undefined && profile === undefined) throw new CautestError(`Profile 不存在: ${parsed.profile}`, { code: "config_error" });
  const runJobs = profile === undefined ? jobs : jobs.map((job) => Object.freeze({ ...job, env: Object.freeze({ ...job.env, ...profile.env }) }));
  const issues = await doctorJobs(runJobs, loaded.dir, loaded.config.defaults);
  if (issues.some((issue) => issue.severity === "error")) {
    if (parsed.json) streams.stdout.write(json({ status: "ERROR", issues }));
    else for (const issue of issues) line(streams, "stderr", `${issue.code} ${issue.jobId}/${issue.step}: ${issue.message}\n修复: ${issue.hint}`);
    return 2;
  }
  const runId = `${new Date().toISOString().replace(/[-:.TZ]/gu, "")}-${randomUUID().slice(0, 8)}`;
  const resultRoot = path.resolve(loaded.dir, parsed.outputDir ?? loaded.config.defaults.resultDir);
  const selectedReporters = reporters(parsed, profile?.reporters);
  const cTestRun = cTestOverrides(parsed, runJobs);
  const heartbeatMs = Number.parseInt(process.env.CAUTEST_HEARTBEAT_MS ?? "30000", 10);
  const run = await executeRun(loaded.config, {
    runId,
    configDir: loaded.dir,
    configHash: loaded.hash,
    configPath: loaded.path,
    jobs: runJobs,
    resultDir: resultRoot,
    failFast: parsed.failFast,
    ...(cTestRun === undefined ? {} : { cTestRun }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(Number.isFinite(heartbeatMs) && heartbeatMs > 0 ? { heartbeatMs } : {}),
    onJob(event) {
      if (event.type === "START") line(streams, "stderr", `START Job ${event.jobId}`);
      else line(streams, "stderr", `END Job ${event.jobId} ${event.status} ${Math.round(event.durationMs ?? 0)}ms`);
    },
    onOutput(event) { if (parsed.verbose) streams.stderr.write(event.text); },
    onStep(event) {
      if (event.type === "START") {
        line(streams, "stderr", `START Step ${event.jobId}/${event.step.phase}/${event.step.kind}:${event.step.name}`);
      } else if (event.type === "HEARTBEAT") {
        line(streams, "stderr", `HEARTBEAT Step ${event.jobId}/${event.step.kind}:${event.step.name} ${Math.round(event.durationMs ?? 0)}ms`);
      } else {
        const cache = event.diagnostics?.find((item) => typeof item === "object" && item !== null && "code" in item && (item.code === "cache_hit" || item.code === "cache_miss")) as { code: string } | undefined;
        line(streams, "stderr", `END Step ${event.jobId}/${event.step.kind}:${event.step.name} ${event.status} ${Math.round(event.durationMs ?? 0)}ms${cache === undefined ? "" : ` ${cache.code === "cache_hit" ? "CACHE HIT" : "CACHE MISS"}`}`);
      }
    },
  });
  const resultDir = await writeRunDirectory(run, resultRoot);
  await writeReports(run, resultDir, selectedReporters);
  if (parsed.json) streams.stdout.write(json(cliRunSummary(run, resultDir, loaded.hash)));
  else streams.stdout.write(formatConsoleReport(run));
  if (options.signal?.aborted === true) return 130;
  return run.status === "ERROR" ? 2 : run.status === "FAIL" ? 1 : 0;
}

/** Cautest CLI 可测试入口。 */
export async function runCli(args: readonly string[], streams: CliStreams = process, options: CliRunOptions = {}): Promise<number> {
  try {
    if (args.includes("--version") || args.includes("-V")) {
      line(streams, "stdout", await versionText());
      return 0;
    }
    const parsed = parseArguments(args);
    if (parsed.help) {
      const topic = parsed.command === "help" ? parsed.selectors[0] : parsed.command;
      streams.stdout.write(topic === undefined ? usage : (commandHelp[topic] ?? usage));
      return 0;
    }
    if (parsed.command === "help") {
      const topic = parsed.selectors[0];
      streams.stdout.write(topic === undefined ? usage : (commandHelp[topic] ?? usage));
      return 0;
    }
    return await runCommand(parsed, streams, options);
  } catch (error) {
    if (options.signal?.aborted === true) return 130;
    const code = error instanceof CautestError ? error.code : "unexpected_error";
    line(streams, "stderr", `${code}: ${error instanceof Error ? error.message : String(error)}`);
    return error instanceof CautestError && !["config_error", "plan_error"].includes(error.code) ? 2 : 3;
  }
}
