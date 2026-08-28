import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { EnvironmentVariables, KernelModuleInput } from "../config/schema/index.js";
import { expandFilePatterns } from "../config/file-pattern.js";
import { CautestError } from "../model/error.js";
import { runCommand } from "../runtime/process.js";

export interface KernelModuleArtifact {
  readonly name: string;
  readonly cacheKey: string;
  readonly cacheHit: boolean;
  readonly module: string;
  readonly symbols: string;
  readonly modulesOrder: string;
  /** Kbuild 产生并由 Cache Manifest 校验的 GCOV Notes。 */
  readonly coverageNotes: readonly string[];
  readonly coverageSources: readonly { readonly path: string; readonly originalPath: string }[];
}

export interface IsolatedKernelModuleBuildInput {
  readonly module: KernelModuleInput;
  readonly kernelOutput: string;
  readonly configDir: string;
  readonly cacheDir: string;
  readonly workDir: string;
  readonly arch?: string;
  readonly crossCompile?: string;
  readonly env?: EnvironmentVariables;
  readonly dependencySymbols?: readonly string[];
  readonly fingerprintEnv?: readonly string[];
  readonly signal: AbortSignal;
  readonly output?: (channel: "stdout" | "stderr", text: string) => void;
}

interface FileRecord { readonly identity: string; readonly path: string }
interface OutputRecord { readonly name: "module" | "symbols" | "modulesOrder" | "coverage" | "coverageSource"; readonly path: string; readonly size: number; readonly sha256: string; readonly originalPath?: string }

function within(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

async function filesUnder(root: string, identityRoot: string, output: FileRecord[]): Promise<void> {
  for (const entry of (await readdir(root, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.name === ".git" || entry.name === ".cautest") continue;
    const location = path.join(root, entry.name);
    if (entry.isSymbolicLink()) throw new CautestError(`Kernel Module Sandbox 不接受符号链接: ${location}`, { code: "config_error" });
    if (entry.isDirectory()) await filesUnder(location, identityRoot, output);
    else if (entry.isFile()) output.push({ identity: path.relative(identityRoot, location).split(path.sep).join("/"), path: location });
  }
}

async function copySandbox(source: string, destination: string): Promise<void> {
  await mkdir(destination, { recursive: true });
  for (const entry of (await readdir(source, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.name === ".git" || entry.name === ".cautest") continue;
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isSymbolicLink()) throw new CautestError(`Kernel Module Sandbox 不接受符号链接: ${from}`, { code: "config_error" });
    if (entry.isDirectory()) await copySandbox(from, to);
    else if (entry.isFile()) await copyFile(from, to);
  }
}

async function digest(file: string): Promise<string> { return createHash("sha256").update(await readFile(file)).digest("hex"); }

async function outputRecord(root: string, name: OutputRecord["name"], relative: string): Promise<OutputRecord> {
  const location = path.join(root, relative);
  const info = await stat(location);
  if (!info.isFile()) throw new CautestError(`Kernel Module 输出不是文件: ${relative}`, { code: "build_error" });
  return { name, path: relative.split(path.sep).join("/"), size: info.size, sha256: await digest(location) };
}

async function validCache(root: string, key: string): Promise<readonly OutputRecord[] | undefined> {
  try {
    const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8")) as { schema?: number; key?: string; outputs?: OutputRecord[] };
    if (manifest.schema !== 4 || manifest.key !== key || !Array.isArray(manifest.outputs) || manifest.outputs.length < 3) return undefined;
    if (!["module", "symbols", "modulesOrder"].every((name) => manifest.outputs!.some((output) => output.name === name))) return undefined;
    for (const output of manifest.outputs) {
      const current = await outputRecord(root, output.name, output.path);
      if (current.size !== output.size || current.sha256 !== output.sha256) return undefined;
    }
    return manifest.outputs;
  } catch { return undefined; }
}

async function filesWithExtension(root: string, extension: string, relative = ""): Promise<string[]> {
  const output: string[] = [];
  for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) output.push(...await filesWithExtension(root, extension, child));
    else if (entry.isFile() && entry.name.endsWith(extension)) output.push(child);
  }
  return output.sort();
}

function compilerCommand(module: KernelModuleInput, environment: NodeJS.ProcessEnv, crossCompile: string): string {
  const configured = module.makeVariables?.CC;
  if (configured !== undefined) return String(configured);
  return environment.CC ?? `${crossCompile}gcc`;
}

function makeVariableArguments(values: KernelModuleInput["makeVariables"]): string[] {
  return Object.entries(values ?? {}).sort(([left], [right]) => left.localeCompare(right)).map(([name, value]) => {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name)) throw new CautestError(`Make 变量名无效: ${name}`, { code: "config_error" });
    return `${name}=${typeof value === "boolean" ? (value ? "1" : "0") : String(value)}`;
  });
}

/**
 * 在专属 Sandbox 中执行 External Module Kbuild，源码树永远不会作为 `M=` 传入。
 * Cache 发布 Module、Symbol、Order 和可选 GCOV Notes，并逐个校验内容摘要。
 */
export async function buildIsolatedKernelModule(input: IsolatedKernelModuleBuildInput): Promise<KernelModuleArtifact> {
  const module = input.module;
  const configDir = path.resolve(input.configDir);
  const sourceDir = path.resolve(configDir, module.sourceDir);
  const sandboxRoot = path.resolve(configDir, module.sandboxRoot ?? module.sourceDir);
  if (!within(sandboxRoot, sourceDir)) throw new CautestError(`sourceDir 必须位于 sandboxRoot 内: ${module.name}`, { code: "config_error" });
  const outputPath = module.output.split("/").join(path.sep);
  if (path.isAbsolute(outputPath) || outputPath === ".." || outputPath.startsWith(`..${path.sep}`) || !outputPath.endsWith(".ko")) throw new CautestError(`Kernel Module output 无效: ${module.output}`, { code: "config_error" });
  const sourceFiles: FileRecord[] = [];
  await filesUnder(sandboxRoot, sandboxRoot, sourceFiles);
  for (const root of module.inputRoots ?? []) {
    const absolute = path.resolve(configDir, root);
    await filesUnder(absolute, absolute, sourceFiles);
  }
  if ((module.inputs?.length ?? 0) > 0) {
    for (const relative of await expandFilePatterns(module.inputs ?? [], { baseDir: configDir, label: `module.${module.name}.inputs` })) sourceFiles.push({ identity: `input/${relative}`, path: path.join(configDir, relative) });
  }
  const configuredSymbols = (module.extraSymbols?.length ?? 0) === 0 ? [] : await expandFilePatterns(module.extraSymbols ?? [], { baseDir: configDir, label: `module.${module.name}.extraSymbols` });
  const dependencySymbols = [...configuredSymbols.map((file) => path.join(configDir, file)), ...(input.dependencySymbols ?? [])];
  dependencySymbols.forEach((file, index) => sourceFiles.push({ identity: `symbols/${index}-${path.basename(file)}`, path: file }));
  const kernelFiles = [".config", "Module.symvers", "include/config/kernel.release"].map((file) => path.join(input.kernelOutput, file));
  for (const file of kernelFiles) { try { if ((await stat(file)).isFile()) sourceFiles.push({ identity: `kernel/${path.relative(input.kernelOutput, file).split(path.sep).join("/")}`, path: file }); } catch { /* 可选 Kernel 标识文件 */ } }
  if (!sourceFiles.some((file) => file.identity.startsWith("kernel/"))) throw new CautestError("Kernel Output 缺少 .config/Module.symvers/kernel.release 身份文件", { code: "build_error" });

  const environment = { ...process.env, ...input.env };
  const make = module.make ?? "make";
  const crossCompile = input.crossCompile ?? environment.CROSS_COMPILE ?? "";
  const compiler = compilerCommand(module, environment, crossCompile);
  const [makeVersion, compilerVersion, compilerTarget] = await Promise.all([
    runCommand({ program: make, args: ["--version"], cwd: configDir, env: environment, signal: input.signal }),
    runCommand({ program: compiler, args: ["--version"], cwd: configDir, env: environment, signal: input.signal }),
    runCommand({ program: compiler, args: ["-dumpmachine"], cwd: configDir, env: environment, signal: input.signal }),
  ]);
  if (makeVersion.exitCode !== 0 || compilerVersion.exitCode !== 0) throw new CautestError("无法识别 Kbuild Make/Compiler", { code: "tooling_error" });
  const environmentKeys = new Set(["ARCH", "CROSS_COMPILE", "CC", "HOSTCC", "LD", "AR", "NM", "OBJCOPY", "OBJDUMP", "READELF", "STRIP", "LLVM", "LLVM_IAS", "KCFLAGS", "KCPPFLAGS", "KAFLAGS", ...(input.fingerprintEnv ?? []), ...(module.cache?.fingerprintEnv ?? [])]);
  const metadata = {
    schema: 2, name: module.name, output: module.output, sourceDir: path.relative(sandboxRoot, sourceDir).split(path.sep).join("/"),
    arch: input.arch ?? environment.ARCH ?? "", crossCompile, make: makeVersion.stdout.trim(), compiler: compilerVersion.stdout.trim(), compilerTarget: compilerTarget.stdout.trim(),
    makeVariables: module.makeVariables ?? {}, makeArgs: module.makeArgs ?? [], environment: Object.fromEntries([...environmentKeys].sort().map((key) => [key, environment[key] ?? null])),
  };
  const hash = createHash("sha256").update(JSON.stringify(metadata));
  for (const file of sourceFiles.sort((left, right) => left.identity.localeCompare(right.identity))) { hash.update(`\0${file.identity}\0`); hash.update(await readFile(file.path)); }
  const key = hash.digest("hex");
  const cacheEnabled = module.cache?.enabled !== false;
  const cacheRoot = path.resolve(configDir, cacheEnabled ? (module.cache?.directory ?? input.cacheDir) : input.workDir);
  await mkdir(cacheRoot, { recursive: true });
  await mkdir(path.resolve(input.workDir), { recursive: true });
  const cachePath = path.join(cacheRoot, key);
  let outputs = cacheEnabled ? await validCache(cachePath, key) : undefined;
  const cacheHit = outputs !== undefined;
  if (outputs === undefined) {
    await rm(cachePath, { recursive: true, force: true });
    const buildRoot = await mkdtemp(path.join(path.resolve(input.workDir), `.${module.name}-build-`));
    const publish = await mkdtemp(path.join(cacheRoot, `.${key.slice(0, 12)}-`));
    try {
      const sandbox = path.join(buildRoot, "sandbox");
      await copySandbox(sandboxRoot, sandbox);
      const sandboxModule = path.join(sandbox, path.relative(sandboxRoot, sourceDir));
      const symbolDir = path.join(buildRoot, "symbols");
      await mkdir(symbolDir);
      const sandboxSymbols: string[] = [];
      for (const [index, symbol] of dependencySymbols.entries()) { const target = path.join(symbolDir, `${index}-${path.basename(symbol)}`); await copyFile(symbol, target); sandboxSymbols.push(target); }
      const args = ["-C", path.resolve(input.kernelOutput), `M=${sandboxModule}`, `-j${module.jobs ?? 4}`, ...(input.arch === undefined ? [] : [`ARCH=${input.arch}`]), ...(crossCompile.length === 0 ? [] : [`CROSS_COMPILE=${crossCompile}`]), ...makeVariableArguments(module.makeVariables), ...(sandboxSymbols.length === 0 ? [] : [`KBUILD_EXTRA_SYMBOLS=${sandboxSymbols.join(" ")}`]), ...(module.makeArgs ?? []), "modules"];
      const result = await runCommand({ program: make, args, cwd: buildRoot, env: environment, signal: input.signal, ...(input.output === undefined ? {} : { onOutput: input.output }) });
      if (result.exitCode !== 0) throw new CautestError(`Kernel Module 构建失败 (exit ${result.exitCode})\n${result.stderr}`, { code: "build_error" });
      const moduleSource = path.join(sandboxModule, outputPath);
      await copyFile(moduleSource, path.join(publish, path.basename(outputPath)));
      await copyFile(path.join(sandboxModule, "Module.symvers"), path.join(publish, "Module.symvers"));
      await copyFile(path.join(sandboxModule, "modules.order"), path.join(publish, "modules.order"));
      const notes = await filesWithExtension(sandboxModule, ".gcno");
      const noteStems = new Set(notes.map((note) => path.basename(note, ".gcno")));
      const coverageSources = notes.length === 0 ? [] : (await filesWithExtension(sandboxModule, ".c")).filter((source) => noteStems.has(path.basename(source, ".c")));
      for (const note of notes) { const target = path.join(publish, "coverage", note); await mkdir(path.dirname(target), { recursive: true }); await copyFile(path.join(sandboxModule, note), target); }
      for (const source of coverageSources) { const target = path.join(publish, "coverage-sources", source); await mkdir(path.dirname(target), { recursive: true }); await copyFile(path.join(sandboxModule, source), target); }
      outputs = Object.freeze([
        await outputRecord(publish, "module", path.basename(outputPath)),
        await outputRecord(publish, "symbols", "Module.symvers"),
        await outputRecord(publish, "modulesOrder", "modules.order"),
        ...await Promise.all(notes.map((note) => outputRecord(publish, "coverage", path.join("coverage", note)))),
        ...await Promise.all(coverageSources.map(async (source) => ({ ...await outputRecord(publish, "coverageSource", path.join("coverage-sources", source)), originalPath: path.join(sandboxModule, source) }))),
      ]);
      await writeFile(path.join(publish, "manifest.json"), `${JSON.stringify({ schema: 4, key, outputs }, null, 2)}\n`);
      try { await rename(publish, cachePath); }
      catch (cause) { const existing = await validCache(cachePath, key); if (existing === undefined) throw cause; outputs = existing; await rm(publish, { recursive: true, force: true }); }
    } finally {
      await rm(buildRoot, { recursive: true, force: true });
      await rm(publish, { recursive: true, force: true });
    }
  }
  const byName = new Map(outputs.filter((output) => !["coverage", "coverageSource"].includes(output.name)).map((output) => [output.name, output.path]));
  return Object.freeze({ name: module.name, cacheKey: key, cacheHit, module: path.join(cachePath, byName.get("module") ?? ""), symbols: path.join(cachePath, byName.get("symbols") ?? ""), modulesOrder: path.join(cachePath, byName.get("modulesOrder") ?? ""), coverageNotes: Object.freeze(outputs.filter((output) => output.name === "coverage").map((output) => path.join(cachePath, output.path))), coverageSources: Object.freeze(outputs.filter((output) => output.name === "coverageSource" && output.originalPath !== undefined).map((output) => Object.freeze({ path: path.join(cachePath, output.path), originalPath: output.originalPath! }))) });
}
