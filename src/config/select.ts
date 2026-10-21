import { CautestError } from "../model/error.js";
import { globMatcher } from "../pattern/glob.js";
import type { TestJob, TestSelectionPolicy } from "./schema/common.js";
import { normalizeSelectionPolicy } from "./define.js";

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
  readonly collections?: readonly string[];
  readonly environments?: readonly string[];
  readonly policy?: TestSelectionPolicy;
}

const fields = new Set(["selectors", "levels", "tags", "includeDisabled", "collections", "environments", "policy"]);
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
  const environments = strings(input.environments, "environments");
  const policy = normalizeSelectionPolicy(input.policy, jobs);
  const selectedEnvironments = environments.length > 0 ? environments
    : matchers.length > 0 ? [] : (policy?.defaultEnvironments ?? []);
  for (const name of selectedEnvironments) {
    if (name !== "*" && !jobs.some(job => job.testEnvironment === name)) throw new CautestError(`未知 environment: ${name}`, { code: "config_error" });
  }
  const collections = strings(input.collections, "collections");
  const expanded = new Set<string>();
  const graph = policy?.collections ?? {};
  const expand = (name: string, active: Set<string>): void => {
    if (name === "*") { expanded.add(name); return; }
    if (!Object.hasOwn(graph, name)) throw new CautestError(`未知 collection: ${name}`, { code: "config_error" });
    if (active.has(name)) throw new CautestError(`collection 继承循环: ${name}`, { code: "config_error" });
    expanded.add(name);
    for (const child of graph[name]!) expand(child, new Set([...active, name]));
  };
  for (const name of collections) expand(name, new Set());
  return Object.freeze(jobs.filter((job) => (input.includeDisabled === true || job.enabled)
    && (matchers.length === 0 || matchers.some((match) => match(job.id)))
    && (selectedLevels.length === 0 || selectedLevels.includes(job.level))
    && tags.every((tag) => job.tags.includes(tag))
    && (selectedEnvironments.length === 0 || selectedEnvironments.includes("*") || (job.testEnvironment !== undefined && selectedEnvironments.includes(job.testEnvironment)))
    && (collections.length === 0 || expanded.has("*") || job.collections?.some(name => expanded.has(name)))));
}
