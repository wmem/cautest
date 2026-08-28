import { access, stat } from "node:fs/promises";
import path from "node:path";
import type { TestJob, WorkflowStep } from "../config/schema/index.js";
import { expandFilePatterns } from "../config/file-pattern.js";

export interface DoctorIssue { readonly code: string; readonly severity: "error" | "warning"; readonly jobId: string; readonly step: string; readonly message: string; readonly hint: string }

async function exists(location: string): Promise<boolean> { try { await access(location); return true; } catch { return false; } }
function patterns(value: unknown): readonly string[] { return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : []; }

async function checkPatterns(job: TestJob, step: WorkflowStep, field: string, configDir: string, issues: DoctorIssue[]): Promise<void> {
  const value = patterns(step.details[field]);
  if (value.length === 0) return;
  try { await expandFilePatterns(value, { baseDir: configDir, label: `jobs.${job.id}.${field}` }); }
  catch (error) { issues.push({ code: "CT-DOCTOR-INPUT-001", severity: "error", jobId: job.id, step: step.kind, message: error instanceof Error ? error.message : String(error), hint: `修正 ${field} 路径或 Glob，确保至少匹配一个普通文件` }); }
}

/** 在任何 Workflow Executor 启动前检查昂贵 Job 的静态输入。 */
export async function doctorJobs(jobs: readonly TestJob[], configDir: string): Promise<readonly DoctorIssue[]> {
  const issues: DoctorIssue[] = [];
  for (const job of jobs) {
    const builtModules = new Set<string>();
    for (const step of job.workflow) {
      for (const field of ["tests", "sources", "headers", "files", "inputs", "extraSymbols"]) await checkPatterns(job, step, field, configDir, issues);
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
  return Object.freeze(issues);
}
