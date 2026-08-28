import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import type { Readable, Writable } from "node:stream";
import { CautestError } from "../model/error.js";
import { LineDecoder } from "./ctp3.js";

export interface CtpTransport {
  open(options?: { readonly timeoutMs?: number; readonly signal?: AbortSignal }): void | Promise<void>;
  write(data: string | Uint8Array): void | Promise<void>;
  nextLine(options?: { readonly timeoutMs?: number; readonly signal?: AbortSignal }): string | Promise<string>;
  close(): void | Promise<void>;
}

interface LineWaiter { readonly resolve: (line: string) => void; readonly reject: (error: Error) => void }

/** 将任意 Node Readable/Writable 转换为有边界的 CTP3 行式 Transport。 */
export class StreamTransport implements CtpTransport {
  readonly #readable: Readable;
  readonly #writable: Writable;
  readonly #decoder = new LineDecoder();
  readonly #lines: string[] = [];
  readonly #waiters: LineWaiter[] = [];
  #failure?: Error;
  #closed = false;

  constructor(options: { readonly readable: Readable; readonly writable: Writable }) { this.#readable = options.readable; this.#writable = options.writable; }
  async open(): Promise<void> {
    this.#readable.on("data", (chunk: Buffer | string) => { this.#onData(typeof chunk === "string" ? Buffer.from(chunk) : chunk); });
    this.#readable.once("error", (error) => { this.#fail(error); });
    this.#readable.once("end", () => { this.#fail(new CautestError("Target Event Stream 已关闭", { code: "transport_error" })); });
    this.#writable.once("error", (error) => { this.#fail(error); });
  }
  #onData(chunk: Uint8Array): void {
    const { lines, errors } = this.#decoder.push(chunk);
    if (errors[0] !== undefined) { this.#fail(new CautestError(errors[0].message, { code: "protocol_error", cause: errors[0] })); return; }
    for (const line of lines) { const waiter = this.#waiters.shift(); if (waiter === undefined) this.#lines.push(line); else waiter.resolve(line); }
  }
  #fail(value: unknown): void {
    if (this.#failure !== undefined || this.#closed) return;
    const error = value instanceof Error ? value : new Error(String(value));
    this.#failure = error instanceof CautestError ? error : new CautestError(error.message, { code: "transport_error", cause: error });
    for (const waiter of this.#waiters.splice(0)) waiter.reject(this.#failure);
  }
  async write(data: string | Uint8Array): Promise<void> {
    if (this.#closed) throw new CautestError("Transport 已关闭", { code: "transport_error" });
    await new Promise<void>((resolve, reject) => this.#writable.write(data, (error) => error === null || error === undefined ? resolve() : reject(error)));
  }
  async nextLine(options: { readonly timeoutMs?: number; readonly signal?: AbortSignal } = {}): Promise<string> {
    const line = this.#lines.shift();
    if (line !== undefined) return line;
    if (this.#failure !== undefined) throw this.#failure;
    if (this.#closed) throw new CautestError("Transport 已关闭", { code: "transport_error" });
    return await new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const waiter: LineWaiter = {
        resolve: (value) => { cleanup(); resolve(value); },
        reject: (error) => { cleanup(); reject(error); },
      };
      const abort = (): void => waiter.reject(options.signal?.reason instanceof Error ? options.signal.reason : new CautestError("Session 已取消", { code: "timeout_error" }));
      const cleanup = (): void => { if (timer !== undefined) clearTimeout(timer); options.signal?.removeEventListener("abort", abort); const index = this.#waiters.indexOf(waiter); if (index >= 0) this.#waiters.splice(index, 1); };
      timer = setTimeout(() => waiter.reject(new CautestError(`等待 Target 消息超时 (${options.timeoutMs ?? 5_000} ms)`, { code: "timeout_error" })), options.timeoutMs ?? 5_000);
      options.signal?.addEventListener("abort", abort, { once: true });
      if (options.signal?.aborted === true) abort(); else this.#waiters.push(waiter);
    });
  }
  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#readable.removeAllListeners("data");
    this.#writable.end();
    for (const waiter of this.#waiters.splice(0)) waiter.reject(new CautestError("Transport 已关闭", { code: "transport_error" }));
  }
}

export interface ProcessTransportInput { readonly program: string; readonly args?: readonly string[]; readonly cwd?: string; readonly env?: NodeJS.ProcessEnv }

/** 启动带 FD3/FD4 CTP3 控制管道的 Native Target。 */
export class ProcessTransport implements CtpTransport {
  readonly #options: ProcessTransportInput;
  #child?: ChildProcess;
  #stream?: StreamTransport;
  readonly #stdout: Buffer[] = [];
  readonly #stderr: Buffer[] = [];
  constructor(options: ProcessTransportInput) {
    if (typeof options?.program !== "string") throw new CautestError("ProcessTransport 需要 program", { code: "transport_error" });
    this.#options = options;
  }
  get child(): ChildProcess | undefined { return this.#child; }
  get stdout(): string { return Buffer.concat(this.#stdout).toString("utf8"); }
  get stderr(): string { return Buffer.concat(this.#stderr).toString("utf8"); }
  async open(): Promise<void> {
    const child = spawn(this.#options.program, [...(this.#options.args ?? [])], { cwd: this.#options.cwd, env: { ...process.env, ...this.#options.env }, stdio: ["ignore", "pipe", "pipe", "pipe", "pipe"] });
    this.#child = child;
    child.stdout?.on("data", (chunk: Buffer) => this.#stdout.push(Buffer.from(chunk)));
    child.stderr?.on("data", (chunk: Buffer) => this.#stderr.push(Buffer.from(chunk)));
    await Promise.race([once(child, "spawn"), once(child, "error").then((values) => { const cause = values[0] as Error; throw new CautestError(`无法启动 Native Target: ${cause.message}`, { code: "transport_error", cause }); })]);
    this.#stream = new StreamTransport({ readable: child.stdio[4] as Readable, writable: child.stdio[3] as Writable });
    await this.#stream.open();
  }
  write(data: string | Uint8Array): void | Promise<void> { if (this.#stream === undefined) throw new CautestError("ProcessTransport 未打开", { code: "transport_error" }); return this.#stream.write(data); }
  nextLine(options?: { readonly timeoutMs?: number; readonly signal?: AbortSignal }): string | Promise<string> { if (this.#stream === undefined) throw new CautestError("ProcessTransport 未打开", { code: "transport_error" }); return this.#stream.nextLine(options); }
  async close(): Promise<void> {
    await this.#stream?.close();
    const child = this.#child;
    if (child === undefined || child.exitCode !== null || child.signalCode !== null) return;
    const closed = once(child, "close");
    if (await Promise.race([closed.then(() => true), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 250))])) return;
    child.kill("SIGTERM");
    const forced = setTimeout(() => child.kill("SIGKILL"), 500);
    await closed;
    clearTimeout(forced);
  }
}

export function processTransport(options: ProcessTransportInput): ProcessTransport { return new ProcessTransport(options); }
