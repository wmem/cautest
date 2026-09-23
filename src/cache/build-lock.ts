import {mkdir, realpath} from "node:fs/promises";
import path from "node:path";
import {acquirePhysicalResource} from "../integration/resource-lock.js";
import {CautestError} from "../model/error.js";

/**
 * Serialize validation, invalidation, build and publication of a Linux build
 * directory. The lock lives outside that directory and is never unlinked.
 * Kernel flock, rather than PID/mtime heuristics, releases it after a crash.
 * The same helper protects the multi-command Xmake receipt transaction.
 */
export async function withBuildLock<T>(directory: string, signal: AbortSignal, action: () => Promise<T>, timeoutMs = 30 * 60_000): Promise<T> {
  signal.throwIfAborted();
  if (process.platform !== "linux") throw new CautestError("Cross-process build locking requires Linux flock on this supported host", {code: "tooling_error"});
  const absolute = path.resolve(directory);
  await mkdir(path.dirname(absolute), {recursive: true});
  const parent = await realpath(path.dirname(absolute));
  const canonical = path.join(parent, path.basename(absolute));
  let lock;
  try {
    lock = await acquirePhysicalResource({resourceId: `cautest-build:${canonical}`, signal, timeoutMs});
  } catch (cause) {
    signal.throwIfAborted();
    throw new CautestError(`Cannot lock build directory ${canonical}: ${cause instanceof Error ? cause.message : String(cause)}`, {code: "cache_error", cause});
  }
  try { signal.throwIfAborted(); return await action(); }
  finally { await lock.release(); }
}
