import {ownedProcessStop} from "../runtime/owned-process.js";
import {validBuildOutput, publishBuildOutput} from "../cache/build-output.js";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import type { Duplex } from "node:stream";
import { chmod, copyFile, cp, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { BusyBoxBuildInput, CTestRunInput, DriverGuestCTestInput, StepExecutionContext, UmlGuestProgramInput, UmlKernelEnvironmentInput } from "../config/schema/index.js";
import { CAUTEST_CACHE_VERSIONS } from "../config/versions.js";
import { expandFilePatterns } from "../config/file-pattern.js";
import type { KernelModuleArtifact } from "../kernel/module-build.js";
import { CautestError } from "../model/error.js";
import { runCtpSession } from "../protocol/native-session.js";
import { workflowSessionEventSink } from "../protocol/workflow-session.js";
import { declaredEnvironment, effectiveEnvironment } from "../runtime/environment.js";
import { runCommand } from "../runtime/process.js";
import { UmlControlChannel, type UmlRuntimeResource } from "./control.js";

const kitRoot = fileURLToPath(new URL("../../assets/cautest-c", import.meta.url));

export interface BusyBoxArtifact { readonly path: string; readonly buildId: string; readonly cacheHit: boolean }
export interface GuestProgramArtifact { readonly name: string; readonly path: string; readonly buildId: string; readonly endpoint: string; readonly installPath: string; readonly cacheHit: boolean }
export interface UmlImageArtifact { readonly kernelPath: string; readonly rootfsPath: string; readonly buildId: string; readonly endpoints: ReadonlyMap<string, { readonly type: "kernel" | "process"; readonly buildId: string }>; readonly cacheHit: boolean }

async function files(root: string, relative = ""): Promise<string[]> {
  const output: string[] = [];
  for (const entry of (await readdir(path.join(root, relative), { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) output.push(...await files(root, child));
    else output.push(child);
  }
  return output;
}

async function archiveEntries(root: string, relative = ""): Promise<string[]> {
  const output: string[] = [];
  for (const entry of (await readdir(path.join(root, relative), { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
    const child = path.join(relative, entry.name);
    output.push(child);
    if (entry.isDirectory()) output.push(...await archiveEntries(root, child));
  }
  return output;
}

async function hashFiles(locations: readonly string[], metadata: unknown): Promise<string> {
  const hash = createHash("sha256").update(JSON.stringify(metadata));
  for (const location of [...locations].sort()) {
    const info = await lstat(location);
    hash.update(location).update(String(info.mode));
    if (info.isSymbolicLink()) hash.update(await import("node:fs/promises").then(({ readlink }) => readlink(location)));
    else if (info.isFile()) hash.update(await readFile(location));
  }
  return hash.digest("hex");
}

/** 对 Git Worktree 使用 HEAD、完整 Diff 和未跟踪文件，对普通目录使用内容树。 */
export async function sourceTreeIdentity(source: string, context: StepExecutionContext): Promise<string> {
  const environment = effectiveEnvironment(context);
  const head = await runCommand({ program: "git", args: ["-C", source, "rev-parse", "HEAD"], cwd: context.project.configDir, env: environment, signal: context.signal });
  if (head.exitCode === 0) {
    const diff = await runCommand({ program: "git", args: ["-C", source, "diff", "--binary", "HEAD"], cwd: context.project.configDir, env: environment, signal: context.signal });
    const untracked = await runCommand({ program: "git", args: ["-C", source, "ls-files", "--others", "--exclude-standard"], cwd: context.project.configDir, env: environment, signal: context.signal });
    const extra = untracked.stdout.split("\n").filter(Boolean).map((item) => path.join(source, item));
    return await hashFiles(extra, { head: head.stdout.trim(), diff: diff.stdout });
  }
  return await hashFiles((await files(source)).map((item) => path.join(source, item)), { source: "tree" });
}

/** 按 Kconfig/BusyBox Config Fragment 覆盖已有 `.config`。 */
export function mergeConfigText(current: string, fragments: string): string {
  const assignments = new Map<string, string>();
  for (const line of fragments.split("\n")) {
    const match = /^(?:# )?(CONFIG_[A-Za-z0-9_]+)(?:=(.*)| is not set)$/u.exec(line.trim());
    if (match !== null) assignments.set(match[1]!, match[2] === undefined ? `# ${match[1]} is not set` : `${match[1]}=${match[2]}`);
  }
  for (const [symbol, assignment] of assignments) {
    const expression = new RegExp(`^(?:# )?${symbol}(?:=.*| is not set)$`, "mu");
    current = expression.test(current) ? current.replace(expression, assignment) : `${current}${assignment}\n`;
  }
  return current;
}

/** 构建可用于 initramfs 的静态 BusyBox，并按源码、配置和工具身份缓存。 */
export async function buildBusyBox(input: BusyBoxBuildInput, context: StepExecutionContext): Promise<BusyBoxArtifact> {
  const source = path.resolve(context.project.configDir, input.sourceDir);
  const fragments = input.configFragments === undefined ? [] : await expandFilePatterns(input.configFragments, { baseDir: context.project.configDir, label: "busybox.configFragments" });
  const make = input.make ?? "make";
  const buildEnvironment = effectiveEnvironment(context, input.env);
  const compiler = buildEnvironment.CC ?? "cc";
  const [identity, version, compilerVersion, compilerTarget] = await Promise.all([
    sourceTreeIdentity(source, context),
    runCommand({ program: make, args: ["--version"], cwd: context.project.configDir, env: buildEnvironment, signal: context.signal }),
    runCommand({ program: compiler, args: ["--version"], cwd: context.project.configDir, env: buildEnvironment, signal: context.signal }),
    runCommand({ program: compiler, args: ["-dumpmachine"], cwd: context.project.configDir, env: buildEnvironment, signal: context.signal }),
  ]);
  const fingerprintEnvironment = Object.fromEntries((input.cache?.fingerprintEnv ?? []).map((key) => [key, buildEnvironment[key] ?? null]));
  const key = await hashFiles(fragments.map((item) => path.join(context.project.configDir, item)), { schema: CAUTEST_CACHE_VERSIONS.busyboxFingerprint, identity, make: version.stdout, compiler: compilerVersion.stdout, compilerTarget: compilerTarget.stdout, static: input.static !== false, makeArgs: input.makeArgs ?? [], environment: declaredEnvironment(context, input.env), fingerprintEnvironment });
  const cacheEnabled = input.cache?.enabled !== false;
  const cacheRoot = path.resolve(context.project.configDir, cacheEnabled ? (input.cache?.directory ?? context.project.cacheDir) : context.project.workDir);
  const output = path.join(cacheRoot, "busybox", key);
  const binary = path.join(output, "busybox");
  if (cacheEnabled) {
    if (await validBuildOutput(output, key, ["busybox", ".config"])) return {path: binary, buildId: key, cacheHit: true};
  }
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  const base = ["-C", source, `O=${output}`];
  for (const args of [[...base, "defconfig"]]) {
    const result = await runCommand({ program: make, args, cwd: context.project.configDir, env: buildEnvironment, signal: context.signal, onOutput: context.output });
    if (result.exitCode !== 0) throw new CautestError(`BusyBox 配置失败 (exit ${result.exitCode})`, { code: "build_error" });
  }
  const defaults = `${input.static === false ? "" : "CONFIG_STATIC=y\n"}CONFIG_SH_IS_ASH=y\nCONFIG_ASH=y\nCONFIG_MOUNT=y\nCONFIG_INSMOD=y\nCONFIG_POWEROFF=y\nCONFIG_REBOOT=y\n# CONFIG_TC is not set\n`;
  const fragmentText = (await Promise.all(fragments.map((item) => readFile(path.join(context.project.configDir, item), "utf8")))).join("\n");
  const configPath = path.join(output, ".config");
  await writeFile(configPath, mergeConfigText(await readFile(configPath, "utf8"), defaults + fragmentText));
  for (const args of [[...base, "silentoldconfig"], [...base, `-j${input.jobs ?? 4}`, ...(input.makeArgs ?? []), "busybox"]]) {
    const result = await runCommand({ program: make, args, cwd: context.project.configDir, env: buildEnvironment, signal: context.signal, onOutput: context.output });
    if (result.exitCode !== 0) throw new CautestError(`BusyBox 构建失败 (exit ${result.exitCode})`, { code: "build_error" });
  }
  await publishBuildOutput(output, key, ["busybox", ".config"]);
  return { path: binary, buildId: key, cacheHit: false };
}

async function buildAgent(context: StepExecutionContext): Promise<GuestProgramArtifact> {
  const source = path.join(kitRoot, "agent/uml-guest-agent/guest_agent.c");
  const environment = effectiveEnvironment(context);
  const compiler = environment.CC ?? "cc";
  const version = await runCommand({ program: compiler, args: ["--version"], cwd: context.project.configDir, env: environment, signal: context.signal });
  const key = await hashFiles([source, path.join(kitRoot, "include/cautest/version.h"), path.join(kitRoot, "platform/linux-kernel/include/cautest/kernel_abi.h")], { version: version.stdout, schema: CAUTEST_CACHE_VERSIONS.agentFingerprint, environment: declaredEnvironment(context) });
  const directory = path.join(context.project.cacheDir, "uml-agent", key);
  const target = path.join(directory, "agent");
  if (await validBuildOutput(directory, key, ["agent"])) return {name: "agent", path: target, buildId: key, endpoint: "", installPath: "/opt/cautest/bin/agent", cacheHit: true};
  await rm(directory, {recursive: true, force: true});
  await mkdir(directory, { recursive: true });
  const result = await runCommand({ program: compiler, args: ["-O2", "-std=c99", "-Wall", "-Wextra", "-static", `-I${path.join(kitRoot, "include")}`, `-I${path.join(kitRoot, "platform/linux-kernel/include")}`, source, "-o", target], cwd: directory, env: environment, signal: context.signal, onOutput: context.output });
  if (result.exitCode !== 0) throw new CautestError(`UML Guest Agent 构建失败 (exit ${result.exitCode})`, { code: "build_error" });
  await chmod(target, 0o755);
  await publishBuildOutput(directory, key, ["agent"]);
  return { name: "agent", path: target, buildId: key, endpoint: "", installPath: "/opt/cautest/bin/agent", cacheHit: false };
}

/** 编译直接放入 Rootfs 的 Guest Program。 */
export async function buildGuestProgram(input: UmlGuestProgramInput, context: StepExecutionContext): Promise<GuestProgramArtifact> {
  const sources = await expandFilePatterns(input.sources, { baseDir: context.project.configDir, label: `guestPrograms.${input.name}.sources` });
  const headers = input.headers === undefined ? [] : await expandFilePatterns(input.headers, { baseDir: context.project.configDir, label: `guestPrograms.${input.name}.headers` });
  const environment = effectiveEnvironment(context);
  const compiler = input.compiler ?? environment.CC ?? "cc";
  const [version, targetIdentity] = await Promise.all([
    runCommand({ program: compiler, args: ["--version"], cwd: context.project.configDir, env: environment, signal: context.signal }),
    runCommand({ program: compiler, args: ["-dumpmachine"], cwd: context.project.configDir, env: environment, signal: context.signal }),
  ]);
  const locations = [...sources, ...headers].map((item) => path.join(context.project.configDir, item));
  const fingerprintEnvironment = Object.fromEntries((input.cache?.fingerprintEnv ?? []).map((key) => [key, environment[key] ?? null]));
  const key = await hashFiles(locations, {
    schema: CAUTEST_CACHE_VERSIONS.guestFingerprint,
    compiler: version.stdout,
    compilerTarget: targetIdentity.stdout,
    sources,
    headers,
    includeDirs: input.includeDirs ?? [],
    defines: input.defines ?? {},
    cflags: input.cflags ?? [],
    ldflags: input.ldflags ?? [],
    static: input.static !== false,
    environment: declaredEnvironment(context),
    fingerprintEnvironment,
  });
  const cacheEnabled = input.cache?.enabled !== false;
  const cacheRoot = path.resolve(context.project.configDir, cacheEnabled ? (input.cache?.directory ?? context.project.cacheDir) : context.project.workDir);
  const directory = path.join(cacheRoot, "guest-programs", key);
  const target = path.join(directory, input.name);
  if (cacheEnabled) {
    if (await validBuildOutput(directory, key, [input.name])) return {name: input.name, path: target, buildId: key, endpoint: input.endpoint ?? input.name, installPath: input.installPath ?? `/opt/cautest/bin/${input.name}`, cacheHit: true};
  }
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
  const includes = [...new Set([...(input.includeDirs ?? []).map((item) => path.resolve(context.project.configDir, item)), ...headers.map((item) => path.dirname(path.join(context.project.configDir, item)))])];
  const definitions = Object.entries(input.defines ?? {}).map(([name, value]) => `-D${name}${value === null ? "" : `=${value === true ? 1 : value === false ? 0 : value}`}`);
  const result = await runCommand({ program: compiler, args: ["-std=c99", "-Wall", "-Wextra", ...(input.static === false ? [] : ["-static"]), ...includes.map((item) => `-I${item}`), ...definitions, ...(input.cflags ?? []), ...sources.map((item) => path.join(context.project.configDir, item)), ...(input.ldflags ?? []), "-o", target], cwd: directory, env: environment, signal: context.signal, onOutput: context.output });
  if (result.exitCode !== 0) throw new CautestError(`Guest Program ${input.name} 构建失败 (exit ${result.exitCode})`, { code: "build_error" });
  await chmod(target, 0o755);
  await publishBuildOutput(directory, key, [input.name]);
  return { name: input.name, path: target, buildId: key, endpoint: input.endpoint ?? input.name, installPath: input.installPath ?? `/opt/cautest/bin/${input.name}`, cacheHit: false };
}

function registrySource(suites: readonly string[]): string { return `#include <cautest/cautest.h>\n${suites.map((suite) => `CAUTEST_SUITE_DECLARE(${suite});`).join("\n")}\nCAUTEST_REGISTRY(cautest_generated_registry,\n${suites.map((suite) => `    CAUTEST_SUITE_REF(${suite})`).join(",\n")});\n`; }
function entrySource(buildId: string): string { return `#include "posix_target.h"\nextern const struct cautest_registry cautest_generated_registry;\nint main(void) { const struct cautest_posix_target_config config = { "${buildId}", 65536UL, 1000UL }; return cautest_posix_target_main(&cautest_generated_registry, &config); }\n`; }

/** 自动生成 Driver Guest C Test 的 Registry/入口并静态编译。 */
export async function buildDriverGuestCTest(jobId: string, input: DriverGuestCTestInput, context: StepExecutionContext): Promise<GuestProgramArtifact> {
  const tests = await expandFilePatterns(input.tests, { baseDir: context.project.configDir, label: `jobs.${jobId}.guest.tests` });
  const sources = input.sources === undefined ? [] : await expandFilePatterns(input.sources, { baseDir: context.project.configDir, label: `jobs.${jobId}.guest.sources` });
  const headers = input.headers === undefined ? [] : await expandFilePatterns(input.headers, { baseDir: context.project.configDir, label: `jobs.${jobId}.guest.headers` });
  const suites = input.suites ?? [jobId.split(".").at(-1)!.replace(/[^A-Za-z0-9_]/gu, "_")];
  const environment = effectiveEnvironment(context);
  const compiler = input.compiler ?? environment.CC ?? "cc";
  const [version, targetIdentity] = await Promise.all([
    runCommand({ program: compiler, args: ["--version"], cwd: context.project.configDir, env: environment, signal: context.signal }),
    runCommand({ program: compiler, args: ["-dumpmachine"], cwd: context.project.configDir, env: environment, signal: context.signal }),
  ]);
  const product = [...tests, ...sources, ...headers].map((item) => path.join(context.project.configDir, item));
  const kitSources = ["core/cautest.c", "protocol/ctp3.c", "platform/posix/cautest_posix_platform.c", "target/posix/cautest_posix_target.c", "agent/uml-guest-agent/probe_client.c"].map((item) => path.join(kitRoot, item));
  const fingerprintEnvironment = Object.fromEntries((input.cache?.fingerprintEnv ?? []).map((key) => [key, environment[key] ?? null]));
  const key = await hashFiles([...product, path.join(kitRoot, "include/cautest/version.h"), ...kitSources], {
    schema: CAUTEST_CACHE_VERSIONS.guestFingerprint,
    compiler: version.stdout,
    compilerTarget: targetIdentity.stdout,
    tests,
    sources,
    headers,
    suites,
    includeDirs: input.includeDirs ?? [],
    defines: input.defines ?? {},
    cflags: input.cflags ?? [],
    ldflags: input.ldflags ?? [],
    static: input.static !== false,
    environment: declaredEnvironment(context),
    fingerprintEnvironment,
  });
  const name = input.name ?? jobId.replace(/[^A-Za-z0-9_-]/gu, "-");
  const cacheEnabled = input.cache?.enabled !== false;
  const cacheRoot = path.resolve(context.project.configDir, cacheEnabled ? (input.cache?.directory ?? context.project.cacheDir) : context.project.workDir);
  const directory = path.join(cacheRoot, "driver-guest", key);
  const target = path.join(directory, name);
  if (cacheEnabled) {
    if (await validBuildOutput(directory, key, [name])) return {name, path: target, buildId: key, endpoint: input.endpoint ?? name, installPath: `/opt/cautest/bin/${name}`, cacheHit: true};
  }
  await rm(directory, { recursive: true, force: true }); await mkdir(directory, { recursive: true });
  const registry = path.join(directory, "registry.c"); const entry = path.join(directory, "entry.c");
  await Promise.all([writeFile(registry, registrySource(suites)), writeFile(entry, entrySource(key))]);
  const includes = [...new Set([...(input.includeDirs ?? []).map((item) => path.resolve(context.project.configDir, item)), ...headers.map((item) => path.dirname(path.join(context.project.configDir, item)))])];
  const definitions = Object.entries(input.defines ?? {}).map(([name, value]) => `-D${name}${value === null ? "" : `=${value === true ? 1 : value === false ? 0 : value}`}`);
  const args = ["-std=c99", "-Wall", "-Wextra", ...(input.static === false ? [] : ["-static"]), `-I${path.join(kitRoot, "include")}`, `-I${path.join(kitRoot, "platform/posix")}`, `-I${path.join(kitRoot, "platform/linux-kernel/include")}`, `-I${path.join(kitRoot, "target/posix")}`, `-I${path.join(kitRoot, "agent/uml-guest-agent")}`, ...includes.map((item) => `-I${item}`), ...definitions, ...(input.cflags ?? []), ...tests.map((item) => path.join(context.project.configDir, item)), ...sources.map((item) => path.join(context.project.configDir, item)), registry, entry, ...kitSources, ...(input.ldflags ?? []), "-o", target];
  const result = await runCommand({ program: compiler, args, cwd: directory, env: environment, signal: context.signal, onOutput: context.output });
  if (result.exitCode !== 0) throw new CautestError(`Driver Guest C Test 构建失败 (exit ${result.exitCode})\n${result.stderr}`, { code: "build_error" });
  await chmod(target, 0o755);
  await publishBuildOutput(directory, key, [name]);
  return { name, path: target, buildId: key, endpoint: input.endpoint ?? name, installPath: `/opt/cautest/bin/${name}`, cacheHit: false };
}

async function cpio(root: string, target: string, program: string, signal: AbortSignal, environment: NodeJS.ProcessEnv): Promise<void> {
  const manifest = [".", ...(await archiveEntries(root)).map((item) => `./${item.split(path.sep).join("/")}`)].sort().join("\n") + "\n";
  const child = spawn(program, ["--quiet", "-o", "-H", "newc", "--owner=0:0"], { cwd: root, env: environment, stdio: ["pipe", "pipe", "pipe"] });
  const chunks: Buffer[] = []; const errors: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk)); child.stderr.on("data", (chunk: Buffer) => errors.push(chunk));
  const abort = () => child.kill("SIGTERM"); signal.addEventListener("abort", abort, { once: true });
  child.stdin.end(manifest);
  const [code] = await once(child, "close") as [number | null]; signal.removeEventListener("abort", abort);
  if (code !== 0) throw new CautestError(`Rootfs cpio 失败 (exit ${code})\n${Buffer.concat(errors).toString("utf8")}`, { code: "build_error" });
  await writeFile(target, Buffer.concat(chunks));
}

/** 组装模块、Guest Program、Agent 和 BusyBox 为可启动 initramfs。 */
export async function buildRootfs(options: { readonly name: string; readonly environment: UmlKernelEnvironmentInput; readonly kernelOutput: string; readonly busybox: BusyBoxArtifact; readonly modules: readonly KernelModuleArtifact[]; readonly programs?: readonly GuestProgramArtifact[]; readonly coverage?: boolean }, context: StepExecutionContext): Promise<UmlImageArtifact> {
  const agent = await buildAgent(context);
  const overlays = options.environment.rootfs?.overlays ?? [];
  const overlayFiles = (await Promise.all(overlays.map(async (item) => (await files(path.resolve(context.project.configDir, item))).map((file) => path.join(context.project.configDir, item, file))))).flat();
  const payloadFiles = [options.busybox.path, agent.path, ...options.modules.map(item => item.module), ...(options.programs ?? []).map(item => item.path), ...overlayFiles];
  const key = await hashFiles(payloadFiles, {schema: CAUTEST_CACHE_VERSIONS.rootfsFingerprint, overlays, busybox: options.busybox.buildId, agent: agent.buildId, modules: options.modules.map(item => [item.name, item.cacheKey]), programs: (options.programs ?? []).map(item => [item.name, item.buildId, item.endpoint, item.installPath]), coverage: options.coverage === true, environment: declaredEnvironment(context)});
  const cacheEnabled = options.environment.rootfs?.cache?.enabled !== false;
  const cacheRoot = path.resolve(context.project.configDir, cacheEnabled ? (options.environment.rootfs?.cache?.directory ?? path.join(context.project.cacheDir, "rootfs")) : context.project.workDir);
  const directory = path.join(cacheRoot, key);
  const archive = path.join(directory, "rootfs.cpio");
  const endpoints = new Map<string, { type: "kernel" | "process"; buildId: string }>([["kernel", { type: "kernel", buildId: key }], ...(options.programs ?? []).map((item) => [item.endpoint, { type: "process" as const, buildId: item.buildId }] as const)]);
  if (cacheEnabled) {
    if (await validBuildOutput(directory, key, ["rootfs.cpio"])) return {kernelPath: path.join(options.kernelOutput, options.environment.kernel.target ?? "linux"), rootfsPath: archive, buildId: key, endpoints, cacheHit: true};
  }
  await rm(directory, { recursive: true, force: true });
  await mkdir(cacheRoot, { recursive: true });
  const temporary = await mkdtemp(path.join(cacheRoot, `.${key.slice(0, 12)}-`));
  try {
    const root = path.join(temporary, "root");
    for (const item of ["bin", "dev", "etc/cautest", "mnt/cautest-coverage", "opt/cautest/bin", "opt/cautest/modules", "proc", "sys", "tmp"]) await mkdir(path.join(root, item), { recursive: true });
    await copyFile(options.busybox.path, path.join(root, "bin/busybox")); await chmod(path.join(root, "bin/busybox"), 0o755);
    for (const applet of ["sh", "mount", "insmod", "poweroff", "reboot"]) await symlink("busybox", path.join(root, "bin", applet));
    await copyFile(agent.path, path.join(root, "opt/cautest/bin/agent")); await chmod(path.join(root, "opt/cautest/bin/agent"), 0o755);
    for (const [index, module] of options.modules.entries()) await copyFile(module.module, path.join(root, "opt/cautest/modules", `${String(index).padStart(2, "0")}-${module.name}.ko`));
    for (const program of options.programs ?? []) { const target = path.join(root, program.installPath.replace(/^\/+/, "")); await mkdir(path.dirname(target), { recursive: true }); await copyFile(program.path, target); await chmod(target, 0o755); }
    for (const overlay of overlays) await cp(path.resolve(context.project.configDir, overlay), root, { recursive: true, force: true });
    const catalog = [`build_id=${key}`, `kernel\tkernel\t${key}\t/dev/cautest`, ...(options.programs ?? []).map((item) => `${item.endpoint}\tprocess\t${item.buildId}\t${item.installPath}`), ""].join("\n");
    await writeFile(path.join(root, "etc/cautest/catalog"), catalog);
    const coverage = options.coverage ? `/bin/busybox mkdir -p /sys/kernel/debug\nmount -t debugfs debugfs /sys/kernel/debug\ncoverage_dir=$(/bin/busybox sed -n 's/.*cautest.coverage_dir=\\([^ ]*\\).*/\\1/p' /proc/cmdline)\n[ -n "$coverage_dir" ] || exec /bin/sh\nmount -t hostfs none /mnt/cautest-coverage -o "$coverage_dir" || exec /bin/sh\n` : "";
    await writeFile(path.join(root, "init"), `#!/bin/sh\nmount -t devtmpfs devtmpfs /dev\nmount -t proc proc /proc\nmount -t sysfs sysfs /sys\n${coverage}for module in /opt/cautest/modules/*.ko; do insmod "$module" || exec /bin/sh; done\necho "cautest: modules loaded" >/dev/console\nexec /opt/cautest/bin/agent /dev/ttyS0 /etc/cautest/catalog\n`); await chmod(path.join(root, "init"), 0o755);
    await cpio(root, path.join(temporary, "rootfs.cpio"), options.environment.rootfs?.cpio ?? "cpio", context.signal, effectiveEnvironment(context));
    await publishBuildOutput(temporary, key, ["rootfs.cpio"]);
    await mkdir(path.dirname(directory), { recursive: true });
    try { await rename(temporary, directory); } catch (cause) { if (!await validBuildOutput(directory, key, ["rootfs.cpio"])) throw cause; }
  } finally { await rm(temporary, { recursive: true, force: true }); }
  return { kernelPath: path.join(options.kernelOutput, options.environment.kernel.target ?? "linux"), rootfsPath: archive, buildId: key, endpoints, cacheHit: false };
}

/** 启动 UML 并等待 Guest Agent 用 Catalog Build ID 报告 Ready。 */
export async function startUml(name: string, image: UmlImageArtifact, environment: UmlKernelEnvironmentInput, context: StepExecutionContext, coverageDir?: string): Promise<UmlRuntimeResource> {
  context.signal.throwIfAborted();
  if (coverageDir !== undefined) { if (/\s/u.test(coverageDir)) throw new CautestError("Kernel Coverage 路径不能含空白", { code: "config_error" }); await mkdir(coverageDir, { recursive: true }); }
  const args = [`mem=${environment.machine?.memory ?? "256M"}`, `initrd=${image.rootfsPath}`, "root=/dev/ram0", "rw", "init=/init", "con=null", "con0=fd:0,fd:1", "ssl=null", "ssl0=fd:3,fd:3", ...(coverageDir === undefined ? [] : [`cautest.coverage_dir=${coverageDir}`]), ...(environment.machine?.kernelArgs ?? [])];
  context.signal.throwIfAborted();
  const grouped = process.platform !== "win32";
  const child = spawn(image.kernelPath, args, { cwd: context.project.configDir, env: effectiveEnvironment(context), stdio: ["ignore", "pipe", "pipe", "pipe"], detached: grouped });
  const stopProcess = ownedProcessStop(child, grouped);
  const stdout: Buffer[] = []; const stderr: Buffer[] = [];
  child.stdout?.on("data", (chunk: Buffer) => { stdout.push(chunk); context.output("stdout", chunk.toString("utf8")); }); child.stderr?.on("data", (chunk: Buffer) => { stderr.push(chunk); context.output("stderr", chunk.toString("utf8")); });
  const channel = child.stdio[3];
  if (channel === null || typeof channel === "number") {await stopProcess(); throw new CautestError("UML fd3 Control Channel 创建失败", { code: "provision_error" });}
  const control = new UmlControlChannel(channel as Duplex);
  child.once("error", cause => control.fail(new CautestError(`UML 启动失败: ${cause.message}`, {code: "provision_error", cause})));
  child.once("exit", (code, signal) => control.fail(new CautestError(`UML 已退出: code=${code}, signal=${signal}\n${Buffer.concat(stderr).toString("utf8")}`, { code: "transport_error" })));
  let stopping: Promise<void> | undefined;
  const stop = () => stopping ??= (async () => {
    context.signal.removeEventListener("abort", abort);
    await stopProcess(); await control.close().catch(() => {});
    if (context.resources.has("uml", name)) context.resources.close("uml", name);
  })();
  const abort = () => {control.fail(context.signal.reason instanceof Error ? context.signal.reason : new Error("UML 已取消")); void stop().catch(() => {});};
  const resource = { child, control, stdout, stderr, buildId: image.buildId, stop } satisfies UmlRuntimeResource;
  context.state.set(`uml:${name}`, resource);
  context.resources.publish({ kind: "uml", name, state: "starting", handle: resource, metadata: { buildId: image.buildId, kernelPath: image.kernelPath, rootfsPath: image.rootfsPath, ...(coverageDir === undefined ? {} : { coverageDir }) } });
  context.defer(stop, `stop-uml:${name}`);
  context.signal.addEventListener("abort", abort, {once: true});
  if (context.signal.aborted) abort();
  try {
    const ready = await control.waitReady(environment.machine?.readyTimeoutMs ?? 30_000);
    context.signal.throwIfAborted();
    if (ready.buildId !== image.buildId) throw new CautestError(`UML Catalog Build ID 不匹配: expected=${image.buildId}, actual=${ready.buildId}`, { code: "target_error" });
    context.resources.ready("uml", name);
  } catch (error) {
    const lifecycle = context.resources.get("uml", name);
    if (lifecycle.state === "starting" || lifecycle.state === "ready") context.resources.fail("uml", name, {message: error instanceof Error ? error.message : String(error)});
    await stop().catch(() => {});
    throw error;
  }
  return resource;
}

export async function runUmlEndpoint(name: string, endpoint: string, image: UmlImageArtifact, run: CTestRunInput, context: StepExecutionContext): ReturnType<typeof runCtpSession> {
  const resource = context.state.get(`uml:${name}`) as UmlRuntimeResource | undefined;
  if (resource === undefined) throw new CautestError(`UML Resource 不存在: ${name}`, { code: "transport_error" });
  const target = image.endpoints.get(endpoint);
  if (target === undefined) throw new CautestError(`UML Catalog 不存在 Endpoint: ${endpoint}`, { code: "config_error" });
  const artifactName = `${name}-${endpoint.replace(/[^A-Za-z0-9_-]/gu, "-")}-target`;
  const targetFile = path.join(context.project.resultDir, name, `${artifactName}.log`);
  const targetLogs: string[] = [];
  await mkdir(path.dirname(targetFile), { recursive: true });
  try {
    return await runCtpSession({
      transport: resource.control.openEndpoint(endpoint),
      expectedBuildId: run.expectedBuildId ?? target.buildId,
      run,
      signal: context.signal,
      onEvent: workflowSessionEventSink(context.events, context.job.id),
      onLog(log) { targetLogs.push(`[${log.level}] ${log.scope}: ${log.message}`); return `${targetFile}:${targetLogs.length}`; },
    });
  } finally {
    await writeFile(targetFile, `${targetLogs.join("\n")}${targetLogs.length === 0 ? "" : "\n"}`);
    if (!context.artifacts.has("log", artifactName)) context.artifacts.publish({ kind: "log", name: artifactName, path: targetFile, metadata: { source: "ctp-target", endpoint } });
  }
}

/** 尽力关闭 Agent/UML，并将 Console 与 Host stderr 持久化到结果目录。 */
export async function collectUml(name: string, context: StepExecutionContext): Promise<readonly unknown[]> {
  const resource = context.state.get(`uml:${name}`) as UmlRuntimeResource | undefined;
  if (resource === undefined) return [{ code: "uml_not_started", message: name }];
  try { await resource.control.command("GOODBYE", (line) => line === "BYE", 500); } catch { /* best effort */ }
  try { await resource.control.command("SHUTDOWN", () => false, 50); } catch { /* agent may exit first */ }
  await resource.stop();
  await mkdir(context.project.resultDir, { recursive: true });
  const consolePath = path.join(context.project.resultDir, `${name}-console.log`); const errorPath = path.join(context.project.resultDir, `${name}-host-stderr.log`);
  await Promise.all([writeFile(consolePath, Buffer.concat(resource.stdout)), writeFile(errorPath, Buffer.concat(resource.stderr))]);
  if (!context.artifacts.has("log", `${name}-console`)) context.artifacts.publish({ kind: "log", name: `${name}-console`, path: consolePath, metadata: { source: "uml-console" } });
  if (!context.artifacts.has("log", `${name}-host-stderr`)) context.artifacts.publish({ kind: "log", name: `${name}-host-stderr`, path: errorPath, metadata: { source: "uml-host-stderr" } });
  await resource.control.close().catch(() => {});
  const lifecycle = context.resources.get("uml", name);
  if (lifecycle.state !== "closed") context.resources.close("uml", name);
  return [{ code: "uml_logs", message: consolePath }, { code: "uml_host_stderr", message: errorPath }];
}
