import { execFile } from "node:child_process";
import { readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { CAUTEST_VERSIONS } from "./config/versions.js";

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function git(args: readonly string[]): Promise<string> {
  const result = await execFileAsync("git", ["-C", repositoryRoot, ...args], { encoding: "utf8" });
  return result.stdout.trim();
}

async function main(): Promise<void> {
  const manifest = JSON.parse(await readFile(path.join(repositoryRoot, "package.json"), "utf8")) as { version?: unknown };
  if (typeof manifest.version !== "string") throw new Error("package.json.version 无效");
  if (manifest.version !== CAUTEST_VERSIONS.release) throw new Error(`Release 版本漂移: versions.json=${CAUTEST_VERSIONS.release}, package.json=${manifest.version}`);
  let commit = "unknown";
  let dirty = false;
  try {
    commit = await git(["rev-parse", "HEAD"]);
    dirty = (await git(["status", "--porcelain", "--untracked-files=no"])).length > 0;
  } catch {
    // Registry 或归档安装可能没有 .git；版本仍然可用，Commit 显式标记 unknown。
  }
  const destination = path.join(repositoryRoot, "dist/build-info.json");
  const temporary = `${destination}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify({
    schemaVersion: CAUTEST_VERSIONS.schemas.buildInfo,
    version: CAUTEST_VERSIONS.release,
    versions: CAUTEST_VERSIONS,
    commit,
    dirty,
  }, null, 2)}\n`);
  await rename(temporary, destination);
}

await main();
