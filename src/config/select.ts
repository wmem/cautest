import { CautestError } from "../model/error.js";
import { globMatcher } from "../pattern/glob.js";
import type { TestJob } from "./schema/common.js";

/** Job-level selection shared by frontends; does not alter C Suite/Case selection. */
export interface JobSelectionInput {
  /** Job ID glob patterns. Multiple patterns are OR'ed. */
  readonly selectors?: readonly string[];
  /** Exact categorical levels, OR'ed; integration does not imply unit. */
  readonly levels?: readonly string[];
  /** Required tags. All tags must match (AND). */
  readonly tags?: readonly string[];
  /** Inspection may include disabled jobs. Execution must leave this false. */
  readonly includeDisabled?: boolean;
}

const fields = new Set(["selectors", "levels", "tags", "includeDisabled"]);
const levels = new Set(["unit", "component", "integration", "system"]);

function strings(value: unknown, label: string): readonly string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new CautestError(`Job selection ${label} 必须是字符串数组`, { code: "config_error" });
  }
  return value as readonly string[];
}

/**
 * Select existing Job objects in their original order, without running a Step,
 * loading modules or modifying Job metadata. Dimensions are AND'ed. Disabled
 * jobs remain excluded even when their ID is explicitly selected.
 *
 * CLI adapters are responsible for splitting their own comma/repeated options;
 * this API deliberately treats each array entry as one exact value/pattern.
 */
export function selectJobs(jobs: readonly TestJob[], input: JobSelectionInput = {}): readonly TestJob[] {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new CautestError("Job selection 必须是对象", { code: "config_error" });
  }
  const unknown = Object.keys(input).filter((field) => !fields.has(field));
  if (unknown.length > 0) throw new CautestError(`Job selection 包含未知字段: ${unknown.join(", ")}`, { code: "config_error" });
  if (input.includeDisabled !== undefined && typeof input.includeDisabled !== "boolean") {
    throw new CautestError("Job selection includeDisabled 必须是布尔值", { code: "config_error" });
  }
  const selectedLevels = strings(input.levels, "levels");
  for (const level of selectedLevels) {
    // Preserve the diagnostic of the original JS CLI.
    if (!levels.has(level)) throw new CautestError(`--level 无效: ${level}`, { code: "config_error" });
  }
  const matchers = strings(input.selectors, "selectors").map((selector) => globMatcher(selector));
  const tags = strings(input.tags, "tags");
  return Object.freeze(jobs.filter((job) => (input.includeDisabled === true || job.enabled)
    && (matchers.length === 0 || matchers.some((match) => match(job.id)))
    && (selectedLevels.length === 0 || selectedLevels.includes(job.level))
    && tags.every((tag) => job.tags.includes(tag))));
}
