import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { formatConsoleReport, formatHtmlReport, formatJUnitReport, writeReports } from "../dist/reporters/index.js";

const run = {
  schemaVersion: 1, id: "report-run", status: "ERROR", startedAt: "2026-01-01T00:00:00.000Z", endedAt: "2026-01-01T00:00:01.000Z", durationMs: 1000, metadata: {}, events: [],
  jobs: [{
    jobId: "system.api", level: "system", status: "ERROR", startedAt: "2026-01-01T00:00:00.000Z", endedAt: "2026-01-01T00:00:01.000Z", durationMs: 1000,
    steps: [{ id: "01-run-external-api", kind: "external", name: "api", phase: "run", status: "ERROR", durationMs: 10, diagnostics: [], testResults: [], error: { name: "Error", code: "target_error", message: "transport <closed>" } }],
    groups: [{ name: "api", cases: [{ name: "passes", status: "PASS", assertions: [], diagnostics: [] }, { name: "fails", status: "FAIL", assertions: [], diagnostics: [{ message: "expected <one>" }] }] }],
    cleanup: [], errors: [{ name: "Error", code: "target_error", message: "transport <closed>" }], artifacts: [{ kind: "log", name: "server", path: "/tmp/server.log", metadata: {} }], resources: [],
  }],
};

test("Console/JUnit/HTML Reporter 保留 Case、基础设施错误、时间线和 Artifact", async () => {
  assert.match(formatConsoleReport(run), /FAIL api\/fails/u);
  const junit = formatJUnitReport(run);
  assert.match(junit, /<testsuites/u);
  assert.match(junit, /name="infrastructure" value="true"/u);
  assert.match(junit, /expected|fails/u);
  const html = formatHtmlReport(run);
  assert.match(html, /Step 时间线/u);
  assert.match(html, /log:server/u);
  assert.match(html, /transport &lt;closed&gt;/u);

  const directory = await mkdtemp(path.join(os.tmpdir(), "cautest-v2-reporters-"));
  const outputs = await writeReports(run, directory, ["json", "junit", "html", "console", "html"]);
  assert.equal(outputs.length, 4);
  assert.equal(JSON.parse(await readFile(path.join(directory, "run.json"), "utf8")).id, "report-run");
  assert.match(await readFile(path.join(directory, "junit.xml"), "utf8"), /<failure/u);
  assert.match(await readFile(path.join(directory, "report.html"), "utf8"), /Cautest Run/u);
});

test("terminal summary groups outcome, counts, failure index and report location without replaying evidence", () => {
  const summary = formatConsoleReport(run, {compact: true, plannedJobs: 3, resultDir: "/tmp/reports/run", reportFiles: ["/tmp/reports/run/report.html", "/tmp/reports/run/junit.xml"]});
  assert.match(summary, /^  结果  ERROR  ·  耗时 1\.0s\n/u);
  assert.match(summary, /任务  1\/3  成功 0  失败 0  错误 1  跳过 0  ·  未执行 2/u);
  assert.match(summary, /用例  2  PASS 1  FAIL 1  ERROR 0  SKIP 0/u);
  assert.match(summary, /失败  \[FAIL\] system.api \/ api\/fails/u);
  assert.match(summary, /\[ERROR\] system.api \[target_error\]/u);
  assert.match(summary, /报告  report.html  ·  junit.xml\n  目录  \/tmp\/reports\/run\n$/u);
  assert.doesNotMatch(summary, /Run report-run|明细|transport <closed>|expected <one>|SUCCESS system.api/u);
  assert.match(formatConsoleReport(run), /transport <closed>/u);
});

test("terminal summary bounds many failures, distinguishes cancellation and includes collector errors", () => {
  const failed = {...run, status: "FAIL", jobs: [{...run.jobs[0], status: "FAIL", errors: [], groups: [{name: "api", cases: Array.from({length: 30}, (_, index) => ({name: `failure-${index}`, status: "FAIL", assertions: [], diagnostics: []}))}]}]};
  const summary = formatConsoleReport(failed, {compact: true});
  assert.equal((summary.match(/\[FAIL\]/gu) ?? []).length, 5);
  assert.match(summary, /另有 25 项，详见 failures.jsonl/u);
  assert.match(summary, /用例  30  PASS 0  FAIL 30/u);
  assert.match(formatConsoleReport(failed, {compact: true, interrupted: true}), /结果  已中断/u);
  const collected = {...run, jobs: [{...run.jobs[0], status: "SUCCESS", groups: [], errors: []}], collectors: [{...run.jobs[0], jobId: "report.collect", groups: []}]};
  const collectionSummary = formatConsoleReport(collected, {compact: true});
  assert.match(collectionSummary, /结果  ERROR/u);
  assert.match(collectionSummary, /任务  1\/1  成功 1  失败 0  错误 0/u);
  assert.match(collectionSummary, /\[ERROR\] report.collect \[target_error\]/u);
});
