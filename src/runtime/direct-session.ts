import { spawn } from "node:child_process";
import { once } from "node:events";
import { appendFile, open as openFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import type { CTestRunInput } from "../config/schema/common.js";
import { testConfig, testJob } from "../config/define.js";
import { CautestError } from "../model/error.js";
import { runCTestSession, type TargetLog } from "../protocol/session.js";
import { ProcessTransport, StreamTransport, type CtpTransport } from "../protocol/transport.js";
import { workflowSessionEventSink, workflowSessionResult } from "../protocol/workflow-session.js";
import { executeRun, type ExecutedRun } from "../result/run.js";
import { defineStep } from "../workflow/step.js";

export type DirectSessionMode = "process" | "attach" | "serial";

export interface DirectSessionOptions {
  readonly mode: DirectSessionMode;
  readonly target?: string;
  readonly socket?: string;
  readonly device?: string;
  readonly baud?: number;
  readonly run: CTestRunInput;
  readonly resultRoot: string;
  readonly signal?: AbortSignal;
}

function connectionFailure(label: string, cause: unknown): CautestError {
  return new CautestError(`${label} 连接失败: ${cause instanceof Error ? cause.message : String(cause)}`, { code: "transport_error", cause });
}

class SocketTransport implements CtpTransport {
  readonly #socketPath: string;
  #socket?: net.Socket;
  #stream?: StreamTransport;
  constructor(socketPath: string) { this.#socketPath = socketPath; }
  async open(options: { readonly timeoutMs?: number; readonly signal?: AbortSignal } = {}): Promise<void> {
    const socket = net.createConnection(this.#socketPath);
    this.#socket = socket;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const abort = (): void => { socket.destroy(options.signal?.reason instanceof Error ? options.signal.reason : new Error("连接已取消")); };
    options.signal?.addEventListener("abort", abort, { once: true });
    try {
      await Promise.race([
        once(socket, "connect"),
        once(socket, "error").then(([cause]) => { throw connectionFailure(`Unix Socket ${this.#socketPath}`, cause); }),
        new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new CautestError(`Unix Socket 连接超时 (${options.timeoutMs ?? 5_000} ms)`, { code: "timeout_error" })), options.timeoutMs ?? 5_000); }),
      ]);
      this.#stream = new StreamTransport({ readable: socket, writable: socket });
      await this.#stream.open();
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
    }
  }
  write(data: string | Uint8Array): void | Promise<void> { if (this.#stream === undefined) throw connectionFailure("Unix Socket", "尚未打开"); return this.#stream.write(data); }
  nextLine(options?: { readonly timeoutMs?: number; readonly signal?: AbortSignal }): string | Promise<string> { if (this.#stream === undefined) throw connectionFailure("Unix Socket", "尚未打开"); return this.#stream.nextLine(options); }
  async close(): Promise<void> { await this.#stream?.close(); this.#socket?.destroy(); }
}

async function configureSerial(device: string, baud: number, signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("stty", ["-F", device, String(baud), "raw", "-echo"], { stdio: ["ignore", "ignore", "pipe"] });
    const stderr: Buffer[] = [];
    const abort = (): void => { child.kill("SIGTERM"); };
    signal?.addEventListener("abort", abort, { once: true });
    child.stderr.on("data", (chunk: Buffer) => stderr.push(Buffer.from(chunk)));
    child.once("error", reject);
    child.once("close", (code) => {
      signal?.removeEventListener("abort", abort);
      if (signal?.aborted === true) reject(signal.reason instanceof Error ? signal.reason : new Error("Serial 配置已取消"));
      else if (code === 0) resolve();
      else reject(new CautestError(`stty 配置 Serial 失败 (exit ${code ?? 1}): ${Buffer.concat(stderr).toString("utf8").trim()}`, { code: "transport_error" }));
    });
  });
}

class SerialTransport implements CtpTransport {
  readonly #device: string;
  readonly #baud: number;
  #file?: Awaited<ReturnType<typeof openFile>>;
  #stream?: StreamTransport;
  constructor(device: string, baud: number) { this.#device = device; this.#baud = baud; }
  async open(options: { readonly signal?: AbortSignal } = {}): Promise<void> {
    await configureSerial(this.#device, this.#baud, options.signal);
    const file = await openFile(this.#device, "r+");
    this.#file = file;
    this.#stream = new StreamTransport({ readable: file.createReadStream({ autoClose: false }), writable: file.createWriteStream({ autoClose: false }) });
    await this.#stream.open();
  }
  write(data: string | Uint8Array): void | Promise<void> { if (this.#stream === undefined) throw connectionFailure("Serial", "尚未打开"); return this.#stream.write(data); }
  nextLine(options?: { readonly timeoutMs?: number; readonly signal?: AbortSignal }): string | Promise<string> { if (this.#stream === undefined) throw connectionFailure("Serial", "尚未打开"); return this.#stream.nextLine(options); }
  async close(): Promise<void> { await this.#stream?.close(); await this.#file?.close(); }
}

function directTransport(options: DirectSessionOptions): CtpTransport {
  if (options.mode === "process") {
    if (options.target === undefined) throw new CautestError("session process 要求 --target", { code: "config_error" });
    return new ProcessTransport({ program: options.target, cwd: process.cwd() });
  }
  if (options.mode === "attach") {
    if (options.socket === undefined) throw new CautestError("session attach 要求 --socket", { code: "config_error" });
    return new SocketTransport(options.socket);
  }
  if (options.device === undefined || options.baud === undefined) throw new CautestError("session serial 要求 --device 和 --baud", { code: "config_error" });
  return new SerialTransport(options.device, options.baud);
}

/** 将无项目配置的 CTP3 连接包装成标准 Workflow Run。 */
export async function executeDirectSession(options: DirectSessionOptions): Promise<ExecutedRun> {
  const step = defineStep({
    kind: "cTestRun",
    name: options.mode,
    phase: "run",
    details: { mode: options.mode, selection: options.run },
    timeoutMs: Math.max(60_000, (options.run.runTimeoutMs ?? 0) + 15_000),
    async execute(context) {
      const transport = directTransport(options);
      const targetLog = path.join(context.project.resultDir, "target.log");
      let targetLogLine = 0;
      const session = await runCTestSession({
        transport,
        ...options.run,
        signal: context.signal,
        onEvent: workflowSessionEventSink(context.events, context.job.id),
        async onLog(log: TargetLog) {
          targetLogLine += 1;
          await appendFile(targetLog, `${JSON.stringify(log)}\n`);
          return `target.log:${targetLogLine}`;
        },
      });
      if (targetLogLine > 0) context.artifacts.publish({ kind: "targetLog", name: options.mode, path: targetLog });
      return workflowSessionResult(session, { label: `Direct ${options.mode} C Test`, allowEmpty: false });
    },
  });
  const job = testJob({ id: "direct.session", level: "system", tags: ["direct", "ctp3", options.mode], workflow: [step] });
  const config = testConfig({ jobs: [job], defaults: { resultDir: options.resultRoot } });
  return await executeRun(config, {
    configDir: process.cwd(),
    resultDir: options.resultRoot,
    jobs: [job],
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
}
