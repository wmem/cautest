import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { TestJob, TestJobOrigin } from "./schema/common.js";
import { CautestError } from "../model/error.js";

const origins = new WeakMap<TestJob, TestJobOrigin>();

export function normalizeSource(source: string): string {
  if (typeof source !== "string" || source.length === 0) {
    throw new CautestError("配置来源 source 必须是 import.meta.url 或绝对路径", { code: "config_error" });
  }
  try {
    const url = new URL(source);
    if (url.protocol !== "file:") throw new Error("not file");
    return pathToFileURL(fileURLToPath(url)).href;
  } catch {
    if (!path.isAbsolute(source)) {
      throw new CautestError(`配置来源必须是本地文件 URL 或绝对路径: ${source}`, { code: "config_error" });
    }
    return pathToFileURL(path.resolve(source)).href;
  }
}

export function setJobOrigin(job: TestJob, origin: TestJobOrigin): void {
  origins.set(job, Object.freeze({ source: normalizeSource(origin.source), configPath: origin.configPath }));
}

export function getJobOrigin(job: TestJob): TestJobOrigin | undefined {
  return origins.get(job);
}

export function jobOriginText(job: TestJob | undefined): string {
  const origin = job === undefined ? undefined : getJobOrigin(job);
  if (origin === undefined) return "未知来源";
  return `${fileURLToPath(origin.source)}:${origin.configPath}`;
}
