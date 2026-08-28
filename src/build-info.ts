import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function git(args: readonly string[]): Promise<string> {
  const result = await execFileAsync("git", ["-C", repositoryRoot, ...args], { encoding: "utf8" });
  return result.stdout.trim();
}

async function main(): Promise<void> {
  const manifest = JSON.parse(await readFile(path.join(repositoryRoot, "package.json"), "utf8")) as { version?: unknown };
  if (typeof manifest.version !== "string") throw new Error("package.json.version 无效");
  let commit = "unknown";
  let dirty = false;
  try {
    commit = await git(["rev-parse", "HEAD"]);
    dirty = (await git(["status", "--porcelain", "--untracked-files=no"])).length > 0;
  } catch {
    // Registry 或归档安装可能没有 .git；版本仍然可用，Commit 显式标记 unknown。
  }
  await writeFile(path.join(repositoryRoot, "dist/build-info.json"), `${JSON.stringify({
    schemaVersion: 1,
    version: manifest.version,
    commit,
    dirty,
  }, null, 2)}\n`);
}

await main();
