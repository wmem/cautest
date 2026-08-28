import { spawn } from "node:child_process";
import { once } from "node:events";
import type { Readable, Writable } from "node:stream";
import type { CTestRunInput, TestSuiteResult } from "../config/schema/common.js";
import { CautestError } from "../model/error.js";
import { runCTestSession } from "./session.js";
import type { CtpTransport as StrictCtpTransport } from "./transport.js";

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
  const encoder = new TextDecoder();
  const transport: StrictCtpTransport = {
    async open(options) { await request.transport.open?.(options); },
    async write(data) { await request.transport.write(typeof data === "string" ? data : encoder.decode(data)); },
    nextLine(options) { return request.transport.nextLine(options); },
    async close() { await request.transport.close?.(); },
  };
  const result = await runCTestSession({
    transport,
    expectedBuildId: request.expectedBuildId,
    signal: request.signal,
    ...(request.run.include === undefined ? {} : { include: request.run.include }),
    ...(request.run.exclude === undefined ? {} : { exclude: request.run.exclude }),
    ...(request.run.suite === undefined ? {} : { suite: request.run.suite }),
    ...(request.run.case === undefined ? {} : { case: request.run.case }),
    ...(request.run.parameter === undefined ? {} : { parameter: request.run.parameter }),
    ...(request.run.suitePolicy === undefined ? {} : { suitePolicy: request.run.suitePolicy }),
    ...(request.run.runTimeoutMs === undefined ? {} : { runTimeoutMs: request.run.runTimeoutMs }),
    ...(request.run.session === undefined ? {} : { timeouts: request.run.session }),
  });
  return result.groups;
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
