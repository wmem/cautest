import path from "node:path";
import type { SerializedError } from "../model/error.js";
import type { StepExecutionResult, TestJob, TestSuiteResult, WorkflowProjectContext, WorkflowStep } from "../config/schema/common.js";
import { CautestError, serializeError } from "../model/error.js";
import { EventRecorder } from "./events.js";
import { ArtifactStore, CleanupStack, type CleanupOutcome, ResourceStore, ResultRecorder, type Artifact, type Resource } from "./lifecycle.js";
import { stepExecutor } from "./step.js";

export type StepStatus = "SUCCESS" | "FAIL" | "SKIPPED" | "ERROR";
export type WorkflowStatus = "SUCCESS" | "FAIL" | "ERROR" | "SKIP";

export interface ExecutedStep {
  readonly id: string;
  readonly kind: string;
  readonly name: string;
  readonly phase: WorkflowStep["phase"];
  readonly status: StepStatus;
  readonly durationMs: number;
  readonly diagnostics: readonly unknown[];
  readonly testResults: readonly TestSuiteResult[];
  readonly error?: SerializedError;
}

export interface ExecutedWorkflow {
  readonly jobId: string;
  readonly level: TestJob["level"];
  readonly status: WorkflowStatus;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly durationMs: number;
  readonly steps: readonly ExecutedStep[];
  readonly groups: readonly TestSuiteResult[];
  readonly cleanup: readonly CleanupOutcome[];
  readonly errors: readonly SerializedError[];
  readonly artifacts: readonly Artifact[];
  readonly resources: readonly Omit<Resource, "handle">[];
}

export interface WorkflowExecutionOptions {
  readonly signal?: AbortSignal;
  readonly defaultStepTimeoutMs?: number;
  readonly defaultJobTimeoutMs?: number;
  readonly project?: Partial<WorkflowProjectContext>;
  readonly events?: EventRecorder;
  readonly heartbeatMs?: number;
  readonly onOutput?: (event: { readonly jobId: string; readonly step: WorkflowStep; readonly channel: "stdout" | "stderr"; readonly text: string }) => void;
  readonly onStep?: (event: { readonly type: "START" | "HEARTBEAT" | "END"; readonly jobId: string; readonly step: WorkflowStep; readonly status?: StepStatus; readonly durationMs?: number; readonly diagnostics?: readonly unknown[] }) => void;
}

const phaseError = Object.freeze({
  prepare: "tooling_error",
  build: "build_error",
  provision: "provision_error",
  run: "target_error",
  collect: "collect_error",
} as const);

function stepId(step: WorkflowStep, index: number): string {
  return `${String(index + 1).padStart(2, "0")}-${step.phase}-${step.kind}-${step.name}`;
}

async function runWithTimeout<T>(callback: (signal: AbortSignal) => Promise<T>, timeoutMs: number, outerSignal?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const abort = (): void => controller.abort(outerSignal?.reason ?? new CautestError("Workflow 已取消", { code: "timeout_error" }));
  outerSignal?.addEventListener("abort", abort, { once: true });
  if (outerSignal?.aborted === true) abort();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      callback(controller.signal),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          const error = new CautestError(`执行超时 (${timeoutMs} ms)`, { code: "timeout_error" });
          controller.abort(error);
          reject(error);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    outerSignal?.removeEventListener("abort", abort);
  }
}

function hasFailedCase(groups: readonly TestSuiteResult[]): boolean {
  return groups.some((group) => group.cases.some((item) => item.status === "FAIL" || item.status === "ERROR"));
}

function shouldRun(step: WorkflowStep, infrastructureFailed: boolean, testFailed: boolean, stopOnTestFailure: boolean): boolean {
  if (step.phase !== "collect") return !infrastructureFailed && !(stopOnTestFailure && testFailed);
  const failed = infrastructureFailed || testFailed;
  if (step.runWhen === "always") return true;
  if (step.runWhen === "on-failure") return failed;
  return !failed;
}

function aggregate(steps: readonly ExecutedStep[], groups: readonly TestSuiteResult[], cleanup: readonly CleanupOutcome[], allowEmpty: boolean): WorkflowStatus {
  if (steps.some((step) => step.status === "ERROR") || cleanup.some((entry) => entry.status === "ERROR")) return "ERROR";
  const cases = groups.flatMap((group) => group.cases);
  if (cases.some((item) => item.status === "ERROR")) return "ERROR";
  if (steps.some((step) => step.status === "FAIL") || cases.some((item) => item.status === "FAIL")) return "FAIL";
  if (cases.some((item) => item.status === "PASS")) return "SUCCESS";
  if (cases.length > 0 || allowEmpty) return "SKIP";
  return "ERROR";
}

/** 严格按 Test Job 中的顺序执行 Workflow，并统一管理结果、资源和清理。 */
export async function executeWorkflow(job: TestJob, options: WorkflowExecutionOptions = {}): Promise<ExecutedWorkflow> {
  const startedAt = new Date();
  const started = performance.now();
  const steps: ExecutedStep[] = [];
  const errors: SerializedError[] = [];
  const state = new Map<string, unknown>();
  let infrastructureFailed = false;
  let testFailed = false;
  const configDir = path.resolve(options.project?.configDir ?? process.cwd());
  const project: WorkflowProjectContext = Object.freeze({
    configDir,
    resultDir: path.resolve(configDir, options.project?.resultDir ?? ".cautest/results"),
    cacheDir: path.resolve(configDir, options.project?.cacheDir ?? ".cautest/cache"),
    generatedDir: path.resolve(configDir, options.project?.generatedDir ?? ".cautest/generated"),
    workDir: path.resolve(configDir, options.project?.workDir ?? ".cautest/work"),
  });
  const events = options.events ?? new EventRecorder();
  const artifacts = new ArtifactStore({ onPublish: (artifact) => { events.emit("ARTIFACT_PUBLISHED", { jobId: job.id, artifact: `${artifact.kind}:${artifact.name}` }); } });
  const resources = new ResourceStore(job.id, {
    onPublish: (resource) => { events.emit("RESOURCE_PUBLISHED", { jobId: job.id, resource: `${resource.kind}:${resource.name}`, state: resource.state }); },
    onState: (resource) => { events.emit("RESOURCE_STATE", { jobId: job.id, resource: `${resource.kind}:${resource.name}`, state: resource.state }); },
    onClose: (resource) => { events.emit("RESOURCE_CLOSED", { jobId: job.id, resource: `${resource.kind}:${resource.name}` }); },
  });
  const results = new ResultRecorder();
  const cleanupStack = new CleanupStack();
  const jobTimeout = job.timeoutMs ?? options.defaultJobTimeoutMs ?? Number.POSITIVE_INFINITY;
  events.emit("JOB_START", { jobId: job.id });

  const execute = async (jobSignal: AbortSignal): Promise<void> => {
    for (const [index, step] of job.workflow.entries()) {
      const id = stepId(step, index);
      if (!shouldRun(step, infrastructureFailed, testFailed, job.policy.stopOnTestFailure)) {
        steps.push(Object.freeze({ id, kind: step.kind, name: step.name, phase: step.phase, status: "SKIPPED" as const, durationMs: 0, diagnostics: Object.freeze([]), testResults: Object.freeze([]) }));
        events.emit("STEP_END", { jobId: job.id, stepId: id, status: "SKIPPED", durationMs: 0 });
        options.onStep?.({ type: "END", jobId: job.id, step, status: "SKIPPED", durationMs: 0, diagnostics: [] });
        continue;
      }
      options.onStep?.({ type: "START", jobId: job.id, step });
      events.emit("STEP_START", { jobId: job.id, stepId: id });
      const stepStarted = performance.now();
      const heartbeat = options.heartbeatMs === undefined ? undefined : setInterval(() => {
        options.onStep?.({ type: "HEARTBEAT", jobId: job.id, step, durationMs: performance.now() - stepStarted });
      }, options.heartbeatMs);
      heartbeat?.unref?.();
      try {
        const timeoutMs = step.timeoutMs ?? options.defaultStepTimeoutMs ?? 60_000;
        const result = await runWithTimeout(
          async (signal) => await stepExecutor(step)({
            job,
            signal,
            state,
            project,
            artifacts,
            resources,
            results,
            events,
            defer: (callback, name) => cleanupStack.defer(callback, name),
            output: (channel, text) => options.onOutput?.({ jobId: job.id, step, channel, text }),
          }),
          timeoutMs,
          step.phase === "collect" ? undefined : jobSignal,
        ) as StepExecutionResult | void;
        for (const group of result?.testResults ?? []) results.addGroup(group);
        const status = result?.outcome === "FAIL" ? "FAIL" : "SUCCESS";
        if (status === "FAIL" || hasFailedCase(result?.testResults ?? [])) testFailed = true;
        const record = Object.freeze({
          id,
          kind: step.kind,
          name: step.name,
          phase: step.phase,
          status,
          durationMs: performance.now() - stepStarted,
          diagnostics: Object.freeze([...(result?.diagnostics ?? [])]),
          testResults: Object.freeze([...(result?.testResults ?? [])]),
        });
        steps.push(record);
        events.emit("STEP_END", { jobId: job.id, stepId: id, status, durationMs: record.durationMs });
        options.onStep?.({ type: "END", jobId: job.id, step, status, durationMs: record.durationMs, diagnostics: record.diagnostics });
      } catch (cause) {
        infrastructureFailed = true;
        const error = serializeError(cause, phaseError[step.phase]);
        errors.push(error);
        const record = Object.freeze({ id, kind: step.kind, name: step.name, phase: step.phase, status: "ERROR" as const, durationMs: performance.now() - stepStarted, diagnostics: Object.freeze([]), testResults: Object.freeze([]), error });
        steps.push(record);
        events.emit("STEP_END", { jobId: job.id, stepId: id, status: "ERROR", durationMs: record.durationMs });
        options.onStep?.({ type: "END", jobId: job.id, step, status: "ERROR", durationMs: record.durationMs, diagnostics: [] });
      } finally {
        if (heartbeat !== undefined) clearInterval(heartbeat);
      }
    }
  };

  try {
    if (Number.isFinite(jobTimeout)) await runWithTimeout(execute, jobTimeout, options.signal);
    else await execute(options.signal ?? new AbortController().signal);
  } catch (cause) {
    infrastructureFailed = true;
    errors.push(serializeError(cause, "timeout_error"));
  }
  const cleanup = await cleanupStack.run();
  for (const entry of cleanup) if (entry.error !== undefined) errors.push(entry.error);
  for (const resource of resources.list()) if (resource.state === "ready") resources.close(resource.kind, resource.name);
  const groups = results.list();
  const status = aggregate(steps, groups, cleanup, job.policy.allowEmpty);
  const endedAt = new Date();
  events.emit("JOB_END", { jobId: job.id, status });
  return Object.freeze({
    jobId: job.id,
    level: job.level,
    status,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationMs: performance.now() - started,
    steps: Object.freeze(steps),
    groups,
    cleanup,
    errors: Object.freeze(errors),
    artifacts: artifacts.list(),
    resources: Object.freeze(resources.list().map(({ handle: _handle, ...resource }) => Object.freeze(resource))),
  });
}
