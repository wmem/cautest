import { createHash } from "node:crypto";
import { chmod, copyFile, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CDefineValue, NativeCTestJobFactoryInput, NativeCTestJobInput, TestJob } from "../config/schema/index.js";
import { expandFilePatterns } from "../config/file-pattern.js";
import { testJob } from "../config/define.js";
import { CautestError } from "../model/error.js";
import { runNativeSession } from "../protocol/native-session.js";
import { runCommand } from "../runtime/process.js";
import { defineStep } from "../workflow/step.js";

const kitRoot = fileURLToPath(new URL("../../assets/cautest-c", import.meta.url));
const kitSources = ["core/cautest.c", "protocol/ctp3.c", "platform/posix/cautest_posix_platform.c", "target/posix/cautest_posix_target.c"];
const kitInputs = [...kitSources, "include/cautest/cautest.h", "include/cautest/ctp3.h", "platform/posix/posix_platform.h", "target/posix/posix_target.h", "templates/native-entry.c.tmpl", "templates/native-registry.c.tmpl"];
const inputFields = new Set(["id", "level", "description", "tags", "enabled", "timeoutMs", "env", "policy", "tests", "sources", "headers", "suites", "artifactName", "build", "run", "coverage"]);
const buildFields = new Set(["compiler", "includeDirs", "defines", "cflags", "ldflags", "workspaceSize", "generatedDir", "timeoutMs", "cache"]);
const runFields = new Set(["include", "exclude", "suite", "case", "parameter", "caseTimeoutMs", "runTimeoutMs", "session", "suitePolicy", "expectedBuildId", "stepTimeoutMs"]);
const coverageFields = new Set(["tool", "timeoutMs"]);

interface NativeArtifact { readonly path: string; readonly buildId: string; readonly objectDir: string; readonly sources: readonly string[]; readonly coverage: boolean; readonly cacheHit: boolean }

function strings(value: unknown, label: string, required = false): readonly string[] {
  if (value === undefined) { if (required) throw new CautestError(`${label} 必填`, { code: "config_error" }); return []; }
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== "string" || item.length === 0)) throw new CautestError(`${label} 必须是非空字符串数组`, { code: "config_error" });
  return Object.freeze([...value]);
}

function rejectNested(value: unknown, fields: ReadonlySet<string>, label: string): void {
  if (value === undefined) return;
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new CautestError(`${label} 必须是对象`, { code: "config_error" });
  const unknown = Object.keys(value).filter((key) => !fields.has(key));
  if (unknown.length > 0) throw new CautestError(`${label} 包含未知字段: ${unknown.join(", ")}`, { code: "config_error" });
}

function safeName(value: string): string {
  const result = value.replace(/[^A-Za-z0-9_-]+/gu, "-").replace(/^-+|-+$/gu, "");
  if (result.length === 0) throw new CautestError(`无法从 ${value} 生成 Artifact 名称`, { code: "config_error" });
  return result;
}

function suiteName(id: string): string {
  const result = (id.split(".").at(-1) ?? id).replace(/[^A-Za-z0-9_]/gu, "_");
  return /^[A-Za-z_][A-Za-z0-9_]*$/u.test(result) ? result : `suite_${result}`;
}

function defineArgument(name: string, value: CDefineValue): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name)) throw new CautestError(`C Define 名称无效: ${name}`, { code: "config_error" });
  if (value === null) return `-D${name}`;
  return `-D${name}=${typeof value === "boolean" ? (value ? "1" : "0") : String(value)}`;
}

async function sha256(file: string): Promise<string> { return createHash("sha256").update(await readFile(file)).digest("hex"); }

async function fingerprint(files: readonly string[], metadata: unknown, configDir: string): Promise<string> {
  const hash = createHash("sha256").update(JSON.stringify(metadata));
  for (const file of [...files].sort()) {
    const identity = path.relative(configDir, file).split(path.sep).join("/");
    hash.update(`\0${identity}\0`);
    hash.update(await readFile(file));
  }
  return hash.digest("hex");
}

async function cacheValid(directory: string, target: string, key: string): Promise<boolean> {
  try {
    const manifest = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8")) as { schema?: number; key?: string; outputs?: Array<{ path: string; size: number; sha256: string }> };
    if (manifest.schema !== 2 || manifest.key !== key || !Array.isArray(manifest.outputs)) return false;
    const actual = (await readdir(directory)).filter((name) => name !== "manifest.json").sort();
    if (actual.length !== manifest.outputs.length || actual.some((name, index) => name !== manifest.outputs?.[index]?.path)) return false;
    for (const output of manifest.outputs) {
      const info = await stat(path.join(directory, output.path));
      if (!info.isFile() || info.size !== output.size || await sha256(path.join(directory, output.path)) !== output.sha256) return false;
    }
    return await stat(target).then((info) => info.isFile());
  } catch { return false; }
}

async function outputManifest(directory: string): Promise<readonly { path: string; size: number; sha256: string }[]> {
  const outputs = [];
  for (const name of (await readdir(directory)).filter((item) => item !== "manifest.json").sort()) {
    const info = await stat(path.join(directory, name));
    if (!info.isFile()) throw new CautestError(`Native Cache 包含非文件输出: ${name}`, { code: "cache_error" });
    outputs.push({ path: name, size: info.size, sha256: await sha256(path.join(directory, name)) });
  }
  return outputs;
}

async function collectByExtension(root: string, extension: string, output: string[] = []): Promise<string[]> {
  try {
    for (const entry of await readdir(root, { withFileTypes: true })) {
      const location = path.join(root, entry.name);
      if (entry.isDirectory()) await collectByExtension(location, extension, output);
      else if (entry.isFile() && entry.name.endsWith(extension)) output.push(location);
    }
  } catch (error) {
    if (!(typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT")) throw error;
  }
  return output.sort();
}

function registrySource(suites: readonly string[]): string {
  return `#include <cautest/cautest.h>\n\n${suites.map((suite) => `CAUTEST_SUITE_DECLARE(${suite});`).join("\n")}\n\nCAUTEST_REGISTRY(cautest_generated_registry,\n${suites.map((suite) => `    CAUTEST_SUITE_REF(${suite})`).join(",\n")});\n`;
}

function entrySource(buildId: string, workspaceSize: number, caseTimeoutMs: number): string {
  return `#include "posix_target.h"\n\nextern const struct cautest_registry cautest_generated_registry;\n\nint main(void)\n{\n    const struct cautest_posix_target_config config = {\n        "${buildId}",\n        ${workspaceSize}UL,\n        ${caseTimeoutMs}UL\n    };\n    return cautest_posix_target_main(&cautest_generated_registry, &config);\n}\n`;
}

function validateConfiguredCacheRoot(project: string, configured: string | undefined): void {
  if (configured === undefined) return;
  const root = path.resolve(project);
  const target = path.resolve(root, configured);
  const relative = path.relative(root, target);
  if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new CautestError(`Native build.cache.directory 必须是项目内专用子目录: ${configured}`, { code: "cache_error" });
  }
}

/** 把一个完整 Native C Test 声明展开为 build → run → collect Workflow。 */
export function nativeCTestJob(input: NativeCTestJobInput): TestJob {
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw new CautestError("nativeCTestJob() 参数必须是对象", { code: "config_error" });
  const unknown = Object.keys(input).filter((key) => !inputFields.has(key));
  if (unknown.length > 0) throw new CautestError(`Native C Test 包含未知字段: ${unknown.join(", ")}`, { code: "config_error" });
  rejectNested(input.build, buildFields, "Native build");
  rejectNested(input.run, runFields, "Native run");
  rejectNested(input.coverage, coverageFields, "Native coverage");
  const tests = strings(input.tests, "tests", true);
  const sources = strings(input.sources, "sources");
  const headers = strings(input.headers, "headers");
  const suites = input.suites === undefined ? [suiteName(input.id)] : strings(input.suites, "suites", true);
  if (suites.some((suite) => !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(suite))) throw new CautestError("suites 必须是合法 C 标识符", { code: "config_error" });
  const artifactName = safeName(input.artifactName ?? input.id);
  const build = Object.freeze({ ...(input.build ?? {}) });
  const run = Object.freeze({ ...(input.run ?? {}) });
  const compile = defineStep({
    kind: "nativeCompile", name: artifactName, phase: "build", ...(build.timeoutMs === undefined ? {} : { timeoutMs: build.timeoutMs }),
    details: { tests, sources, headers, compiler: build.compiler ?? "cc", artifactName },
    async execute(context) {
      const project = context.project.configDir;
      const expandedTests = await expandFilePatterns(tests, { baseDir: project, label: `jobs.${input.id}.tests` });
      const expandedSources = sources.length === 0 ? [] : await expandFilePatterns(sources, { baseDir: project, label: `jobs.${input.id}.sources` });
      const expandedHeaders = headers.length === 0 ? [] : await expandFilePatterns(headers, { baseDir: project, label: `jobs.${input.id}.headers` });
      const productFiles = [...expandedTests, ...expandedSources, ...expandedHeaders].map((file) => path.join(project, file));
      const includeDirs = [...new Set([
        ...(build.includeDirs ?? []).map((directory) => path.resolve(project, directory)),
        ...expandedHeaders.map((header) => path.dirname(path.join(project, header))),
      ])].sort();
      const compiler = build.compiler ?? "cc";
      const environment = { ...process.env, ...input.env };
      const [version, target] = await Promise.all([
        runCommand({ program: compiler, args: ["--version"], cwd: project, env: environment, signal: context.signal }),
        runCommand({ program: compiler, args: ["-dumpmachine"], cwd: project, env: environment, signal: context.signal }),
      ]);
      if (version.exitCode !== 0 || version.stdout.trim().length === 0) throw new CautestError(`无法识别 Compiler: ${compiler}`, { code: "tooling_error" });
      const metadata = {
        schema: 1, compiler: version.stdout.trim(), target: target.stdout.trim(), suites, includeDirs: build.includeDirs ?? [],
        defines: build.defines ?? {}, cflags: build.cflags ?? [], ldflags: build.ldflags ?? [], coverage: input.coverage !== undefined,
        workspaceSize: build.workspaceSize ?? 65_536, caseTimeoutMs: run.caseTimeoutMs ?? 1_000,
        fingerprintEnv: Object.fromEntries((build.cache?.fingerprintEnv ?? []).map((key) => [key, environment[key] ?? null])),
      };
      const key = await fingerprint([...productFiles, ...kitInputs.map((file) => path.join(kitRoot, file))], metadata, project);
      const generatedDir = path.resolve(project, build.generatedDir ?? path.join(context.project.generatedDir, "native", artifactName, key));
      await mkdir(generatedDir, { recursive: true });
      const registry = path.join(generatedDir, "registry.c");
      const entry = path.join(generatedDir, "entry.c");
      await writeFile(registry, registrySource(suites));
      await writeFile(entry, entrySource(key, build.workspaceSize ?? 65_536, run.caseTimeoutMs ?? 1_000));
      const cacheEnabled = build.cache?.enabled !== false;
      validateConfiguredCacheRoot(project, build.cache?.directory);
      const cacheRoot = path.resolve(project, cacheEnabled ? (build.cache?.directory ?? path.join(context.project.cacheDir, "native")) : path.join(context.project.workDir, "native"));
      await mkdir(cacheRoot, { recursive: true });
      const cacheDir = path.join(cacheRoot, key);
      if (path.dirname(cacheDir) !== cacheRoot || path.basename(cacheDir) !== key) throw new CautestError("Native Cache 路径无效", { code: "cache_error" });
      const targetPath = path.join(cacheDir, "target");
      let hit = cacheEnabled && await cacheValid(cacheDir, targetPath, key);
      if (!hit) {
        if (!await cacheValid(cacheDir, targetPath, key)) await rm(cacheDir, { recursive: true, force: true });
        const temporary = await mkdtemp(path.join(cacheRoot, `.${key.slice(0, 12)}-`));
        try {
          const temporaryTarget = path.join(temporary, "target");
          const args = ["-std=c99", "-Wall", "-Wextra", `-I${path.join(kitRoot, "include")}`, `-I${path.join(kitRoot, "platform/posix")}`, `-I${path.join(kitRoot, "target/posix")}`, ...includeDirs.map((directory) => `-I${directory}`), ...Object.entries(build.defines ?? {}).map(([name, value]) => defineArgument(name, value)), ...(input.coverage === undefined ? [] : ["--coverage", "-DCAUTEST_GCOV=1"]), ...(build.cflags ?? []), ...expandedTests.map((file) => path.join(project, file)), ...expandedSources.map((file) => path.join(project, file)), registry, entry, ...kitSources.map((file) => path.join(kitRoot, file)), ...(build.ldflags ?? []), "-o", temporaryTarget];
          const result = await runCommand({ program: compiler, args, cwd: temporary, env: environment, signal: context.signal, onOutput: context.output });
          if (result.exitCode !== 0) throw new CautestError(`Native 编译失败 (exit ${result.exitCode})\n${result.stderr}`, { code: "build_error" });
          await chmod(temporaryTarget, 0o755);
          await writeFile(path.join(temporary, "manifest.json"), `${JSON.stringify({ schema: 2, key, outputs: await outputManifest(temporary) }, null, 2)}\n`);
          try { await rename(temporary, cacheDir); }
          catch (cause) { if (!await cacheValid(cacheDir, targetPath, key)) throw cause; await rm(temporary, { recursive: true, force: true }); }
        } catch (cause) { await rm(temporary, { recursive: true, force: true }); throw cause; }
        hit = false;
      }
      const artifact = Object.freeze({ path: targetPath, buildId: key, objectDir: cacheDir, sources: [...expandedTests, ...expandedSources], coverage: input.coverage !== undefined, cacheHit: hit }) satisfies NativeArtifact;
      context.state.set(`native:${artifactName}`, artifact);
      context.artifacts.publish({ kind: "native-test", name: artifactName, path: targetPath, fingerprint: key, buildId: key, metadata: { cacheHit: hit, objectDir: cacheDir, sources: artifact.sources, coverage: artifact.coverage } });
      return { diagnostics: [{ code: hit ? "cache_hit" : (cacheEnabled ? "cache_miss" : "cache_disabled"), message: targetPath }] };
    },
  });
  const execute = defineStep({
    kind: "cTestRun", name: artifactName, phase: "run", ...(run.stepTimeoutMs === undefined ? {} : { timeoutMs: run.stepTimeoutMs }),
    details: { transport: "process", artifactName, selection: run },
    async execute(context) {
      const artifact = context.state.get(`native:${artifactName}`) as NativeArtifact | undefined;
      if (artifact === undefined) throw new CautestError(`Native Artifact 不存在: ${artifactName}`, { code: "build_error" });
      const coverageRaw = path.join(context.project.resultDir, "coverage", artifactName, "raw");
      if (artifact.coverage) await mkdir(coverageRaw, { recursive: true });
      const logDir = path.join(context.project.resultDir, context.job.id);
      const stdoutFile = path.join(logDir, `${artifactName}.stdout.log`);
      const stderrFile = path.join(logDir, `${artifactName}.stderr.log`);
      const targetFile = path.join(logDir, `${artifactName}.target.log`);
      const targetLogs: string[] = [];
      await mkdir(logDir, { recursive: true });
      const results = await runNativeSession({
        program: artifact.path,
        cwd: context.project.configDir,
        env: { ...process.env, ...input.env, ...(artifact.coverage ? { GCOV_PREFIX: coverageRaw, GCOV_PREFIX_STRIP: "100" } : {}) },
        expectedBuildId: artifact.buildId,
        run,
        signal: context.signal,
        onLog(log) { targetLogs.push(`[${log.level}] ${log.scope}: ${log.message}`); return `${targetFile}:${targetLogs.length}`; },
        async onComplete(output) { await Promise.all([writeFile(stdoutFile, output.stdout), writeFile(stderrFile, output.stderr), writeFile(targetFile, `${targetLogs.join("\n")}${targetLogs.length === 0 ? "" : "\n"}`)]); },
      });
      context.artifacts.publish({ kind: "log", name: `${artifactName}-stdout`, path: stdoutFile });
      context.artifacts.publish({ kind: "log", name: `${artifactName}-stderr`, path: stderrFile });
      context.artifacts.publish({ kind: "log", name: `${artifactName}-target`, path: targetFile });
      const cases = results.flatMap((suite) => suite.cases);
      if (cases.length === 0 && input.policy?.allowEmpty !== true) throw new CautestError("Native C Test 没有选中任何 Case", { code: "selection_error" });
      return { outcome: cases.some((item) => item.status === "FAIL" || item.status === "ERROR") ? "FAIL" : "SUCCESS", testResults: results, diagnostics: [{ code: "native_session", message: `cases=${cases.length}` }] };
    },
  });
  const coverage = input.coverage === undefined ? [] : [defineStep({
    kind: "nativeCoverage", name: artifactName, phase: "collect", runWhen: "always", ...(input.coverage.timeoutMs === undefined ? {} : { timeoutMs: input.coverage.timeoutMs }),
    details: { tool: input.coverage.tool ?? "gcov", artifactName },
    async execute(context) {
      const artifact = context.state.get(`native:${artifactName}`) as NativeArtifact | undefined;
      if (artifact === undefined) return { diagnostics: [{ code: "coverage_skipped", message: "Native Artifact 不存在" }] };
      const output = path.join(context.project.resultDir, "coverage", artifactName);
      const objects = path.join(output, "objects");
      await rm(objects, { recursive: true, force: true });
      await mkdir(objects, { recursive: true });
      const notes = await collectByExtension(artifact.objectDir, ".gcno");
      const data = await collectByExtension(path.join(output, "raw"), ".gcda");
      for (const file of [...notes, ...data]) await copyFile(file, path.join(objects, path.basename(file)));
      if (notes.length === 0) throw new CautestError("GCOV Cache 缺少 .gcno Artifact", { code: "cache_error" });
      for (const note of notes) {
        const result = await runCommand({ program: input.coverage?.tool ?? "gcov", args: ["-o", objects, path.join(objects, path.basename(note))], cwd: output, env: { ...process.env, ...input.env }, signal: context.signal, onOutput: context.output });
        if (result.exitCode !== 0) throw new CautestError(`GCOV 收集失败 (exit ${result.exitCode})`, { code: "build_error" });
      }
      const reports = await collectByExtension(output, ".gcov");
      context.artifacts.publish({ kind: "coverage", name: artifactName, path: output, metadata: { adapter: "gcov", reports } });
      return { diagnostics: [{ code: "coverage_collected", message: output, reports }] };
    },
  })];
  return testJob({
    id: input.id,
    level: input.level ?? "unit",
    tags: input.tags ?? [input.level ?? "unit"],
    workflow: [compile, execute, ...coverage],
    ...(input.description === undefined ? {} : { description: input.description }),
    ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
    ...(input.env === undefined ? {} : { env: input.env }),
    ...(input.policy === undefined ? {} : { policy: input.policy }),
  });
}

/** 创建带公共 Native 默认项的单 Job 工厂。 */
export function nativeCTestJobFactory(options: NativeCTestJobFactoryInput = {}): (input: NativeCTestJobInput) => TestJob {
  const defaults = options.defaults ?? {};
  return (input) => nativeCTestJob({
    ...defaults, ...input,
    build: { ...defaults.build, ...input.build, defines: { ...defaults.build?.defines, ...input.build?.defines }, includeDirs: [...(defaults.build?.includeDirs ?? []), ...(input.build?.includeDirs ?? [])], cflags: [...(defaults.build?.cflags ?? []), ...(input.build?.cflags ?? [])], ldflags: [...(defaults.build?.ldflags ?? []), ...(input.build?.ldflags ?? [])] },
    run: { ...defaults.run, ...input.run },
  });
}
