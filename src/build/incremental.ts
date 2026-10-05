import path from "node:path";
import {mkdir, stat, rm} from "node:fs/promises";
import {fileState, writeChanged} from "../cache/file-state.js";
import {CautestError} from "../model/error.js";
import {runCommand} from "../runtime/process.js";

function shell(value: string): string { return `'${value.replaceAll("'", "'\\''")}'`; }
function makePath(value: string): string {
  if (/[\r\n]/u.test(value)) throw new CautestError("构建路径不能包含换行", {code: "config_error"});
  return value.replaceAll("\\", "\\\\").replaceAll("$", () => "$$").replaceAll("#", "\\#").replaceAll(" ", "\\ ").replaceAll("\t", "\\\t").replaceAll(":", "\\:");
}
function command(args: readonly string[]): string { return args.map(shell).join(" ").replaceAll("$", () => "$$"); }

/** 编译器生成真实头文件依赖，Make 负责时间戳与增量；Cautest 不扫描 include 目录。 */
export async function compileC(input: {
  compiler: string; sources: readonly string[]; directory: string; output: string;
  cflags?: readonly string[]; ldflags?: readonly string[]; dependencies?: readonly string[];
  env: NodeJS.ProcessEnv; signal: AbortSignal;
  onOutput?: (channel: "stdout" | "stderr", text: string) => void;
  rebuild?: boolean;
  relink?: boolean;
}): Promise<boolean> {
  const directory = path.resolve(input.directory), output = path.resolve(input.output);
  await mkdir(directory, {recursive: true}); await mkdir(path.dirname(output), {recursive: true});
  const objects = input.sources.map((_, index) => `source_${index}.o`);
  const flags = input.cflags ?? [];
  const lines = [".DELETE_ON_ERROR:", ".PHONY: all force-link", "force-link:", `all: ${makePath(output)}`];
  lines.push(`${makePath(output)}: ${objects.join(" ")} Makefile $(CAUTEST_RELINK)`, `\t${command([input.compiler, ...flags, ...objects, ...(input.ldflags ?? []), "-o", output])}`);
  for (const [index, source] of input.sources.entries()) {
    const object = objects[index]!;
    lines.push(`${object}: ${makePath(path.resolve(source))} Makefile ${(input.dependencies ?? []).map(file => makePath(path.resolve(file))).join(" ")}`,
      `\t${command([input.compiler, ...flags, "-MMD", "-MP", "-MF", `source_${index}.d`, "-MT", object, "-c", path.resolve(source), "-o", object])}`);
  }
  lines.push(`-include ${objects.map((_, index) => `source_${index}.d`).join(" ")}`, "");
  await writeChanged(path.join(directory, "Makefile"), lines.join("\n"));
  let previous: unknown;
  try { previous = await fileState(output); } catch { /* 首次构建没有输出。 */ }
  for (const object of objects) {
    try { await stat(path.join(directory, object)); } catch { continue; }
    try {
      await stat(path.join(directory, object.replace(/\.o$/u, ".d")));
      if (flags.includes("--coverage")) await stat(path.join(directory, object.replace(/\.o$/u, ".gcno")));
    } catch {
      // 对象没有依赖记录/覆盖率副产物时，让 Make 重新生成该对象。
      await rm(path.join(directory, object), {force: true});
    }
  }
  // 缺失覆盖率注记或禁用缓存时仍走同一条 Make 构建路径。
  const result = await runCommand({program: "make", args: ["--no-print-directory", ...(input.rebuild ? ["-B"] : []), ...(input.relink ? ["CAUTEST_RELINK=force-link"] : []), "all"], cwd: directory,
    env: input.env, signal: input.signal, ...(input.onOutput ? {onOutput: input.onOutput} : {})});
  if (result.exitCode !== 0) {
    // 不保留失败链接可能留下的目标；本轮绝不运行上一次输出。
    await rm(output, {force: true});
    throw new CautestError(`C 构建失败 (exit ${result.exitCode})\n${result.stderr}`, {code: "build_error"});
  }
  if (!(await stat(output)).isFile()) throw new CautestError(`构建缺少输出: ${output}`, {code: "build_error"});
  return previous !== undefined && JSON.stringify(previous) === JSON.stringify(await fileState(output));
}
