import { access } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { TestConfig } from "./schema/common.js";
import { isTestConfig } from "./define.js";
import { CautestError } from "../model/error.js";
import { calculateConfigHash } from "./hash.js";
import { getJobOrigin, setJobOrigin } from "./provenance.js";
import { collectConfigSources, enableConfigSourceTracking } from "./source-tracker.js";

const configNames = ["cautest.config.js", "cautest.config.mjs", "cautest.config.cjs"] as const;

export interface LoadedConfig {
  readonly config: TestConfig;
  readonly path: string;
  readonly dir: string;
  readonly hash: string;
  readonly sources: readonly string[];
}

export async function findConfig(startDirectory = process.cwd()): Promise<string> {
  let current = path.resolve(startDirectory);
  while (true) {
    for (const name of configNames) {
      const candidate = path.join(current, name);
      try {
        await access(candidate);
        return candidate;
      } catch (error) {
        if (!(typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT")) throw error;
      }
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new CautestError(`从 ${startDirectory} 向上未找到 cautest.config.js/mjs/cjs`, { code: "config_error" });
}

export async function loadConfig(configPath?: string): Promise<LoadedConfig> {
  const resolved = configPath === undefined ? await findConfig() : path.resolve(configPath);
  const configUrl = pathToFileURL(resolved).href;
  enableConfigSourceTracking();
  let loaded: Record<string, unknown>;
  try {
    loaded = await import(configUrl) as Record<string, unknown>;
  } catch (cause) {
    throw new CautestError(`无法加载配置 ${resolved}: ${cause instanceof Error ? cause.message : String(cause)}`, {
      code: "config_error",
      cause,
    });
  }
  if (!isTestConfig(loaded.default)) {
    throw new CautestError(`配置 ${resolved} 的 default export 必须由 testConfig() 创建`, { code: "config_error" });
  }
  for (const job of loaded.default.jobs) {
    if (getJobOrigin(job) === undefined) {
      setJobOrigin(job, { source: pathToFileURL(resolved).href, configPath: `jobs.${job.id}` });
    }
  }
  const importedSources = await collectConfigSources(configUrl, resolved);
  const fingerprint = await calculateConfigHash(loaded.default, resolved, importedSources);
  return {
    config: loaded.default,
    path: resolved,
    dir: path.dirname(resolved),
    hash: fingerprint.hash,
    sources: fingerprint.sources,
  };
}
