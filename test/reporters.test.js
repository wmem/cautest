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
