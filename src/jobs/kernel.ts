import {withBuildLock} from "../cache/build-lock.js";
import {validBuildOutput, publishBuildOutput} from "../cache/build-output.js";
import { umlRuntimeSteps } from "./uml-runtime.js";
import { createHash } from "node:crypto";
import {fileState, writeChanged, syncFiles} from "../cache/file-state.js";
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { KernelCTestJobFactoryInput, KernelCTestJobInput, KernelModuleDefaultsInput, KernelModuleInput, StepExecutionContext, TestJob, UmlKernelEnvironment, UmlKernelEnvironmentInput } from "../config/schema/index.js";
import { CAUTEST_CACHE_VERSIONS } from "../config/versions.js";
import { expandFilePatterns } from "../config/file-pattern.js";
import { testJob } from "../config/define.js";
import { buildIsolatedKernelModule, type KernelModuleArtifact } from "../kernel/module-build.js";
import { CautestError } from "../model/error.js";
import { effectiveWorkflowCTestRun, workflowSessionResult } from "../protocol/workflow-session.js";
import { declaredEnvironment, effectiveEnvironment } from "../runtime/environment.js";
import { runCommand } from "../runtime/process.js";
import { buildBusyBox, buildGuestProgram, buildRootfs, collectUml, mergeConfigText, runUmlEndpoint, sourceTreeIdentity, startUml, type BusyBoxArtifact, type GuestProgramArtifact, type UmlImageArtifact } from "../uml/runtime.js";
import type { UmlRuntimeResource } from "../uml/control.js";
import { defineStep } from "../workflow/step.js";

const ENVIRONMENT = Symbol.for("@cautest/config/uml-kernel-environment");
const environments = new WeakMap<UmlKernelEnvironment, Readonly<UmlKernelEnvironmentInput>>();
const kitRoot = fileURLToPath(new URL("../../assets/cautest-c", import.meta.url));
const requiredKernelConfig = fileURLToPath(new URL("../../assets/kernel-config/uml-required.config", import.meta.url));
const coverageKernelConfig = fileURLToPath(new URL("../../assets/kernel-config/uml-coverage.config", import.meta.url));

type InternalEnvironment = UmlKernelEnvironment & { readonly [ENVIRONMENT]: true };

function object(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new CautestError(`${label} 必须是对象`, { code: "config_error" });
}

/** @internal */
export function environmentValue(value: UmlKernelEnvironment): Readonly<UmlKernelEnvironmentInput> {
  const result = environments.get(value);
  if (result === undefined) throw new CautestError("environment 必须由 umlKernelEnvironment() 创建", { code: "config_error" });
  return result;
}

/** 创建可跨多个 Kernel/Driver Job 复用的 Kernel、BusyBox 与 Runtime 环境。 */
export function umlKernelEnvironment(input: UmlKernelEnvironmentInput): UmlKernelEnvironment {
  object(input, "umlKernelEnvironment() 参数");
  const unknown = Object.keys(input).filter((key) => !["kernel", "busybox", "moduleDefaults", "runtime", "rootfs", "machine"].includes(key));
  if (unknown.length > 0) throw new CautestError(`UML Environment 包含未知字段: ${unknown.join(", ")}`, { code: "config_error" });
  object(input.kernel, "environment.kernel");
  object(input.busybox, "environment.busybox");
  if (typeof input.kernel.sourceDir !== "string" || input.kernel.sourceDir.length === 0) throw new CautestError("environment.kernel.sourceDir 必填", { code: "config_error" });
  if (typeof input.busybox.sourceDir !== "string" || input.busybox.sourceDir.length === 0) throw new CautestError("environment.busybox.sourceDir 必填", { code: "config_error" });
  const descriptor = Object.freeze({ [ENVIRONMENT]: true }) as InternalEnvironment;
  environments.set(descriptor, Object.freeze({
    kernel: Object.freeze({ ...input.kernel }), busybox: Object.freeze({ ...input.busybox }),
    ...(input.moduleDefaults === undefined ? {} : { moduleDefaults: Object.freeze({ ...input.moduleDefaults }) }),
    ...(input.runtime === undefined ? {} : { runtime: Object.freeze({ ...input.runtime }) }),
    ...(input.rootfs === undefined ? {} : { rootfs: Object.freeze({ ...input.rootfs }) }),
    ...(input.machine === undefined ? {} : { machine: Object.freeze({ ...input.machine }) }),
  }));
  return descriptor;
}

export interface KernelBuildArtifact { readonly path: string; readonly cacheHit: boolean }

function safe(value: string): string { return value.replace(/[^A-Za-z0-9_]/gu, "_"); }
function unique(values: readonly string[]): readonly string[] { return [...new Set(values)]; }
async function extensionFiles(root: string, extension: string): Promise<string[]> { const output: string[] = []; async function visit(directory: string): Promise<void> { let entries; try { entries = await readdir(directory, { withFileTypes: true }); } catch (error) { if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return; throw error; } for (const entry of entries) { const location = path.join(directory, entry.name); if (entry.isDirectory()) await visit(location); else if (entry.isFile() && entry.name.endsWith(extension)) output.push(location); } } await visit(root); return output.sort(); }

function publishKernel(context: StepExecutionContext, name: string, artifact: KernelBuildArtifact, environment: Readonly<UmlKernelEnvironmentInput>): void {
  const buildId = path.basename(artifact.path);
  context.artifacts.publish({ kind: "uml-kernel", name, path: path.join(artifact.path, environment.kernel.target ?? "linux"), fingerprint: buildId, buildId, metadata: { outputDir: artifact.path, cacheHit: artifact.cacheHit, arch: environment.kernel.arch ?? "um" } });
}

function publishModule(context: StepExecutionContext, artifact: KernelModuleArtifact): void {
  context.artifacts.publish({ kind: "kernel-module", name: artifact.name, path: artifact.module, fingerprint: artifact.cacheKey, buildId: artifact.cacheKey, metadata: { cacheHit: artifact.cacheHit, symbols: artifact.symbols, modulesOrder: artifact.modulesOrder, coverageNotes: artifact.coverageNotes, coverageSources: artifact.coverageSources.map((item) => item.path) } });
}

function publishBusyBox(context: StepExecutionContext, name: string, artifact: BusyBoxArtifact): void {
  context.artifacts.publish({ kind: "busybox", name, path: artifact.path, fingerprint: artifact.buildId, buildId: artifact.buildId, metadata: { cacheHit: artifact.cacheHit } });
}

function publishGuestProgram(context: StepExecutionContext, artifact: GuestProgramArtifact): void {
  context.artifacts.publish({ kind: "guest-program", name: artifact.name, path: artifact.path, fingerprint: artifact.buildId, buildId: artifact.buildId, metadata: { cacheHit: artifact.cacheHit, endpoint: artifact.endpoint, installPath: artifact.installPath } });
}

function publishImage(context: StepExecutionContext, name: string, image: UmlImageArtifact): void {
  context.artifacts.publish({ kind: "uml-image", name, path: image.rootfsPath, fingerprint: image.buildId, buildId: image.buildId, metadata: { cacheHit: image.cacheHit, kernelPath: image.kernelPath, rootfsPath: image.rootfsPath, endpoints: [...image.endpoints.entries()].map(([endpoint, value]) => ({ endpoint, ...value })) } });
}

/** @internal */
export async function buildKernel(environment: Readonly<UmlKernelEnvironmentInput>, context: Parameters<Parameters<typeof defineStep>[0]["execute"]>[0], name: string, coverage = false): Promise<KernelBuildArtifact> {
  const input = environment.kernel;
  const source = path.resolve(context.project.configDir, input.sourceDir);
  const fragments = input.configFragments === undefined ? [] : await expandFilePatterns(input.configFragments, { baseDir: context.project.configDir, label: "kernel.configFragments" });
  const make = input.make ?? "make";
  const buildEnvironment = effectiveEnvironment(context, input.env);
  const compiler = buildEnvironment.CC ?? `${input.crossCompile ?? ""}gcc`;
  const [sourceIdentity, makeIdentity, compilerIdentity, compilerTarget, userFragmentContents, requiredContents, coverageContents] = await Promise.all([
    sourceTreeIdentity(source, context),
    runCommand({ program: make, args: ["--version"], cwd: context.project.configDir, env: buildEnvironment, signal: context.signal }),
    runCommand({ program: compiler, args: ["--version"], cwd: context.project.configDir, env: buildEnvironment, signal: context.signal }),
    runCommand({ program: compiler, args: ["-dumpmachine"], cwd: context.project.configDir, env: buildEnvironment, signal: context.signal }),
    Promise.all(fragments.map((item) => readFile(path.join(context.project.configDir, item)))),
    readFile(requiredKernelConfig),
    coverage ? readFile(coverageKernelConfig) : Promise.resolve(Buffer.alloc(0)),
  ]);
  const fragmentContents = [...userFragmentContents, requiredContents, ...(coverage ? [coverageContents] : [])];
  const fingerprintEnvironment = Object.fromEntries((input.cache?.fingerprintEnv ?? []).map((key) => [key, buildEnvironment[key] ?? null]));
  const identity = createHash("sha256").update(JSON.stringify({ schema: CAUTEST_CACHE_VERSIONS.kernelFingerprint, sourceIdentity, makeIdentity: makeIdentity.stdout, compilerIdentity: compilerIdentity.stdout, compilerTarget: compilerTarget.stdout, arch: input.arch ?? "um", crossCompile: input.crossCompile ?? "", configTarget: input.configTarget ?? "x86_64_defconfig", target: input.target ?? "linux", prepareModules: input.prepareModules !== false, makeArgs: input.makeArgs ?? [], environment: declaredEnvironment(context, input.env), fingerprintEnvironment })).digest("hex");
  const kernelRoot = path.resolve(context.project.configDir, input.cache?.enabled === false ? context.project.workDir : (input.cache?.directory ?? context.project.cacheDir));
  const output = path.join(kernelRoot, "kernel", identity);
  const requiredOutputs = [input.target ?? "linux", ".config", "include/config/kernel.release", ...(input.prepareModules === false ? [] : ["Module.symvers"])];
  return await withBuildLock(output, context.signal, async () => {
    const valid = input.cache?.enabled !== false && await validBuildOutput(output, identity, requiredOutputs);
    let previous: unknown;
    try { previous = await fileState(path.join(output, input.target ?? "linux")); } catch { /* 首次构建。 */ }
    if (input.cache?.enabled === false) await rm(output, {recursive: true, force: true});
    await mkdir(output, {recursive: true});
    const configuration = JSON.stringify({target: input.configTarget ?? "x86_64_defconfig", fragments: fragmentContents.map(item => item.toString("utf8"))});
    let configure = true;
    try { configure = await readFile(path.join(output, "cautest-config.json"), "utf8") !== configuration; await fileState(path.join(output, ".config")); } catch { configure = true; }
    const base = ["-C", source, `O=${output}`, `ARCH=${input.arch ?? "um"}`, ...(input.crossCompile === undefined ? [] : [`CROSS_COMPILE=${input.crossCompile}`]), ...(input.makeArgs ?? [])];
    const commands = configure ? [[...base, input.configTarget ?? "x86_64_defconfig"]] : [];
    if (configure && fragmentContents.length > 0) commands.push([...base, "olddefconfig"]);
    commands.push([...base, `-j${input.jobs ?? 4}`, input.target ?? "linux"]);
    if (input.prepareModules !== false) commands.push([...base, `-j${input.jobs ?? 4}`, "modules"]);
    for (const [index, args] of commands.entries()) {
      const result = await runCommand({ program: make, args, cwd: context.project.configDir, env: buildEnvironment, signal: context.signal, onOutput: context.output });
      if (result.exitCode !== 0) throw new CautestError(`Kernel 构建失败 (exit ${result.exitCode})`, { code: "build_error" });
      if (configure && index === 0 && fragmentContents.length > 0) await writeFile(path.join(output, ".config"), mergeConfigText(await readFile(path.join(output, ".config"), "utf8"), Buffer.concat(fragmentContents).toString("utf8")));
    }
    await writeChanged(path.join(output, "cautest-config.json"), configuration);
    await publishBuildOutput(output, identity, requiredOutputs);
    return {path: output, cacheHit: valid && JSON.stringify(previous) === JSON.stringify(await fileState(path.join(output, input.target ?? "linux")))};
  });
}

async function generatedModule(input: KernelCTestJobInput, defaults: KernelModuleDefaultsInput, kernelOutput: string, context: Parameters<Parameters<typeof defineStep>[0]["execute"]>[0], dependencies: readonly string[]): Promise<KernelModuleArtifact> {
  const root = path.join(context.project.generatedDir, "kernel", safe(input.id));
  return await withBuildLock(root, context.signal, async () => {
    const moduleDir = path.join(root, "module");
    await mkdir(path.join(moduleDir, "include"), { recursive: true });
    const tests = await expandFilePatterns(input.tests, { baseDir: context.project.configDir, label: `jobs.${input.id}.tests` });
    const sources = input.sources === undefined ? [] : await expandFilePatterns(input.sources, { baseDir: context.project.configDir, label: `jobs.${input.id}.sources` });
    const headers = unique([...(defaults.headers ?? []), ...(input.headers ?? [])]);
    const expandedHeaders = headers.length === 0 ? [] : await expandFilePatterns(headers, { baseDir: context.project.configDir, label: `jobs.${input.id}.headers` });
    const objects: string[] = ["entry.o", "registry.o"];
    const copies: {source: string; destination: string}[] = [];
    for (const [index, source] of [...tests, ...sources].entries()) { const name = `source_${index}.c`; copies.push({source: path.join(context.project.configDir, source), destination: path.join(moduleDir, name)}); objects.push(name.replace(/\.c$/u, ".o")); }
    for (const header of expandedHeaders) copies.push({source: path.join(context.project.configDir, header), destination: path.join(moduleDir, "include", path.basename(header))});
    await syncFiles(moduleDir, copies);
    const suite = input.suites ?? [safe(input.id.split(".").at(-1) ?? input.id)];
    const moduleName = input.module?.name ?? safe(input.id);
    const registryName = `${safe(moduleName)}_registry`;
    await writeChanged(path.join(moduleDir, "registry.c"), `#include <cautest/cautest.h>\n${suite.map((item) => `CAUTEST_SUITE_DECLARE(${item});`).join("\n")}\nCAUTEST_REGISTRY(${registryName},\n${suite.map((item) => `    CAUTEST_SUITE_REF(${item})`).join(",\n")});\n`);
    await writeChanged(path.join(moduleDir, "entry.c"), `#include <linux/module.h>\n#include <cautest/kernel_runtime.h>\nextern const struct cautest_registry ${registryName};\nstatic int __init ${safe(moduleName)}_init(void) { return CAUTEST_KERNEL_REGISTER(${registryName}); }\nstatic void __exit ${safe(moduleName)}_exit(void) { WARN_ON(CAUTEST_KERNEL_UNREGISTER(${registryName})); }\nmodule_init(${safe(moduleName)}_init);\nmodule_exit(${safe(moduleName)}_exit);\nMODULE_LICENSE("${input.module?.license ?? "GPL"}");\n`);
    const includeDirs = unique([...(defaults.includeDirs ?? []), ...(input.module?.includeDirs ?? [])]).map((directory) => `-I${path.resolve(context.project.configDir, directory)}`);
    const defines = { ...(defaults.defines ?? {}), ...(input.module?.defines ?? {}) };
    const flags = [...Object.entries(defines).map(([key, value]) => `-D${key}${value === null ? "" : `=${value === true ? 1 : value === false ? 0 : value}`}`), ...(defaults.cflags ?? []), ...(input.module?.cflags ?? [])];
    await writeChanged(path.join(moduleDir, "Makefile"), `obj-m += ${moduleName}.o\n${moduleName}-y := ${objects.join(" ")}\n${input.coverage === undefined ? "" : "GCOV_PROFILE := y\n"}ccflags-y += -I${path.join(kitRoot, "include")} -I${path.join(kitRoot, "target/linux-kernel/include")} -I$(src)/include ${includeDirs.join(" ")} ${flags.join(" ")}\n`);
    return await buildIsolatedKernelModule({ module: { name: moduleName, sourceDir: ".", sandboxRoot: ".", output: `${moduleName}.ko`, ...(defaults.make === undefined ? {} : { make: defaults.make }), ...((input.module?.jobs ?? defaults.jobs) === undefined ? {} : { jobs: input.module?.jobs ?? defaults.jobs }), ...(input.module?.makeVariables === undefined ? {} : { makeVariables: input.module.makeVariables }), ...(input.module?.makeArgs === undefined ? {} : { makeArgs: input.module.makeArgs }), ...((input.module?.cache ?? defaults.cache) === undefined ? {} : { cache: input.module?.cache ?? defaults.cache }) }, kernelOutput, configDir: moduleDir, cacheDir: path.join(context.project.cacheDir, "kernel-modules"), workDir: path.join(context.project.workDir, "kernel-modules"), arch: environmentValue(input.environment).kernel.arch ?? "um", ...(environmentValue(input.environment).kernel.crossCompile === undefined ? {} : { crossCompile: environmentValue(input.environment).kernel.crossCompile }), env: context.job.env, dependencySymbols: dependencies, signal: context.signal, output: context.output });
  });
}

/** 创建完整 Kernel C Test Job；公共环境与 Module 配置保持独立指纹边界。 */
export function kernelCTestJob(input: KernelCTestJobInput): TestJob {
  const environment = environmentValue(input.environment);
  const name = safe(input.id);
  const moduleDefaults = environment.moduleDefaults ?? {};
  const { kernel, busybox } = umlEnvironmentBuildSteps(environment, name, input.coverage !== undefined);
  const runtime = kernelRuntimeBuildStep(environment);
  const extras = (input.extraModules ?? []).map((module) => defineStep({ kind: "kernelModuleBuild", name: module.name, phase: "build", details: { ...module }, ...(module.timeoutMs === undefined ? {} : { timeoutMs: module.timeoutMs }), async execute(context) { const kernelOutput = context.state.get("kernelOutput"); if (typeof kernelOutput !== "string") throw new CautestError("Kernel Output 不存在", { code: "build_error" }); const dependencies = (module.extraModules ?? []).map((dependency) => { const artifact = context.state.get(`module:${dependency}`) as KernelModuleArtifact | undefined; if (artifact === undefined) throw new CautestError(`extraModules 依赖尚未构建: ${dependency}`, { code: "config_error" }); return artifact.symbols; }); const artifact = await buildIsolatedKernelModule({ module, kernelOutput, configDir: context.project.configDir, cacheDir: path.join(context.project.cacheDir, "kernel-modules"), workDir: path.join(context.project.workDir, "kernel-modules"), arch: environment.kernel.arch ?? "um", ...(environment.kernel.crossCompile === undefined ? {} : { crossCompile: environment.kernel.crossCompile }), env: context.job.env, dependencySymbols: dependencies, signal: context.signal, output: context.output }); context.state.set(`module:${module.name}`, artifact); publishModule(context, artifact); return { diagnostics: [{ code: artifact.cacheHit ? "cache_hit" : "cache_miss", message: artifact.module }] }; } }));
  const testModuleTimeoutMs = input.module?.timeoutMs ?? moduleDefaults.timeoutMs;
  const testModule = defineStep({ kind: "generatedKernelTestModule", name, phase: "build", details: { tests: input.tests, sources: input.sources ?? [], headers: unique([...(moduleDefaults.headers ?? []), ...(input.headers ?? [])]), suites: input.suites ?? [safe(input.id.split(".").at(-1) ?? input.id)] }, ...(testModuleTimeoutMs === undefined ? {} : { timeoutMs: testModuleTimeoutMs }), async execute(context) { const kernelOutput = context.state.get("kernelOutput"); const core = context.state.get("module:cautest_kernel") as KernelModuleArtifact | undefined; if (typeof kernelOutput !== "string" || core === undefined) throw new CautestError("Kernel Runtime Artifact 不存在", { code: "build_error" }); const artifact = await generatedModule(input, moduleDefaults, kernelOutput, context, [core.symbols]); context.state.set(`module:${artifact.name}`, artifact); publishModule(context, artifact); return { diagnostics: [{ code: artifact.cacheHit ? "cache_hit" : "cache_miss", message: artifact.module }] }; } });
  const guestPrograms = (input.guestPrograms ?? []).map((program) => defineStep({ kind: "umlGuestProgramBuild", name: program.name, phase: "build", details: { ...program }, ...(program.timeoutMs === undefined ? {} : { timeoutMs: program.timeoutMs }), async execute(context) { const artifact = await buildGuestProgram(program, context); context.state.set(`guest:${program.name}`, artifact); publishGuestProgram(context, artifact); return { diagnostics: [{ code: artifact.cacheHit ? "cache_hit" : "cache_miss", message: artifact.path }] }; } }));
  const rootfs = defineStep({ kind: "umlRootfsBuild", name, phase: "build", details: { overlays: environment.rootfs?.overlays ?? [], modules: ["cautest_kernel", ...(input.extraModules ?? []).map((item) => item.name), input.module?.name ?? name], guestPrograms: input.guestPrograms?.map((item) => item.name) ?? [], coverage: input.coverage !== undefined }, ...(environment.rootfs?.timeoutMs === undefined ? {} : { timeoutMs: environment.rootfs.timeoutMs }), async execute(context) { const kernelOutput = context.state.get("kernelOutput"); const busyboxArtifact = context.state.get("busybox") as BusyBoxArtifact | undefined; if (typeof kernelOutput !== "string" || busyboxArtifact === undefined) throw new CautestError("Kernel/BusyBox Artifact 不存在", { code: "build_error" }); const moduleNames = ["cautest_kernel", ...(input.extraModules ?? []).map((item) => item.name), input.module?.name ?? name]; const modules = moduleNames.map((item) => { const artifact = context.state.get(`module:${item}`) as KernelModuleArtifact | undefined; if (artifact === undefined) throw new CautestError(`Rootfs Module Artifact 不存在: ${item}`, { code: "build_error" }); return artifact; }); const programs = (input.guestPrograms ?? []).map((program) => { const artifact = context.state.get(`guest:${program.name}`) as GuestProgramArtifact | undefined; if (artifact === undefined) throw new CautestError(`Guest Program Artifact 不存在: ${program.name}`, { code: "build_error" }); return artifact; }); const image = await buildRootfs({ name, environment, kernelOutput, busybox: busyboxArtifact, modules, programs, coverage: input.coverage !== undefined }, context); context.state.set(`image:${name}`, image); publishImage(context, name, image); return { diagnostics: [{ code: image.cacheHit ? "cache_hit" : "cache_miss", message: image.rootfsPath }] }; } });
  const { start, run, collect } = umlRuntimeSteps({ name, environment, endpoint: "kernel", label: "Kernel C Test", transportDetail: true, ...(input.run === undefined ? {} : {run: input.run}), allowEmpty: input.policy?.allowEmpty === true, ...(input.coverage === undefined ? {} : {coverageDir: (context: StepExecutionContext) => path.join(context.project.resultDir, "coverage", name, "raw")}) });
  const coverage = input.coverage === undefined ? [] : [defineStep({
    kind: "kernelCoverage", name, phase: "collect", runWhen: "always", details: { tool: input.coverage.tool ?? "gcov" }, ...(input.coverage.timeoutMs === undefined ? {} : { timeoutMs: input.coverage.timeoutMs }),
    async execute(context) {
      const resource = context.state.get(`uml:${name}`) as UmlRuntimeResource | undefined;
      const artifact = context.state.get(`module:${input.module?.name ?? name}`) as KernelModuleArtifact | undefined;
      if (resource === undefined || artifact === undefined) return { diagnostics: [{ code: "coverage_skipped", message: "UML/Test Module 未准备" }] };
      const response = await resource.control.command("GCOV", (line) => /^GCOV [0-9]+$/u.test(line), 30_000);
      if (response !== "GCOV 0") throw new CautestError(`Guest GCOV 导出失败: ${response}`, { code: "target_error" });
      if (artifact.coverageNotes.length === 0) throw new CautestError("Kernel Module Cache 缺少 .gcno Artifact", { code: "cache_error" });
      const raw = path.join(context.project.resultDir, "coverage", name, "raw");
      const data = await extensionFiles(raw, ".gcda");
      const report = path.join(context.project.resultDir, "coverage", name, "gcov");
      await rm(report, { recursive: true, force: true }); await mkdir(report, { recursive: true });
      const stems = new Set(artifact.coverageNotes.map((item) => path.basename(item, ".gcno")));
      for (const note of artifact.coverageNotes) await copyFile(note, path.join(report, path.basename(note)));
      for (const item of data.filter((file) => stems.has(path.basename(file, ".gcda")))) await copyFile(item, path.join(report, path.basename(item)));
      for (const source of artifact.coverageSources) {
        const relative = path.relative(context.project.workDir, source.originalPath);
        if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new CautestError("Kernel Coverage Source 路径不属于当前 Work 目录；请清理 Module Cache 后重建", { code: "cache_error" });
        await mkdir(path.dirname(source.originalPath), { recursive: true }); await copyFile(source.path, source.originalPath);
      }
      const result = await runCommand({ program: input.coverage?.tool ?? "gcov", args: ["-b", "-c", ...artifact.coverageNotes.map((item) => path.basename(item))], cwd: report, env: effectiveEnvironment(context), signal: context.signal, onOutput: context.output });
      const reports = await extensionFiles(report, ".gcov");
      if (result.exitCode !== 0 || reports.length === 0) throw new CautestError(`Kernel GCOV 报告生成失败 (exit ${result.exitCode})`, { code: "build_error" });
      context.artifacts.publish({ kind: "coverage", name, path: report, metadata: { adapter: "gcov", rawData: raw, reports } });
      return { diagnostics: [{ code: "kernel_coverage_collected", message: `${reports.length} reports: ${report}` }] };
    },
  })];
  return testJob({ id: input.id, level: input.level ?? "unit", tags: input.tags ?? [input.level ?? "unit", "kernel", "uml"], workflow: [kernel, busybox, runtime, ...extras, testModule, ...guestPrograms, rootfs, start, run, ...coverage, collect], ...(input.description === undefined ? {} : { description: input.description }), ...(input.enabled === undefined ? {} : { enabled: input.enabled }), ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }), ...(input.env === undefined ? {} : { env: input.env }), ...(input.policy === undefined ? {} : { policy: input.policy }) });
}

/** 绑定 UML Environment 和公共 Module 默认项。 */
export function kernelCTestJobFactory(options: KernelCTestJobFactoryInput): (input: Omit<KernelCTestJobInput, "environment">) => TestJob {
  environmentValue(options.environment);
  return (input) => kernelCTestJob({ ...options.defaults, ...input, environment: options.environment, headers: unique([...(options.defaults?.headers ?? []), ...(input.headers ?? [])]), sources: unique([...(options.defaults?.sources ?? []), ...(input.sources ?? [])]), module: { ...options.defaults?.module, ...input.module, defines: { ...options.defaults?.module?.defines, ...input.module?.defines }, includeDirs: unique([...(options.defaults?.module?.includeDirs ?? []), ...(input.module?.includeDirs ?? [])]), cflags: unique([...(options.defaults?.module?.cflags ?? []), ...(input.module?.cflags ?? [])]) } });
}

/** Shared transitional environment build: never builds product Driver sources. */
export function umlEnvironmentBuildSteps(environment: Readonly<UmlKernelEnvironmentInput>, name: string, coverage = false) {
  const kernel = defineStep({ kind: "kernelBuild", name, phase: "build", details: { ...environment.kernel }, ...(environment.kernel.timeoutMs === undefined ? {} : { timeoutMs: environment.kernel.timeoutMs }), async execute(context) { const artifact = await buildKernel(environment, context, name, coverage); context.state.set("kernelOutput", artifact.path); publishKernel(context, name, artifact, environment); return { diagnostics: [{ code: artifact.cacheHit ? "cache_hit" : "cache_miss", message: artifact.path }] }; } });
  const busybox = defineStep({ kind: "busyboxBuild", name, phase: "build", details: { ...environment.busybox }, ...(environment.busybox.timeoutMs === undefined ? {} : { timeoutMs: environment.busybox.timeoutMs }), async execute(context) { const artifact = await buildBusyBox(environment.busybox, context); context.state.set("busybox", artifact); publishBusyBox(context, name, artifact); return { diagnostics: [{ code: artifact.cacheHit ? "cache_hit" : "cache_miss", message: artifact.path }] }; } });
  return {kernel, busybox};
}

/** Shared Cautest Runtime module; its symbols are passed to external test targets. */
export function kernelRuntimeBuildStep(environment: Readonly<UmlKernelEnvironmentInput>) {
  const moduleDefaults = environment.moduleDefaults ?? {};
  const runtime = defineStep({ kind: "kernelModuleBuild", name: "cautest_kernel", phase: "build", details: { sourceDir: "assets/cautest-c/kernel/cautest-kernel", output: "cautest_kernel.ko" }, ...(moduleDefaults.timeoutMs === undefined ? {} : { timeoutMs: moduleDefaults.timeoutMs }), async execute(context) { const kernelOutput = context.state.get("kernelOutput"); if (typeof kernelOutput !== "string") throw new CautestError("Kernel Output 不存在", { code: "build_error" }); const artifact = await buildIsolatedKernelModule({ module: { name: "cautest_kernel", sourceDir: "kernel/cautest-kernel", sandboxRoot: ".", output: "cautest_kernel.ko", ...(moduleDefaults.make === undefined ? {} : { make: moduleDefaults.make }), ...(moduleDefaults.jobs === undefined ? {} : { jobs: moduleDefaults.jobs }), makeVariables: { CAUTEST_KERNEL_MAX_REGISTRIES: environment.runtime?.maxRegistries ?? 16, CAUTEST_KERNEL_EVENT_CAPACITY: environment.runtime?.eventCapacity ?? 128, CAUTEST_KERNEL_WORKSPACE_SIZE: environment.runtime?.workspaceSize ?? 16384 }, ...(moduleDefaults.cache === undefined ? {} : { cache: moduleDefaults.cache }) }, kernelOutput, configDir: kitRoot, cacheDir: path.join(context.project.cacheDir, "kernel-modules"), workDir: path.join(context.project.workDir, "kernel-modules"), arch: environment.kernel.arch ?? "um", ...(environment.kernel.crossCompile === undefined ? {} : { crossCompile: environment.kernel.crossCompile }), env: context.job.env, signal: context.signal, output: context.output }); context.state.set("module:cautest_kernel", artifact); publishModule(context, artifact); return { diagnostics: [{ code: artifact.cacheHit ? "cache_hit" : "cache_miss", message: artifact.module }] }; } });
  return runtime;
}
