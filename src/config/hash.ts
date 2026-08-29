import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { TestConfig, TestJob } from "./schema/common.js";
import { CautestError } from "../model/error.js";
import { getJobOrigin } from "./provenance.js";

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, stable(child)]));
  }
  return value;
}

function resolvedJob(job: TestJob, configDir: string): unknown {
  const origin = getJobOrigin(job);
  return {
    id: job.id,
    level: job.level,
    description: job.description,
    tags: job.tags,
    enabled: job.enabled,
    timeoutMs: job.timeoutMs,
    env: job.env,
    policy: job.policy,
    workflow: job.workflow.map((step) => ({
      kind: step.kind,
      name: step.name,
      phase: step.phase,
      runWhen: step.runWhen,
      timeoutMs: step.timeoutMs,
      details: step.details,
    })),
    origin: origin === undefined ? undefined : {
      source: sourceIdentity(fileURLToPath(origin.source), configDir),
      configPath: origin.configPath,
    },
  };
}

function sourceIdentity(sourcePath: string, configDir: string): string {
  const relative = path.relative(configDir, sourcePath).split(path.sep).join("/");
  return relative.length === 0 ? path.basename(sourcePath) : relative;
}

export interface ConfigHashResult {
  readonly hash: string;
  readonly sources: readonly string[];
}

/** 对所有已发现的配置来源内容和最终归一化结果计算位置无关的 SHA-256。 */
export async function calculateConfigHash(
  config: TestConfig,
  configPath: string,
  importedSources: readonly string[] = [],
): Promise<ConfigHashResult> {
  const configDir = path.dirname(configPath);
  const sourcePaths = new Set<string>([configPath, ...importedSources]);
  for (const job of config.jobs) {
    const origin = getJobOrigin(job);
    if (origin !== undefined) sourcePaths.add(fileURLToPath(origin.source));
  }
  const ordered = [...sourcePaths].sort((left, right) => sourceIdentity(left, configDir).localeCompare(sourceIdentity(right, configDir)));
  const hash = createHash("sha256").update("cautest-config-v2\0");
  for (const sourcePath of ordered) {
    let contents: Buffer;
    try {
      contents = await readFile(sourcePath);
    } catch (cause) {
      throw new CautestError(`无法读取配置来源 ${sourcePath}`, { code: "config_error", cause });
    }
    const identity = sourceIdentity(sourcePath, configDir);
    hash.update(`${identity.length}:${identity}:${contents.length}:`);
    hash.update(contents);
  }
  hash.update(JSON.stringify(stable({
    defaults: config.defaults,
    profiles: config.profiles,
    jobs: config.jobs.map((job) => resolvedJob(job, configDir)),
  })));
  return Object.freeze({ hash: hash.digest("hex"), sources: Object.freeze(ordered) });
}
