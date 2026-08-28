import type { SuitePolicy, TestAssertionResult, TestCaseResult, TestSuiteResult } from "../config/schema/common.js";
import { CautestError } from "../model/error.js";
import { CTP_PROTOCOL_MAJOR, encodeCommand, parseProtocolLine, type ParsedProtocolLine } from "./ctp3.js";
import type { CtpTransport } from "./transport.js";

const statuses = new Set(["PASS", "SKIP", "FAIL", "ERROR"]);

export interface TestDescriptor {
  readonly suiteId: number;
  readonly caseId: number;
  readonly paramId: number;
  readonly suite: string;
  readonly case: string;
  readonly parameter: string;
  readonly name: string;
}

export interface CTestSelection {
  readonly include?: string | readonly string[];
  readonly exclude?: string | readonly string[];
  readonly suite?: string | readonly string[];
  readonly case?: string | readonly string[];
  readonly parameter?: string | readonly string[];
}

export type CTestExecution = Readonly<{ readonly kind: "CASE"; readonly descriptor: TestDescriptor } | { readonly kind: "SUITE"; readonly suiteId: number; readonly suite: string }>;

function patterns(value: string | readonly string[] | undefined, fallback: readonly string[] = []): readonly string[] { return value === undefined ? fallback : typeof value === "string" ? [value] : value; }

function glob(pattern: string): RegExp {
  let expression = "^";
  for (const character of pattern) expression += character === "*" ? ".*" : character === "?" ? "." : character.replace(/[\\^$.[\]{}()+|]/u, "\\$&");
  return new RegExp(`${expression}$`, "u");
}

function matches(value: string, values: readonly string[]): boolean { return values.some((pattern) => glob(pattern).test(value)); }

export function filterTestDescriptors(descriptors: readonly TestDescriptor[], options: CTestSelection = {}): readonly TestDescriptor[] {
  const include = patterns(options.include, ["*"]);
  const excludePatterns = patterns(options.exclude);
  const suitePatterns = patterns(options.suite);
  const casePatterns = patterns(options.case);
  const parameterPatterns = patterns(options.parameter);
  return Object.freeze(descriptors.filter((item) => matches(item.name, include) && !matches(item.name, excludePatterns)
    && (suitePatterns.length === 0 || matches(item.suite, suitePatterns))
    && (casePatterns.length === 0 || matches(item.case, casePatterns))
    && (parameterPatterns.length === 0 || matches(item.parameter, parameterPatterns))));
}

export function planCTestExecutions(_catalog: readonly TestDescriptor[], selection: readonly TestDescriptor[], options: CTestSelection = {}): readonly CTestExecution[] {
  const instanceMode = [options.include, options.exclude, options.case, options.parameter].some((value) => value !== undefined);
  if (instanceMode) return Object.freeze(selection.map((descriptor) => Object.freeze({ kind: "CASE" as const, descriptor })));
  const suites = new Map<number, TestDescriptor>();
  for (const descriptor of selection) if (!suites.has(descriptor.suiteId)) suites.set(descriptor.suiteId, descriptor);
  return Object.freeze([...suites.values()].map((descriptor) => Object.freeze({ kind: "SUITE" as const, suiteId: descriptor.suiteId, suite: descriptor.suite })));
}

export interface TargetLog {
  readonly executionId: number;
  readonly scope: "TARGET" | "EXEC" | "SUITE" | "CASE";
  readonly suiteId: number;
  readonly caseId: number;
  readonly paramId: number;
  readonly channel: "TARGET" | "STDOUT" | "STDERR" | "CONSOLE";
  readonly level: "TRACE" | "DEBUG" | "INFO" | "WARN" | "ERROR" | "NONE";
  readonly message: string;
  readonly truncated: boolean;
}

export interface SessionEvent { readonly type: string; readonly targetSequence: number; readonly [key: string]: unknown }

export interface CTestSessionOptions extends CTestSelection {
  readonly transport: CtpTransport;
  readonly expectedBuildId?: string;
  readonly expectedBootId?: string;
  readonly timeouts?: Readonly<Partial<Record<"connect" | "handshake" | "discovery" | "run" | "close", number>>>;
  readonly signal?: AbortSignal;
  readonly suitePolicy?: SuitePolicy;
  readonly caseTimeoutMs?: number;
  readonly runTimeoutMs?: number;
  readonly onEvent?: (event: SessionEvent) => unknown | Promise<unknown>;
  readonly onLog?: (log: TargetLog) => string | void | Promise<string | void>;
}

interface CTestExecutionResult {
  readonly groups: readonly TestSuiteResult[];
  readonly executionCount: number;
  readonly eventCount: number;
  readonly groupDiagnostics: readonly Readonly<Record<string, unknown>>[];
  readonly executionErrors: readonly Readonly<Record<string, unknown>>[];
}

export interface CTestSessionResult extends CTestExecutionResult {
  readonly hello: Readonly<Record<string, unknown>>;
  readonly catalog: readonly TestDescriptor[];
  readonly selection: readonly TestDescriptor[];
}

function u32(value: string | undefined, field: string): number {
  if (value === undefined || !/^(?:0|[1-9][0-9]*)$/u.test(value)) throw new CautestError(`${field} 不是合法 u32`, { code: "protocol_error" });
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed > 0xffff_ffff) throw new CautestError(`${field} 超出 u32`, { code: "protocol_error" });
  return parsed;
}

function status(value: string | undefined): TestCaseResult["status"] {
  if (value === undefined || !statuses.has(value)) throw new CautestError(`未知测试状态: ${String(value)}`, { code: "protocol_error" });
  return value as TestCaseResult["status"];
}

function same(left: { readonly suiteId: number; readonly caseId: number; readonly paramId: number }, right: { readonly suiteId: number; readonly caseId: number; readonly paramId: number }): boolean {
  return left.suiteId === right.suiteId && left.caseId === right.caseId && left.paramId === right.paramId;
}

function targetError(line: ParsedProtocolLine): CautestError {
  return new CautestError(line.fields.at(-1) ?? line.raw, { code: "target_error", details: { command: line.name, targetCode: line.fields.at(-2), fields: line.fields } });
}

function decodeLog(line: ParsedProtocolLine): TargetLog {
  if (line.fields.length !== 8) throw new CautestError("LOG 字段错误", { code: "protocol_error" });
  const log = {
    executionId: u32(line.fields[0], "executionId"), scope: line.fields[1] as TargetLog["scope"], suiteId: u32(line.fields[2], "suiteId"), caseId: u32(line.fields[3], "caseId"), paramId: u32(line.fields[4], "paramId"),
    channel: line.fields[5] as TargetLog["channel"], level: line.fields[6] as TargetLog["level"], message: line.fields[7]!, truncated: line.name === "LOG-TRUNC",
  };
  if (!["TARGET", "EXEC", "SUITE", "CASE"].includes(log.scope) || !["TARGET", "STDOUT", "STDERR", "CONSOLE"].includes(log.channel) || !["TRACE", "DEBUG", "INFO", "WARN", "ERROR", "NONE"].includes(log.level)) {
    throw new CautestError("LOG 枚举错误", { code: "protocol_error" });
  }
  return Object.freeze(log);
}

interface MutableCase extends TestDescriptor { status: TestCaseResult["status"]; readonly assertions: TestAssertionResult[]; readonly diagnostics: unknown[]; readonly executionId: number }

/** 严格验证 CTP3 HELLO/LIST/Execution 事件身份和顺序的 Session。 */
export class CTestSession {
  readonly #options: CTestSessionOptions;
  #state: "NEW" | "TRANSPORT_OPEN" | "READY" | "EXECUTING" | "CLOSED" = "NEW";
  #executionId = 0;
  #eventSequence = 0;
  #targetRxLineMax?: number;

  constructor(options: CTestSessionOptions) {
    if (options?.transport === undefined) throw new CautestError("CTestSession 需要 transport", { code: "config_error" });
    this.#options = options;
  }
  get state(): string { return this.#state; }
  #timeout(name: "connect" | "handshake" | "discovery" | "run" | "close", fallback: number): number { return this.#options.timeouts?.[name] ?? fallback; }
  async #send(command: string): Promise<void> {
    const encoded = encodeCommand(command);
    if (this.#targetRxLineMax !== undefined && encoded.byteLength > this.#targetRxLineMax) throw new CautestError(`Target rxLineMax=${this.#targetRxLineMax} 无法容纳命令`, { code: "protocol_error" });
    await this.#options.transport.write(encoded);
  }
  async #emit(type: string, payload: Readonly<Record<string, unknown>>): Promise<void> { await this.#options.onEvent?.(Object.freeze({ type, targetSequence: ++this.#eventSequence, ...payload })); }
  async #next(timeoutMs: number): Promise<ParsedProtocolLine> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new CautestError(`等待 Target 消息超时 (${timeoutMs} ms)`, { code: "timeout_error" });
      let parsed: ParsedProtocolLine;
      try { parsed = parseProtocolLine(await this.#options.transport.nextLine({ timeoutMs: remaining, ...(this.#options.signal === undefined ? {} : { signal: this.#options.signal }) })); }
      catch (cause) {
        if (cause instanceof CautestError) throw cause;
        if (cause instanceof Error && "code" in cause && cause.code === "timeout_error") throw new CautestError(cause.message, { code: "timeout_error", cause });
        throw new CautestError(cause instanceof Error ? cause.message : String(cause), { code: "protocol_error", cause });
      }
      if (parsed.kind === "data" && (parsed.name === "LOG" || parsed.name === "LOG-TRUNC") && parsed.fields[1] === "TARGET") {
        const log = decodeLog(parsed);
        if (log.executionId !== 0 || log.suiteId !== 0 || log.caseId !== 0 || log.paramId !== 0) throw new CautestError("TARGET LOG ID 错误", { code: "protocol_error" });
        const logRef = await this.#options.onLog?.(log);
        await this.#emit("TARGET_LOG", { ...log, message: undefined, ...(typeof logRef === "string" ? { logRef } : {}) });
        continue;
      }
      return parsed;
    }
  }
  async open(): Promise<Readonly<Record<string, unknown>>> {
    if (this.#state !== "NEW") throw new CautestError(`无效 Session 状态: ${this.#state}`, { code: "protocol_error" });
    await this.#options.transport.open({ timeoutMs: this.#timeout("connect", 5_000), ...(this.#options.signal === undefined ? {} : { signal: this.#options.signal }) });
    this.#state = "TRANSPORT_OPEN";
    await this.#send("AT+HELLO");
    let hello: { readonly major: number; readonly minor: number; readonly buildId: string; readonly bootId: string; readonly rxLineMax: number; readonly txLineMax: number } | undefined;
    for (;;) {
      const line = await this.#next(this.#timeout("handshake", 5_000));
      if (line.kind === "error") throw targetError(line);
      if (line.kind === "data" && line.name === "HELLO") {
        if (line.fields.length !== 6) throw new CautestError("HELLO 字段数量错误", { code: "protocol_error" });
        hello = Object.freeze({ major: u32(line.fields[0], "HELLO.major"), minor: u32(line.fields[1], "HELLO.minor"), buildId: line.fields[2]!, bootId: line.fields[3]!, rxLineMax: u32(line.fields[4], "HELLO.rxLineMax"), txLineMax: u32(line.fields[5], "HELLO.txLineMax") });
      } else if (line.kind === "ok" && line.name === "HELLO") break;
      else throw new CautestError(`HELLO 收到意外响应: ${line.raw}`, { code: "protocol_error" });
    }
    if (hello === undefined) throw new CautestError("Target 未返回 HELLO Data", { code: "protocol_error" });
    if (hello.major !== CTP_PROTOCOL_MAJOR) throw new CautestError(`CTP major 不兼容: ${hello.major}`, { code: "protocol_error" });
    if (this.#options.expectedBuildId !== undefined && hello.buildId !== this.#options.expectedBuildId) throw new CautestError(`Build ID 不匹配: expected=${this.#options.expectedBuildId}, actual=${hello.buildId}`, { code: "target_error" });
    if (this.#options.expectedBootId !== undefined && hello.bootId !== this.#options.expectedBootId) throw new CautestError(`Boot ID 不匹配: expected=${this.#options.expectedBootId}, actual=${hello.bootId}`, { code: "target_error" });
    this.#targetRxLineMax = hello.rxLineMax;
    this.#state = "READY";
    return hello;
  }
  async list(): Promise<readonly TestDescriptor[]> {
    if (this.#state !== "READY") throw new CautestError(`LIST 状态无效: ${this.#state}`, { code: "protocol_error" });
    await this.#send("AT+LIST");
    const descriptors: TestDescriptor[] = [];
    let started = false;
    let ended = false;
    for (;;) {
      const line = await this.#next(this.#timeout("discovery", 5_000));
      if (line.kind === "error") throw targetError(line);
      if (line.kind === "data" && line.name === "LIST" && line.fields[0] === "START" && line.fields.length === 1 && !started) started = true;
      else if (line.kind === "data" && line.name === "CASE") {
        if (!started || ended || line.fields.length !== 6) throw new CautestError("LIST CASE 顺序或字段错误", { code: "protocol_error" });
        const item = { suiteId: u32(line.fields[0], "suiteId"), caseId: u32(line.fields[1], "caseId"), paramId: u32(line.fields[2], "paramId"), suite: line.fields[3]!, case: line.fields[4]!, parameter: line.fields[5]! };
        descriptors.push(Object.freeze({ ...item, name: `${item.suite}/${item.case}${item.parameter === "" ? "" : `@${item.parameter}`}` }));
      } else if (line.kind === "data" && line.name === "LIST" && line.fields[0] === "END" && line.fields.length === 2) {
        if (!started || ended || u32(line.fields[1], "instanceCount") !== descriptors.length) throw new CautestError("LIST END 计数错误", { code: "protocol_error" });
        ended = true;
      } else if (line.kind === "ok" && line.name === "LIST" && ended) return Object.freeze(descriptors);
      else throw new CautestError(`LIST 收到意外响应: ${line.raw}`, { code: "protocol_error" });
    }
  }
  async #execute(unit: CTestExecution, catalog: ReadonlyMap<string, TestDescriptor>, cases: MutableCase[], groupDiagnostics: Array<Readonly<Record<string, unknown>>>, executionErrors: Array<Readonly<Record<string, unknown>>>): Promise<void> {
    const executionId = ++this.#executionId;
    const command = unit.kind === "CASE" ? `AT+CASE=${executionId},${unit.descriptor.suiteId},${unit.descriptor.caseId},${unit.descriptor.paramId}` : `AT+SUITE=${executionId},${unit.suiteId},${this.#options.suitePolicy ?? "CONTINUE"}`;
    await this.#send(command);
    this.#state = "EXECUTING";
    let execStart: { readonly suiteId: number; readonly caseId: number; readonly paramId: number } | undefined;
    let current: MutableCase | undefined;
    let suiteStarted = false;
    let suiteEnded = false;
    let execEnded = false;
    const caseStatuses: TestCaseResult["status"][] = [];
    for (;;) {
      const line = await this.#next((unit.kind === "CASE" ? this.#options.caseTimeoutMs : undefined) ?? this.#options.runTimeoutMs ?? this.#timeout("run", 60_000));
      if (line.kind === "error") throw targetError(line);
      if (line.kind === "ok") {
        if (line.name !== unit.kind || !execEnded || current !== undefined || u32(line.fields[0], "Final.executionId") !== executionId) throw new CautestError(`Execution Final Response 不完整: ${line.raw}`, { code: "protocol_error" });
        break;
      }
      if (line.kind !== "data" || execEnded) throw new CautestError(`Execution 收到意外响应: ${line.raw}`, { code: "protocol_error" });
      const fields = line.fields;
      if (line.name === "EXEC-START") {
        if (execStart !== undefined || fields.length !== 5 || u32(fields[0], "executionId") !== executionId || fields[1] !== unit.kind) throw new CautestError("EXEC-START 身份错误", { code: "protocol_error" });
        execStart = { suiteId: u32(fields[2], "suiteId"), caseId: u32(fields[3], "caseId"), paramId: u32(fields[4], "paramId") };
        const expected = unit.kind === "CASE" ? unit.descriptor : { suiteId: unit.suiteId, caseId: 0, paramId: 0 };
        if (!same(execStart, expected)) throw new CautestError("EXEC-START 选择目标错误", { code: "protocol_error" });
        await this.#emit("EXEC_START", { executionId, ...execStart });
      } else if (line.name === "SUITE-START") {
        if (execStart === undefined || suiteStarted || fields.length !== 2 || u32(fields[0], "executionId") !== executionId || u32(fields[1], "suiteId") !== execStart.suiteId) throw new CautestError("SUITE-START 身份错误", { code: "protocol_error" });
        suiteStarted = true;
        await this.#emit("SUITE_START", { executionId, suiteId: execStart.suiteId });
      } else if (line.name === "CASE-START") {
        if (!suiteStarted || suiteEnded || current !== undefined || fields.length !== 4 || u32(fields[0], "executionId") !== executionId) throw new CautestError("CASE-START 身份错误", { code: "protocol_error" });
        const ids = { suiteId: u32(fields[1], "suiteId"), caseId: u32(fields[2], "caseId"), paramId: u32(fields[3], "paramId") };
        const descriptor = catalog.get(`${ids.suiteId}/${ids.caseId}/${ids.paramId}`);
        if (descriptor === undefined || execStart === undefined || descriptor.suiteId !== execStart.suiteId || (unit.kind === "CASE" && !same(descriptor, unit.descriptor))) throw new CautestError("CASE-START 引用了无效目录项", { code: "protocol_error" });
        current = { ...descriptor, status: "ERROR", assertions: [], diagnostics: [], executionId };
        cases.push(current);
        await this.#emit("CASE_START", { executionId, ...descriptor });
      } else if (line.name === "ASSERT" || line.name === "ASSERT2") {
        const typed = line.name === "ASSERT2";
        if (current === undefined || fields.length !== (typed ? 13 : 11) || u32(fields[0], "executionId") !== executionId) throw new CautestError(`${line.name} 上下文错误`, { code: "protocol_error" });
        const ids = { suiteId: u32(fields[1], "suiteId"), caseId: u32(fields[2], "caseId"), paramId: u32(fields[3], "paramId") };
        if (!same(ids, current)) throw new CautestError(`${line.name} Case ID 错误`, { code: "protocol_error" });
        const base = { status: status(fields[5]), file: fields[6]!, line: u32(fields[7], "line"), expression: fields[8]! };
        let assertion: TestAssertionResult;
        if (typed) {
          const type = fields[9] as "u64" | "pointer" | "string" | "bytes";
          if (!["u64", "pointer", "string", "bytes"].includes(type)) throw new CautestError("ASSERT2 value type 错误", { code: "protocol_error" });
          const flags = u32(fields[10], "valueFlags");
          if ((flags & ~3) !== 0) throw new CautestError("ASSERT2 value flags 错误", { code: "protocol_error" });
          assertion = Object.freeze({ ...base, expected: { type, value: flags & 1 ? null : fields[11]! }, actual: { type, value: flags & 2 ? null : fields[12]! } });
        } else {
          assertion = Object.freeze({ ...base, expected: { type: "integer" as const, value: fields[9]! }, actual: { type: "integer" as const, value: fields[10]! } });
        }
        current.assertions.push(assertion);
        await this.#emit("ASSERTION", { executionId, suiteId: current.suiteId, caseId: current.caseId, paramId: current.paramId, assertionId: u32(fields[4], "assertionId"), ...assertion });
      } else if (line.name === "SKIP") {
        if (current === undefined || fields.length !== 5 || u32(fields[0], "executionId") !== executionId) throw new CautestError("SKIP 上下文错误", { code: "protocol_error" });
        const ids = { suiteId: u32(fields[1], "suiteId"), caseId: u32(fields[2], "caseId"), paramId: u32(fields[3], "paramId") };
        if (!same(ids, current)) throw new CautestError("SKIP Case ID 错误", { code: "protocol_error" });
        current.assertions.push({ status: "SKIP", expression: fields[4]! });
        await this.#emit("SKIP", { executionId, ...ids, reason: fields[4]! });
      } else if (line.name === "FAULT") {
        if (fields.length !== 7 || u32(fields[0], "executionId") !== executionId || execStart === undefined) throw new CautestError("FAULT 身份错误", { code: "protocol_error" });
        const fault = Object.freeze({ executionId, scope: fields[1]!, suiteId: u32(fields[2], "suiteId"), caseId: u32(fields[3], "caseId"), paramId: u32(fields[4], "paramId"), code: fields[5]!, message: fields[6]! });
        if (!["EXEC", "SUITE", "CASE"].includes(fault.scope)) throw new CautestError("FAULT Scope 错误", { code: "protocol_error" });
        if (fault.scope === "CASE") { if (current === undefined || !same(fault, current)) throw new CautestError("FAULT Case ID 错误", { code: "protocol_error" }); current.diagnostics.push({ code: fault.code, message: fault.message }); }
        else {
          if (fault.scope === "SUITE" && (execStart === undefined || fault.suiteId !== execStart.suiteId || fault.caseId !== 0 || fault.paramId !== 0)) throw new CautestError("FAULT Suite ID 错误", { code: "protocol_error" });
          if (fault.scope === "EXEC" && (fault.suiteId !== 0 || fault.caseId !== 0 || fault.paramId !== 0)) throw new CautestError("FAULT Execution ID 错误", { code: "protocol_error" });
          groupDiagnostics.push(fault);
        }
        await this.#emit("FAULT", fault);
      } else if (line.name === "LOG" || line.name === "LOG-TRUNC") {
        const log = decodeLog(line);
        if (log.executionId !== executionId || (log.scope === "CASE" && (current === undefined || !same(log, current)))) throw new CautestError("LOG Scope ID 或上下文错误", { code: "protocol_error" });
        const logRef = await this.#options.onLog?.(log);
        await this.#emit("TARGET_LOG", { ...log, message: undefined, ...(typeof logRef === "string" ? { logRef } : {}) });
      } else if (line.name === "CASE-END") {
        if (current === undefined || fields.length !== 5 || u32(fields[0], "executionId") !== executionId) throw new CautestError("CASE-END 上下文错误", { code: "protocol_error" });
        const ids = { suiteId: u32(fields[1], "suiteId"), caseId: u32(fields[2], "caseId"), paramId: u32(fields[3], "paramId") };
        if (!same(ids, current)) throw new CautestError("CASE-END Case ID 错误", { code: "protocol_error" });
        current.status = status(fields[4]);
        caseStatuses.push(current.status);
        await this.#emit("CASE_END", { executionId, ...ids, status: current.status });
        current = undefined;
      } else if (line.name === "SUITE-END") {
        if (!suiteStarted || suiteEnded || current !== undefined || fields.length !== 3 || u32(fields[0], "executionId") !== executionId) throw new CautestError("SUITE-END 身份错误", { code: "protocol_error" });
        if (execStart === undefined || u32(fields[1], "suiteId") !== execStart.suiteId) throw new CautestError("SUITE-END Suite ID 错误", { code: "protocol_error" });
        const suiteStatus = status(fields[2]);
        suiteEnded = true;
        await this.#emit("SUITE_END", { executionId, suiteId: execStart.suiteId, status: suiteStatus });
      } else if (line.name === "EXEC-END") {
        if (!suiteEnded || current !== undefined || fields.length !== 6 || u32(fields[0], "executionId") !== executionId) throw new CautestError("EXEC-END 身份错误", { code: "protocol_error" });
        const ending = { status: status(fields[1]), passed: u32(fields[2], "passed"), failed: u32(fields[3], "failed"), skipped: u32(fields[4], "skipped"), errors: u32(fields[5], "errors") };
        const total = ending.passed + ending.failed + ending.skipped + ending.errors;
        if (total !== (unit.kind === "CASE" && ending.errors === 1 && caseStatuses.length === 0 ? 1 : caseStatuses.length)) throw new CautestError("EXEC-END 计数与 Case Event 不一致", { code: "protocol_error" });
        if (ending.status === "ERROR" && caseStatuses.length === 0 && !(unit.kind === "CASE" && ending.errors === 1)) executionErrors.push({ executionId, code: "suite_execution_error", message: `Suite ${unit.kind === "SUITE" ? unit.suite : unit.descriptor.suite} 运行错误` });
        execEnded = true;
        await this.#emit("EXEC_END", { executionId, ...ending });
      } else throw new CautestError(`Execution 收到未知 Data Line: ${line.raw}`, { code: "protocol_error" });
    }
    this.#state = "READY";
  }
  async run(catalog: readonly TestDescriptor[], selection: readonly TestDescriptor[]): Promise<CTestExecutionResult> {
    if (this.#state !== "READY") throw new CautestError(`执行状态无效: ${this.#state}`, { code: "protocol_error" });
    const units = planCTestExecutions(catalog, selection, this.#options);
    const byId = new Map(catalog.map((item) => [`${item.suiteId}/${item.caseId}/${item.paramId}`, item]));
    const cases: MutableCase[] = [];
    const groupDiagnostics: Array<Readonly<Record<string, unknown>>> = [];
    const executionErrors: Array<Readonly<Record<string, unknown>>> = [];
    for (const unit of units) await this.#execute(unit, byId, cases, groupDiagnostics, executionErrors);
    const groups = new Map<string, TestCaseResult[]>();
    for (const item of cases) {
      const values = groups.get(item.suite) ?? [];
      values.push(Object.freeze({ name: `${item.case}${item.parameter === "" ? "" : `@${item.parameter}`}`, status: item.status, assertions: Object.freeze(item.assertions), diagnostics: Object.freeze(item.diagnostics) }));
      groups.set(item.suite, values);
    }
    return Object.freeze({ groups: Object.freeze([...groups].map(([name, values]) => Object.freeze({ name, cases: Object.freeze(values) }))), executionCount: units.length, eventCount: this.#eventSequence, groupDiagnostics: Object.freeze(groupDiagnostics), executionErrors: Object.freeze(executionErrors) });
  }
  async close(): Promise<void> {
    if (this.#state === "CLOSED") return;
    if (this.#state === "READY") try { await this.#send("AT+BYE"); await this.#next(this.#timeout("close", 2_000)); } catch { /* best effort */ }
    await this.#options.transport.close();
    this.#state = "CLOSED";
  }
}

export async function runCTestSession(options: CTestSessionOptions): Promise<CTestSessionResult> {
  const session = new CTestSession(options);
  try {
    const hello = await session.open();
    const catalog = await session.list();
    const selection = filterTestDescriptors(catalog, options);
    const result = await session.run(catalog, selection);
    return Object.freeze({ hello, catalog, selection, ...result });
  } finally { await session.close(); }
}
