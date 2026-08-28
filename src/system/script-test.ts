import type { TestCaseResult, TestSuiteResult } from "../config/schema/common.js";
import { CautestError } from "../model/error.js";
import { isDeepStrictEqual } from "node:util";

const SCRIPT_TEST = Symbol.for("@cautest/script-test");

export interface ScriptCaseContext {
  readonly signal: AbortSignal;
  expect(value: unknown, message?: string): void;
  expectEqual(expected: unknown, actual: unknown, message?: string): void;
  assert(value: unknown, message?: string): asserts value;
  assertEqual(expected: unknown, actual: unknown, message?: string): void;
  fail(reason?: string): void;
  skip(reason?: string): never;
  log(message: unknown): void;
  attach(name: string, value: unknown): void;
  wait(milliseconds: number): Promise<void>;
}

export interface ScriptTestApi {
  case(name: string, callback: (context: ScriptCaseContext) => void | Promise<void>, options?: { readonly timeoutMs?: number }): Promise<TestCaseResult>;
}

export interface ScriptExecRequest { readonly program: string; readonly args?: readonly string[]; readonly cwd?: string; readonly env?: Readonly<Record<string, string>> }
export interface ScriptExecResult { readonly exitCode: number; readonly stdout: string; readonly stderr: string }
export type ScriptExec = (request: ScriptExecRequest) => Promise<ScriptExecResult>;

export interface ScriptTestContext {
  readonly test: ScriptTestApi;
  readonly exec: ScriptExec;
  readonly signal: AbortSignal;
  readonly env: Readonly<Record<string, string>>;
}

export interface ScriptTestDefinition {
  readonly [SCRIPT_TEST]: true;
  readonly define: (context: ScriptTestContext) => void | Promise<void>;
}

class CaseStop extends Error {
  readonly kind: "assert" | "skip";
  constructor(kind: "assert" | "skip", message: string) { super(message); this.kind = kind; }
}

/** 定义具备 EXPECT/ASSERT/SKIP 语义的 Script Test。 */
export function defineScriptTest(definition: ScriptTestDefinition["define"]): ScriptTestDefinition {
  if (typeof definition !== "function") throw new CautestError("defineScriptTest() 需要函数", { code: "config_error" });
  return Object.freeze({ [SCRIPT_TEST]: true as const, define: definition });
}

export function isScriptTest(value: unknown): value is ScriptTestDefinition { return typeof value === "object" && value !== null && (value as Partial<ScriptTestDefinition>)[SCRIPT_TEST] === true; }

function timeoutError(milliseconds: number): CautestError { return new CautestError(`Script Case 超时 (${milliseconds} ms)`, { code: "timeout_error" }); }

/** 执行一个 Script Test Definition 并返回结构化 Result Group。 */
export async function executeScriptTest(definition: ScriptTestDefinition, options: { readonly name?: string; readonly caseTimeoutMs?: number; readonly env?: Readonly<Record<string, string>>; readonly signal?: AbortSignal; readonly exec?: ScriptExec; readonly onEvent?: (type: string, payload: Readonly<Record<string, unknown>>) => unknown } = {}): Promise<TestSuiteResult> {
  if (!isScriptTest(definition)) throw new CautestError("executeScriptTest() 需要 defineScriptTest() 的返回值", { code: "config_error" });
  const cases: TestCaseResult[] = [];
  const names = new Set<string>();
  const timeoutMs = options.caseTimeoutMs ?? 30_000;
  const signal = options.signal ?? new AbortController().signal;
  const event = (type: string, payload: Readonly<Record<string, unknown>> = {}): void => { options.onEvent?.(type, payload); };
  event("TEST_GROUP_START", { group: options.name ?? "script" });
  const api: ScriptTestApi = Object.freeze({
    async case(name: string, callback: (context: ScriptCaseContext) => void | Promise<void>, caseOptions: { readonly timeoutMs?: number } = {}) {
      if (typeof name !== "string" || name.length === 0 || typeof callback !== "function") throw new CautestError("Script Case 需要 name 和 callback", { code: "config_error" });
      if (names.has(name)) throw new CautestError(`Script Case 名称重复: ${name}`, { code: "config_error" });
      names.add(name);
      event("CASE_START", { case: name });
      const started = performance.now();
      const failures: Array<{ readonly message: string; readonly expected?: unknown; readonly actual?: unknown }> = [];
      const logs: string[] = [];
      const attachments: Array<{ readonly name: string; readonly value: unknown }> = [];
      const controller = new AbortController();
      const outerAbort = (): void => controller.abort(signal.reason);
      signal.addEventListener("abort", outerAbort, { once: true });
      let timer: ReturnType<typeof setTimeout> | undefined;
      const addFailure = (failure: { readonly message: string; readonly expected?: unknown; readonly actual?: unknown }): void => {
        failures.push(failure);
        event("ASSERTION", { case: name, passed: false, ...failure });
      };
      const context: ScriptCaseContext = Object.freeze({
        signal: controller.signal,
        expect(value: unknown, message = "Expectation 失败") { if (!value) addFailure({ message }); },
        expectEqual(expected: unknown, actual: unknown, message = "值不相等") { if (!isDeepStrictEqual(expected, actual)) addFailure({ message, expected, actual }); },
        assert(value: unknown, message = "Assertion 失败"): asserts value { if (!value) { addFailure({ message }); throw new CaseStop("assert", message); } },
        assertEqual(expected: unknown, actual: unknown, message = "值不相等") { if (!isDeepStrictEqual(expected, actual)) { addFailure({ message, expected, actual }); throw new CaseStop("assert", message); } },
        fail(reason = "显式失败") { addFailure({ message: reason }); },
        skip(reason = "显式跳过"): never { throw new CaseStop("skip", reason); },
        log(message: unknown) { logs.push(String(message)); },
        attach(attachmentName: string, value: unknown) {
          if (typeof attachmentName !== "string" || attachmentName.length === 0) throw new CautestError("Attachment name 必须是非空字符串", { code: "config_error" });
          attachments.push(Object.freeze({ name: attachmentName, value }));
        },
        async wait(milliseconds: number) {
          await new Promise<void>((resolve, reject) => {
            const waitTimer = setTimeout(resolve, milliseconds);
            const abort = (): void => { clearTimeout(waitTimer); reject(controller.signal.reason); };
            controller.signal.addEventListener("abort", abort, { once: true });
          });
        },
      });
      let status: TestCaseResult["status"] = "PASS";
      let error: TestCaseResult["error"];
      try {
        if (controller.signal.aborted) throw controller.signal.reason;
        await Promise.race([
          Promise.resolve().then(() => callback(context)),
          new Promise<never>((_resolve, reject) => { controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true }); }),
          new Promise<never>((_resolve, reject) => { const selectedTimeout = caseOptions.timeoutMs ?? timeoutMs; timer = setTimeout(() => { const failure = timeoutError(selectedTimeout); controller.abort(failure); reject(failure); }, selectedTimeout); }),
        ]);
        if (failures.length > 0) status = "FAIL";
      } catch (cause) {
        if (cause instanceof CaseStop) { status = cause.kind === "skip" ? "SKIP" : "FAIL"; if (cause.kind === "skip") error = { message: cause.message }; }
        else { status = "ERROR"; error = { ...(cause instanceof CautestError ? { code: cause.code } : {}), message: cause instanceof Error ? cause.message : String(cause) }; }
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        signal.removeEventListener("abort", outerAbort);
      }
      const result = Object.freeze({
        name,
        status,
        assertions: Object.freeze([]),
        diagnostics: Object.freeze(error === undefined ? [] : [error]),
        durationMs: performance.now() - started,
        ...(failures.length === 0 ? {} : { failures: Object.freeze(failures) }),
        ...(logs.length === 0 ? {} : { logs: Object.freeze(logs) }),
        ...(attachments.length === 0 ? {} : { attachments: Object.freeze(attachments) }),
        ...(error === undefined ? {} : { error: Object.freeze(error) }),
      });
      cases.push(result);
      if (status === "SKIP") event("SKIP", { case: name, reason: error?.message ?? "显式跳过" });
      event("CASE_END", { case: name, status, durationMs: result.durationMs });
      return result;
    },
  });
  const exec = options.exec ?? (async () => { throw new CautestError("当前 executeScriptTest() 调用未提供 exec 实现", { code: "tooling_error" }); });
  await definition.define({ test: api, exec, signal, env: Object.freeze({ ...(options.env ?? {}) }) });
  const group = Object.freeze({ name: options.name ?? "script", cases: Object.freeze(cases) });
  event("TEST_GROUP_END", { group: group.name });
  return group;
}
