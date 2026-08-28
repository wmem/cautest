import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { KernelCTestJobFactoryInput, KernelCTestJobInput, KernelModuleDefaultsInput, KernelModuleInput, TestJob, UmlKernelEnvironment, UmlKernelEnvironmentInput } from "../config/schema/index.js";
import { expandFilePatterns } from "../config/file-pattern.js";
import { testJob } from "../config/define.js";
import { buildIsolatedKernelModule, type KernelModuleArtifact } from "../kernel/module-build.js";
import { CautestError } from "../model/error.js";
import { runCommand } from "../runtime/process.js";
import { defineStep } from "../workflow/step.js";

const ENVIRONMENT = Symbol.for("@cautest/config/uml-kernel-environment");
const environments = new WeakMap<UmlKernelEnvironment, Readonly<UmlKernelEnvironmentInput>>();
const kitRoot = fileURLToPath(new URL("../../assets/cautest-c", import.meta.url));

type InternalEnvironment = UmlKernelEnvironment & { readonly [ENVIRONMENT]: true };

function object(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new CautestError(`${label} 必须是对象`, { code: "config_error" });
}

function environmentValue(value: UmlKernelEnvironment): Readonly<UmlKernelEnvironmentInput> {
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

function safe(value: string): string { return value.replace(/[^A-Za-z0-9_]/gu, "_"); }
function unique(values: readonly string[]): readonly string[] { return [...new Set(values)]; }

async function buildKernel(environment: Readonly<UmlKernelEnvironmentInput>, context: Parameters<Parameters<typeof defineStep>[0]["execute"]>[0], name: string): Promise<string> {
  const input = environment.kernel;
  const source = path.resolve(context.project.configDir, input.sourceDir);
  const identity = createHash("sha256").update(JSON.stringify({ input, name })).digest("hex");
  const output = path.join(context.project.cacheDir, "kernel", identity);
  const marker = path.join(output, input.target ?? "linux");
  try { await readFile(marker); return output; } catch { /* build */ }
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  const make = input.make ?? "make";
  const base = ["-C", source, `O=${output}`, `ARCH=${input.arch ?? "um"}`, ...(input.crossCompile === undefined ? [] : [`CROSS_COMPILE=${input.crossCompile}`])];
  for (const args of [[...base, input.configTarget ?? "x86_64_defconfig"], [...base, `-j${input.jobs ?? 4}`, ...(input.makeArgs ?? []), input.target ?? "linux"], ...(input.prepareModules === false ? [] : [[...base, `-j${input.jobs ?? 4}`, "modules_prepare"]])]) {
    const result = await runCommand({ program: make, args, cwd: context.project.configDir, env: { ...process.env, ...input.env }, signal: context.signal, onOutput: context.output });
    if (result.exitCode !== 0) throw new CautestError(`Kernel 构建失败 (exit ${result.exitCode})`, { code: "build_error" });
  }
  return output;
}

async function generatedModule(input: KernelCTestJobInput, defaults: KernelModuleDefaultsInput, kernelOutput: string, context: Parameters<Parameters<typeof defineStep>[0]["execute"]>[0], dependencies: readonly string[]): Promise<KernelModuleArtifact> {
  const root = await mkdtemp(path.join(context.project.workDir, `.${safe(input.id)}-generated-`));
  try {
    const moduleDir = path.join(root, "module");
    await mkdir(path.join(moduleDir, "include"), { recursive: true });
    const tests = await expandFilePatterns(input.tests, { baseDir: context.project.configDir, label: `jobs.${input.id}.tests` });
    const sources = input.sources === undefined ? [] : await expandFilePatterns(input.sources, { baseDir: context.project.configDir, label: `jobs.${input.id}.sources` });
    const headers = unique([...(defaults.headers ?? []), ...(input.headers ?? [])]);
    const expandedHeaders = headers.length === 0 ? [] : await expandFilePatterns(headers, { baseDir: context.project.configDir, label: `jobs.${input.id}.headers` });
    const objects: string[] = ["entry.o", "registry.o"];
    for (const [index, source] of [...tests, ...sources].entries()) { const name = `source_${index}.c`; await copyFile(path.join(context.project.configDir, source), path.join(moduleDir, name)); objects.push(name.replace(/\.c$/u, ".o")); }
    for (const header of expandedHeaders) await copyFile(path.join(context.project.configDir, header), path.join(moduleDir, "include", path.basename(header)));
    const suite = input.suites ?? [safe(input.id.split(".").at(-1) ?? input.id)];
    const moduleName = input.module?.name ?? safe(input.id);
    const registryName = `${safe(moduleName)}_registry`;
    await writeFile(path.join(moduleDir, "registry.c"), `#include <cautest/cautest.h>\n${suite.map((item) => `CAUTEST_SUITE_DECLARE(${item});`).join("\n")}\nCAUTEST_REGISTRY(${registryName},\n${suite.map((item) => `    CAUTEST_SUITE_REF(${item})`).join(",\n")});\n`);
    await writeFile(path.join(moduleDir, "entry.c"), `#include <linux/module.h>\n#include <cautest/kernel_runtime.h>\nextern const struct cautest_registry ${registryName};\nstatic int __init ${safe(moduleName)}_init(void) { return CAUTEST_KERNEL_REGISTER(${registryName}); }\nstatic void __exit ${safe(moduleName)}_exit(void) { WARN_ON(CAUTEST_KERNEL_UNREGISTER(${registryName})); }\nmodule_init(${safe(moduleName)}_init);\nmodule_exit(${safe(moduleName)}_exit);\nMODULE_LICENSE("${input.module?.license ?? "GPL"}");\n`);
    const includeDirs = unique([...(defaults.includeDirs ?? []), ...(input.module?.includeDirs ?? [])]).map((directory) => `-I${path.resolve(context.project.configDir, directory)}`);
    const defines = { ...(defaults.defines ?? {}), ...(input.module?.defines ?? {}) };
    const flags = [...Object.entries(defines).map(([key, value]) => `-D${key}${value === null ? "" : `=${value === true ? 1 : value === false ? 0 : value}`}`), ...(defaults.cflags ?? []), ...(input.module?.cflags ?? [])];
    await writeFile(path.join(moduleDir, "Makefile"), `obj-m += ${moduleName}.o\n${moduleName}-y := ${objects.join(" ")}\nccflags-y += -I${path.join(kitRoot, "include")} -I${path.join(kitRoot, "target/linux-kernel/include")} -I$(src)/include ${includeDirs.join(" ")} ${flags.join(" ")}\n`);
    return await buildIsolatedKernelModule({ module: { name: moduleName, sourceDir: ".", sandboxRoot: ".", output: `${moduleName}.ko`, ...(defaults.make === undefined ? {} : { make: defaults.make }), ...((input.module?.jobs ?? defaults.jobs) === undefined ? {} : { jobs: input.module?.jobs ?? defaults.jobs }), ...(input.module?.makeVariables === undefined ? {} : { makeVariables: input.module.makeVariables }), ...(input.module?.makeArgs === undefined ? {} : { makeArgs: input.module.makeArgs }), ...((input.module?.cache ?? defaults.cache) === undefined ? {} : { cache: input.module?.cache ?? defaults.cache }) }, kernelOutput, configDir: moduleDir, cacheDir: path.join(context.project.cacheDir, "kernel-modules"), workDir: path.join(context.project.workDir, "kernel-modules"), arch: environmentValue(input.environment).kernel.arch ?? "um", ...(environmentValue(input.environment).kernel.crossCompile === undefined ? {} : { crossCompile: environmentValue(input.environment).kernel.crossCompile }), ...(input.env === undefined ? {} : { env: input.env }), dependencySymbols: dependencies, signal: context.signal, output: context.output });
  } finally { await rm(root, { recursive: true, force: true }); }
}

/** 创建完整 Kernel C Test Job；公共环境与 Module 配置保持独立指纹边界。 */
export function kernelCTestJob(input: KernelCTestJobInput): TestJob {
  const environment = environmentValue(input.environment);
  const name = safe(input.id);
  const moduleDefaults = environment.moduleDefaults ?? {};
  const kernel = defineStep({ kind: "kernelBuild", name, phase: "build", details: { ...environment.kernel }, ...(environment.kernel.timeoutMs === undefined ? {} : { timeoutMs: environment.kernel.timeoutMs }), async execute(context) { const output = await buildKernel(environment, context, name); context.state.set("kernelOutput", output); return { diagnostics: [{ code: "kernel_ready", message: output }] }; } });
  const busybox = defineStep({ kind: "busyboxBuild", name, phase: "build", details: { ...environment.busybox }, ...(environment.busybox.timeoutMs === undefined ? {} : { timeoutMs: environment.busybox.timeoutMs }), execute() { return { diagnostics: [{ code: "busybox_deferred", message: environment.busybox.sourceDir }] }; } });
  const runtime = defineStep({ kind: "kernelModuleBuild", name: "cautest_kernel", phase: "build", details: { sourceDir: "assets/cautest-c/kernel/cautest-kernel", output: "cautest_kernel.ko" }, async execute(context) { const kernelOutput = context.state.get("kernelOutput"); if (typeof kernelOutput !== "string") throw new CautestError("Kernel Output 不存在", { code: "build_error" }); const artifact = await buildIsolatedKernelModule({ module: { name: "cautest_kernel", sourceDir: "kernel/cautest-kernel", sandboxRoot: ".", output: "cautest_kernel.ko", ...(moduleDefaults.make === undefined ? {} : { make: moduleDefaults.make }), ...(moduleDefaults.jobs === undefined ? {} : { jobs: moduleDefaults.jobs }), makeVariables: { CAUTEST_KERNEL_MAX_REGISTRIES: environment.runtime?.maxRegistries ?? 16, CAUTEST_KERNEL_EVENT_CAPACITY: environment.runtime?.eventCapacity ?? 128, CAUTEST_KERNEL_WORKSPACE_SIZE: environment.runtime?.workspaceSize ?? 16384 }, ...(moduleDefaults.cache === undefined ? {} : { cache: moduleDefaults.cache }) }, kernelOutput, configDir: kitRoot, cacheDir: path.join(context.project.cacheDir, "kernel-modules"), workDir: path.join(context.project.workDir, "kernel-modules"), arch: environment.kernel.arch ?? "um", ...(environment.kernel.crossCompile === undefined ? {} : { crossCompile: environment.kernel.crossCompile }), signal: context.signal, output: context.output }); context.state.set("module:cautest_kernel", artifact); return { diagnostics: [{ code: artifact.cacheHit ? "cache_hit" : "cache_miss", message: artifact.module }] }; } });
  const extras = (input.extraModules ?? []).map((module) => defineStep({ kind: "kernelModuleBuild", name: module.name, phase: "build", details: { ...module }, ...(module.timeoutMs === undefined ? {} : { timeoutMs: module.timeoutMs }), async execute(context) { const kernelOutput = context.state.get("kernelOutput"); if (typeof kernelOutput !== "string") throw new CautestError("Kernel Output 不存在", { code: "build_error" }); const dependencies = (module.extraModules ?? []).map((dependency) => { const artifact = context.state.get(`module:${dependency}`) as KernelModuleArtifact | undefined; if (artifact === undefined) throw new CautestError(`extraModules 依赖尚未构建: ${dependency}`, { code: "config_error" }); return artifact.symbols; }); const artifact = await buildIsolatedKernelModule({ module, kernelOutput, configDir: context.project.configDir, cacheDir: path.join(context.project.cacheDir, "kernel-modules"), workDir: path.join(context.project.workDir, "kernel-modules"), arch: environment.kernel.arch ?? "um", ...(environment.kernel.crossCompile === undefined ? {} : { crossCompile: environment.kernel.crossCompile }), ...(input.env === undefined ? {} : { env: input.env }), dependencySymbols: dependencies, signal: context.signal, output: context.output }); context.state.set(`module:${module.name}`, artifact); return { diagnostics: [{ code: artifact.cacheHit ? "cache_hit" : "cache_miss", message: artifact.module }] }; } }));
  const testModule = defineStep({ kind: "generatedKernelTestModule", name, phase: "build", details: { tests: input.tests, sources: input.sources ?? [], headers: input.headers ?? [], suites: input.suites ?? [safe(input.id.split(".").at(-1) ?? input.id)] }, ...(input.module?.timeoutMs === undefined ? {} : { timeoutMs: input.module.timeoutMs }), async execute(context) { const kernelOutput = context.state.get("kernelOutput"); const core = context.state.get("module:cautest_kernel") as KernelModuleArtifact | undefined; if (typeof kernelOutput !== "string" || core === undefined) throw new CautestError("Kernel Runtime Artifact 不存在", { code: "build_error" }); const artifact = await generatedModule(input, moduleDefaults, kernelOutput, context, [core.symbols]); context.state.set(`module:${artifact.name}`, artifact); return { diagnostics: [{ code: artifact.cacheHit ? "cache_hit" : "cache_miss", message: artifact.module }] }; } });
  const rootfs = defineStep({ kind: "umlRootfsBuild", name, phase: "build", details: { overlays: environment.rootfs?.overlays ?? [], modules: ["cautest_kernel", ...(input.extraModules ?? []).map((item) => item.name), input.module?.name ?? name] }, execute() { return { diagnostics: [{ code: "rootfs_plan", message: "Rootfs inputs resolved" }] }; } });
  const start = defineStep({ kind: "umlStart", name, phase: "provision", details: { ...environment.machine }, ...(environment.machine?.startTimeoutMs === undefined ? {} : { timeoutMs: environment.machine.startTimeoutMs }), execute() { throw new CautestError("当前环境未提供可启动的 UML Image Artifact", { code: "provision_error" }); } });
  const run = defineStep({ kind: "cTestRun", name, phase: "run", details: { transport: "uml", endpoint: "kernel", selection: input.run ?? {} }, ...(input.run?.stepTimeoutMs === undefined ? {} : { timeoutMs: input.run.stepTimeoutMs }), execute() { throw new CautestError("UML 未启动，无法建立 Kernel CTP3 Session", { code: "transport_error" }); } });
  const collect = defineStep({ kind: "umlLogs", name, phase: "collect", runWhen: "always", details: {}, ...(environment.machine?.collectTimeoutMs === undefined ? {} : { timeoutMs: environment.machine.collectTimeoutMs }), execute() { return { diagnostics: [] }; } });
  return testJob({ id: input.id, level: input.level ?? "unit", tags: input.tags ?? [input.level ?? "unit", "kernel", "uml"], workflow: [kernel, busybox, runtime, ...extras, testModule, rootfs, start, run, collect], ...(input.description === undefined ? {} : { description: input.description }), ...(input.enabled === undefined ? {} : { enabled: input.enabled }), ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }), ...(input.env === undefined ? {} : { env: input.env }), ...(input.policy === undefined ? {} : { policy: input.policy }) });
}

/** 绑定 UML Environment 和公共 Module 默认项。 */
export function kernelCTestJobFactory(options: KernelCTestJobFactoryInput): (input: Omit<KernelCTestJobInput, "environment">) => TestJob {
  environmentValue(options.environment);
  return (input) => kernelCTestJob({ ...options.defaults, ...input, environment: options.environment, headers: unique([...(options.defaults?.headers ?? []), ...(input.headers ?? [])]), sources: unique([...(options.defaults?.sources ?? []), ...(input.sources ?? [])]), module: { ...options.defaults?.module, ...input.module, defines: { ...options.defaults?.module?.defines, ...input.module?.defines }, includeDirs: unique([...(options.defaults?.module?.includeDirs ?? []), ...(input.module?.includeDirs ?? [])]), cflags: unique([...(options.defaults?.module?.cflags ?? []), ...(input.module?.cflags ?? [])]) } });
}
