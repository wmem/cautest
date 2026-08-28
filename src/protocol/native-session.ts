import type { CTestRunInput, TestSuiteResult } from "../config/schema/common.js";
import { runCTestSession, type TargetLog } from "./session.js";
import { ProcessTransport, type CtpTransport as StrictCtpTransport } from "./transport.js";

/** 兼容项目自定义 Adapter 的行式 CTP3 Transport。 */
export interface CtpTransport {
  open?(options?: { readonly timeoutMs?: number; readonly signal?: AbortSignal }): void | Promise<void>;
  write(data: string): void | Promise<void>;
  nextLine(options?: { readonly timeoutMs?: number; readonly signal?: AbortSignal }): string | Promise<string>;
  close?(): void | Promise<void>;
}

export interface CtpSessionRequest { readonly transport: CtpTransport; readonly expectedBuildId: string; readonly expectedBootId?: string; readonly run: CTestRunInput; readonly signal: AbortSignal; readonly onLog?: (log: TargetLog) => string | void | Promise<string | void> }

/** 将项目 Adapter 统一接入严格 CTestSession。 */
export async function runCtpSession(request: CtpSessionRequest): Promise<readonly TestSuiteResult[]> {
  const decoder = new TextDecoder();
  const transport: StrictCtpTransport = {
    async open(options) { await request.transport.open?.(options); },
    async write(data) { await request.transport.write(typeof data === "string" ? data : decoder.decode(data)); },
    nextLine(options) { return request.transport.nextLine(options); },
    async close() { await request.transport.close?.(); },
  };
  const result = await runCTestSession({
    transport,
    expectedBuildId: request.expectedBuildId,
    ...(request.expectedBootId === undefined ? {} : { expectedBootId: request.expectedBootId }),
    signal: request.signal,
    ...(request.run.include === undefined ? {} : { include: request.run.include }),
    ...(request.run.exclude === undefined ? {} : { exclude: request.run.exclude }),
    ...(request.run.suite === undefined ? {} : { suite: request.run.suite }),
    ...(request.run.case === undefined ? {} : { case: request.run.case }),
    ...(request.run.parameter === undefined ? {} : { parameter: request.run.parameter }),
    ...(request.run.suitePolicy === undefined ? {} : { suitePolicy: request.run.suitePolicy }),
    ...(request.run.runTimeoutMs === undefined ? {} : { runTimeoutMs: request.run.runTimeoutMs }),
    ...(request.run.session === undefined ? {} : { timeouts: request.run.session }),
    ...(request.onLog === undefined ? {} : { onLog: request.onLog }),
  });
  return result.groups;
}

export interface NativeSessionRequest {
  readonly program: string;
  readonly args?: readonly string[];
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly expectedBuildId: string;
  readonly expectedBootId?: string;
  readonly run: CTestRunInput;
  readonly signal: AbortSignal;
  readonly onLog?: (log: TargetLog) => string | void | Promise<string | void>;
  readonly onComplete?: (output: { readonly stdout: string; readonly stderr: string }) => void | Promise<void>;
}

/** 通过 POSIX Target 的 FD3/FD4 执行严格 CTP3 Native Session。 */
export async function runNativeSession(request: NativeSessionRequest): Promise<readonly TestSuiteResult[]> {
  const transport = new ProcessTransport({ program: request.program, ...(request.args === undefined ? {} : { args: request.args }), cwd: request.cwd, env: request.env });
  try {
    const result = await runCTestSession({
      transport,
      expectedBuildId: request.expectedBuildId,
      ...(request.expectedBootId === undefined ? {} : { expectedBootId: request.expectedBootId }),
      signal: request.signal,
      ...(request.run.include === undefined ? {} : { include: request.run.include }),
      ...(request.run.exclude === undefined ? {} : { exclude: request.run.exclude }),
      ...(request.run.suite === undefined ? {} : { suite: request.run.suite }),
      ...(request.run.case === undefined ? {} : { case: request.run.case }),
      ...(request.run.parameter === undefined ? {} : { parameter: request.run.parameter }),
      ...(request.run.suitePolicy === undefined ? {} : { suitePolicy: request.run.suitePolicy }),
      ...(request.run.runTimeoutMs === undefined ? {} : { runTimeoutMs: request.run.runTimeoutMs }),
      ...(request.run.session === undefined ? {} : { timeouts: request.run.session }),
      ...(request.onLog === undefined ? {} : { onLog: request.onLog }),
    });
    return result.groups;
  } finally { await request.onComplete?.({ stdout: transport.stdout, stderr: transport.stderr }); }
}
