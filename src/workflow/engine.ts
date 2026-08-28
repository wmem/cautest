import path from "node:path";
import type { StepExecutionResult, TestJob, TestSuiteResult, WorkflowProjectContext, WorkflowStep } from "../config/schema/common.js";
import { CautestError } from "../model/error.js";
import { stepExecutor } from "./step.js";

export type StepStatus = "SUCCESS" | "FAIL" | "SKIPPED" | "ERROR";

export interface ExecutedStep {
  readonly kind: string;
  readonly name: string;
  readonly phase: WorkflowStep["phase"];
  readonly status: StepStatus;
  readonly durationMs: number;
  readonly diagnostics: readonly unknown[];
  readonly testResults: readonly TestSuiteResult[];
  readonly error?: Error;
}

export interface ExecutedWorkflow {
  readonly jobId: string;
  readonly status: "SUCCESS" | "FAIL" | "ERROR";
  readonly durationMs: number;
  readonly steps: readonly ExecutedStep[];
}

export interface WorkflowExecutionOptions {
  readonly signal?: AbortSignal;
  readonly defaultStepTimeoutMs?: number;
  readonly defaultJobTimeoutMs?: number;
  readonly project?: Partial<WorkflowProjectContext>;
  readonly onOutput?: (event: { readonly jobId: string; readonly step: WorkflowStep; readonly channel: "stdout" | "stderr"; readonly text: string }) => void;
  readonly onStep?: (event: { readonly type: "START" | "END"; readonly jobId: string; readonly step: WorkflowStep; readonly status?: StepStatus; readonly durationMs?: number; readonly diagnostics?: readonly unknown[] }) => void;
}

function errorValue(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

async function runWithTimeout<T>(
  callback: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  outerSignal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort(outerSignal?.reason ?? new Error("Workflow 已取消"));
  outerSignal?.addEventListener("abort", abort, { once: true });
  if (outerSignal?.aborted) abort();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      callback(controller.signal),
      new Promise<never>((_, reject) => {
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

/** 严格按 Test Job 中的顺序执行 Workflow。 */
export async function executeWorkflow(job: TestJob, options: WorkflowExecutionOptions = {}): Promise<ExecutedWorkflow> {
  const workflowStarted = performance.now();
  const steps: ExecutedStep[] = [];
  const state = new Map<string, unknown>();
  let failed = false;
  let testFailed = false;
  let executionError = false;
  const configDir = path.resolve(options.project?.configDir ?? process.cwd());
  const project: WorkflowProjectContext = Object.freeze({
    configDir,
    resultDir: path.resolve(configDir, options.project?.resultDir ?? ".cautest/results"),
    cacheDir: path.resolve(configDir, options.project?.cacheDir ?? ".cautest/cache"),
    generatedDir: path.resolve(configDir, options.project?.generatedDir ?? ".cautest/generated"),
    workDir: path.resolve(configDir, options.project?.workDir ?? ".cautest/work"),
  });
  const jobTimeout = job.timeoutMs ?? options.defaultJobTimeoutMs ?? Number.POSITIVE_INFINITY;
  const execute = async (jobSignal: AbortSignal) => {
    for (const step of job.workflow) {
      const shouldRun = step.runWhen === "always" || (step.runWhen === "on-failure" ? failed : !failed);
      if (!shouldRun) {
        steps.push({ kind: step.kind, name: step.name, phase: step.phase, status: "SKIPPED", durationMs: 0, diagnostics: [], testResults: [] });
        continue;
      }
      options.onStep?.({ type: "START", jobId: job.id, step });
      const started = performance.now();
      try {
        const timeoutMs = step.timeoutMs ?? options.defaultStepTimeoutMs ?? 60_000;
        const result = await runWithTimeout(
          async (signal) => await stepExecutor(step)({
            job,
            signal,
            state,
            project,
            output: (channel, text) => options.onOutput?.({ jobId: job.id, step, channel, text }),
          }),
          timeoutMs,
          jobSignal,
        ) as StepExecutionResult | void;
        const status = result?.outcome === "FAIL" ? "FAIL" : "SUCCESS";
        if (status === "FAIL") {
          failed = true;
          testFailed = true;
        }
        steps.push({
          kind: step.kind,
          name: step.name,
          phase: step.phase,
          status,
          durationMs: performance.now() - started,
          diagnostics: result?.diagnostics ?? [],
          testResults: result?.testResults ?? [],
        });
        options.onStep?.({ type: "END", jobId: job.id, step, status, durationMs: performance.now() - started, diagnostics: result?.diagnostics ?? [] });
      } catch (cause) {
        failed = true;
        executionError = true;
        steps.push({
          kind: step.kind,
          name: step.name,
          phase: step.phase,
          status: "ERROR",
          durationMs: performance.now() - started,
          diagnostics: [],
          testResults: [],
          error: errorValue(cause),
        });
        options.onStep?.({ type: "END", jobId: job.id, step, status: "ERROR", durationMs: performance.now() - started, diagnostics: [] });
      }
    }
  };
  if (Number.isFinite(jobTimeout)) await runWithTimeout(execute, jobTimeout, options.signal);
  else await execute(options.signal ?? new AbortController().signal);
  return Object.freeze({
    jobId: job.id,
    status: executionError ? "ERROR" : (testFailed ? "FAIL" : "SUCCESS"),
    durationMs: performance.now() - workflowStarted,
    steps: Object.freeze(steps),
  });
}
