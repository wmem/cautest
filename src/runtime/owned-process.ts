import type {ChildProcess} from "node:child_process";

/** Install immediately after spawn. Stop is bounded, idempotent and reaps the owned POSIX group. */
export function ownedProcessStop(child: ChildProcess, grouped: boolean): () => Promise<void> {
  let closed = false;
  const exited = new Promise<void>(resolve => child.once("close", () => {closed = true; resolve();}));
  const kill = (signal: NodeJS.Signals) => {
    if (child.pid === undefined) return;
    try {if (grouped) process.kill(-child.pid, signal); else if (!closed) child.kill(signal);}
    catch (error) {if (!(typeof error === "object" && error !== null && "code" in error && error.code === "ESRCH")) throw error;}
  };
  async function grace(): Promise<void> {
    if (closed) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {await Promise.race([exited, new Promise<void>(resolve => {timer = setTimeout(resolve, 500);})]);}
    finally {if (timer !== undefined) clearTimeout(timer);}
  }
  let stopping: Promise<void> | undefined;
  return () => stopping ??= (async () => {
    kill("SIGTERM"); await grace();
    // A leader can exit after TERM while a descendant survives and closes its pipes.
    kill("SIGKILL"); await grace();
  })();
}
