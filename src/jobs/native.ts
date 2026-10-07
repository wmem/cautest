import {withBuildLock} from "../cache/build-lock.js";
import {hashBytes, stableSerialize} from "../cache/fingerprint.js";
import {buildIdentity, writeChanged} from "../cache/file-state.js";
import {compileC} from "../build/incremental.js";
import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CDefineValue, NativeCTestJobFactoryInput, NativeCTestJobInput, TestJob, StepExecutionContext, WorkflowStep, CTestRunInput } from "../config/schema/index.js";
import { CAUTEST_CACHE_VERSIONS } from "../config/versions.js";
import { expandFilePatterns } from "../config/file-pattern.js";
import { testJob } from "../config/define.js";
import { CautestError } from "../model/error.js";
import { runNativeSession } from "../protocol/native-session.js";
import { effectiveWorkflowCTestRun, workflowSessionEventSink, workflowSessionResult } from "../protocol/workflow-session.js";
import { declaredEnvironment, effectiveEnvironment } from "../runtime/environment.js";
import { runCommand } from "../runtime/process.js";
import { defineStep } from "../workflow/step.js";
import { coverageFiles, nativeCoverageStep, validateNativeCoverage } from "./native-coverage.js";

const kitRoot = fileURLToPath(new URL("../../assets/cautest-c", import.meta.url));
const nativeCaseTimeoutGraceMs = 250;
const kitSources = ["core/cautest.c", "protocol/ctp3.c", "platform/posix/cautest_posix_platform.c", "target/posix/cautest_posix_target.c"];
const kitInputs = [...kitSources, "include/cautest/version.h", "include/cautest/cautest.h", "include/cautest/ctp3.h", "platform/posix/posix_platform.h", "target/posix/posix_target.h", "templates/native-entry.c.tmpl", "templates/native-registry.c.tmpl"];
const inputFields = new Set(["id", "level", "description", "tags", "enabled", "timeoutMs", "env", "policy", "tests", "sources", "headers", "suites", "artifactName", "build", "run", "coverage"]);
const buildFields = new Set(["compiler", "linker", "includeDirs", "defines", "cflags", "ldflags", "workspaceSize", "generatedDir", "timeoutMs", "cache"]);
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

function fingerprint(files: readonly string[], metadata: unknown, configDir: string): string {
  // 缓存目录只区分构建参数与输入路径，源码依赖交给 Make/depfile。
  return hashBytes(stableSerialize({metadata, files: files.map(file => path.relative(configDir, file)).sort()}));
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

/** Runtime shared by the legacy compiler helper and artifact-driven providers. */
export interface NativeRuntimeArtifact { readonly path: string; readonly buildId: string; readonly coverage?: boolean }
export function nativeRuntimeStep(options: {
  readonly name: string;
  readonly run?: CTestRunInput;
  readonly allowEmpty?: boolean;
  readonly coveragePrefixStrip?: number;
  readonly artifact: (context: StepExecutionContext) => NativeRuntimeArtifact | undefined;
}): WorkflowStep {
  const artifactName = options.name;
  const run = options.run ?? {};
  return defineStep({
    kind: "cTestRun", name: artifactName, phase: "run", ...(run.stepTimeoutMs === undefined ? {} : { timeoutMs: run.stepTimeoutMs }),
    details: { transport: "process", artifactName, selection: run },
    async execute(context) {
      const effectiveRun = effectiveWorkflowCTestRun(context, run, artifactName);
      const artifact = options.artifact(context);
      if (artifact === undefined) throw new CautestError(`Native Artifact 不存在: ${artifactName}`, { code: "build_error" });
      const coverageRaw = path.join(context.project.resultDir, "coverage", artifactName, "raw");
      if (artifact.coverage) await mkdir(coverageRaw, { recursive: true });
      const logDir = path.join(context.project.resultDir, context.job.id);
      const stdoutFile = path.join(logDir, `${artifactName}.stdout.log`);
      const stderrFile = path.join(logDir, `${artifactName}.stderr.log`);
      const targetFile = path.join(logDir, `${artifactName}.target.log`);
      const targetLogs: string[] = [];
      await mkdir(logDir, { recursive: true });
      const hostRun = effectiveRun.caseTimeoutMs === undefined ? effectiveRun : Object.freeze({
        ...effectiveRun,
        // Native Target 自己按配置终止隔离 Case；Host 只需为 FAULT/END 事件留出传输宽限。
        caseTimeoutMs: Math.min(Number.MAX_SAFE_INTEGER, effectiveRun.caseTimeoutMs + nativeCaseTimeoutGraceMs),
      });
      const session = await runNativeSession({
        program: artifact.path,
        cwd: context.project.configDir,
        env: { ...effectiveEnvironment(context), ...(artifact.coverage ? { GCOV_PREFIX: coverageRaw, GCOV_PREFIX_STRIP: String(options.coveragePrefixStrip ?? 0) } : {}) },
        expectedBuildId: artifact.buildId,
        run: hostRun,
        signal: context.signal,
        onEvent: workflowSessionEventSink(context.events, context.job.id),
        onLog(log) { targetLogs.push(`[${log.level}] ${log.scope}: ${log.message}`); return `${targetFile}:${targetLogs.length}`; },
        async onComplete(output) { await Promise.all([writeFile(stdoutFile, output.stdout), writeFile(stderrFile, output.stderr), writeFile(targetFile, `${targetLogs.join("\n")}${targetLogs.length === 0 ? "" : "\n"}`)]); },
      });
      context.artifacts.publish({ kind: "log", name: `${artifactName}-stdout`, path: stdoutFile });
      context.artifacts.publish({ kind: "log", name: `${artifactName}-stderr`, path: stderrFile });
      context.artifacts.publish({ kind: "log", name: `${artifactName}-target`, path: targetFile });
      return workflowSessionResult(session, { label: "Native C Test", allowEmpty: options.allowEmpty === true });
    },
  });
}

/** 把一个完整 Native C Test 声明展开为 build → run → collect Workflow。 */
export function nativeCTestJob(input: NativeCTestJobInput): TestJob {
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw new CautestError("nativeCTestJob() 参数必须是对象", { code: "config_error" });
  const unknown = Object.keys(input).filter((key) => !inputFields.has(key));
  if (unknown.length > 0) throw new CautestError(`Native C Test 包含未知字段: ${unknown.join(", ")}`, { code: "config_error" });
  rejectNested(input.build, buildFields, "Native build");
  if (input.build?.linker !== undefined && (typeof input.build.linker !== "string" || input.build.linker.trim().length === 0)) throw new CautestError("Native build.linker 必须是非空命令", { code: "config_error" });
  rejectNested(input.run, runFields, "Native run");
  rejectNested(input.coverage, coverageFields, "Native coverage");
  if (input.coverage !== undefined) validateNativeCoverage(input.coverage);
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
    details: { tests, sources, headers, compiler: build.compiler ?? "cc", ...(build.linker ? {linker: build.linker} : {}), artifactName },
    async execute(context) {
      const effectiveRun = effectiveWorkflowCTestRun(context, run, artifactName);
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
      const linker = build.linker ?? compiler;
      const environment = effectiveEnvironment(context);
      const [version, target] = await Promise.all([
        runCommand({ program: compiler, args: ["--version"], cwd: project, env: environment, signal: context.signal }),
        runCommand({ program: compiler, args: ["-dumpmachine"], cwd: project, env: environment, signal: context.signal }),
      ]);
      if (version.exitCode !== 0 || version.stdout.trim().length === 0) throw new CautestError(`无法识别 Compiler: ${compiler}`, { code: "tooling_error" });
      const linkerVersion = linker === compiler ? version : await runCommand({ program: linker, args: ["--version"], cwd: project, env: environment, signal: context.signal });
      if (linkerVersion.exitCode !== 0 || linkerVersion.stdout.trim().length === 0) throw new CautestError(`无法识别 Linker: ${linker}`, { code: "tooling_error" });
      const metadata = {
        schema: CAUTEST_CACHE_VERSIONS.nativeFingerprint, compiler: version.stdout.trim(), target: target.stdout.trim(), suites, includeDirs: build.includeDirs ?? [],
        linker, linkerVersion: linkerVersion.stdout.trim(),
        defines: build.defines ?? {}, cflags: build.cflags ?? [], ldflags: build.ldflags ?? [], coverage: input.coverage !== undefined,
        workspaceSize: build.workspaceSize ?? 65_536, caseTimeoutMs: effectiveRun.caseTimeoutMs ?? 1_000,
        environment: declaredEnvironment(context),
        fingerprintEnv: Object.fromEntries((build.cache?.fingerprintEnv ?? []).map((key) => [key, environment[key] ?? null])),
      };
      const key = fingerprint([...productFiles, ...kitInputs.map((file) => path.join(kitRoot, file))], metadata, project);
      const generatedDir = path.resolve(project, build.generatedDir ?? path.join(context.project.generatedDir, "native", artifactName, key));
      await mkdir(generatedDir, { recursive: true });
      const registry = path.join(generatedDir, "registry.c");
      const entry = path.join(generatedDir, "entry.c");
      const cacheEnabled = build.cache?.enabled !== false;
      validateConfiguredCacheRoot(project, build.cache?.directory);
      const cacheRoot = path.resolve(project, cacheEnabled ? (build.cache?.directory ?? path.join(context.project.cacheDir, "native")) : path.join(context.project.workDir, "native"));
      await mkdir(cacheRoot, { recursive: true });
      const cacheDir = path.join(cacheRoot, key);
      if (path.dirname(cacheDir) !== cacheRoot || path.basename(cacheDir) !== key) throw new CautestError("Native Cache 路径无效", { code: "cache_error" });
      const targetPath = path.join(cacheDir, "target");
      const buildTarget = async () => {
        if (!cacheEnabled) await rm(cacheDir, {recursive: true, force: true});
        const buildId = await buildIdentity(cacheDir);
        await writeChanged(registry, registrySource(suites));
        await writeChanged(entry, entrySource(buildId, build.workspaceSize ?? 65_536, effectiveRun.caseTimeoutMs ?? 1_000));
        const flags = ["-std=c99", "-Wall", "-Wextra", `-I${path.join(kitRoot, "include")}`, `-I${path.join(kitRoot, "platform/posix")}`, `-I${path.join(kitRoot, "target/posix")}`, ...includeDirs.map(directory => `-I${directory}`), ...Object.entries(build.defines ?? {}).map(([name, value]) => defineArgument(name, value)), ...(input.coverage === undefined ? [] : ["--coverage", "-DCAUTEST_GCOV=1"]), ...(build.cflags ?? [])];
        const hit = await compileC({compiler, ...(build.linker ? {linker: build.linker} : {}), sources: [...expandedTests, ...expandedSources].map(file => path.join(project, file)).concat([registry, entry], kitSources.map(file => path.join(kitRoot, file))),
          directory: cacheDir, output: targetPath, cflags: flags, ldflags: build.ldflags ?? [], dependencies: expandedHeaders.map(file => path.join(project, file)),
          env: environment, signal: context.signal, onOutput: context.output, rebuild: !cacheEnabled});
        await chmod(targetPath, 0o755);
        const artifact = Object.freeze({ path: targetPath, buildId, objectDir: cacheDir, sources: [...expandedTests, ...expandedSources], coverage: input.coverage !== undefined, cacheHit: hit }) satisfies NativeArtifact;
        context.state.set(`native:${artifactName}`, artifact);
        context.artifacts.publish({ kind: "native-test", name: artifactName, path: targetPath, buildId, metadata: { cacheHit: hit, objectDir: cacheDir, sources: artifact.sources, coverage: artifact.coverage } });
        return { diagnostics: [{ code: hit ? "cache_hit" : (cacheEnabled ? "cache_miss" : "cache_disabled"), message: targetPath }] };
      };
      return process.platform === "linux" ? await withBuildLock(cacheDir, context.signal, buildTarget) : await buildTarget();
    },
  });
  const execute = nativeRuntimeStep({ name: artifactName, run, allowEmpty: input.policy?.allowEmpty === true, coveragePrefixStrip: 100,
    artifact: (context) => context.state.get(`native:${artifactName}`) as NativeArtifact | undefined });
  const coverage = input.coverage === undefined ? [] : [nativeCoverageStep({
    name: artifactName, coverage: input.coverage, rawLayout: "flat",
    async notes(context) {
      const artifact = context.state.get(`native:${artifactName}`) as NativeArtifact | undefined;
      if (artifact === undefined) return undefined;
      return (await coverageFiles(artifact.objectDir, ".gcno")).map(file => ({ path: file }));
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
