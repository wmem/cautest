import {fileURLToPath} from "node:url";
import path from "node:path";
import {runCommand} from "../runtime/process.js";
import {CautestError} from "../model/error.js";

/** Parse ESM imports/re-exports without running top-level code or a factory. */
export async function staticProviderSources(module: string): Promise<readonly string[]> {
  const result = await runCommand({
    program: process.execPath,
    args: ["--no-warnings", "--experimental-vm-modules", "--experimental-import-meta-resolve", fileURLToPath(new URL("./static-source-worker.js", import.meta.url)), module],
    cwd: path.dirname(module),
    // Do not inherit preload hooks which could execute arbitrary code in a
    // subprocess whose contract is strictly parse-only.
    env: {...process.env, NODE_OPTIONS: ""},
    signal: AbortSignal.timeout(15000),
  });
  if (result.exitCode !== 0) throw new CautestError(`Cannot snapshot provider ${module}: ${result.stderr.trim()}`, {code: "config_error"});
  const files: unknown = JSON.parse(result.stdout);
  if (!Array.isArray(files) || !files.every(file => typeof file === "string" && path.isAbsolute(file))) throw new CautestError(`Invalid provider source snapshot: ${module}`, {code: "config_error"});
  return files as string[];
}
