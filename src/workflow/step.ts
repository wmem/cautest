import type { StepExecutionContext, StepExecutionResult, WorkflowPhase, WorkflowStep, WorkflowStepInput } from "../config/schema/common.js";
import { CautestError } from "../model/error.js";
import { flattenWorkflow } from "./fragment.js";

const STEP = Symbol.for("@cautest/config/workflow-step");
const EXECUTOR = Symbol.for("@cautest/config/workflow-executor");
const phases: readonly WorkflowPhase[] = ["prepare", "build", "provision", "run", "collect"];
const runWhenValues = ["on-success", "always", "on-failure"] as const;
const fields = new Set(["kind", "name", "phase", "runWhen", "timeoutMs", "details", "execute"]);

type InternalStep = WorkflowStep & {
  readonly [STEP]: true;
  readonly [EXECUTOR]: (context: StepExecutionContext) => void | StepExecutionResult | Promise<void | StepExecutionResult>;
};

function safeName(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value) || value.includes("..")) {
    throw new CautestError(`${field} 必须是安全标识符`, { code: "config_error" });
  }
}

/** 创建不可变 Workflow Step Descriptor。 */
export function defineStep(input: WorkflowStepInput): WorkflowStep {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new CautestError("defineStep() 需要对象参数", { code: "config_error" });
  }
  const unknown = Object.keys(input).filter((key) => !fields.has(key));
  if (unknown.length > 0) throw new CautestError(`Workflow Step 包含未知字段: ${unknown.join(", ")}`, { code: "config_error" });
  safeName(input.kind, "Step kind");
  const name = input.name ?? input.kind;
  safeName(name, "Step name");
  if (!phases.includes(input.phase)) throw new CautestError(`无效 Workflow phase: ${String(input.phase)}`, { code: "config_error" });
  const runWhen = input.runWhen ?? "on-success";
  if (!runWhenValues.includes(runWhen)) throw new CautestError(`无效 Step runWhen: ${String(runWhen)}`, { code: "config_error" });
  if (runWhen !== "on-success" && input.phase !== "collect") {
    throw new CautestError("只有 collect Step 可以使用 always/on-failure", { code: "config_error" });
  }
  if (input.timeoutMs !== undefined && (!Number.isFinite(input.timeoutMs) || input.timeoutMs <= 0)) {
    throw new CautestError("Step timeoutMs 必须为正数", { code: "config_error" });
  }
  if (typeof input.execute !== "function") throw new CautestError("Step execute 必须是函数", { code: "config_error" });
  if (input.details !== undefined && (typeof input.details !== "object" || input.details === null || Array.isArray(input.details))) {
    throw new CautestError("Step details 必须是对象", { code: "config_error" });
  }
  return Object.freeze({
    [STEP]: true,
    [EXECUTOR]: input.execute,
    kind: input.kind,
    name,
    phase: input.phase,
    runWhen,
    details: Object.freeze({ ...(input.details ?? {}) }),
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
  }) as InternalStep;
}

export function isWorkflowStep(value: unknown): value is WorkflowStep {
  return typeof value === "object" && value !== null && (value as Partial<InternalStep>)[STEP] === true;
}

export function stepExecutor(step: WorkflowStep): InternalStep[typeof EXECUTOR] {
  if (!isWorkflowStep(step)) throw new CautestError("Workflow 包含非 Step Descriptor", { code: "config_error" });
  return (step as InternalStep)[EXECUTOR];
}

export function normalizeWorkflow(value: unknown): readonly WorkflowStep[] {
  if (!Array.isArray(value)) {
    throw new CautestError("Test Job workflow 必须是非空 Step 数组", { code: "config_error" });
  }
  const flattened = flattenWorkflow(value);
  if (flattened.length === 0) throw new CautestError("Test Job workflow 必须是非空 Step 数组", { code: "config_error" });
  let previous = -1;
  const output = flattened.map((step, index) => {
    const current = phases.indexOf(step.phase);
    if (current < previous) throw new CautestError(`workflow[${index}] 的 phase ${step.phase} 发生逆序`, { code: "config_error" });
    previous = current;
    return step;
  });
  return Object.freeze(output);
}
