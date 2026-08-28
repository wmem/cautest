import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "../config/load.js";
import { planConfig } from "../config/plan.js";
import type { TestJob } from "../config/schema/common.js";
import { doctorJobs } from "../doctor/index.js";
import { CautestError } from "../model/error.js";
import { executeRun, writeRunDirectory } from "../result/run.js";

interface CliStreams {
  readonly stdout: { write(text: string): unknown };
  readonly stderr: { write(text: string): unknown };
}

interface ParsedArguments {
  readonly command: string;
  readonly selectors: readonly string[];
  readonly config?: string;
  readonly json: boolean;
  readonly verbose: boolean;
  readonly all: boolean;
  readonly help: boolean;
}

const usage = `用法: cautest [全局选项] <命令> [Job ID...]

命令:
  list                 列出最终 Test Job
  plan [Job ID...]     打印按顺序展开的 Workflow
  describe [Job ID...] 显示配置来源、继承结果和 Workflow
  doctor [Job ID...]   在执行前检查配置和静态输入
  run [Job ID...]      执行 Test Job
  clean --all          清理配置声明的 Cautest 受管目录
  help [命令]          显示帮助

全局选项:
  --config <文件>      指定根配置文件
  --json               stdout 只输出结构化 JSON
  --verbose            实时转发 Step 输出到 stderr
  --version            显示版本和构建 Commit
`;

const commandHelp: Readonly<Record<string, string>> = Object.freeze({
  list: "用法: cautest [--config <文件>] list [--json]\n",
  plan: "用法: cautest [--config <文件>] plan [Job ID...] [--json]\n",
  describe: "用法: cautest [--config <文件>] describe [Job ID...] [--json]\n",
  doctor: "用法: cautest [--config <文件>] doctor [Job ID...] [--json]\n",
  run: "用法: cautest [--config <文件>] run [Job ID...] [--json] [--verbose]\n",
  clean: "用法: cautest [--config <文件>] clean --all\n",
});

function parseArguments(args: readonly string[]): ParsedArguments {
  let config: string | undefined;
  let json = false;
  let verbose = false;
  let all = false;
  let help = false;
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
    else if (argument === "--all") all = true;
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
    help,
  };
}

async function versionText(): Promise<string> {
  const value = JSON.parse(await readFile(new URL("../../build-info.json", import.meta.url), "utf8")) as {
    version?: unknown; commit?: unknown; dirty?: unknown;
  };
  return `Cautest ${String(value.version)} (commit ${String(value.commit)}${value.dirty === true ? ", dirty" : ""})`;
}

function selectedJobs(jobs: readonly TestJob[], selectors: readonly string[]): readonly TestJob[] {
  if (selectors.length === 0) return jobs.filter((job) => job.enabled);
  const requested = new Set(selectors);
  const selected = jobs.filter((job) => requested.has(job.id));
  const found = new Set(selected.map((job) => job.id));
  const missing = selectors.filter((id) => !found.has(id));
  if (missing.length > 0) throw new CautestError(`未找到 Test Job: ${missing.join(", ")}`, { code: "selection_error" });
  return selected;
}

function json(value: unknown): string {
  return `${JSON.stringify(value, (_key, candidate: unknown) => candidate instanceof Error
    ? { name: candidate.name, message: candidate.message }
    : candidate, 2)}\n`;
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

async function runCommand(parsed: ParsedArguments, streams: CliStreams): Promise<number> {
  const loaded = await loadConfig(parsed.config);
  const planned = planConfig(loaded.config, parsed.selectors);
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
    const description = { config: loaded.path, configHash: loaded.hash, sources: loaded.sources, defaults: loaded.config.defaults, jobs: planned };
    if (parsed.json) streams.stdout.write(json(description));
    else streams.stdout.write(json(description));
    return 0;
  }
  const jobs = selectedJobs(loaded.config.jobs, parsed.selectors);
  if (parsed.command === "doctor") {
    const issues = await doctorJobs(jobs, loaded.dir);
    const result = { status: issues.some((issue) => issue.severity === "error") ? "ERROR" : "SUCCESS", issues };
    if (parsed.json) streams.stdout.write(json(result));
    else if (issues.length === 0) line(streams, "stdout", "Doctor: OK");
    else for (const issue of issues) line(streams, "stdout", `${issue.severity.toUpperCase()} ${issue.code} ${issue.jobId}/${issue.step}: ${issue.message}\n  修复: ${issue.hint}`);
    return result.status === "SUCCESS" ? 0 : 5;
  }
  if (parsed.command === "clean") {
    if (!parsed.all) throw new CautestError("clean 当前要求显式传入 --all", { code: "config_error" });
    const defaults = loaded.config.defaults;
    const targets = [defaults.resultDir, defaults.cacheDir, defaults.generatedDir, defaults.workDir].map((item) => managedPath(loaded.dir, item));
    for (const target of new Set(targets)) await rm(target, { recursive: true, force: true });
    if (parsed.json) streams.stdout.write(json({ status: "SUCCESS", removed: targets }));
    else for (const target of targets) line(streams, "stdout", `已清理 ${target}`);
    return 0;
  }
  if (parsed.command !== "run") throw new CautestError(`未知命令: ${parsed.command}`, { code: "config_error" });

  const issues = await doctorJobs(jobs, loaded.dir);
  if (issues.some((issue) => issue.severity === "error")) {
    if (parsed.json) streams.stdout.write(json({ status: "ERROR", issues }));
    else for (const issue of issues) line(streams, "stderr", `${issue.code} ${issue.jobId}/${issue.step}: ${issue.message}\n修复: ${issue.hint}`);
    return 5;
  }
  const runId = `${new Date().toISOString().replace(/[-:.TZ]/gu, "")}-${randomUUID().slice(0, 8)}`;
  const resultRoot = path.resolve(loaded.dir, loaded.config.defaults.resultDir);
  const heartbeatMs = Number.parseInt(process.env.CAUTEST_HEARTBEAT_MS ?? "30000", 10);
  const run = await executeRun(loaded.config, {
    runId,
    configDir: loaded.dir,
    configHash: loaded.hash,
    configPath: loaded.path,
    jobs,
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
  const summary = { ...run, runId: run.id, configHash: loaded.hash, resultDir };
  if (parsed.json) streams.stdout.write(json(summary));
  else line(streams, "stdout", `Run ${runId}: ${run.status}\n结果: ${resultDir}`);
  return run.status === "SUCCESS" || run.status === "SKIP" ? 0 : 1;
}

/** Cautest CLI 可测试入口。 */
export async function runCli(args: readonly string[], streams: CliStreams = process): Promise<number> {
  try {
    if (args.includes("--version")) {
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
    return await runCommand(parsed, streams);
  } catch (error) {
    const code = error instanceof CautestError ? error.code : "unexpected_error";
    line(streams, "stderr", `${code}: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
}
