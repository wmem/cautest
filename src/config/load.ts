import { access } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { TestConfig } from "./schema/common.js";
import { isTestConfig } from "./define.js";
import { CautestError } from "../model/error.js";

const configNames = ["cautest.config.js", "cautest.config.mjs", "cautest.config.cjs"] as const;

export interface LoadedConfig {
  readonly config: TestConfig;
  readonly path: string;
  readonly dir: string;
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
  let loaded: Record<string, unknown>;
  try {
    loaded = await import(pathToFileURL(resolved).href) as Record<string, unknown>;
  } catch (cause) {
    throw new CautestError(`无法加载配置 ${resolved}: ${cause instanceof Error ? cause.message : String(cause)}`, {
      code: "config_error",
      cause,
    });
  }
  if (!isTestConfig(loaded.default)) {
    throw new CautestError(`配置 ${resolved} 的 default export 必须由 testConfig() 创建`, { code: "config_error" });
  }
  return { config: loaded.default, path: resolved, dir: path.dirname(resolved) };
}
