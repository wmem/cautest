#!/usr/bin/env node

import { createHash } from "node:crypto";
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, rmdir, writeFile, chmod } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

type DestinationState = "missing" | "empty";

interface BuildInfo {
  readonly schemaVersion: number;
  readonly version: string;
  readonly commit: string;
  readonly dirty: boolean;
}

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const picomatchRoot = path.dirname(require.resolve("picomatch/package.json"));
const usage = `用法: cautest-install <目标目录>

目标目录必须不存在或为空。安装器不会覆盖文件、符号链接或非空目录。
`;

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

async function inspectDestination(destination: string): Promise<DestinationState> {
  try {
    const metadata = await lstat(destination);
    if (metadata.isSymbolicLink()) throw new Error(`目标目录是符号链接，拒绝写入: ${destination}`);
    if (!metadata.isDirectory()) throw new Error(`目标路径不是目录，拒绝覆盖: ${destination}`);
    if ((await readdir(destination)).length > 0) throw new Error(`目标目录非空，拒绝覆盖: ${destination}`);
    return "empty";
  } catch (error) {
    if (isMissing(error)) return "missing";
    throw error;
  }
}

function resolveDestination(input: string, cwd: string): string {
  const destination = path.resolve(cwd, input);
  if (destination === path.parse(destination).root) throw new Error("拒绝将文件系统根作为目标目录");
  const relative = path.relative(destination, cwd);
  const containsCwd = relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
  if (containsCwd) throw new Error("拒绝将当前工作目录或其父目录作为目标目录");
  return destination;
}

async function collectFiles(root: string, relative = ""): Promise<string[]> {
  const files: string[] = [];
  for (const name of (await readdir(path.join(root, relative), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const child = path.join(relative, name.name);
    if (name.isDirectory()) files.push(...await collectFiles(root, child));
    else if (name.isFile()) files.push(child.split(path.sep).join("/"));
    else throw new Error(`便携目录拒绝非普通文件: ${child}`);
  }
  return files;
}

async function createPortableTree(root: string, build: BuildInfo): Promise<void> {
  await mkdir(path.join(root, "lib"), { recursive: true });
  for (const directory of ["config", "jobs", "model", "protocol", "workflow"]) {
    await cp(path.join(packageRoot, `dist/${directory}`), path.join(root, `lib/${directory}`), { recursive: true });
  }
  await mkdir(path.join(root, "lib/runtime"));
  for (const file of ["cli.js", "cli.js.map", "cli.d.ts", "cli.d.ts.map", "process.js", "process.js.map", "process.d.ts", "process.d.ts.map"]) {
    await cp(path.join(packageRoot, `dist/runtime/${file}`), path.join(root, `lib/runtime/${file}`));
  }
  await mkdir(path.join(root, "lib/vendor/picomatch"), { recursive: true });
  for (const file of ["index.js", "LICENSE", "package.json"]) {
    await cp(path.join(picomatchRoot, file), path.join(root, `lib/vendor/picomatch/${file}`));
  }
  await cp(path.join(picomatchRoot, "lib"), path.join(root, "lib/vendor/picomatch/lib"), { recursive: true });
  await cp(path.join(packageRoot, "dist/runtime/entry.js"), path.join(root, "cautest.js"));
  await cp(path.join(packageRoot, "dist/runtime/loader.js"), path.join(root, "loader.mjs"));
  await cp(path.join(packageRoot, "assets/portable/README.md"), path.join(root, "README.md"));
  await mkdir(path.join(root, "assets"));
  await cp(path.join(packageRoot, "assets/cautest-c"), path.join(root, "assets/cautest-c"), { recursive: true });
  await chmod(path.join(root, "cautest.js"), 0o755);
  await writeFile(path.join(root, "package.json"), `${JSON.stringify({
    name: "cautest-portable",
    version: build.version,
    private: true,
    type: "module",
    engines: { node: ">=20.6" },
  }, null, 2)}\n`);
  await writeFile(path.join(root, "build-info.json"), `${JSON.stringify(build, null, 2)}\n`);
  const entries = [];
  for (const relative of await collectFiles(root)) {
    const bytes = await readFile(path.join(root, relative));
    entries.push({ path: relative, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
  }
  await writeFile(path.join(root, "manifest.json"), `${JSON.stringify({
    schemaVersion: 1,
    product: "cautest-portable",
    version: build.version,
    build: { commit: build.commit, dirty: build.dirty },
    entries,
  }, null, 2)}\n`);
}

async function verifyPortableTree(root: string): Promise<void> {
  const value: unknown = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));
  if (typeof value !== "object" || value === null || !("entries" in value) || !Array.isArray(value.entries)) {
    throw new Error("便携目录 Manifest 无效");
  }
  const expected = new Set(["manifest.json"]);
  for (const entry of value.entries as unknown[]) {
    if (typeof entry !== "object" || entry === null) throw new Error("便携目录 Manifest Entry 无效");
    const candidate = entry as { path?: unknown; size?: unknown; sha256?: unknown };
    if (typeof candidate.path !== "string" || typeof candidate.size !== "number" || typeof candidate.sha256 !== "string") {
      throw new Error("便携目录 Manifest Entry 字段不完整");
    }
    if (expected.has(candidate.path)) throw new Error(`便携目录 Manifest 路径重复: ${candidate.path}`);
    expected.add(candidate.path);
    const bytes = await readFile(path.join(root, candidate.path));
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (bytes.length !== candidate.size || digest !== candidate.sha256) {
      throw new Error(`便携目录文件校验失败: ${candidate.path}`);
    }
  }
  const actual = await collectFiles(root);
  if (actual.length !== expected.size || actual.some((item) => !expected.has(item))) {
    throw new Error("便携目录文件集合与 Manifest 不一致");
  }
}

async function restoreEmptyDirectory(destination: string): Promise<void> {
  try {
    await mkdir(destination);
  } catch (error) {
    if (!isMissing(error) && !(typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST")) {
      throw error;
    }
  }
}

async function install(destination: string): Promise<BuildInfo> {
  const initialState = await inspectDestination(destination);
  const parent = path.dirname(destination);
  await mkdir(parent, { recursive: true });
  const temporaryRoot = await mkdtemp(path.join(parent, ".cautest-v2-install-"));
  const staged = path.join(temporaryRoot, "cautest");
  await mkdir(staged);
  try {
    const build = JSON.parse(await readFile(path.join(packageRoot, "dist/build-info.json"), "utf8")) as BuildInfo;
    await createPortableTree(staged, build);
    await verifyPortableTree(staged);
    if (await inspectDestination(destination) !== initialState) throw new Error("目标目录状态在安装期间发生变化");
    if (initialState === "empty") {
      await rmdir(destination);
      try {
        await rename(staged, destination);
      } catch (error) {
        await restoreEmptyDirectory(destination);
        throw error;
      }
    } else {
      await rename(staged, destination);
    }
    return build;
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
    process.stdout.write(usage);
    return;
  }
  const input = args[0];
  if (args.length !== 1 || input === undefined || input.startsWith("-")) throw new Error(usage.trimEnd());
  const destination = resolveDestination(input, process.cwd());
  const build = await install(destination);
  process.stdout.write(`Cautest ${build.version} (commit ${build.commit}${build.dirty ? ", dirty" : ""}) 已安装到: ${destination}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
