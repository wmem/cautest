import type { StepExecutionResult, TestJob, WorkflowStep } from "../config/schema/common.js";
import { CautestError } from "../model/error.js";
import { stepExecutor } from "./step.js";

export type StepStatus = "SUCCESS" | "SKIPPED" | "ERROR";

export interface ExecutedStep {
  readonly kind: string;
  readonly name: string;
  readonly phase: WorkflowStep["phase"];
  readonly status: StepStatus;
  readonly durationMs: number;
  readonly diagnostics: readonly unknown[];
  readonly error?: Error;
}

export interface ExecutedWorkflow {
  readonly jobId: string;
  readonly status: "SUCCESS" | "ERROR";
  readonly steps: readonly ExecutedStep[];
}

export interface WorkflowExecutionOptions {
  readonly signal?: AbortSignal;
  readonly defaultStepTimeoutMs?: number;
  readonly defaultJobTimeoutMs?: number;
  readonly onStep?: (event: { readonly type: "START" | "END"; readonly jobId: string; readonly step: WorkflowStep; readonly status?: StepStatus }) => void;
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
  const steps: ExecutedStep[] = [];
  const state = new Map<string, unknown>();
  let failed = false;
  const jobTimeout = job.timeoutMs ?? options.defaultJobTimeoutMs ?? Number.POSITIVE_INFINITY;
  const execute = async (jobSignal: AbortSignal) => {
    for (const step of job.workflow) {
      const shouldRun = step.runWhen === "always" || (step.runWhen === "on-failure" ? failed : !failed);
      if (!shouldRun) {
        steps.push({ kind: step.kind, name: step.name, phase: step.phase, status: "SKIPPED", durationMs: 0, diagnostics: [] });
        continue;
      }
      options.onStep?.({ type: "START", jobId: job.id, step });
      const started = performance.now();
      try {
        const timeoutMs = step.timeoutMs ?? options.defaultStepTimeoutMs ?? 60_000;
        const result = await runWithTimeout(
          async (signal) => await stepExecutor(step)({ job, signal, state }),
          timeoutMs,
          jobSignal,
        ) as StepExecutionResult | void;
        steps.push({
          kind: step.kind,
          name: step.name,
          phase: step.phase,
          status: "SUCCESS",
          durationMs: performance.now() - started,
          diagnostics: result?.diagnostics ?? [],
        });
        options.onStep?.({ type: "END", jobId: job.id, step, status: "SUCCESS" });
      } catch (cause) {
        failed = true;
        steps.push({
          kind: step.kind,
          name: step.name,
          phase: step.phase,
          status: "ERROR",
          durationMs: performance.now() - started,
          diagnostics: [],
          error: errorValue(cause),
        });
        options.onStep?.({ type: "END", jobId: job.id, step, status: "ERROR" });
      }
    }
  };
  if (Number.isFinite(jobTimeout)) await runWithTimeout(execute, jobTimeout, options.signal);
  else await execute(options.signal ?? new AbortController().signal);
  return Object.freeze({ jobId: job.id, status: failed ? "ERROR" : "SUCCESS", steps: Object.freeze(steps) });
}
