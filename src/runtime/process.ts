import { spawn } from "node:child_process";

export interface CommandRequest {
  readonly program: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly signal: AbortSignal;
  readonly onOutput?: (channel: "stdout" | "stderr", text: string) => void;
}
export interface CommandResult { readonly exitCode: number; readonly stdout: string; readonly stderr: string }

/** Run argv without a shell. POSIX commands own a process group, including compiler children. */
export async function runCommand(request: CommandRequest): Promise<CommandResult> {
  request.signal.throwIfAborted();
  return await new Promise((resolve, reject) => {
    const grouped = process.platform !== "win32";
    const child = spawn(request.program, [...request.args], {
      cwd: request.cwd, env: request.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"], detached: grouped,
    });
    const stdout: Buffer[] = [], stderr: Buffer[] = [];
    let forced: ReturnType<typeof setTimeout> | undefined;
    const kill = (signal: NodeJS.Signals) => {
      if (child.pid === undefined) return;
      try { if (grouped) process.kill(-child.pid, signal); else child.kill(signal); }
      catch (error) { if (!(typeof error === "object" && error !== null && "code" in error && error.code === "ESRCH")) reject(error); }
    };
    const abort = () => { kill("SIGTERM"); forced ??= setTimeout(() => kill("SIGKILL"), 500); };
    const clean = () => { if (forced !== undefined) clearTimeout(forced); request.signal.removeEventListener("abort", abort); };
    request.signal.addEventListener("abort", abort, { once: true });
    if (request.signal.aborted) abort();
    child.stdout.on("data", (chunk: Buffer) => { stdout.push(chunk); request.onOutput?.("stdout", chunk.toString("utf8")); });
    child.stderr.on("data", (chunk: Buffer) => { stderr.push(chunk); request.onOutput?.("stderr", chunk.toString("utf8")); });
    child.once("error", (error) => { clean(); reject(error); });
    child.once("close", (code) => {
      // A descendant may have closed its pipes but survived its parent. Reap the group too.
      if (request.signal.aborted) kill("SIGKILL");
      clean();
      if (request.signal.aborted) { reject(request.signal.reason instanceof Error ? request.signal.reason : new Error("命令已取消")); return; }
      resolve({ exitCode: code ?? 1, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") });
    });
  });
}
