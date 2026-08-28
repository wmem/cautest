import { spawn, type ChildProcess } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { Resource } from "../workflow/lifecycle.js";
import type { TestCaseResult, TestSuiteResult } from "../config/schema/common.js";
import { CautestError } from "../model/error.js";
import { runCommand } from "../runtime/process.js";
import { defineStep } from "../workflow/step.js";

export type ReadyProbe =
  | Readonly<{ readonly type: "process-alive" }>
  | Readonly<{ readonly type?: "file-exists"; readonly kind?: "file"; readonly path: string }>
  | Readonly<{ readonly type?: "tcp-connect"; readonly kind?: "tcp"; readonly host?: string; readonly port: number }>
  | Readonly<{ readonly type?: "http-response"; readonly kind?: "http"; readonly url: string; readonly status?: number; readonly bodyIncludes?: string }>
  | Readonly<{ readonly type: "custom"; readonly check: (context: { readonly resource: unknown; readonly signal: AbortSignal }) => boolean | Promise<boolean> }>;

function childOf(resource: unknown): ChildProcess | undefined {
  if (typeof resource !== "object" || resource === null) return undefined;
  const candidate = resource as { readonly handle?: { readonly child?: ChildProcess }; readonly child?: ChildProcess };
  return candidate.handle?.child ?? candidate.child;
}

async function checkReady(resource: unknown, probe: ReadyProbe, signal: AbortSignal): Promise<void> {
  const type = "type" in probe && probe.type !== undefined ? probe.type : probe.kind === "file" ? "file-exists" : probe.kind === "tcp" ? "tcp-connect" : "http-response";
  if (type === "process-alive") { const child = childOf(resource) ?? resource as ChildProcess; if (child === undefined || child.exitCode !== null || child.signalCode !== null) throw new Error("进程未运行"); return; }
  if (type === "file-exists") { await access((probe as { readonly path: string }).path); return; }
  if (type === "tcp-connect") await new Promise<void>((resolve, reject) => {
    const value = probe as { readonly host?: string; readonly port: number };
    const socket = net.createConnection({ host: value.host ?? "127.0.0.1", port: value.port });
    const finish = (error?: Error): void => { socket.destroy(); signal.removeEventListener("abort", abort); if (error === undefined) resolve(); else reject(error); };
    const abort = (): void => finish(signal.reason instanceof Error ? signal.reason : new Error("Ready 已取消"));
    socket.once("connect", () => finish()); socket.once("error", finish); signal.addEventListener("abort", abort, { once: true });
  });
  else if (type === "http-response") { const value = probe as { readonly url: string; readonly status?: number; readonly bodyIncludes?: string }; const response = await fetch(value.url, { signal }); if (response.status !== (value.status ?? 200)) throw new Error(`HTTP Status ${response.status}`); if (value.bodyIncludes !== undefined && !(await response.text()).includes(value.bodyIncludes)) throw new Error("HTTP Body 不匹配"); }
  else if (type === "custom") { const value = probe as Extract<ReadyProbe, { type: "custom" }>; if (!await value.check({ resource, signal })) throw new Error("Custom Probe 尚未 Ready"); }
}

export async function waitForReady(resource: unknown, probe: ReadyProbe, options: { readonly signal?: AbortSignal; readonly timeoutMs?: number; readonly intervalMs?: number } = {}): Promise<void> {
  if (typeof probe !== "object" || probe === null) throw new CautestError("必须配置 Ready Probe", { code: "config_error" });
  const controller = new AbortController();
  const abort = (): void => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", abort, { once: true });
  const timeoutMs = options.timeoutMs ?? 5_000;
  const timer = setTimeout(() => controller.abort(new CautestError(`Ready Probe 超时 (${timeoutMs} ms)`, { code: "provision_error" })), timeoutMs);
  let lastError: unknown;
  try {
    while (!controller.signal.aborted) {
      const child = childOf(resource);
      if (child !== undefined && (child.exitCode !== null || child.signalCode !== null)) throw new CautestError("进程在 Ready 前退出", { code: "provision_error" });
      try { await checkReady(resource, probe, controller.signal); return; } catch (cause) { if (cause instanceof CautestError) throw cause; lastError = cause; }
      await delay(options.intervalMs ?? 25, undefined, { signal: controller.signal }).catch(() => undefined);
    }
  } finally { clearTimeout(timer); options.signal?.removeEventListener("abort", abort); }
  throw controller.signal.reason instanceof CautestError ? controller.signal.reason : new CautestError(`Ready Probe 失败: ${lastError instanceof Error ? lastError.message : "not ready"}`, { code: "provision_error", cause: lastError });
}

export function waitReady(input: { readonly name?: string; readonly resource?: string; readonly from?: string; readonly probe?: ReadyProbe; readonly ready?: ReadyProbe; readonly readyTimeoutMs?: number; readonly intervalMs?: number; readonly timeoutMs?: number }) {
  const resourceKey = input.resource ?? input.from;
  const probe = input.probe ?? input.ready;
  if (resourceKey === undefined || probe === undefined) throw new CautestError("waitReady 需要 resource/from 和 probe/ready", { code: "config_error" });
  return defineStep({ kind: "waitReady", name: input.name ?? "default", phase: "provision", ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }), details: { resource: resourceKey, probe }, async execute(context) {
    const resource = context.resources.get(resourceKey);
    await waitForReady(resource, probe, { signal: context.signal, ...(input.readyTimeoutMs === undefined ? {} : { timeoutMs: input.readyTimeoutMs }), ...(input.intervalMs === undefined ? {} : { intervalMs: input.intervalMs }) });
    if (resource.state === "starting") context.resources.ready(resource.kind, resource.name);
  } });
}

interface ProcessLifecycle { readiness: "starting" | "ready" | "failed"; exitCode: number | null; signalCode: NodeJS.Signals | null; cleaned: boolean }
interface ManagedProcess { readonly child: ChildProcess; readonly stdout: Buffer[]; readonly stderr: Buffer[]; readonly lifecycle: ProcessLifecycle }

async function stopProcess(managed: ManagedProcess, graceMs: number): Promise<void> {
  const child = managed.child;
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGTERM");
    await Promise.race([new Promise((resolve) => child.once("exit", resolve)), delay(graceMs)]);
    if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await new Promise((resolve) => child.once("exit", resolve)); }
  }
  managed.lifecycle.exitCode = child.exitCode;
  managed.lifecycle.signalCode = child.signalCode;
  managed.lifecycle.cleaned = true;
}

export interface ProcessStartInput { readonly name?: string; readonly program: string; readonly args?: readonly string[]; readonly cwd?: string; readonly env?: NodeJS.ProcessEnv; readonly ready: ReadyProbe; readonly readyTimeoutMs?: number; readonly intervalMs?: number; readonly stopGraceMs?: number; readonly logLimitBytes?: number; readonly timeoutMs?: number }

export function processStart(input: ProcessStartInput) {
  if (typeof input?.program !== "string" || !Array.isArray(input.args ?? []) || input.ready === undefined) throw new CautestError("processStart 需要 program、args[] 和 ready", { code: "config_error" });
  const name = input.name ?? "default";
  return defineStep({ kind: "processStart", name, phase: "provision", ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }), details: { program: input.program, args: input.args ?? [], ready: input.ready }, async execute(context) {
    const child = spawn(input.program, [...(input.args ?? [])], { cwd: path.resolve(context.project.configDir, input.cwd ?? "."), env: { ...process.env, ...context.job.env, ...input.env }, stdio: ["ignore", "pipe", "pipe"] });
    const lifecycle: ProcessLifecycle = { readiness: "starting", exitCode: null, signalCode: null, cleaned: false };
    const managed: ManagedProcess = { child, stdout: [], stderr: [], lifecycle };
    const limit = input.logLimitBytes ?? 1024 * 1024;
    let stdoutBytes = 0; let stderrBytes = 0;
    child.stdout?.on("data", (chunk: Buffer) => { if (stdoutBytes < limit) { const value = Buffer.from(chunk).subarray(0, limit - stdoutBytes); managed.stdout.push(value); stdoutBytes += value.length; } });
    child.stderr?.on("data", (chunk: Buffer) => { if (stderrBytes < limit) { const value = Buffer.from(chunk).subarray(0, limit - stderrBytes); managed.stderr.push(value); stderrBytes += value.length; } });
    child.once("exit", (exitCode, signalCode) => { lifecycle.exitCode = exitCode; lifecycle.signalCode = signalCode; });
    const resource = context.resources.publish({ kind: "process", name, state: "starting", handle: managed, metadata: { ownership: "owned", pid: child.pid, program: input.program, args: [...(input.args ?? [])], lifecycle } });
    context.defer(() => stopProcess(managed, input.stopGraceMs ?? 500), `stop-process:${name}`);
    try { await waitForReady(resource, input.ready, { signal: context.signal, ...(input.readyTimeoutMs === undefined ? {} : { timeoutMs: input.readyTimeoutMs }), ...(input.intervalMs === undefined ? {} : { intervalMs: input.intervalMs }) }); }
    catch (cause) { lifecycle.readiness = "failed"; context.resources.fail("process", name, { message: cause instanceof Error ? cause.message : String(cause) }); throw cause; }
    lifecycle.readiness = "ready"; context.resources.ready("process", name);
  } });
}

export interface ProcessAttachInput { readonly name?: string; readonly handle: unknown; readonly ownership?: "borrowed" | "owned"; readonly stop?: (handle: unknown) => unknown | Promise<unknown>; readonly ready?: ReadyProbe; readonly readyTimeoutMs?: number; readonly intervalMs?: number; readonly timeoutMs?: number }
export function processAttach(input: ProcessAttachInput) {
  if (input?.handle === undefined) throw new CautestError("processAttach.handle 不能为空", { code: "config_error" });
  const name = input.name ?? "default"; const ownership = input.ownership ?? "borrowed";
  return defineStep({ kind: "processAttach", name, phase: "provision", ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }), details: { ownership }, async execute(context) {
    const resource = context.resources.publish({ kind: "process", name, handle: input.handle, metadata: { ownership } });
    if (ownership === "owned") context.defer(async () => { if (input.stop !== undefined) await input.stop(input.handle); else { const value = input.handle as { stop?: () => unknown }; await value.stop?.(); } }, `stop-attached-process:${name}`);
    if (input.ready !== undefined) await waitForReady(resource, input.ready, { signal: context.signal, ...(input.readyTimeoutMs === undefined ? {} : { timeoutMs: input.readyTimeoutMs }), ...(input.intervalMs === undefined ? {} : { intervalMs: input.intervalMs }) });
  } });
}

export function collectLogs(input: { readonly from: string; readonly name?: string; readonly timeoutMs?: number }) {
  return defineStep({ kind: "collectLogs", name: input.name ?? input.from, phase: "collect", runWhen: "always", ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }), details: { from: input.from }, async execute(context) {
    const resource = context.resources.get(input.from.includes(":") ? input.from : `process:${input.from}`) as Resource & { readonly handle?: ManagedProcess };
    const managed = resource.handle;
    if (managed === undefined) return;
    const directory = path.join(context.project.resultDir, context.job.id);
    await mkdir(directory, { recursive: true });
    for (const channel of ["stdout", "stderr"] as const) {
      const file = path.join(directory, `${input.from}.${channel}.log`);
      await writeFile(file, Buffer.concat(managed[channel]));
      context.artifacts.publish({ kind: "log", name: `${input.from}-${channel}`, path: file, metadata: { startupFailed: managed.lifecycle.readiness === "failed", lifecycle: managed.lifecycle } });
    }
  } });
}

function xmlDecode(value: string): string { return value.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", "\"").replaceAll("&apos;", "'").replaceAll("&amp;", "&"); }
function xmlAttributes(source: string): Record<string, string> { return Object.fromEntries([...source.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/gsu)].map((match) => [match[1]!, xmlDecode(match[3]!)])); }

export function parseJUnit(xml: string): readonly TestSuiteResult[] {
  if (typeof xml !== "string") throw new CautestError("JUnit 内容必须是字符串", { code: "target_error" });
  const groups: TestSuiteResult[] = [];
  for (const suiteMatch of xml.matchAll(/<testsuite\b([^>]*)>([\s\S]*?)<\/testsuite>/gu)) {
    const suite = xmlAttributes(suiteMatch[1]!); const cases: TestCaseResult[] = [];
    for (const caseMatch of suiteMatch[2]!.matchAll(/<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/gu)) {
      const item = xmlAttributes(caseMatch[1]!); const body = caseMatch[2] ?? ""; const failure = /<failure\b/gu.test(body); const error = /<error\b/gu.test(body); const skipped = /<skipped\b/gu.test(body); const status: TestCaseResult["status"] = error ? "ERROR" : failure ? "FAIL" : skipped ? "SKIP" : "PASS";
      cases.push(Object.freeze({ name: item.name ?? "unnamed", status, assertions: [], diagnostics: status === "PASS" || status === "SKIP" ? [] : [{ message: xmlAttributes(body).message ?? `${status} from JUnit` }], durationMs: Math.round(Number(item.time ?? 0) * 1000) }));
    }
    groups.push(Object.freeze({ name: suite.name ?? "external", cases: Object.freeze(cases) }));
  }
  if (groups.length === 0) throw new CautestError("JUnit XML 不包含 testsuite", { code: "target_error" });
  return Object.freeze(groups);
}

export function parseJsonResults(value: string | unknown): readonly TestSuiteResult[] {
  let parsed: unknown;
  try { parsed = typeof value === "string" ? JSON.parse(value) : value; } catch (cause) { throw new CautestError("JSON Result 无法解析", { code: "target_error", cause }); }
  const candidate = Array.isArray(parsed) ? parsed : typeof parsed === "object" && parsed !== null && "groups" in parsed ? parsed.groups : undefined;
  if (!Array.isArray(candidate)) throw new CautestError("JSON Result 必须包含 groups[]", { code: "target_error" });
  return Object.freeze(candidate.map((group: unknown) => {
    const source = group as { readonly name?: unknown; readonly cases?: unknown };
    if (!Array.isArray(source.cases)) throw new CautestError("JSON Result Group 必须包含 cases[]", { code: "target_error" });
    return Object.freeze({ name: typeof source.name === "string" ? source.name : "external", cases: Object.freeze(source.cases.map((item: unknown) => { const result = item as Partial<TestCaseResult>; if (typeof result.name !== "string" || !["PASS", "FAIL", "ERROR", "SKIP"].includes(String(result.status))) throw new CautestError("JSON Case Result 无效", { code: "target_error" }); return Object.freeze({ ...result, name: result.name, status: result.status!, assertions: result.assertions ?? [], diagnostics: result.diagnostics ?? [] }); })) });
  }));
}

export interface ExternalTestInput { readonly name?: string; readonly program: string; readonly args?: readonly string[]; readonly cwd?: string; readonly env?: NodeJS.ProcessEnv; readonly resultAdapter: "junit" | "json" | "custom"; readonly resultFile?: string; readonly parse?: (raw: string, execution: { readonly exitCode: number; readonly stdout: string; readonly stderr: string }) => readonly TestSuiteResult[] | Promise<readonly TestSuiteResult[]>; readonly acceptExitCodes?: readonly number[]; readonly timeoutMs?: number }
export function externalTest(input: ExternalTestInput) {
  if (typeof input?.program !== "string" || !["junit", "json", "custom"].includes(input.resultAdapter)) throw new CautestError("externalTest 参数无效", { code: "config_error" });
  return defineStep({ kind: "externalTest", name: input.name ?? "external", phase: "run", ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }), details: { program: input.program, resultAdapter: input.resultAdapter }, async execute(context) {
    const execution = await runCommand({ program: input.program, args: input.args ?? [], cwd: path.resolve(context.project.configDir, input.cwd ?? "."), env: { ...process.env, ...context.job.env, ...input.env }, signal: context.signal, onOutput: context.output });
    if (!(input.acceptExitCodes ?? [0, 1]).includes(execution.exitCode)) throw new CautestError(`外部测试退出码 ${execution.exitCode}`, { code: "target_error", details: { stderr: execution.stderr } });
    const raw = input.resultFile === undefined ? execution.stdout : await readFile(path.resolve(context.project.configDir, input.resultFile), "utf8");
    const groups = input.resultAdapter === "junit" ? parseJUnit(raw) : input.resultAdapter === "json" ? parseJsonResults(raw) : input.parse === undefined ? (() => { throw new CautestError("Custom Adapter 缺少 parse()", { code: "config_error" }); })() : await input.parse(raw, execution);
    const cases = groups.flatMap((group) => group.cases);
    return { outcome: cases.some((item) => item.status === "FAIL" || item.status === "ERROR") ? "FAIL" : "SUCCESS", testResults: groups, diagnostics: execution.stderr === "" ? [] : [{ stream: "stderr", message: execution.stderr }] };
  } });
}

export function execStep(input: { readonly name?: string; readonly program: string; readonly args?: readonly string[]; readonly cwd?: string; readonly env?: NodeJS.ProcessEnv; readonly acceptExitCodes?: readonly number[]; readonly timeoutMs?: number }) {
  return defineStep({ kind: "exec", name: input.name ?? path.basename(input.program), phase: "run", ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }), details: { program: input.program, args: input.args ?? [] }, async execute(context) { const result = await runCommand({ program: input.program, args: input.args ?? [], cwd: path.resolve(context.project.configDir, input.cwd ?? "."), env: { ...process.env, ...context.job.env, ...input.env }, signal: context.signal, onOutput: context.output }); if (!(input.acceptExitCodes ?? [0]).includes(result.exitCode)) throw new CautestError(`命令退出码 ${result.exitCode}`, { code: "target_error", details: result }); return { diagnostics: [result] }; } });
}

export function shellExec(input: { readonly name?: string; readonly command: string; readonly unsafeShell?: boolean; readonly cwd?: string; readonly env?: NodeJS.ProcessEnv; readonly timeoutMs?: number }) {
  if (input.unsafeShell !== true) throw new CautestError("shellExec 必须显式设置 unsafeShell:true", { code: "config_error" });
  return execStep({ name: input.name ?? "shell", program: "/bin/sh", args: ["-c", input.command], ...(input.cwd === undefined ? {} : { cwd: input.cwd }), ...(input.env === undefined ? {} : { env: input.env }), ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }) });
}

export function collectStep(input: { readonly name?: string; readonly runWhen?: "on-success" | "always" | "on-failure"; readonly timeoutMs?: number; readonly execute: Parameters<typeof defineStep>[0]["execute"] }) { return defineStep({ kind: "collect", name: input.name ?? "default", phase: "collect", runWhen: input.runWhen ?? "always", ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }), execute: input.execute }); }
