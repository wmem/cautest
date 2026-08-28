import type { TestJob, WorkflowFragment, WorkflowInput, WorkflowPhase, WorkflowStep } from "../config/schema/common.js";
import { CautestError } from "../model/error.js";
import { defineStep, isWorkflowStep, stepExecutor } from "./step.js";

const FRAGMENT = Symbol.for("@cautest/config/workflow-fragment");
const phases: readonly WorkflowPhase[] = ["prepare", "build", "provision", "run", "collect"];
type InternalFragment = WorkflowFragment & { readonly [FRAGMENT]: true };

/** 把 Step、数组和其他 Fragment 包装成可嵌套 Workflow Fragment。 */
export function defineFragment(...entries: readonly WorkflowInput[]): WorkflowFragment {
  return Object.freeze({ [FRAGMENT]: true as const, entries: Object.freeze([...entries]) }) as InternalFragment;
}

export function isWorkflowFragment(value: unknown): value is WorkflowFragment {
  return typeof value === "object" && value !== null && (value as Partial<InternalFragment>)[FRAGMENT] === true;
}

/** 递归展开 Fragment/数组；非法普通对象不会被当成 Step。 */
export function flattenWorkflow(value: unknown): readonly WorkflowStep[] {
  if (!Array.isArray(value)) throw new CautestError("workflow 必须是数组", { code: "config_error" });
  const output: WorkflowStep[] = [];
  const visit = (entry: unknown): void => {
    if (Array.isArray(entry)) for (const child of entry) visit(child);
    else if (isWorkflowFragment(entry)) for (const child of entry.entries) visit(child);
    else if (isWorkflowStep(entry)) output.push(entry);
    else throw new CautestError("workflow 只能包含 Step、Fragment 或其数组", { code: "config_error" });
  };
  visit(value);
  return Object.freeze(output);
}

export interface StandardJobFragmentSelection {
  readonly phases?: readonly WorkflowPhase[];
  readonly kinds?: readonly string[];
  readonly names?: readonly string[];
}

function reusableStep(job: TestJob, step: WorkflowStep): WorkflowStep {
  const execute = stepExecutor(step);
  return defineStep({
    kind: step.kind,
    name: step.name,
    phase: step.phase,
    runWhen: step.runWhen,
    details: { ...step.details, sourceJob: job.id },
    ...(step.timeoutMs === undefined ? {} : { timeoutMs: step.timeoutMs }),
    async execute(context) {
      const sourceView = Object.freeze({ ...context.job, env: Object.freeze({ ...job.env, ...context.job.env }) });
      return await execute(Object.freeze({ ...context, job: sourceView }));
    },
  });
}

/** 直接复用标准 Job 已配置的 Executor，可按 Phase/Kind/Name 选择，无需复制内部构建逻辑。 */
export function standardJobFragment(job: TestJob, selection: StandardJobFragmentSelection = {}): WorkflowFragment {
  const selected = job.workflow.filter((step) => (selection.phases === undefined || selection.phases.includes(step.phase))
    && (selection.kinds === undefined || selection.kinds.includes(step.kind))
    && (selection.names === undefined || selection.names.includes(step.name))).map((step) => reusableStep(job, step));
  if (selected.length === 0) throw new CautestError(`Standard Job ${job.id} 的 Fragment 选择为空`, { code: "config_error" });
  return defineFragment(...selected);
}

/** 将多个标准 Job 的 Step 按固定 Phase 合并，同时保留每个 Job 内同 Phase 的依赖顺序。 */
export function composeJobWorkflows(...jobs: readonly TestJob[]): WorkflowFragment {
  if (jobs.length === 0) throw new CautestError("composeJobWorkflows() 至少需要一个 Test Job", { code: "config_error" });
  const entries = phases.flatMap((phase) => jobs.flatMap((job) => job.workflow.filter((step) => step.phase === phase).map((step) => reusableStep(job, step))));
  return defineFragment(...entries);
}
