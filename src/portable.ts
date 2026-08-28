import { createHash } from "node:crypto";
import { cp, chmod, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { CAUTEST_VERSIONS } from "./config/versions.js";

export interface BuildInfo {
  readonly schemaVersion: number;
  readonly version: string;
  readonly commit: string;
  readonly dirty: boolean;
  readonly versions: typeof CAUTEST_VERSIONS;
}

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const picomatchRoot = path.dirname(require.resolve("picomatch/package.json"));

export async function readBuildInfo(): Promise<BuildInfo> {
  const value: unknown = JSON.parse(await readFile(path.join(packageRoot, "dist/build-info.json"), "utf8"));
  if (
    typeof value !== "object"
    || value === null
    || !("schemaVersion" in value)
    || !("version" in value)
    || !("commit" in value)
    || !("dirty" in value)
    || !("versions" in value)
    || typeof value.schemaVersion !== "number"
    || typeof value.version !== "string"
    || typeof value.commit !== "string"
    || typeof value.dirty !== "boolean"
    || JSON.stringify(value.versions) !== JSON.stringify(CAUTEST_VERSIONS)
    || value.schemaVersion !== CAUTEST_VERSIONS.schemas.buildInfo
    || value.version !== CAUTEST_VERSIONS.release
  ) {
    throw new Error("dist/build-info.json 无效，请先执行 build-info");
  }
  return value as BuildInfo;
}

export async function collectPortableFiles(root: string, relative = ""): Promise<string[]> {
  const files: string[] = [];
  for (const name of (await readdir(path.join(root, relative), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const child = path.join(relative, name.name);
    if (name.isDirectory()) files.push(...await collectPortableFiles(root, child));
    else if (name.isFile()) files.push(child.split(path.sep).join("/"));
    else throw new Error(`便携目录拒绝非普通文件: ${child}`);
  }
  return files;
}

export async function createPortableTree(root: string, build: BuildInfo): Promise<void> {
  await mkdir(path.join(root, "lib"), { recursive: true });
  for (const directory of ["cache", "config", "doctor", "integration", "jobs", "kernel", "model", "protocol", "reporters", "result", "steps", "system", "uml", "workflow"]) {
    await cp(path.join(packageRoot, `dist/${directory}`), path.join(root, `lib/${directory}`), { recursive: true });
  }
  await mkdir(path.join(root, "lib/runtime"));
  for (const file of ["cli.js", "cli.js.map", "cli.d.ts", "cli.d.ts.map", "direct-session.js", "direct-session.js.map", "direct-session.d.ts", "direct-session.d.ts.map", "environment.js", "environment.js.map", "environment.d.ts", "environment.d.ts.map", "interrupt.js", "interrupt.js.map", "interrupt.d.ts", "interrupt.d.ts.map", "process.js", "process.js.map", "process.d.ts", "process.d.ts.map"]) {
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
  await cp(path.join(packageRoot, "versions.json"), path.join(root, "versions.json"));
  await cp(path.join(packageRoot, "docs"), path.join(root, "docs"), { recursive: true });
  await cp(path.join(packageRoot, "usage"), path.join(root, "usage"), { recursive: true });
  await cp(path.join(packageRoot, "examples"), path.join(root, "examples"), { recursive: true });
  await mkdir(path.join(root, "assets"));
  await cp(path.join(packageRoot, "assets/cautest-c"), path.join(root, "assets/cautest-c"), { recursive: true });
  await cp(path.join(packageRoot, "assets/kernel-config"), path.join(root, "assets/kernel-config"), { recursive: true });
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
  for (const relative of await collectPortableFiles(root)) {
    const bytes = await readFile(path.join(root, relative));
    entries.push({ path: relative, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
  }
  await writeFile(path.join(root, "manifest.json"), `${JSON.stringify({
    schemaVersion: CAUTEST_VERSIONS.schemas.portableManifest,
    product: "cautest-portable",
    version: build.version,
    build: { commit: build.commit, dirty: build.dirty },
    entries,
  }, null, 2)}\n`);
}

export async function verifyPortableTree(root: string): Promise<void> {
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
  const actual = await collectPortableFiles(root);
  if (actual.length !== expected.size || actual.some((item) => !expected.has(item))) {
    throw new Error("便携目录文件集合与 Manifest 不一致");
  }
}
