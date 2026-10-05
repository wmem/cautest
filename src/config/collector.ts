import type { RunCollector, RunCollectorInput } from "./schema/common.js";
import { CautestError } from "../model/error.js";

const RUN_COLLECTOR = Symbol.for("@cautest/config/run-collector");

/** 声明收集器，实际回调只在本轮所有 Job 完成后执行。 */
export function runCollector(input: RunCollectorInput): RunCollector {
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw new CautestError("runCollector() 参数必须是对象", { code: "config_error" });
  const unknown = Object.keys(input).filter(key => !["id", "timeoutMs", "details", "collect"].includes(key));
  if (unknown.length) throw new CautestError(`Run Collector 包含未知字段: ${unknown.join(", ")}`, { code: "config_error" });
  if (typeof input.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(input.id) || input.id.includes("..")) throw new CautestError("Run Collector ID 必须是安全标识符", { code: "config_error" });
  if (typeof input.collect !== "function") throw new CautestError("Run Collector collect 必须是函数", { code: "config_error" });
  if (input.timeoutMs !== undefined && (!Number.isFinite(input.timeoutMs) || input.timeoutMs <= 0)) throw new CautestError("Run Collector timeoutMs 必须为正数", { code: "config_error" });
  if (input.details !== undefined && (typeof input.details !== "object" || input.details === null || Array.isArray(input.details))) throw new CautestError("Run Collector details 必须是对象", { code: "config_error" });
  return Object.freeze({ ...input, [RUN_COLLECTOR]: true }) as unknown as RunCollector;
}

export function isRunCollector(value: unknown): value is RunCollector {
  return typeof value === "object" && value !== null && (value as Record<symbol, unknown>)[RUN_COLLECTOR] === true;
}
