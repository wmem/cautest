import { spawn } from "node:child_process";

export interface CommandRequest {
  readonly program: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly signal: AbortSignal;
  readonly onOutput?: (channel: "stdout" | "stderr", text: string) => void;
}

export interface CommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** 执行参数数组命令，不经过 Shell；Abort 时先 SIGTERM，随后 SIGKILL。 */
export async function runCommand(request: CommandRequest): Promise<CommandResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn(request.program, [...request.args], {
      cwd: request.cwd,
      env: request.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let forced: ReturnType<typeof setTimeout> | undefined;
    const abort = () => {
      child.kill("SIGTERM");
      forced = setTimeout(() => child.kill("SIGKILL"), 500);
    };
    request.signal.addEventListener("abort", abort, { once: true });
    if (request.signal.aborted) abort();
    child.stdout.on("data", (chunk: Buffer) => {
      stdout.push(chunk);
      request.onOutput?.("stdout", chunk.toString("utf8"));
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr.push(chunk);
      request.onOutput?.("stderr", chunk.toString("utf8"));
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (forced !== undefined) clearTimeout(forced);
      request.signal.removeEventListener("abort", abort);
      if (request.signal.aborted) {
        reject(request.signal.reason instanceof Error ? request.signal.reason : new Error("命令已取消"));
        return;
      }
      resolve({ exitCode: code ?? 1, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") });
    });
  });
}
