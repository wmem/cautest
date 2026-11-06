import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";
import type { ExecutedRun } from "../result/run.js";
type JobResult = ExecutedRun["jobs"][number];
const stepOnly = (job: JobResult): boolean => job.resultMode === "steps" && job.groups.every(group => group.cases.length === 0);
const hasCaseJobs = (run: ExecutedRun): boolean => run.jobs.some(job => !stepOnly(job));
const hasStepJobs = (run: ExecutedRun): boolean => run.jobs.some(job => job.resultMode === "steps");
function stepStatistics(run: ExecutedRun): string {
  const steps = run.jobs.flatMap(job => job.steps);
  return `步骤  ${steps.length}  成功 ${steps.filter(step => step.status === "SUCCESS").length}  失败 ${steps.filter(step => step.status === "FAIL").length}  错误 ${steps.filter(step => step.status === "ERROR").length}  跳过 ${steps.filter(step => step.status === "SKIPPED").length}`;
}

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

interface ConsoleReportOptions {
  readonly verbose?: boolean;
  readonly compact?: boolean;
  readonly plannedJobs?: number;
  readonly interrupted?: boolean;
  readonly resultDir?: string;
  readonly reportFiles?: readonly string[];
}

const summaryText = (value: string): string => stripVTControlCharacters(value).replace(/[\x00-\x1f\x7f]/gu, " ");

function durationText(durationMs: number): string {
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
  if (durationMs < 60_000) return `${(durationMs / 1000).toFixed(1)}s`;
  const seconds = Math.floor(durationMs / 1000);
  return [...(seconds >= 3600 ? [Math.floor(seconds / 3600)] : []), Math.floor(seconds / 60) % 60, seconds % 60]
    .map(value => String(value).padStart(2, "0")).join(":");
}

function formatTerminalSummary(run: ExecutedRun, options: ConsoleReportOptions): string {
  const planned = Math.max(run.jobs.length, options.plannedJobs ?? run.jobs.length);
  const jobCounts = ["SUCCESS", "FAIL", "ERROR", "SKIP"].map(status => run.jobs.filter(job => job.status === status).length);
  const caseCounts = ["PASS", "FAIL", "ERROR", "SKIP"].map(status => caseCount(run, status));
  const caseTotal = caseCounts.reduce((sum, count) => sum + count, 0);
  const lines = [
    `  结果  ${options.interrupted ? "已中断" : run.status}  ·  耗时 ${durationText(run.durationMs)}`,
    `  任务  ${run.jobs.length}/${planned}  成功 ${jobCounts[0]}  失败 ${jobCounts[1]}  错误 ${jobCounts[2]}  跳过 ${jobCounts[3]}${planned > run.jobs.length ? `  ·  未执行 ${planned - run.jobs.length}` : ""}`,
  ];
  if (hasStepJobs(run)) lines.push(`  ${stepStatistics(run)}`);
  if (hasCaseJobs(run)) lines.push(`  用例  ${caseTotal}  PASS ${caseCounts[0]}  FAIL ${caseCounts[1]}  ERROR ${caseCounts[2]}  SKIP ${caseCounts[3]}`);
  // A short index identifies failures without replaying evidence already printed live.
  const failures: string[] = [];
  let failureCount = 0;
  const addFailure = (failure: string): void => {
    failureCount++;
    if (failures.length < 5) failures.push(failure);
  };
  for (const job of [...run.jobs, ...(run.collectors ?? [])]) {
    let failedCases = 0;
    for (const group of job.groups) for (const item of group.cases) {
      if (item.status !== "FAIL" && item.status !== "ERROR") continue;
      failedCases++;
      addFailure(`[${item.status}] ${summaryText(job.jobId)} / ${summaryText(group.name)}/${summaryText(item.name)}`);
    }
    if (job.errors.length || !failedCases && (job.status === "FAIL" || job.status === "ERROR")) {
      const codes = [...new Set(job.errors.map(error => error.code))].join(", ");
      addFailure(`[${job.status}] ${summaryText(job.jobId)}${codes ? ` [${summaryText(codes)}]` : ""}`);
    }
  }
  if (failures.length) {
    lines.push("");
    for (const [index, failure] of failures.entries()) lines.push(`  ${index === 0 ? "失败" : "    "}  ${failure}`);
    if (failureCount > 5) lines.push(`        另有 ${failureCount - 5} 项，详见 failures.jsonl`);
  }
  if (options.resultDir || options.reportFiles?.length) {
    lines.push("");
    if (options.reportFiles?.length) lines.push(`  报告  ${options.reportFiles.map(file => summaryText(path.basename(file))).join("  ·  ")}`);
    if (options.resultDir) lines.push(`  目录  ${summaryText(options.resultDir)}`);
  }
  return `${lines.join("\n")}\n`;
}

/** 终端短摘要和完整 console.txt 共用入口；短摘要不重复运行时证据。 */
export function formatConsoleReport(run: ExecutedRun, options: ConsoleReportOptions = {}): string {
  if (options.compact) return formatTerminalSummary(run, options);
  const lines = [`Run ${run.id}: ${run.status} (${Math.round(run.durationMs)}ms)`];
  const jobs = [...run.jobs, ...(run.collectors ?? [])];
  for (const job of jobs) {
    const cases = job.groups.flatMap(group => group.cases);
    const statistics = stepOnly(job) ? `Steps ${job.steps.length} | ${["SUCCESS", "FAIL", "ERROR", "SKIPPED"].map(status => `${status} ${job.steps.filter(step => step.status === status).length}`).join("  ")}`
      : ["PASS", "FAIL", "ERROR", "SKIP"].map(status => `${status} ${cases.filter(item => item.status === status).length}`).join("  ");
    lines.push(`${job.status} ${job.jobId} (${Math.round(job.durationMs)}ms) | ${statistics}`);
    if (job.description) lines.push(`  ${job.description}`);
    if (stepOnly(job)) for (const step of job.steps) lines.push(`  ${step.status} ${step.phase}/${step.name}`);
  }
  // Keep evidence after all Job summaries, so later passing jobs cannot bury it.
  for (const job of jobs) {
    const showCase = (status: string): boolean => options.verbose === true || status === "FAIL" || status === "ERROR" || status === "SKIP";
    const visible = job.groups.some(group => group.cases.some(item => showCase(item.status)));
    if (visible || job.errors.length) lines.push(`明细 ${job.jobId}:`);
    for (const group of job.groups) for (const item of group.cases) {
      if (!showCase(item.status)) continue;
      lines.push(`  ${item.status} ${group.name}/${item.name}`);
      if (item.description) lines.push(`    目的：${item.description}`);
      if (item.expectedBehavior) lines.push(`    预期行为：${item.expectedBehavior}`);
      if (item.status === "FAIL" || item.status === "ERROR") lines.push(`    ${caseEvidence(item)}`);
    }
    for (const error of job.errors) lines.push(`  ERROR [${error.code}] ${error.message}`);
  }
  if (hasStepJobs(run)) lines.push(stepStatistics(run));
  if (hasCaseJobs(run)) lines.push(`Cases: PASS ${caseCount(run, "PASS")}, FAIL ${caseCount(run, "FAIL")}, ERROR ${caseCount(run, "ERROR")}, SKIP ${caseCount(run, "SKIP")}`);
  return `${lines.join("\n")}\n`;
}

/** 生成 CI 可读取的 JUnit XML；基础设施错误使用独立 testcase 保留。 */
export function formatJUnitReport(run: ExecutedRun): string {
  const extraErrors = (job: JobResult) => stepOnly(job) ? job.errors.filter(error => !job.steps.some(step => step.error?.code === error.code && step.error.message === error.message)) : job.errors;
  const suites = [...run.jobs, ...(run.collectors ?? [])].map((job) => {
    if (stepOnly(job)) {
      const cases = job.steps.map(step => {
        const proof = step.error?.message ?? (step.diagnostics[0] === undefined ? "" : bounded(step.diagnostics[0]));
        const body = step.status === "FAIL" ? `<failure message="${escapeXml(step.name)}">${escapeXml(proof)}</failure>`
          : step.status === "ERROR" ? `<error message="${escapeXml(step.name)}">${escapeXml(proof)}</error>` : step.status === "SKIPPED" ? "<skipped/>" : "";
        return `<testcase classname="${escapeXml(job.jobId)}" name="${escapeXml(step.id)}" time="${(step.durationMs / 1000).toFixed(6)}"><properties><property name="workflowStep" value="true"/><property name="phase" value="${step.phase}"/></properties>${body}</testcase>`;
      });
      for (const [index, error] of extraErrors(job).entries()) cases.push(`<testcase classname="${escapeXml(job.jobId)}" name="infrastructure-${index + 1}"><properties><property name="infrastructure" value="true"/></properties><error message="${escapeXml(error.message)}"/></testcase>`);
      return `<testsuite name="${escapeXml(job.jobId)}" tests="${cases.length}" failures="${job.steps.filter(step => step.status === "FAIL").length}" errors="${job.steps.filter(step => step.status === "ERROR").length + extraErrors(job).length}" skipped="${job.steps.filter(step => step.status === "SKIPPED").length}" time="${(job.durationMs / 1000).toFixed(6)}"><properties><property name="description" value="${escapeXml(job.description ?? "")}"/></properties>${cases.join("")}</testsuite>`;
    }
    const cases = job.groups.flatMap((group) => group.cases.map((item) => {
      const evidence = caseEvidence(item);
      const body = item.status === "FAIL" ? `<failure message="${escapeXml(`${group.name}/${item.name} FAIL`)}">${escapeXml(evidence)}</failure>`
        : item.status === "ERROR" ? `<error message="${escapeXml(`${group.name}/${item.name} ERROR`)}">${escapeXml(evidence)}</error>`
          : item.status === "SKIP" ? "<skipped/>" : "";
      const properties = `<properties><property name="description" value="${escapeXml(item.description ?? "")}"/><property name="expectedBehavior" value="${escapeXml(item.expectedBehavior ?? "")}"/><property name="suiteDescription" value="${escapeXml(group.description ?? "")}"/></properties>`;
      return `<testcase classname="${escapeXml(group.name)}" name="${escapeXml(item.name)}" time="${((item.durationMs ?? 0) / 1000).toFixed(6)}">${properties}${body}</testcase>`;
    }));
    for (const [index, error] of job.errors.entries()) cases.push(`<testcase classname="${escapeXml(job.jobId)}" name="infrastructure-${index + 1}"><properties><property name="infrastructure" value="true"/></properties><error message="${escapeXml(error.message)}">${escapeXml(error.stack ?? "")}</error></testcase>`);
    const allCases = job.groups.flatMap((group) => group.cases);
    return `<testsuite name="${escapeXml(job.jobId)}" tests="${cases.length}" failures="${allCases.filter((item) => item.status === "FAIL").length}" errors="${allCases.filter((item) => item.status === "ERROR").length + job.errors.length}" skipped="${allCases.filter((item) => item.status === "SKIP").length}" time="${(job.durationMs / 1000).toFixed(6)}"><properties><property name="description" value="${escapeXml(job.description ?? "")}"/></properties>${cases.join("")}</testsuite>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites name="cautest" tests="${[...run.jobs, ...(run.collectors ?? [])].reduce((count, job) => count + (stepOnly(job) ? job.steps.length : job.groups.reduce((sum, group) => sum + group.cases.length, 0)) + extraErrors(job).length, 0)}">${suites.join("")}</testsuites>\n`;
}

/** 生成单文件、无外部依赖的可导航 HTML 报告。 */
export function formatHtmlReport(run: ExecutedRun): string {
  const allJobs = [...run.jobs, ...(run.collectors ?? [])];
  const stats = `${hasStepJobs(run) ? `<p>${escapeXml(stepStatistics(run))}</p>` : ""}${hasCaseJobs(run) ? `<div class="stats">${["PASS", "FAIL", "ERROR", "SKIP"].map(status => `<span class="${status}">${status} <b>${caseCount(run, status)}</b></span>`).join("")}</div>` : ""}`;
  const jobs = allJobs.map((job, index) => {
    const cases = job.groups.flatMap(group => group.cases);
    const jobStatistics = stepOnly(job) ? `Steps ${job.steps.length} · ${["SUCCESS", "FAIL", "ERROR", "SKIPPED"].map(status => `${status} ${job.steps.filter(step => step.status === status).length}`).join(" · ")}`
      : `Cases ${cases.length} · ${["PASS", "FAIL", "ERROR", "SKIP"].map(status => `${status} ${cases.filter(item => item.status === status).length}`).join(" · ")}`;
    const groups = (stepOnly(job) ? [] : job.groups).map(group => `<h3>Suite: ${escapeXml(group.name)}</h3><p class="description">${escapeXml(group.description ?? "")}</p><div class="table"><table><thead><tr><th>Case</th><th>测试目的</th><th>预期行为</th><th>实际结果</th><th>源码位置</th><th>执行证据 / 诊断</th></tr></thead><tbody>${group.cases.map(item => {
      const failures = item.assertions.filter(assertion => assertion.status === "FAIL" || assertion.status === "ERROR");
      const proof = failures.length ? failures.map(assertion => caseEvidence({...item, assertions: [assertion]})).join("\n")
        : item.status === "FAIL" || item.status === "ERROR" || item.status === "SKIP" ? caseEvidence(item) : "";
      const location = item.source ? `${item.source.file}:${item.source.line}` : "";
      return `<tr data-status="${escapeXml(item.status)}"><td><code>${escapeXml(item.name)}</code></td><td class="description">${escapeXml(item.description ?? "")}</td><td class="description">${escapeXml(item.expectedBehavior ?? "")}</td><td class="${item.status}">${item.status}</td><td><code>${escapeXml(location)}</code></td><td><pre>${escapeXml(proof)}</pre></td></tr>`;
    }).join("")}</tbody></table></div>`).join("");
    return `<section id="job-${index}"><h2>${escapeXml(job.jobId)} — <span class="${job.status}">${job.status}</span></h2><p class="description">${escapeXml(job.description ?? "")}</p><p>${Math.round(job.durationMs)}ms · ${jobStatistics}</p>${groups}<details${stepOnly(job) ? " open" : ""}><summary>Step 时间线</summary><ol>${job.steps.map(step => `<li class="${step.status}"><code>${escapeXml(step.id)}</code> ${step.status} ${Math.round(step.durationMs)}ms${step.error || step.status === "FAIL" && step.diagnostics.length ? `<pre>${escapeXml(step.error?.message ?? bounded(step.diagnostics[0]))}</pre>` : ""}</li>`).join("")}</ol></details><details><summary>Artifacts / Logs</summary><ul>${job.artifacts.map(artifact => `<li>${escapeXml(`${artifact.kind}:${artifact.name}`)} — <code>${escapeXml(artifact.path)}</code></li>`).join("")}</ul></details>${job.errors.length ? `<h3>Infrastructure 诊断</h3><pre>${escapeXml(job.errors.map(error => `[${error.code}] ${error.message}`).join("\n"))}</pre>` : ""}</section>`;
  }).join("");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Cautest ${escapeXml(run.id)}</title><style>body{font:14px system-ui,sans-serif;color:#243247;background:#f5f7fa;max-width:1440px;margin:auto;padding:24px}section{background:white;border:1px solid #dce2ea;border-radius:8px;padding:20px;margin:20px 0}h1{font-size:24px}h2{font-size:20px}.stats{display:flex;gap:24px;flex-wrap:wrap;font-size:18px}.table{overflow:auto}table{border-collapse:collapse;width:100%}th,td{border:1px solid #dce2ea;padding:10px;text-align:left;vertical-align:top}th{background:#f1f4f8}pre,code{overflow-wrap:anywhere;white-space:pre-wrap}pre{margin:0}.description{white-space:pre-wrap}.SUCCESS,.PASS{color:#08783e}.FAIL{color:#9b5700}.ERROR{color:#b00020}.SKIP{color:#687486}details{margin-top:16px}summary{cursor:pointer}nav a{display:inline-block;margin:4px 16px 4px 0}</style></head><body><h1>Cautest Run ${escapeXml(run.id)} — <span class="${run.status}">${run.status}</span></h1><p>${escapeXml(run.startedAt)} → ${escapeXml(run.endedAt)} · ${Math.round(run.durationMs)}ms · Jobs ${run.jobs.length}</p>${stats}<nav>${allJobs.map((job, index) => `<a class="${job.status}" href="#job-${index}">${escapeXml(job.jobId)} · ${job.status}</a>`).join("")}</nav>${jobs}</body></html>\n`;
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
