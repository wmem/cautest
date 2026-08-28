import { spawn } from "node:child_process";
import { once } from "node:events";
import type { Readable, Writable } from "node:stream";
import picomatch from "picomatch";
import type { CTestRunInput, TestAssertionResult, TestCaseResult, TestSuiteResult } from "../config/schema/common.js";
import { CautestError } from "../model/error.js";

interface ProtocolLine { readonly kind: "data" | "ok" | "error"; readonly name: string; readonly fields: readonly string[]; readonly raw: string }
interface CatalogCase { readonly suiteId: number; readonly caseId: number; readonly paramId: number; readonly suite: string; readonly case: string; readonly parameter: string; readonly name: string }

function splitFields(value: string): string[] {
  const fields: string[] = [];
  let field = "";
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === ",") { fields.push(field); field = ""; continue; }
    if (character !== "\\") { field += character; continue; }
    const escaped = value[++index];
    if (escaped === "\\" || escaped === ",") field += escaped;
    else if (escaped === "n") field += "\n";
    else if (escaped === "r") field += "\r";
    else if (escaped === "x") { field += String.fromCharCode(Number.parseInt(value.slice(index + 1, index + 3), 16)); index += 2; }
    else throw new CautestError(`CTP3 字段转义无效: ${value}`, { code: "protocol_error" });
  }
  fields.push(field);
  return fields;
}

function parseLine(line: string): ProtocolLine {
  if (line.startsWith("OK:")) { const fields = splitFields(line.slice(3)); return { kind: "ok", name: fields[0] ?? "", fields: fields.slice(1), raw: line }; }
  if (line.startsWith("ERROR:")) { const fields = splitFields(line.slice(6)); return { kind: "error", name: fields[0] ?? "", fields: fields.slice(1), raw: line }; }
  if (line.startsWith("+")) {
    const separator = line.indexOf(":");
    if (separator > 1) return { kind: "data", name: line.slice(1, separator), fields: splitFields(line.slice(separator + 1)), raw: line };
  }
  throw new CautestError(`无效 CTP3 响应: ${line}`, { code: "protocol_error" });
}

class LineQueue {
  readonly #lines: string[] = [];
  readonly #waiters: Array<(line: string) => void> = [];
  #error: Error | undefined;
  #buffer = "";
  constructor(stream: Readable) {
    stream.setEncoding("utf8");
    stream.on("data", (chunk: string) => {
      this.#buffer += chunk;
      for (;;) {
        const end = this.#buffer.indexOf("\n");
        if (end < 0) break;
        const line = this.#buffer.slice(0, end).replace(/\r$/u, "");
        this.#buffer = this.#buffer.slice(end + 1);
        const waiter = this.#waiters.shift();
        if (waiter === undefined) this.#lines.push(line); else waiter(line);
      }
    });
    stream.on("error", (error: Error) => { this.#error = error; });
  }
  async next(timeoutMs: number, signal: AbortSignal): Promise<string> {
    const line = this.#lines.shift();
    if (line !== undefined) return line;
    if (this.#error !== undefined) throw this.#error;
    return await new Promise((resolve, reject) => {
      const accept = (value: string) => { cleanup(); resolve(value); };
      const abort = () => { cleanup(); reject(signal.reason ?? new Error("Session 已取消")); };
      const timer = setTimeout(() => { cleanup(); reject(new CautestError(`等待 CTP3 响应超时 (${timeoutMs} ms)`, { code: "timeout_error" })); }, timeoutMs);
      const cleanup = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); const index = this.#waiters.indexOf(accept); if (index >= 0) this.#waiters.splice(index, 1); };
      this.#waiters.push(accept);
      signal.addEventListener("abort", abort, { once: true });
    });
  }
}

function number(value: string | undefined, label: string): number {
  if (value === undefined || !/^[0-9]+$/u.test(value)) throw new CautestError(`${label} 不是无符号整数`, { code: "protocol_error" });
  return Number(value);
}

function selected(item: CatalogCase, run: CTestRunInput): boolean {
  const match = (value: string, patterns: readonly string[] | undefined, fallback: boolean) => patterns === undefined ? fallback : picomatch([...patterns])(value);
  return match(item.name, run.include, true) && !match(item.name, run.exclude, false)
    && match(item.suite, run.suite === undefined ? undefined : [run.suite], true)
    && match(item.case, run.case === undefined ? undefined : [run.case], true)
    && match(item.parameter, run.parameter === undefined ? undefined : [run.parameter], true);
}

function assertion(parsed: ProtocolLine): TestAssertionResult {
  const typed = parsed.name === "ASSERT2";
  const fields = parsed.fields;
  const base = { status: fields[5] as TestAssertionResult["status"], ...(fields[6] === undefined ? {} : { file: fields[6] }), line: number(fields[7], "ASSERT.line"), expression: fields[8] ?? "" };
  if (!typed) return { ...base, expected: { type: "integer", value: fields[9] ?? "" }, actual: { type: "integer", value: fields[10] ?? "" } };
  const type = fields[9] === "u64" ? "u64" : fields[9] as "pointer" | "string" | "bytes";
  const flags = number(fields[10], "ASSERT2.flags");
  return { ...base, expected: { type, value: flags & 1 ? null : fields[11] ?? "" }, actual: { type, value: flags & 2 ? null : fields[12] ?? "" } };
}

export interface CtpTransport {
  open?(options?: { readonly timeoutMs?: number; readonly signal?: AbortSignal }): void | Promise<void>;
  write(data: string): void | Promise<void>;
  nextLine(options?: { readonly timeoutMs?: number; readonly signal?: AbortSignal }): string | Promise<string>;
  close?(): void | Promise<void>;
}

export interface CtpSessionRequest {
  readonly transport: CtpTransport;
  readonly expectedBuildId: string;
  readonly run: CTestRunInput;
  readonly signal: AbortSignal;
}

/** 在任意行式 Transport 上执行完整 CTP3 Session。 */
export async function runCtpSession(request: CtpSessionRequest): Promise<readonly TestSuiteResult[]> {
  const timeout = request.run.session?.run ?? request.run.runTimeoutMs ?? 60_000;
  await request.transport.open?.({ timeoutMs: request.run.session?.connect ?? 5_000, signal: request.signal });
  const send = async (command: string) => { await request.transport.write(`${command}\n`); };
  const next = async () => parseLine(await request.transport.nextLine({ timeoutMs: timeout, signal: request.signal }));
  try {
    await send("AT+HELLO");
    let buildId = "";
    for (;;) { const line = await next(); if (line.kind === "error") throw new CautestError(line.raw, { code: "target_error" }); if (line.name === "HELLO" && line.kind === "data") buildId = line.fields[2] ?? ""; if (line.name === "HELLO" && line.kind === "ok") break; }
    if (buildId !== request.expectedBuildId) throw new CautestError(`Build ID 不匹配: expected=${request.expectedBuildId}, actual=${buildId}`, { code: "target_error" });
    await send("AT+LIST");
    const catalog: CatalogCase[] = [];
    for (;;) {
      const line = await next();
      if (line.kind === "error") throw new CautestError(line.raw, { code: "target_error" });
      if (line.name === "CASE" && line.kind === "data") {
        const item = { suiteId: number(line.fields[0], "suiteId"), caseId: number(line.fields[1], "caseId"), paramId: number(line.fields[2], "paramId"), suite: line.fields[3] ?? "", case: line.fields[4] ?? "", parameter: line.fields[5] ?? "" };
        catalog.push({ ...item, name: `${item.suite}/${item.case}${item.parameter ? `@${item.parameter}` : ""}` });
      }
      if (line.name === "LIST" && line.kind === "ok") break;
    }
    const results: Array<{ suite: string; result: TestCaseResult }> = [];
    let execution = 0;
    for (const item of catalog.filter((candidate) => selected(candidate, request.run))) {
      execution += 1;
      await send(`AT+CASE=${execution},${item.suiteId},${item.caseId},${item.paramId}`);
      const assertions: TestAssertionResult[] = [];
      const diagnostics: unknown[] = [];
      let status: TestCaseResult["status"] = "ERROR";
      for (;;) {
        const line = await next();
        if (line.kind === "error") throw new CautestError(line.raw, { code: "target_error" });
        if (line.kind === "ok" && line.name === "CASE") break;
        if (line.name === "ASSERT" || line.name === "ASSERT2") assertions.push(assertion(line));
        else if (line.name === "SKIP") assertions.push({ status: "SKIP", expression: line.fields[4] ?? "" });
        else if (line.name === "FAULT") diagnostics.push({ code: line.fields[5], message: line.fields[6] });
        else if (line.name === "CASE-END") status = (line.fields[4] ?? "ERROR") as TestCaseResult["status"];
      }
      results.push({ suite: item.suite, result: Object.freeze({ name: `${item.case}${item.parameter ? `@${item.parameter}` : ""}`, status, assertions: Object.freeze(assertions), diagnostics: Object.freeze(diagnostics) }) });
    }
    const suites = new Map<string, TestCaseResult[]>();
    for (const item of results) { const cases = suites.get(item.suite) ?? []; cases.push(item.result); suites.set(item.suite, cases); }
    return Object.freeze([...suites].map(([name, cases]) => Object.freeze({ name, cases: Object.freeze(cases) })));
  } finally {
    try {
      await send("AT+BYE");
      await Promise.race([next(), new Promise((resolve) => setTimeout(resolve, 100))]);
    } catch { /* best effort */ }
    await request.transport.close?.();
  }
}

export interface NativeSessionRequest { readonly program: string; readonly args?: readonly string[]; readonly cwd: string; readonly env: NodeJS.ProcessEnv; readonly expectedBuildId: string; readonly run: CTestRunInput; readonly signal: AbortSignal }

/** 通过 POSIX Target 的 FD3/FD4 执行 CTP3 Native Test。 */
export async function runNativeSession(request: NativeSessionRequest): Promise<readonly TestSuiteResult[]> {
  const child = spawn(request.program, [...(request.args ?? [])], { cwd: request.cwd, env: request.env, stdio: ["ignore", "pipe", "pipe", "pipe", "pipe"] });
  const input = child.stdio[3] as Writable;
  const output = child.stdio[4] as Readable;
  input.on("error", () => { /* Target 退出时关闭控制管道属于正常清理路径。 */ });
  const queue = new LineQueue(output);
  const transport: CtpTransport = {
    write(data) { return new Promise<void>((resolve, reject) => input.write(data, (error) => error ? reject(error) : resolve())); },
    nextLine(options) { return queue.next(options?.timeoutMs ?? 60_000, options?.signal ?? request.signal); },
    async close() {
      if (child.exitCode === null) child.kill("SIGTERM");
      await Promise.race([once(child, "close"), new Promise((resolve) => setTimeout(resolve, 500))]);
      if (child.exitCode === null) child.kill("SIGKILL");
    },
  };
  return await runCtpSession({ transport, expectedBuildId: request.expectedBuildId, run: request.run, signal: request.signal });
}
