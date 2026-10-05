import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ExecutedRun } from "../result/run.js";

function escapeXml(value: unknown): string {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function caseCount(run: ExecutedRun, status: string): number {
  return run.jobs.flatMap((job) => job.groups).flatMap((group) => group.cases).filter((item) => item.status === status).length;
}

function bounded(value: unknown, limit = 500): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return (text ?? String(value)).length <= limit ? (text ?? String(value)) : `${(text ?? String(value)).slice(0, limit)}…`;
}

function caseEvidence(item: ExecutedRun["jobs"][number]["groups"][number]["cases"][number]): string {
  const assertion = item.assertions.find((value) => value.status === "FAIL" || value.status === "ERROR");
  if (assertion !== undefined) {
    const location = assertion.file === undefined ? "" : ` at ${assertion.file}${assertion.line === undefined ? "" : `:${assertion.line}`}`;
    const values = assertion.expected === undefined && assertion.actual === undefined ? "" : ` expected=${bounded(assertion.expected)} actual=${bounded(assertion.actual)}`;
    return `${assertion.expression}${location}${values}`;
  }
  const diagnostic = item.diagnostics[0] ?? item.error;
  const scriptFailure = item.failures?.[0];
  if (scriptFailure !== undefined) return `${scriptFailure.message}${scriptFailure.expected === undefined && scriptFailure.actual === undefined ? "" : ` expected=${bounded(scriptFailure.expected)} actual=${bounded(scriptFailure.actual)}`}`;
  return diagnostic === undefined ? `${item.status}` : bounded(diagnostic);
}

/** 生成适合终端和纯文本 Artifact 的 Run 摘要。 */
export function formatConsoleReport(run: ExecutedRun): string {
  const lines = [`Run ${run.id}: ${run.status} (${Math.round(run.durationMs)}ms)`];
  for (const job of [...run.jobs, ...(run.collectors ?? [])]) {
    lines.push(`${job.status} ${job.jobId} (${Math.round(job.durationMs)}ms)`);
    for (const group of job.groups) for (const item of group.cases) {
      lines.push(`  ${item.status} ${group.name}/${item.name}`);
      if (item.status === "FAIL" || item.status === "ERROR") lines.push(`    ${caseEvidence(item)}`);
    }
    for (const error of job.errors) lines.push(`  ERROR [${error.code}] ${error.message}`);
  }
  lines.push(`Cases: PASS ${caseCount(run, "PASS")}, FAIL ${caseCount(run, "FAIL")}, ERROR ${caseCount(run, "ERROR")}, SKIP ${caseCount(run, "SKIP")}`);
  return `${lines.join("\n")}\n`;
}

/** 生成 CI 可读取的 JUnit XML；基础设施错误使用独立 testcase 保留。 */
export function formatJUnitReport(run: ExecutedRun): string {
  const suites = [...run.jobs, ...(run.collectors ?? [])].map((job) => {
    const cases = job.groups.flatMap((group) => group.cases.map((item) => {
      const evidence = caseEvidence(item);
      const body = item.status === "FAIL" ? `<failure message="${escapeXml(`${group.name}/${item.name} FAIL`)}">${escapeXml(evidence)}</failure>`
        : item.status === "ERROR" ? `<error message="${escapeXml(`${group.name}/${item.name} ERROR`)}">${escapeXml(evidence)}</error>`
          : item.status === "SKIP" ? "<skipped/>" : "";
      return `<testcase classname="${escapeXml(group.name)}" name="${escapeXml(item.name)}" time="${((item.durationMs ?? 0) / 1000).toFixed(6)}">${body}</testcase>`;
    }));
    for (const [index, error] of job.errors.entries()) cases.push(`<testcase classname="${escapeXml(job.jobId)}" name="infrastructure-${index + 1}"><properties><property name="infrastructure" value="true"/></properties><error message="${escapeXml(error.message)}">${escapeXml(error.stack ?? "")}</error></testcase>`);
    const allCases = job.groups.flatMap((group) => group.cases);
    return `<testsuite name="${escapeXml(job.jobId)}" tests="${cases.length}" failures="${allCases.filter((item) => item.status === "FAIL").length}" errors="${allCases.filter((item) => item.status === "ERROR").length + job.errors.length}" skipped="${allCases.filter((item) => item.status === "SKIP").length}" time="${(job.durationMs / 1000).toFixed(6)}">${cases.join("")}</testsuite>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites name="cautest" tests="${[...run.jobs, ...(run.collectors ?? [])].reduce((count, job) => count + job.groups.reduce((sum, group) => sum + group.cases.length, 0) + job.errors.length, 0)}">${suites.join("")}</testsuites>\n`;
}

/** 生成单文件、无外部依赖的可导航 HTML 报告。 */
export function formatHtmlReport(run: ExecutedRun): string {
  const jobs = [...run.jobs, ...(run.collectors ?? [])].map((job) => `<section><h2>${escapeXml(job.jobId)} — ${escapeXml(job.status)}</h2><h3>Step 时间线</h3><ol>${job.steps.map((step) => `<li class="${escapeXml(step.status)}"><code>${escapeXml(step.id)}</code> ${escapeXml(step.status)} ${Math.round(step.durationMs)}ms</li>`).join("")}</ol><h3>Cases</h3><table><thead><tr><th>Suite</th><th>Case</th><th>Status</th></tr></thead><tbody>${job.groups.flatMap((group) => group.cases.map((item) => `<tr data-status="${escapeXml(item.status)}"><td>${escapeXml(group.name)}</td><td>${escapeXml(item.name)}</td><td>${escapeXml(item.status)}</td></tr>`)).join("")}</tbody></table><h3>Artifacts / Logs</h3><ul>${job.artifacts.map((artifact) => `<li>${escapeXml(`${artifact.kind}:${artifact.name}`)} — <code>${escapeXml(artifact.path)}</code></li>`).join("")}</ul>${job.errors.length === 0 ? "" : `<h3>Infrastructure 诊断</h3><pre>${escapeXml(job.errors.map((error) => `[${error.code}] ${error.message}`).join("\n"))}</pre>`}</section>`).join("");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Cautest ${escapeXml(run.id)}</title><style>body{font:14px system-ui,sans-serif;max-width:1200px;margin:auto;padding:24px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ddd;padding:6px}.SUCCESS,.PASS{color:#08783e}.FAIL{color:#b26a00}.ERROR{color:#b00020}</style></head><body><h1>Cautest Run ${escapeXml(run.id)} — ${escapeXml(run.status)}</h1>${jobs}</body></html>\n`;
}

/** 按 Profile 声明将附加报告写入已经创建的 Run 目录。 */
export async function writeReports(run: ExecutedRun, directory: string, reporters: readonly string[]): Promise<readonly string[]> {
  await mkdir(directory, { recursive: true });
  const outputs: string[] = [];
  for (const reporter of [...new Set(reporters)]) {
    const file = reporter === "json" ? path.join(directory, "run.json") : reporter === "junit" ? path.join(directory, "junit.xml") : reporter === "html" ? path.join(directory, "report.html") : reporter === "console" ? path.join(directory, "console.txt") : undefined;
    if (file === undefined) throw new Error(`未知 Reporter: ${reporter}`);
    const contents = reporter === "json" ? `${JSON.stringify(run, null, 2)}\n` : reporter === "junit" ? formatJUnitReport(run) : reporter === "html" ? formatHtmlReport(run) : formatConsoleReport(run);
    await writeFile(file, contents);
    outputs.push(file);
  }
  return Object.freeze(outputs);
}
