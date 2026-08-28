import { access, stat } from "node:fs/promises";
import path from "node:path";
import { executeRun, writeRunDirectory } from "../../dist/config/index.js";

const SOURCE_REQUIREMENTS = Object.freeze([
  Object.freeze({ name: "KERNEL_SRC", files: Object.freeze(["Makefile", "arch/um/Kconfig"]) }),
  Object.freeze({ name: "BUSYBOX_SRC", files: Object.freeze(["Makefile"]) }),
]);

async function sourceProblems(requirement, environment) {
  const configured = environment[requirement.name];
  if (typeof configured !== "string" || configured.trim().length === 0) {
    return [{ name: requirement.name, reason: "环境变量未设置" }];
  }
  const sourceDir = path.resolve(configured);
  try {
    if (!(await stat(sourceDir)).isDirectory()) return [{ name: requirement.name, path: sourceDir, reason: "不是目录" }];
    for (const file of requirement.files) await access(path.join(sourceDir, file));
    return [];
  } catch (error) {
    return [{
      name: requirement.name,
      path: sourceDir,
      reason: error instanceof Error ? error.message : String(error),
    }];
  }
}

/** 检查真实 UML 验收所需的源码树；不使用机器私有默认路径。 */
export async function inspectUmlPrerequisites(environment = process.env) {
  const problems = (await Promise.all(SOURCE_REQUIREMENTS.map((item) => sourceProblems(item, environment)))).flat();
  if (problems.length > 0) return Object.freeze({ ok: false, problems: Object.freeze(problems) });
  return Object.freeze({
    ok: true,
    kernelSource: path.resolve(environment.KERNEL_SRC),
    busyboxSource: path.resolve(environment.BUSYBOX_SRC),
  });
}

export function reportBlockedUml(prerequisites, command) {
  const report = {
    schemaVersion: 1,
    status: "BLOCKED",
    code: "uml_prerequisites_missing",
    command,
    problems: prerequisites.problems,
    required: ["KERNEL_SRC=<Linux source tree>", "BUSYBOX_SRC=<BusyBox source tree>"],
  };
  process.stderr.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = 77;
}

/** 执行真实 UML Job，持久化标准结果目录并只向 stdout 输出紧凑摘要。 */
export async function executeRealUml(config, project) {
  const resultRoot = path.join(project, ".cautest/results");
  const run = await executeRun(config, {
    configDir: project,
    resultDir: resultRoot,
    output(channel, value) { process.stderr.write(`[${channel}] ${value}`); },
  });
  const resultDir = await writeRunDirectory(run, resultRoot);
  const summary = {
    schemaVersion: run.schemaVersion,
    runId: run.id,
    status: run.status,
    resultDir,
    jobs: run.jobs.map((job) => ({
      id: job.jobId,
      status: job.status,
      groups: job.groups.length,
      cases: job.groups.flatMap((group) => group.cases).length,
      artifacts: job.artifacts.map((artifact) => `${artifact.kind}:${artifact.name}`),
    })),
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (run.status !== "SUCCESS") process.exitCode = run.status === "FAIL" ? 1 : 2;
}
