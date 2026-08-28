import type { ChildProcess } from "node:child_process";
import type { Duplex } from "node:stream";
import type { CtpTransport } from "../protocol/native-session.js";
import { CautestError } from "../model/error.js";

interface Waiter { readonly predicate: (line: string) => boolean; readonly resolve: (line: string) => void; readonly reject: (error: Error) => void }

function timeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([promise, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new CautestError(message, { code: "timeout_error" })), timeoutMs); })])
    .finally(() => { if (timer !== undefined) clearTimeout(timer); });
}

class UmlEndpointTransport implements CtpTransport {
  readonly #channel: UmlControlChannel;
  readonly #endpoint: string;
  readonly #lines: string[] = [];
  readonly #waiters: Array<{ resolve(line: string): void; reject(error: Error): void }> = [];
  #buffer = "";
  #failure: Error | undefined;
  #opened = false;
  #closed = false;

  constructor(channel: UmlControlChannel, endpoint: string) { this.#channel = channel; this.#endpoint = endpoint; }
  async open(options: { readonly timeoutMs?: number; readonly signal?: AbortSignal } = {}): Promise<void> {
    if (!this.#opened) { await this.#channel.acquire(this, this.#endpoint, options.timeoutMs ?? 5_000); this.#opened = true; }
  }
  feed(chunk: Buffer): void {
    this.#buffer += chunk.toString("utf8");
    for (;;) {
      const end = this.#buffer.indexOf("\n");
      if (end < 0) break;
      const line = this.#buffer.slice(0, end).replace(/\r$/u, "");
      this.#buffer = this.#buffer.slice(end + 1);
      const waiter = this.#waiters.shift();
      if (waiter === undefined) this.#lines.push(line); else waiter.resolve(line);
    }
  }
  fail(error: Error): void { if (this.#failure !== undefined || this.#closed) return; this.#failure = error; for (const waiter of this.#waiters.splice(0)) waiter.reject(error); }
  async write(data: string): Promise<void> {
    if (!this.#opened || this.#closed) throw new CautestError("UML Endpoint Transport 未打开", { code: "transport_error" });
    await this.#channel.write(data);
  }
  async nextLine(options: { readonly timeoutMs?: number; readonly signal?: AbortSignal } = {}): Promise<string> {
    const existing = this.#lines.shift();
    if (existing !== undefined) return existing;
    if (this.#failure !== undefined) throw this.#failure;
    return await new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const waiter = { resolve: (line: string) => { cleanup(); resolve(line); }, reject: (error: Error) => { cleanup(); reject(error); } };
      const abort = () => waiter.reject(options.signal?.reason instanceof Error ? options.signal.reason : new Error("UML Session 已取消"));
      const cleanup = () => { if (timer !== undefined) clearTimeout(timer); options.signal?.removeEventListener("abort", abort); const index = this.#waiters.indexOf(waiter); if (index >= 0) this.#waiters.splice(index, 1); };
      timer = setTimeout(() => waiter.reject(new CautestError(`等待 UML Target 消息超时 (${options.timeoutMs ?? 5_000} ms)`, { code: "timeout_error" })), options.timeoutMs ?? 5_000);
      options.signal?.addEventListener("abort", abort, { once: true });
      if (options.signal?.aborted) abort(); else this.#waiters.push(waiter);
    });
  }
  async close(): Promise<void> { if (this.#closed) return; this.#closed = true; this.#channel.release(this); }
}

/** 复用 UML Guest Agent fd 通道的控制面和单活动 CTP3 Endpoint。 */
export class UmlControlChannel {
  readonly #stream: Duplex;
  readonly #waiters: Waiter[] = [];
  #buffer = Buffer.alloc(0);
  #endpoint: UmlEndpointTransport | undefined;
  #failure: Error | undefined;
  readonly #ready: Promise<string>;

  constructor(stream: Duplex) {
    this.#stream = stream;
    this.#ready = new Promise((resolve, reject) => this.#waiters.push({ predicate: (line) => line.startsWith("CAUTEST_AGENT_READY "), resolve, reject }));
    stream.on("data", (chunk: Buffer) => this.#onData(Buffer.from(chunk)));
    stream.once("error", (cause: Error) => this.fail(new CautestError(`UML Control Channel 错误: ${cause.message}`, { code: "transport_error", cause })));
    stream.once("end", () => this.fail(new CautestError("UML Control Channel 已关闭", { code: "transport_error" })));
  }
  #onData(chunk: Buffer): void {
    if (this.#endpoint !== undefined) { this.#endpoint.feed(chunk); return; }
    this.#buffer = Buffer.concat([this.#buffer, chunk]);
    if (this.#buffer.length > 4096 && this.#buffer.indexOf(0x0a) < 0) { this.fail(new CautestError("UML Agent 行响应超过 4096 字节", { code: "protocol_error" })); return; }
    for (;;) {
      const newline = this.#buffer.indexOf(0x0a);
      if (newline < 0) break;
      const line = this.#buffer.subarray(0, newline).toString("utf8").replace(/\r$/u, "");
      this.#buffer = this.#buffer.subarray(newline + 1);
      const index = this.#waiters.findIndex((waiter) => waiter.predicate(line));
      if (index >= 0) this.#waiters.splice(index, 1)[0]!.resolve(line);
    }
  }
  fail(error: Error): void { if (this.#failure !== undefined) return; this.#failure = error; this.#endpoint?.fail(error); for (const waiter of this.#waiters.splice(0)) waiter.reject(error); }
  async waitReady(timeoutMs: number): Promise<{ readonly buildId: string; readonly bootId: string }> {
    const line = await timeout(this.#ready, timeoutMs, "等待 UML Guest Agent Ready 超时");
    const fields = line.split(" ");
    if (fields.length !== 4 || fields[1] !== "1") throw new CautestError(`无效 UML Agent Ready: ${line}`, { code: "protocol_error" });
    return { buildId: fields[2]!, bootId: fields[3]! };
  }
  waitLine(predicate: (line: string) => boolean, timeoutMs = 5_000): Promise<string> {
    if (this.#failure !== undefined) return Promise.reject(this.#failure);
    return timeout(new Promise((resolve, reject) => this.#waiters.push({ predicate, resolve, reject })), timeoutMs, "等待 UML Agent 响应超时");
  }
  async write(data: string): Promise<void> { if (this.#failure !== undefined) throw this.#failure; await new Promise<void>((resolve, reject) => this.#stream.write(data, (error) => error ? reject(error) : resolve())); }
  async acquire(endpoint: UmlEndpointTransport, name: string, timeoutMs: number): Promise<void> {
    if (this.#endpoint !== undefined) throw new CautestError("UML Control Channel 已有活动 Session", { code: "transport_error" });
    const response = this.waitLine((line) => line === "OK" || line === "DENY", timeoutMs);
    await this.write(`OPEN ${name}\n`);
    if (await response !== "OK") throw new CautestError(`Guest Agent 拒绝 Endpoint: ${name}`, { code: "target_error" });
    this.#endpoint = endpoint;
  }
  release(endpoint: UmlEndpointTransport): void { if (this.#endpoint === endpoint) this.#endpoint = undefined; }
  openEndpoint(name: string): CtpTransport { return new UmlEndpointTransport(this, name); }
  async command(line: string, expected: (line: string) => boolean, timeoutMs = 5_000): Promise<string> { const response = this.waitLine(expected, timeoutMs); await this.write(`${line}\n`); return await response; }
  async close(): Promise<void> { this.#stream.removeAllListeners("data"); this.#stream.end(); this.fail(new CautestError("UML Control Channel 已关闭", { code: "transport_error" })); }
}

export interface UmlRuntimeResource {
  readonly child: ChildProcess;
  readonly control: UmlControlChannel;
  readonly stdout: Buffer[];
  readonly stderr: Buffer[];
  readonly buildId: string;
}
