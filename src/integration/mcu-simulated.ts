import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import type { Readable, Writable } from "node:stream";
import type { McuBoardAdapter, McuCtpTransport, SimulatedMcuBoardInput } from "../config/schema/mcu.js";
import { CautestError } from "../model/error.js";
import { LineDecoder } from "../protocol/ctp3.js";

interface Firmware { readonly path: string; readonly buildId: string }
interface Waiter { readonly resolve: (line: string) => void; readonly reject: (error: Error) => void }

class SimulatedSerialTransport implements McuCtpTransport {
  readonly #board: SimulatedMcuBoard;
  readonly #options: Readonly<Record<string, unknown>>;
  readonly #decoder = new LineDecoder();
  readonly #lines: string[] = [];
  readonly #waiters: Waiter[] = [];
  #child?: ChildProcess;
  #input?: Writable;
  #failure?: Error;
  #closed = false;
  #readChunks = 0;
  constructor(board: SimulatedMcuBoard, options: Readonly<Record<string, unknown>>) { this.#board = board; this.#options = options; }
  async open(): Promise<void> {
    const firmware = this.#board.firmware;
    if (firmware === undefined) throw new CautestError("模拟 Board 尚未 Flash", { code: "transport_error" });
    const child = spawn(firmware.path, [this.#board.bootId], {
      cwd: typeof this.#options.cwd === "string" ? this.#options.cwd : process.cwd(),
      env: { ...process.env, ...(typeof this.#options.env === "object" && this.#options.env !== null ? this.#options.env : {}) },
      stdio: ["ignore", "pipe", "pipe", "pipe", "pipe"],
    });
    this.#child = child;
    this.#input = child.stdio[3] as Writable;
    this.#board.activate(this);
    child.stdout?.on("data", (chunk: Buffer) => this.#board.record("stdout", chunk.toString("utf8")));
    child.stderr?.on("data", (chunk: Buffer) => this.#board.record("stderr", chunk.toString("utf8")));
    (child.stdio[4] as Readable).on("data", (chunk: Buffer) => this.#onBytes(chunk));
    (child.stdio[4] as Readable).once("end", () => this.#fail(new CautestError("模拟 MCU Event Stream 已关闭", { code: "transport_error" })));
    (child.stdio[4] as Readable).once("error", (cause) => this.#fail(new CautestError(cause.message, { code: "transport_error", cause })));
    this.#input.once("error", (cause) => this.#fail(new CautestError(cause.message, { code: "transport_error", cause })));
    await Promise.race([once(child, "spawn"), once(child, "error").then(([cause]) => { throw new CautestError(`无法启动模拟 MCU Target: ${(cause as Error).message}`, { code: "transport_error", cause }); })]);
  }
  async write(data: string): Promise<void> {
    if (this.#closed || this.#failure !== undefined || this.#input === undefined) throw this.#failure ?? new CautestError("模拟串口未打开或已关闭", { code: "transport_error" });
    this.#board.record("command", data.trimEnd());
    let bytes = Buffer.from(data);
    if (this.#board.corruptWriteOnce && !this.#board.corruptionUsed) {
      this.#board.corruptionUsed = true;
      const damaged = Buffer.from(bytes);
      if (damaged.length > 0) damaged[damaged.length - 1] = 0xff;
      bytes = Buffer.concat([damaged, bytes]);
    }
    for (let offset = 0; offset < bytes.length; offset += this.#board.maxWriteSize) {
      const chunk = bytes.subarray(offset, offset + this.#board.maxWriteSize);
      await new Promise<void>((resolve, reject) => this.#input!.write(chunk, (error) => error === null || error === undefined ? resolve() : reject(error)));
    }
  }
  #onBytes(bytes: Uint8Array): void {
    for (let offset = 0; offset < bytes.length; offset += this.#board.maxReadSize) {
      const chunk = bytes.subarray(offset, offset + this.#board.maxReadSize);
      this.#readChunks += 1;
      if (this.#board.disconnectOnce !== undefined && !this.#board.disconnectUsed && this.#readChunks > this.#board.disconnectOnce) {
        this.#board.disconnectUsed = true;
        this.#fail(new CautestError("模拟串口断线", { code: "transport_error" }));
        this.#child?.kill("SIGKILL");
        return;
      }
      const decoded = this.#decoder.push(chunk);
      if (decoded.errors[0] !== undefined) { this.#fail(new CautestError(decoded.errors[0].message, { code: "protocol_error", cause: decoded.errors[0] })); return; }
      for (const line of decoded.lines) { const waiter = this.#waiters.shift(); if (waiter === undefined) this.#lines.push(line); else waiter.resolve(line); }
    }
  }
  nextLine(options: { readonly timeoutMs?: number; readonly signal?: AbortSignal } = {}): string | Promise<string> {
    const line = this.#lines.shift();
    if (line !== undefined) return line;
    if (this.#failure !== undefined) return Promise.reject(this.#failure);
    if (this.#closed) return Promise.reject(new CautestError("模拟串口已关闭", { code: "transport_error" }));
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const waiter: Waiter = { resolve: (value) => { cleanup(); resolve(value); }, reject: (error) => { cleanup(); reject(error); } };
      const abort = (): void => waiter.reject(options.signal?.reason instanceof Error ? options.signal.reason : new CautestError("MCU Session 已取消", { code: "timeout_error" }));
      const cleanup = (): void => { if (timer !== undefined) clearTimeout(timer); options.signal?.removeEventListener("abort", abort); const index = this.#waiters.indexOf(waiter); if (index >= 0) this.#waiters.splice(index, 1); };
      timer = setTimeout(() => waiter.reject(new CautestError(`等待 MCU 响应超时 (${options.timeoutMs ?? 5_000} ms)`, { code: "timeout_error" })), options.timeoutMs ?? 5_000);
      options.signal?.addEventListener("abort", abort, { once: true });
      if (options.signal?.aborted === true) abort(); else this.#waiters.push(waiter);
    });
  }
  #fail(error: Error): void { if (this.#failure !== undefined || this.#closed) return; this.#failure = error; for (const waiter of this.#waiters.splice(0)) waiter.reject(error); }
  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#board.deactivate(this);
    for (const waiter of this.#waiters.splice(0)) waiter.reject(new CautestError("模拟串口已关闭", { code: "transport_error" }));
    const child = this.#child;
    if (child === undefined || child.exitCode !== null || child.signalCode !== null) return;
    this.#input?.end();
    const closed = once(child, "close");
    if (await Promise.race([closed.then(() => true), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 100))])) return;
    child.kill("SIGKILL");
    await closed;
  }
}

/** 具有分片 I/O、一次性损坏/断线与稳定 Boot ID 的 Host 模拟 MCU Board。 */
export class SimulatedMcuBoard implements McuBoardAdapter {
  readonly maxReadSize: number;
  readonly maxWriteSize: number;
  readonly disconnectOnce: number | undefined;
  readonly corruptWriteOnce: boolean;
  disconnectUsed = false;
  corruptionUsed = false;
  #bootCounter = 0;
  #powered = false;
  readonly #active = new Set<SimulatedSerialTransport>();
  readonly logs: Array<Readonly<{ readonly channel: "stdout" | "stderr" | "command" | "lifecycle"; readonly text: string }>> = [];
  firmware?: Firmware;
  bootId = "";
  constructor(options: Omit<SimulatedMcuBoardInput, "kind"> = {}) {
    this.maxReadSize = options.maxReadSize ?? 7;
    this.maxWriteSize = options.maxWriteSize ?? 5;
    this.disconnectOnce = options.disconnectOnce;
    this.corruptWriteOnce = options.corruptWriteOnce ?? false;
    if (!Number.isInteger(this.maxReadSize) || this.maxReadSize <= 0 || !Number.isInteger(this.maxWriteSize) || this.maxWriteSize <= 0) throw new CautestError("模拟 MCU I/O 分片大小必须是正整数", { code: "config_error" });
    if (this.disconnectOnce !== undefined && (!Number.isInteger(this.disconnectOnce) || this.disconnectOnce < 0)) throw new CautestError("模拟 MCU disconnectOnce 必须是非负整数", { code: "config_error" });
  }
  record(channel: "stdout" | "stderr" | "command" | "lifecycle", text: string): void { this.logs.push(Object.freeze({ channel, text })); }
  activate(transport: SimulatedSerialTransport): void { this.#active.add(transport); }
  deactivate(transport: SimulatedSerialTransport): void { this.#active.delete(transport); }
  flash(firmware: Firmware): void { if (!firmware?.path || !firmware.buildId) throw new CautestError("Firmware 缺少 path/buildId", { code: "provision_error" }); this.firmware = Object.freeze({ ...firmware }); this.record("lifecycle", `flash:${firmware.buildId}`); }
  reset(): string {
    if (this.firmware === undefined) throw new CautestError("Reset 前尚未 Flash Firmware", { code: "provision_error" });
    for (const transport of this.#active) void transport.close();
    this.#bootCounter += 1;
    this.bootId = `sim-boot-${this.#bootCounter}`;
    this.#powered = true;
    this.record("lifecycle", `reset:${this.bootId}`);
    return this.bootId;
  }
  openTransport(options: Readonly<Record<string, unknown>> = {}): McuCtpTransport { if (!this.#powered) throw new CautestError("模拟 Board 尚未启动", { code: "transport_error" }); return new SimulatedSerialTransport(this, options); }
  async close(): Promise<void> { await Promise.all([...this.#active].map(async (transport) => await transport.close())); this.#powered = false; }
}
