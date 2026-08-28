import type { TestCaseResult, TestSuiteResult } from "../config/schema/common.js";
import { CautestError } from "../model/error.js";

const SCRIPT_TEST = Symbol.for("@cautest/script-test");

export interface ScriptCaseContext {
  readonly signal: AbortSignal;
  expect(value: unknown, message?: string): void;
  expectEqual(expected: unknown, actual: unknown, message?: string): void;
  assert(value: unknown, message?: string): asserts value;
  skip(reason: string): never;
  log(message: unknown): void;
  wait(milliseconds: number): Promise<void>;
}

export interface ScriptTestApi {
  case(name: string, callback: (context: ScriptCaseContext) => void | Promise<void>): Promise<void>;
}

export interface ScriptTestDefinition {
  readonly [SCRIPT_TEST]: true;
  readonly define: (context: { readonly test: ScriptTestApi; readonly env: Readonly<Record<string, string>> }) => void | Promise<void>;
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
export async function executeScriptTest(definition: ScriptTestDefinition, options: { readonly name?: string; readonly caseTimeoutMs?: number; readonly env?: Readonly<Record<string, string>>; readonly signal?: AbortSignal } = {}): Promise<TestSuiteResult> {
  if (!isScriptTest(definition)) throw new CautestError("executeScriptTest() 需要 defineScriptTest() 的返回值", { code: "config_error" });
  const cases: TestCaseResult[] = [];
  const names = new Set<string>();
  const timeoutMs = options.caseTimeoutMs ?? 30_000;
  const api: ScriptTestApi = Object.freeze({
    async case(name: string, callback: (context: ScriptCaseContext) => void | Promise<void>) {
      if (typeof name !== "string" || name.length === 0 || typeof callback !== "function") throw new CautestError("Script Case 需要 name 和 callback", { code: "config_error" });
      if (names.has(name)) throw new CautestError(`Script Case 名称重复: ${name}`, { code: "config_error" });
      names.add(name);
      const started = performance.now();
      const failures: Array<{ readonly message: string; readonly expected?: unknown; readonly actual?: unknown }> = [];
      const logs: string[] = [];
      const controller = new AbortController();
      const outerAbort = (): void => controller.abort(options.signal?.reason);
      options.signal?.addEventListener("abort", outerAbort, { once: true });
      let timer: ReturnType<typeof setTimeout> | undefined;
      const context: ScriptCaseContext = Object.freeze({
        signal: controller.signal,
        expect(value: unknown, message = "Expectation 失败") { if (!value) failures.push({ message }); },
        expectEqual(expected: unknown, actual: unknown, message = "值不相等") { if (!Object.is(expected, actual)) failures.push({ message, expected, actual }); },
        assert(value: unknown, message = "Assertion 失败"): asserts value { if (!value) { failures.push({ message }); throw new CaseStop("assert", message); } },
        skip(reason: string): never { throw new CaseStop("skip", reason); },
        log(message: unknown) { logs.push(String(message)); },
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
        await Promise.race([
          Promise.resolve().then(() => callback(context)),
          new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { const failure = timeoutError(timeoutMs); controller.abort(failure); reject(failure); }, timeoutMs); }),
        ]);
        if (failures.length > 0) status = "FAIL";
      } catch (cause) {
        if (cause instanceof CaseStop) status = cause.kind === "skip" ? "SKIP" : "FAIL";
        else { status = "ERROR"; error = { ...(cause instanceof CautestError ? { code: cause.code } : {}), message: cause instanceof Error ? cause.message : String(cause) }; }
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        options.signal?.removeEventListener("abort", outerAbort);
      }
      cases.push(Object.freeze({
        name,
        status,
        assertions: Object.freeze([]),
        diagnostics: Object.freeze(error === undefined ? [] : [error]),
        durationMs: performance.now() - started,
        ...(failures.length === 0 ? {} : { failures: Object.freeze(failures) }),
        ...(logs.length === 0 ? {} : { logs: Object.freeze(logs) }),
        ...(error === undefined ? {} : { error: Object.freeze(error) }),
      }));
    },
  });
  await definition.define({ test: api, env: Object.freeze({ ...(options.env ?? {}) }) });
  return Object.freeze({ name: options.name ?? "script", cases: Object.freeze(cases) });
}
