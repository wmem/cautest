import path from "node:path";
import { pathToFileURL } from "node:url";
import type { ScriptSystemTestDefinition, ScriptSystemTestJobInput, TestCaseResult, TestJob } from "../config/schema/index.js";
import { testJob } from "../config/define.js";
import { CautestError } from "../model/error.js";
import { defineStep } from "../workflow/step.js";
import { executeScriptTest, isScriptTest } from "../system/script-test.js";

function safeName(file: string): string { return path.basename(file).replace(/\.[^.]+$/u, "").replace(/[^A-Za-z0-9_-]/gu, "-"); }

async function withTimeout(run: (signal: AbortSignal) => void | Promise<void>, timeoutMs: number, outer: AbortSignal): Promise<void> {
  const controller = new AbortController();
  const abort = () => controller.abort(outer.reason);
  outer.addEventListener("abort", abort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([Promise.resolve().then(() => run(controller.signal)), new Promise<never>((_, reject) => { timer = setTimeout(() => { const error = new CautestError(`Script Case 超时 (${timeoutMs} ms)`, { code: "timeout_error" }); controller.abort(error); reject(error); }, timeoutMs); })]);
  } finally { if (timer !== undefined) clearTimeout(timer); outer.removeEventListener("abort", abort); }
}

/** 执行 Default Export 为强类型 Case 列表的 JavaScript System Test。 */
export function scriptSystemTestJob(input: ScriptSystemTestJobInput): TestJob {
  if (typeof input.file !== "string" || input.file.length === 0) throw new CautestError("scriptSystemTestJob.file 必填", { code: "config_error" });
  const name = input.name ?? safeName(input.file);
  const step = defineStep({ kind: "scriptSystemRun", name, phase: "run", details: { file: input.file, caseTimeoutMs: input.caseTimeoutMs ?? 30_000 }, ...(input.stepTimeoutMs === undefined ? {} : { timeoutMs: input.stepTimeoutMs }), async execute(context) {
    const file = path.resolve(context.project.configDir, input.file);
    const loaded = await import(`${pathToFileURL(file).href}?cautest=${Date.now()}`) as { default?: unknown };
    if (isScriptTest(loaded.default)) {
      const group = await executeScriptTest(loaded.default, { name, caseTimeoutMs: input.caseTimeoutMs ?? 30_000, env: context.job.env, signal: context.signal });
      return { outcome: group.cases.some((item) => item.status === "FAIL" || item.status === "ERROR") ? "FAIL" : "SUCCESS", testResults: [group] };
    }
    const definition = loaded.default as Partial<ScriptSystemTestDefinition> | undefined;
    if (definition === undefined || !Array.isArray(definition.cases) || definition.cases.length === 0) throw new CautestError(`Script Test ${input.file} 必须导出非空 cases[]`, { code: "config_error" });
    const names = new Set<string>();
    const cases: TestCaseResult[] = [];
    for (const candidate of definition.cases) {
      if (typeof candidate?.name !== "string" || candidate.name.length === 0 || typeof candidate.run !== "function") throw new CautestError(`Script Test ${input.file} Case Schema 无效`, { code: "config_error" });
      if (names.has(candidate.name)) throw new CautestError(`Script Case 名称重复: ${candidate.name}`, { code: "config_error" });
      names.add(candidate.name);
      try { await withTimeout((signal) => candidate.run({ signal, env: context.job.env }), input.caseTimeoutMs ?? 30_000, context.signal); cases.push(Object.freeze({ name: candidate.name, status: "PASS", assertions: [], diagnostics: [] })); }
      catch (error) { cases.push(Object.freeze({ name: candidate.name, status: "ERROR", assertions: [], diagnostics: [{ code: "script_error", message: error instanceof Error ? error.message : String(error) }] })); }
    }
    return { outcome: cases.some((item) => item.status === "ERROR") ? "FAIL" : "SUCCESS", testResults: [Object.freeze({ name, cases: Object.freeze(cases) })] };
  } });
  return testJob({ id: input.id, level: input.level ?? "system", tags: input.tags ?? ["system", "script"], workflow: [step], ...(input.description === undefined ? {} : { description: input.description }), ...(input.enabled === undefined ? {} : { enabled: input.enabled }), ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }), ...(input.env === undefined ? {} : { env: input.env }), ...(input.policy === undefined ? {} : { policy: input.policy }) });
}
