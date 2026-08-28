import type { CTestRunInput, StepExecutionContext, StepExecutionResult } from "../config/schema/common.js";
import { CautestError } from "../model/error.js";
import type { EventRecorder } from "../workflow/events.js";
import type { CTestSessionResult, SessionEvent } from "./session.js";

/** 将 Target 语义事件写入当前 Run 的流式 EventRecorder。 */
export function workflowSessionEventSink(events: EventRecorder, jobId: string): (event: SessionEvent) => Promise<void> {
  return async ({ type, ...payload }) => { await events.emitTransient(type, { jobId, ...payload }); };
}

/** 合并本次 CLI Run 对指定 C Test Step 的临时覆盖。 */
export function effectiveWorkflowCTestRun(context: Pick<StepExecutionContext, "cTestRun">, configured: CTestRunInput, stepName: string): CTestRunInput {
  const overrides = context.cTestRun;
  if (overrides === undefined || (overrides.step !== undefined && overrides.step !== stepName)) return configured;
  const { step: _step, ...values } = overrides;
  return Object.freeze({ ...configured, ...values });
}

/** 在保留已取得 Case Result 的同时，把 Session 级错误提升为 Workflow ERROR。 */
export function workflowSessionResult(result: CTestSessionResult, options: { readonly label: string; readonly allowEmpty: boolean }): StepExecutionResult {
  const cases = result.groups.flatMap((suite) => suite.cases);
  const diagnostics = [
    {
      code: "c_test_session",
      message: `${options.label}: catalog=${result.catalog.length}, selected=${result.selection.length}, executions=${result.executionCount}, cases=${cases.length}, events=${result.eventCount}`,
      hello: result.hello,
      catalog: result.catalog,
      selection: result.selection,
      executionCount: result.executionCount,
      eventCount: result.eventCount,
    },
    ...result.groupDiagnostics,
    ...result.executionErrors,
  ];
  if (result.executionErrors.length > 0) {
    return {
      outcome: "ERROR",
      error: new CautestError(`${options.label} Target 执行错误`, { code: "target_error", details: result.executionErrors }),
      testResults: result.groups,
      diagnostics,
    };
  }
  if (cases.length === 0 && !options.allowEmpty) throw new CautestError(`${options.label} 没有选中任何 Case`, { code: "selection_error" });
  return {
    outcome: cases.some((item) => item.status === "FAIL" || item.status === "ERROR") ? "FAIL" : "SUCCESS",
    testResults: result.groups,
    diagnostics,
  };
}
