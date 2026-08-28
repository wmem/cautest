import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { CAUTEST_RESULT_SCHEMA_VERSION } from "../config/versions.js";
import type { TestConfig, TestJob } from "../config/schema/common.js";
import { EventRecorder, type WorkflowEvent } from "../workflow/events.js";
import { executeWorkflow, type ExecutedWorkflow, type WorkflowExecutionOptions, type WorkflowStatus } from "../workflow/engine.js";

export interface ExecutedRun {
  readonly schemaVersion: typeof CAUTEST_RESULT_SCHEMA_VERSION;
  readonly id: string;
  readonly status: WorkflowStatus;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly durationMs: number;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly jobs: readonly ExecutedWorkflow[];
  readonly events: readonly WorkflowEvent[];
}

export interface RunExecutionOptions extends Omit<WorkflowExecutionOptions, "project" | "events"> {
  readonly runId?: string;
  readonly configDir?: string;
  readonly jobs?: readonly TestJob[];
  readonly failFast?: boolean;
  readonly configHash?: string;
  readonly configPath?: string;
  readonly resultDir?: string;
  readonly onJob?: (event: { readonly type: "START" | "END"; readonly jobId: string; readonly status?: WorkflowStatus; readonly durationMs?: number }) => void;
}

function aggregateRun(jobs: readonly ExecutedWorkflow[]): WorkflowStatus {
  if (jobs.some((job) => job.status === "ERROR")) return "ERROR";
  if (jobs.some((job) => job.status === "FAIL")) return "FAIL";
  if (jobs.some((job) => job.status === "SUCCESS")) return "SUCCESS";
  return "SKIP";
}

/** 顺序执行选中的 Test Job，并为整个 Run 建立统一事件流。 */
export async function executeRun(config: TestConfig, options: RunExecutionOptions = {}): Promise<ExecutedRun> {
  const startedAt = new Date();
  const started = performance.now();
  const id = options.runId ?? randomUUID();
  const configDir = path.resolve(options.configDir ?? process.cwd());
  const resultDir = path.resolve(configDir, options.resultDir ?? config.defaults.resultDir, id);
  const events = new EventRecorder({ file: path.join(resultDir, "events.jsonl") });
  const jobs: ExecutedWorkflow[] = [];
  events.emit("RUN_START", { runId: id });
  for (const job of options.jobs ?? config.jobs.filter((candidate) => candidate.enabled)) {
    options.onJob?.({ type: "START", jobId: job.id });
    const result = await executeWorkflow(job, {
      ...options,
      events,
      defaultStepTimeoutMs: options.defaultStepTimeoutMs ?? config.defaults.stepTimeoutMs,
      ...(options.defaultJobTimeoutMs ?? config.defaults.jobTimeoutMs) === undefined ? {} : { defaultJobTimeoutMs: options.defaultJobTimeoutMs ?? config.defaults.jobTimeoutMs },
      project: {
        configDir,
        resultDir,
        cacheDir: path.resolve(configDir, config.defaults.cacheDir),
        generatedDir: path.resolve(configDir, config.defaults.generatedDir),
        workDir: path.resolve(configDir, config.defaults.workDir, id, job.id),
      },
    });
    jobs.push(result);
    options.onJob?.({ type: "END", jobId: job.id, status: result.status, durationMs: result.durationMs });
    if (options.signal?.aborted === true) break;
    if (options.failFast === true && (result.status === "FAIL" || result.status === "ERROR")) break;
  }
  const status = aggregateRun(jobs);
  events.emit("RUN_END", { runId: id, status });
  const endedAt = new Date();
  const run = Object.freeze({
    schemaVersion: CAUTEST_RESULT_SCHEMA_VERSION,
    id,
    status,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationMs: performance.now() - started,
    metadata: Object.freeze({ ...(options.configPath === undefined ? {} : { configPath: options.configPath }), ...(options.configHash === undefined ? {} : { configHash: options.configHash }) }),
    jobs: Object.freeze(jobs),
    events: events.list(),
  });
  await events.close();
  return run;
}

interface FailureRecord {
  readonly sequence: number;
  readonly kind: "step" | "cleanup" | "case";
  readonly status: "FAIL" | "ERROR";
  readonly jobId: string;
  readonly stepId?: string;
  readonly suite?: string;
  readonly case?: string;
  readonly location?: Readonly<{ readonly file: string; readonly line?: number }>;
  readonly assertion?: Readonly<Record<string, unknown>>;
  readonly diagnostic?: unknown;
  readonly message: string;
  readonly code?: string;
  readonly detailRef: string;
}

function failures(run: ExecutedRun): readonly FailureRecord[] {
  const records: Omit<FailureRecord, "sequence">[] = [];
  for (const job of run.jobs) {
    for (const [index, step] of job.steps.entries()) if (step.status === "ERROR") records.push({
      kind: "step", status: "ERROR", jobId: job.jobId, stepId: step.id, message: step.error?.message ?? "Step Error", ...(step.error?.code === undefined ? {} : { code: step.error.code }), diagnostic: step.diagnostics[0], detailRef: `jobs/${job.jobId}/job.json#/steps/${index}`,
    });
    for (const [index, cleanup] of job.cleanup.entries()) if (cleanup.status === "ERROR") records.push({
      kind: "cleanup", status: "ERROR", jobId: job.jobId, message: cleanup.error?.message ?? "Cleanup Error", ...(cleanup.error?.code === undefined ? {} : { code: cleanup.error.code }), detailRef: `jobs/${job.jobId}/job.json#/cleanup/${index}`,
    });
    for (const [groupIndex, group] of job.groups.entries()) for (const [caseIndex, item] of group.cases.entries()) {
      if (item.status !== "FAIL" && item.status !== "ERROR") continue;
      const diagnostic = item.diagnostics.find((value) => typeof value === "object" && value !== null && "message" in value) as { readonly message?: unknown; readonly code?: unknown } | undefined;
      const assertion = item.assertions.find((value) => value.status === "FAIL" || value.status === "ERROR");
      const scriptFailure = item.failures?.[0];
      records.push({
        kind: "case", status: item.status,
        jobId: job.jobId,
        suite: group.name,
        case: item.name,
        ...(assertion?.file === undefined ? {} : { location: { file: assertion.file, ...(assertion.line === undefined ? {} : { line: assertion.line }) } }),
        ...(assertion === undefined && scriptFailure === undefined ? {} : { assertion: assertion === undefined ? { status: "FAIL", expression: scriptFailure!.message, ...(scriptFailure!.expected === undefined ? {} : { expected: scriptFailure!.expected }), ...(scriptFailure!.actual === undefined ? {} : { actual: scriptFailure!.actual }) } : { status: assertion.status, expression: assertion.expression, ...(assertion.expected === undefined ? {} : { expected: assertion.expected }), ...(assertion.actual === undefined ? {} : { actual: assertion.actual }) } }),
        ...(diagnostic === undefined ? {} : { diagnostic }),
        message: typeof diagnostic?.message === "string" ? diagnostic.message : assertion?.expression ?? scriptFailure?.message ?? `${group.name}/${item.name} ${item.status}`,
        ...(typeof diagnostic?.code === "string" ? { code: diagnostic.code } : {}),
        detailRef: `jobs/${job.jobId}/job.json#/groups/${groupIndex}/cases/${caseIndex}`,
      });
    }
  }
  return Object.freeze(records.map((record, index) => Object.freeze({ sequence: index + 1, ...record })));
}

async function json(file: string, value: unknown): Promise<void> {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

/** 写入可导航、适合 Agent/CI 读取的 Run 结果目录。 */
export async function writeRunDirectory(run: ExecutedRun, directory: string): Promise<string> {
  const root = path.resolve(directory, run.id);
  await mkdir(root, { recursive: true });
  const failureRecords = failures(run);
  const caseStatuses = run.jobs.flatMap((job) => job.groups.flatMap((group) => group.cases.map((item) => item.status)));
  await json(path.join(root, "summary.json"), {
    schemaVersion: run.schemaVersion,
    runId: run.id,
    status: run.status,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    durationMs: run.durationMs,
    counts: {
      jobs: { total: run.jobs.length, success: run.jobs.filter((job) => job.status === "SUCCESS").length, fail: run.jobs.filter((job) => job.status === "FAIL").length, error: run.jobs.filter((job) => job.status === "ERROR").length, skip: run.jobs.filter((job) => job.status === "SKIP").length },
      cases: { total: caseStatuses.length, pass: caseStatuses.filter((status) => status === "PASS").length, fail: caseStatuses.filter((status) => status === "FAIL").length, error: caseStatuses.filter((status) => status === "ERROR").length, skip: caseStatuses.filter((status) => status === "SKIP").length },
      failureRecords: failureRecords.length,
    },
    failedJobs: run.jobs.filter((job) => job.status === "FAIL" || job.status === "ERROR").map((job) => ({ jobId: job.jobId, status: job.status, detailRef: `jobs/${job.jobId}/job.json` })),
    failuresRef: "failures.jsonl",
    resultRef: "result.json",
  });
  await json(path.join(root, "result.json"), run);
  await writeFile(path.join(root, "failures.jsonl"), `${failureRecords.map((record) => JSON.stringify(record)).join("\n")}${failureRecords.length === 0 ? "" : "\n"}`);
  for (const job of run.jobs) {
    const jobDir = path.join(root, "jobs", job.jobId);
    await mkdir(jobDir, { recursive: true });
    await json(path.join(jobDir, "job.json"), job);
    await json(path.join(jobDir, "workflow.json"), job.steps);
    await json(path.join(jobDir, "diagnostics.json"), { errors: job.errors, cleanup: job.cleanup });
    await json(path.join(jobDir, "artifacts.json"), job.artifacts);
  }
  return root;
}
