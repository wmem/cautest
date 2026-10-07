import { createHash } from "node:crypto";
import { cp, chmod, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
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
const distRoot = path.join(packageRoot, "dist");
const declarationReference = /(?:\bfrom\s+|\bimport\s*\(\s*)["'](\.[^"']+)["']/gu;

async function collectPublicDeclarations(): Promise<ReadonlySet<string>> {
  const declarations = new Set<string>();
  async function visit(relative: string): Promise<void> {
    const normalized = relative.split(path.sep).join("/");
    if (declarations.has(normalized)) return;
    declarations.add(normalized);
    const location = path.join(distRoot, normalized);
    const contents = await readFile(location, "utf8");
    for (const match of contents.matchAll(declarationReference)) {
      const specifier = match[1];
      if (specifier === undefined) continue;
      const resolved = path.resolve(path.dirname(location), specifier.endsWith(".js") ? `${specifier.slice(0, -3)}.d.ts` : specifier);
      const dependency = path.relative(distRoot, resolved);
      if (dependency === ".." || dependency.startsWith(`..${path.sep}`) || path.isAbsolute(dependency)) {
        throw new Error(`公共声明引用 dist 之外的文件: ${specifier}`);
      }
      await visit(dependency);
    }
  }
  await visit("config/index.d.ts");
  return declarations;
}

function portableLibraryFilter(publicDeclarations: ReadonlySet<string>): (source: string) => boolean {
  return (source) => {
    const name = path.basename(source);
    if (!name.includes(".")) return true;
    if (name.endsWith(".js")) return true;
    if (!name.endsWith(".d.ts")) return false;
    return publicDeclarations.has(path.relative(distRoot, source).split(path.sep).join("/"));
  };
}

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
  const publicDeclarations = await collectPublicDeclarations();
  const libraryFilter = portableLibraryFilter(publicDeclarations);
  await mkdir(path.join(root, "lib"), { recursive: true });
  for (const directory of ["adapters", "artifacts", "build", "cache", "config", "doctor", "integration", "jobs", "kernel", "model", "pattern", "protocol", "reporters", "result", "steps", "system", "uml", "workflow"]) {
    await cp(path.join(packageRoot, `dist/${directory}`), path.join(root, `lib/${directory}`), { recursive: true, filter: libraryFilter });
  }
  await mkdir(path.join(root, "lib/runtime"));
  for (const file of ["cli.js", "direct-session.js", "environment.js", "interrupt.js", "main.js", "owned-process.js", "process.js", "repository-loader.js"]) {
    await cp(path.join(packageRoot, `dist/runtime/${file}`), path.join(root, `lib/runtime/${file}`));
  }
  await cp(path.join(packageRoot, "dist/runtime/entry.js"), path.join(root, "cautest.js"));
  await cp(path.join(packageRoot, "dist/runtime/loader.js"), path.join(root, "loader.mjs"));
  const installedGuide = path.join(packageRoot, "docs/usage/installed.md");
  const installedTemplate = await readFile(installedGuide, "utf8");
  const installedReadme = installedTemplate.replace("[使用指南](index.md)", "[使用指南](docs/usage/index.md)");
  if (installedReadme === installedTemplate) throw new Error("安装说明缺少使用指南链接");
  await writeFile(path.join(root, "README.md"), installedReadme);
  await cp(path.join(packageRoot, "LICENSE"), path.join(root, "LICENSE"));
  await cp(path.join(packageRoot, "xmake.lua"), path.join(root, "xmake.lua"));
  await cp(path.join(packageRoot, "adapters"), path.join(root, "adapters"), {recursive: true});
  await cp(path.join(packageRoot, "versions.json"), path.join(root, "versions.json"));
  await mkdir(path.join(root, "docs"));
  await cp(path.join(packageRoot, "docs/usage"), path.join(root, "docs/usage"), {
    recursive: true,
    filter: (source) => source !== installedGuide,
  });
  await cp(path.join(packageRoot, "examples"), path.join(root, "examples"), {
    recursive: true,
    // 示例运行后的固件、测试结果及 Python 缓存不属于分发内容。
    filter: (source) => ![".cautest", "__pycache__"].includes(path.basename(source)),
  });
  await mkdir(path.join(root, "assets"));
  await cp(path.join(packageRoot, "assets/cautest-c"), path.join(root, "assets/cautest-c"), { recursive: true });
  await cp(path.join(packageRoot, "assets/kernel-config"), path.join(root, "assets/kernel-config"), { recursive: true });
  await chmod(path.join(root, "cautest.js"), 0o755);
  await writeFile(path.join(root, "package.json"), `${JSON.stringify({
    name: "cautest-portable",
    version: build.version,
    private: true,
    license: "MIT",
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
