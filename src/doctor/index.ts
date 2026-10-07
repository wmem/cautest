import { execFile } from "node:child_process";
import { constants, existsSync } from "node:fs";
import { access, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { ResolvedTestConfigDefaults, TestJob, WorkflowStep } from "../config/schema/index.js";
import { expandFilePatterns } from "../config/file-pattern.js";

export interface DoctorIssue { readonly code: string; readonly severity: "error" | "warning"; readonly jobId: string; readonly step: string; readonly message: string; readonly hint: string }

async function exists(location: string): Promise<boolean> { try { await access(location); return true; } catch { return false; } }
function patterns(value: unknown): readonly string[] { return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : []; }
const execFileAsync = promisify(execFile);
const cKitHeader = fileURLToPath(new URL("../../assets/cautest-c/include/cautest/cautest.h", import.meta.url));

function issue(code: string, jobId: string, step: string, message: string, hint: string): DoctorIssue {
  return { code, severity: "error", jobId, step, message, hint };
}

async function executable(program: string, cwd: string, env: NodeJS.ProcessEnv, jobId: string, step: string, label: string): Promise<DoctorIssue | undefined> {
  try {
    if (label === "Linux bc") {
      // --version is a GNU extension, not a calculator capability probe.
      // The BusyBox bc applet is usable for kernel/time/timeconst.bc too.
      const directory = await mkdtemp(path.join(os.tmpdir(), "cautest-bc-probe-"));
      try {
        const script = path.join(directory, "probe.bc");
        await writeFile(script, "scale=0\n2^64\nquit\n");
        const result = await execFileAsync(program, [script], {cwd, env, timeout: 5_000, maxBuffer: 1024 * 1024});
        if (result.stdout.trim() !== "18446744073709551616") throw new Error("bc arbitrary-precision arithmetic probe returned an unexpected result");
      } finally { await rm(directory, {recursive: true, force: true}); }
    } else await execFileAsync(program, ["--version"], { cwd, env, timeout: 5_000, maxBuffer: 1024 * 1024 });
    return undefined;
  }
  catch (error) { return issue("CT-DOCTOR-TOOL-001", jobId, step, `${label} 不可执行: ${program} (${error instanceof Error ? error.message : String(error)})`, `安装 ${label} 或修正该 Step 的工具路径/PATH`); }
}

async function compileProbe(compiler: string, cwd: string, env: NodeJS.ProcessEnv, options: { readonly staticLink?: boolean; readonly run?: boolean }, jobId: string, step: string): Promise<DoctorIssue | undefined> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cautest-doctor-"));
  const source = path.join(directory, "probe.c");
  const output = path.join(directory, "probe");
  try {
    await writeFile(source, options.run === true ? "#include <sys/ptrace.h>\nint main(void){return ptrace(PTRACE_TRACEME,0,0,0)==-1;}\n" : "int main(void){return 0;}\n");
    await execFileAsync(compiler, [...(options.staticLink === true ? ["-static"] : []), source, "-o", output], { cwd, env, timeout: 10_000, maxBuffer: 1024 * 1024 });
    if (options.run === true) await execFileAsync(output, [], { cwd, env, timeout: 5_000, maxBuffer: 1024 * 1024 });
    return undefined;
  } catch (error) {
    const stderr = typeof error === "object" && error !== null && "stderr" in error ? String(error.stderr) : error instanceof Error ? error.message : String(error);
    const kind = options.run === true ? "UML ptrace Probe" : "静态链接 Probe";
    return issue(options.run === true ? "CT-DOCTOR-UML-PTRACE-001" : "CT-DOCTOR-STATIC-001", jobId, step, `${kind} 失败: ${stderr.trim().split("\n").slice(-2).join(" | ")}`, options.run === true ? "在允许 ptrace(PTRACE_TRACEME) 的 Host/Container 运行 UML" : "安装静态 libc/toolchain，或为 Guest/BusyBox 显式关闭 static");
  } finally { await rm(directory, { recursive: true, force: true }); }
}

async function writableDirectory(target: string): Promise<boolean> {
  let candidate = path.resolve(target);
  for (;;) {
    try { const info = await stat(candidate); if (!info.isDirectory()) return false; await access(candidate, constants.R_OK | constants.W_OK); return true; }
    catch (error) { if (typeof error !== "object" || error === null || !("code" in error) || error.code !== "ENOENT") return false; }
    const parent = path.dirname(candidate);
    if (parent === candidate) return false;
    candidate = parent;
  }
}

async function hostChecks(jobs: readonly TestJob[], configDir: string, defaults: Readonly<ResolvedTestConfigDefaults>): Promise<readonly DoctorIssue[]> {
  const issues: DoctorIssue[] = [];
  const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
  if (major < 20 || (major === 20 && minor < 6)) issues.push(issue("CT-DOCTOR-NODE-001", "host", "node", `Node.js 版本过低: ${process.version}`, "使用 Node.js >= 20.6"));
  if (!await exists(cKitHeader)) issues.push(issue("CT-DOCTOR-C-KIT-001", "host", "c-kit", `C Test Kit Header 不存在: ${cKitHeader}`, "重新安装完整 Cautest 便携包"));
  for (const [name, configured] of [["result", defaults.resultDir], ["cache", defaults.cacheDir], ["generated", defaults.generatedDir], ["work", defaults.workDir]] as const) {
    const target = path.resolve(configDir, configured);
    if (!await writableDirectory(target)) issues.push(issue("CT-DOCTOR-DIRECTORY-001", "host", name, `受管目录不可写且无法创建: ${target}`, "修正目录所有权/权限或 defaults 路径"));
  }
  const tools = new Map<string, { program: string; job: TestJob; step: WorkflowStep; label: string }>();
  const staticCompilers = new Map<string, { compiler: string; job: TestJob; step: WorkflowStep }>();
  let ptrace: { job: TestJob; step: WorkflowStep } | undefined;
  for (const job of jobs) for (const step of job.workflow) {
    const details = step.details;
    if(step.kind==="physicalResourceLock")tools.set("flock",{program:"flock",job,step,label:"Linux flock"});
    if (["kernelBuild", "busyboxBuild", "kernelModuleBuild", "generatedKernelTestModule"].includes(step.kind)) tools.set(`make:${String(details.make ?? "make")}`, { program: String(details.make ?? "make"), job, step, label: "Make" });
    if (["nativeCompile", "driverGuestCTestBuild", "umlGuestProgramBuild", "mcuFirmwareBuild"].includes(step.kind)) {
      const compiler = String(details.compiler ?? "cc");
      tools.set(`compiler:${compiler}`, { program: compiler, job, step, label: "C Compiler" });
      if (step.kind === "nativeCompile") {
        tools.set("make", { program: "make", job, step, label: "Make" });
        if (typeof details.linker === "string") tools.set(`linker:${details.linker}`, { program: details.linker, job, step, label: "C Linker" });
      }
      if ((step.kind === "driverGuestCTestBuild" || step.kind === "umlGuestProgramBuild") && details.static !== false) staticCompilers.set(compiler, { compiler, job, step });
    }
    if ((step.kind === "nativeCoverage" || step.kind === "kernelCoverage") && typeof details.tool === "string") tools.set(`gcov:${details.tool}`, { program: details.tool, job, step, label: "GCOV" });
    if (step.kind === "umlRootfsBuild") tools.set(`cpio:${String(details.cpio ?? "cpio")}`, { program: String(details.cpio ?? "cpio"), job, step, label: "CPIO" });
    if (step.kind === "busyboxBuild" && details.static !== false) staticCompilers.set("cc", { compiler: "cc", job, step });
    if (step.kind === "umlStart") ptrace ??= { job, step };
    if (step.kind === "kernelBuild" && typeof details.sourceDir === "string") {
      const source = path.resolve(configDir, details.sourceDir);
      // Only a real Linux source layout needs Kconfig generators. This also keeps
      // arbitrary custom build Steps and pure declaration fixtures meaningful.
      if (requireExists(source, "scripts/kconfig/Makefile")) {
        for (const program of ["flex", "bison", "bc"]) tools.set(`linux:${program}:${job.id}`, {program, job, step, label: `Linux ${program}`});
      }
      const dirty = [".config", "include/config/auto.conf", "include/generated/autoconf.h"].filter((file) => requireExists(source, file));
      if (dirty.length > 0) issues.push(issue("CT-DOCTOR-KERNEL-DIRTY-001", job.id, step.kind, `Kernel 源码树包含 in-tree 构建状态: ${dirty.join(", ")}`, "使用干净源码树；Cautest 不会自动执行 mrproper"));
    }
  }
  for (const { program, job, step, label } of tools.values()) { const found = await executable(program, configDir, { ...process.env, ...job.env }, job.id, step.kind, label); if (found !== undefined) issues.push(found); }
  for (const { compiler, job, step } of staticCompilers.values()) { const found = await compileProbe(compiler, configDir, { ...process.env, ...job.env }, { staticLink: true }, job.id, step.kind); if (found !== undefined) issues.push(found); }
  if (ptrace !== undefined) { const found = await compileProbe("cc", configDir, { ...process.env, ...ptrace.job.env }, { run: true }, ptrace.job.id, ptrace.step.kind); if (found !== undefined) issues.push(found); }
  return Object.freeze(issues);
}

function requireExists(root: string, relative: string): boolean {
  return existsSync(path.join(root, relative));
}

async function checkPatterns(job: TestJob, step: WorkflowStep, field: string, configDir: string, issues: DoctorIssue[]): Promise<void> {
  const value = patterns(step.details[field]);
  if (value.length === 0) return;
  try { await expandFilePatterns(value, { baseDir: configDir, label: `jobs.${job.id}.${field}` }); }
  catch (error) { issues.push({ code: "CT-DOCTOR-INPUT-001", severity: "error", jobId: job.id, step: step.kind, message: error instanceof Error ? error.message : String(error), hint: `修正 ${field} 路径或 Glob，确保至少匹配一个普通文件` }); }
}

/** 在任何 Workflow Executor 启动前检查昂贵 Job 的静态输入。 */
export async function doctorJobs(jobs: readonly TestJob[], configDir: string, defaults: Readonly<ResolvedTestConfigDefaults> = { resultDir: ".cautest/results", cacheDir: ".cautest/cache", generatedDir: ".cautest/generated", workDir: ".cautest/work", stepTimeoutMs: 60_000 }): Promise<readonly DoctorIssue[]> {
  const issues: DoctorIssue[] = [];
  for (const job of jobs) {
    for (const step of job.workflow) if (step.kind === "xmakeUnsupported") issues.push({code:"CT-DOCTOR-XMAKE-UNSUPPORTED",severity:"error",jobId:job.id,step:step.kind,message:`Xmake ${String(step.details.platform)} artifact runtime is not implemented`,hint:"Use the existing standalone JS helper; this platform gate remains blocked"});
    const builtModules = new Set<string>();
    for (const step of job.workflow) {
      for (const field of ["tests", "sources", "headers", "inputs", "extraSymbols", "configFragments"]) await checkPatterns(job, step, field, configDir, issues);
      if ((step.kind === "kernelBuild" || step.kind === "busyboxBuild") && step.timeoutMs === undefined && defaults.stepTimeoutMs === 60_000) {
        const label = step.kind === "kernelBuild" ? "Kernel" : "BusyBox";
        const field = step.kind === "kernelBuild" ? "kernel.timeoutMs" : "busybox.timeoutMs";
        const example = step.kind === "kernelBuild" ? "20 * 60_000" : "10 * 60_000";
        issues.push({
          code: "CT-DOCTOR-TIMEOUT-001",
          severity: "warning",
          jobId: job.id,
          step: step.kind,
          message: `${label} Build 未设置专用 timeoutMs，将继承通用 60 秒 Step 默认值`,
          hint: `在 umlKernelEnvironment() 的 ${field} 设置首次构建超时（例如 ${example}）；--run-timeout 只控制 C Test Run`,
        });
      }
      const file = step.details.file;
      if (typeof file === "string" && !await exists(path.resolve(configDir, file))) issues.push({ code: "CT-DOCTOR-INPUT-002", severity: "error", jobId: job.id, step: step.kind, message: `文件不存在: ${file}`, hint: "修正配置文件路径" });
      const sourceDir = step.details.sourceDir;
      if (typeof sourceDir === "string" && step.details.builtIn !== true && step.name !== "cautest_kernel") {
        const directory = path.resolve(configDir, sourceDir);
        let directoryValid = false;
        try { directoryValid = (await stat(directory)).isDirectory(); } catch { /* issue below */ }
        if (!directoryValid) issues.push({ code: "CT-DOCTOR-KMOD-001", severity: "error", jobId: job.id, step: step.kind, message: `sourceDir 不存在或不是目录: ${sourceDir}`, hint: "修正 Module/Kernel/BusyBox sourceDir" });
        else if (step.kind === "kernelModuleBuild" && !await exists(path.join(directory, "Makefile")) && !await exists(path.join(directory, "Kbuild"))) issues.push({ code: "CT-DOCTOR-KMOD-002", severity: "error", jobId: job.id, step: step.kind, message: `Kernel Module 缺少 Makefile/Kbuild: ${sourceDir}`, hint: "添加 Kbuild 或使用自动生成 Kernel Test Module" });
      }
      for (const [kind, value] of [["Kernel", step.details.kernel], ["BusyBox", step.details.busybox]] as const) {
        if (typeof value !== "object" || value === null || !("sourceDir" in value) || typeof value.sourceDir !== "string") continue;
        const directory = path.resolve(configDir, value.sourceDir);
        let valid = false;
        try { valid = (await stat(directory)).isDirectory(); } catch { /* issue below */ }
        if (!valid) issues.push({ code: "CT-DOCTOR-ENV-001", severity: "error", jobId: job.id, step: step.kind, message: `${kind} sourceDir 不存在或不是目录: ${value.sourceDir}`, hint: `修正公共 UML Environment 的 ${kind.toLowerCase()}.sourceDir` });
        else if (!await exists(path.join(directory, "Makefile"))) issues.push({ code: "CT-DOCTOR-ENV-002", severity: "error", jobId: job.id, step: step.kind, message: `${kind} 源码目录缺少 Makefile: ${value.sourceDir}`, hint: `确认 ${kind} sourceDir 指向源码根目录` });
        if ("configFragments" in value && Array.isArray(value.configFragments)) {
          try { await expandFilePatterns(value.configFragments as readonly string[], { baseDir: configDir, label: `jobs.${job.id}.${kind.toLowerCase()}.configFragments` }); }
          catch (error) { issues.push({ code: "CT-DOCTOR-INPUT-001", severity: "error", jobId: job.id, step: step.kind, message: error instanceof Error ? error.message : String(error), hint: `修正公共 UML Environment 的 ${kind.toLowerCase()}.configFragments` }); }
        }
      }
      for (const inputRoot of patterns(step.details.inputRoots)) {
        try { if (!(await stat(path.resolve(configDir, inputRoot))).isDirectory()) throw new Error(); }
        catch { issues.push({ code: "CT-DOCTOR-KMOD-005", severity: "error", jobId: job.id, step: step.kind, message: `inputRoots 不存在或不是目录: ${inputRoot}`, hint: "修正 Kernel Module inputRoots" }); }
      }
      if (step.kind === "kernelModuleBuild") {
        const output = step.details.output;
        if (typeof output !== "string" || path.isAbsolute(output) || !output.endsWith(".ko") || output.split(/[\\/]/u).includes("..")) issues.push({ code: "CT-DOCTOR-KMOD-003", severity: "error", jobId: job.id, step: step.kind, message: `Kernel Module output 无效: ${String(output)}`, hint: "output 必须是 Module 目录内的相对 .ko 路径" });
        for (const dependency of patterns(step.details.extraModules)) if (!builtModules.has(dependency)) issues.push({ code: "CT-DOCTOR-KMOD-004", severity: "error", jobId: job.id, step: step.kind, message: `extraModules 依赖不存在或顺序错误: ${dependency}`, hint: "把依赖 Module 放在当前 Module 之前并使用其 name" });
        builtModules.add(step.name);
      }
    }
  }
  issues.push(...await hostChecks(jobs, configDir, defaults));
  return Object.freeze(issues);
}
