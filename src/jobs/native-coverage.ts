import { copyFile, mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { NativeCoverageInput, StepExecutionContext, WorkflowStep } from "../config/schema/index.js";
import { CautestError } from "../model/error.js";
import { effectiveEnvironment } from "../runtime/environment.js";
import { runCommand } from "../runtime/process.js";
import { defineStep } from "../workflow/step.js";

export interface NativeCoverageNote { readonly path: string; }
export async function coverageFiles(root: string, extension: string): Promise<string[]> {
  const files: string[] = [];
  try {
    for (const entry of await readdir(root, { withFileTypes: true })) {
      const file = path.join(root, entry.name);
      if (entry.isDirectory()) files.push(...await coverageFiles(file, extension));
      else if (entry.isFile() && entry.name.endsWith(extension)) files.push(file);
    }
  } catch (cause) {
    if (!(typeof cause === "object" && cause !== null && "code" in cause && cause.code === "ENOENT")) throw cause;
  }
  return files.sort();
}

export function validateNativeCoverage(value: unknown): asserts value is NativeCoverageInput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new CautestError("Native coverage 必须是对象", { code: "config_error" });
  const fields = value as Record<string, unknown>;
  if (Object.keys(fields).some(key => !["tool", "timeoutMs"].includes(key))) throw new CautestError("Native coverage 包含未知字段", { code: "config_error" });
  if (fields.tool !== undefined && (typeof fields.tool !== "string" || !fields.tool.trim())) throw new CautestError("Native coverage.tool 必须是非空命令", { code: "config_error" });
  if (fields.timeoutMs !== undefined && (typeof fields.timeoutMs !== "number" || !Number.isFinite(fields.timeoutMs) || fields.timeoutMs <= 0)) throw new CautestError("Native coverage.timeoutMs 必须是正数", { code: "config_error" });
}

/** 旧编译入口和 Artifact 入口共用收集；每个 gcno 保留独立目录，避免同名源码串用。 */
export function nativeCoverageStep(options: {
  readonly name: string;
  readonly coverage: NativeCoverageInput;
  readonly rawLayout?: "flat" | "absolute";
  readonly notes: (context: StepExecutionContext) => Promise<readonly NativeCoverageNote[] | undefined>;
}): WorkflowStep {
  validateNativeCoverage(options.coverage);
  return defineStep({
    kind: "nativeCoverage", name: options.name, phase: "collect", runWhen: "always",
    ...(options.coverage.timeoutMs === undefined ? {} : { timeoutMs: options.coverage.timeoutMs }),
    details: { tool: options.coverage.tool ?? "gcov", artifactName: options.name },
    async execute(context) {
      const notes = await options.notes(context);
      if (notes === undefined) return { diagnostics: [{ code: "coverage_skipped", message: "Native Artifact 不存在" }] };
      if (!notes.length) throw new CautestError("GCOV Artifact 缺少 .gcno；Xmake 目标需要 cautest.gcov rule", { code: "cache_error" });
      const output = path.join(context.project.resultDir, "coverage", options.name);
      const objects = path.join(output, "objects");
      const reportsRoot = path.join(output, "reports");
      await rm(objects, { recursive: true, force: true });
      await rm(reportsRoot, { recursive: true, force: true });
      for (const [index, note] of notes.entries()) {
        if (!path.isAbsolute(note.path) || !note.path.endsWith(".gcno")) throw new CautestError("无效的 GCOV notes 路径", { code: "cache_error" });
        const directory = path.join(objects, String(index));
        const reportDir = options.rawLayout === "flat" ? output : path.join(reportsRoot, String(index));
        await mkdir(directory, { recursive: true });
        await mkdir(reportDir, { recursive: true });
        const localNote = path.join(directory, path.basename(note.path));
        await copyFile(note.path, localNote);
        // GCOV_PREFIX_STRIP=0 保留绝对路径的目录部分；读取本轮专用 raw，不读取构建目录的历史 gcda。
        const relative = path.relative(path.parse(note.path).root, note.path).replace(/\.gcno$/u, ".gcda");
        const data = path.join(output, "raw", options.rawLayout === "flat" ? path.basename(relative) : relative);
        try { await stat(data); await copyFile(data, localNote.replace(/\.gcno$/u, ".gcda")); }
        catch (cause) { if (!(typeof cause === "object" && cause !== null && "code" in cause && cause.code === "ENOENT")) throw cause; }
        const tool = options.coverage.tool ?? "gcov";
        const program = tool.includes(path.sep) ? path.resolve(context.project.configDir, tool) : tool;
        const args = [...(options.rawLayout === "flat" ? [] : ["-p"]), "-o", directory, localNote];
        const result = await runCommand({ program, args, cwd: reportDir,
          env: effectiveEnvironment(context), signal: context.signal, onOutput: context.output });
        if (result.exitCode !== 0) throw new CautestError(`GCOV 收集失败 (exit ${result.exitCode})`, { code: "build_error" });
      }
      const reports = await coverageFiles(options.rawLayout === "flat" ? output : reportsRoot, ".gcov");
      if (!reports.length) throw new CautestError("GCOV 未生成任何 .gcov 报告", { code: "build_error" });
      context.artifacts.publish({ kind: "coverage", name: options.name, path: output, metadata: { adapter: "gcov", reports } });
      return { diagnostics: [{ code: "coverage_collected", message: output, reports }] };
    },
  });
}
