import type { TestConfig, TestJob, TestJobOrigin, WorkflowStep } from "./schema/common.js";
import { CautestError } from "../model/error.js";
import { getJobOrigin } from "./provenance.js";

export interface PlannedStep {
  readonly id: string;
  readonly index: number;
  readonly kind: string;
  readonly name: string;
  readonly phase: WorkflowStep["phase"];
  readonly runWhen: WorkflowStep["runWhen"];
  readonly timeoutMs?: number;
}

export interface PlannedJob {
  readonly id: string;
  readonly level: TestJob["level"];
  readonly description: string;
  readonly tags: readonly string[];
  readonly enabled: boolean;
  readonly origin?: TestJobOrigin;
  readonly workflow: readonly PlannedStep[];
}

function plannedStep(step: WorkflowStep, index: number): PlannedStep {
  const position = String(index + 1).padStart(2, "0");
  return Object.freeze({
    id: `${position}-${step.phase}-${step.kind}-${step.name}`,
    index,
    kind: step.kind,
    name: step.name,
    phase: step.phase,
    runWhen: step.runWhen,
    ...(step.timeoutMs === undefined ? {} : { timeoutMs: step.timeoutMs }),
  });
}

/** 将最终 Test Job 转换为 CLI 可打印的稳定线性计划。 */
export function planConfig(config: TestConfig, selectors: readonly string[] = []): readonly PlannedJob[] {
  const requested = new Set(selectors);
  const selected = selectors.length === 0 ? config.jobs : config.jobs.filter((job) => requested.has(job.id));
  if (selectors.length > 0) {
    const found = new Set(selected.map((job) => job.id));
    const missing = selectors.filter((id) => !found.has(id));
    if (missing.length > 0) throw new CautestError(`未找到 Test Job: ${missing.join(", ")}`, { code: "selection_error" });
  }
  return Object.freeze(selected.map((job) => {
    const origin = getJobOrigin(job);
    return Object.freeze({
      id: job.id,
      level: job.level,
      description: job.description,
      tags: job.tags,
      enabled: job.enabled,
      ...(origin === undefined ? {} : { origin }),
      workflow: Object.freeze(job.workflow.map(plannedStep)),
    });
  }));
}
