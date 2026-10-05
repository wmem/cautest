import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { defineStep, testConfig, testJob, runCollector, executeRun, formatJUnitReport } from "../dist/config/index.js";
import { runCli } from "../dist/runtime/cli.js";

function job(status = "PASS") {
  return testJob({ id: "unit.fixture", level: "unit", workflow: [defineStep({ kind: "fixture", phase: "run", execute() {
    if (status === "ERROR") throw new Error("build infrastructure failed");
    return { testResults: [{ name: "fixture", cases: [{ name: "case", status, assertions: [], diagnostics: [] }] }] };
  } })] });
}

for (const status of ["PASS", "FAIL", "ERROR", "SKIP"]) test(`Run Collector 在 ${status} 后读取本轮完整报告并保留状态`, async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ct-collector-"));
  try {
    let calls = 0;
    const config = testConfig({ jobs: [job(status)], collectors: [runCollector({ id: "coverage", async collect({ run, resultDir, exec }) {
      calls++;
      const report = JSON.parse(await readFile(path.join(resultDir, "result.json"), "utf8"));
      assert.equal(report.id, run.id); assert.equal(report.jobs.length, 1);
      const command = await exec({ program: process.execPath, args: ["-e", "process.stdout.write('collector output')"] });
      assert.equal(command.exitCode, 0); assert.equal(command.stdout, "collector output");
      await writeFile(path.join(resultDir, "merged.txt"), run.status);
    } })] });
    const result = await executeRun(config, { configDir: root });
    assert.equal(calls, 1); assert.equal(result.jobs.length, 1);
    assert.equal(result.collectors[0].status, "SUCCESS");
    assert.equal(result.status, status === "PASS" ? "SUCCESS" : status);
    assert.equal(JSON.parse(await readFile(path.join(root, ".cautest/results", result.id, "summary.json"))).counts.cases.total, status === "ERROR" ? 0 : 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("收集失败、超时和取消后收集保存诊断，后续收集器仍执行", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ct-collector-error-"));
  try {
    const controller = new AbortController(); controller.abort();
    const config = testConfig({ jobs: [job()], collectors: [
      runCollector({ id: "broken", collect() { throw new Error("merge failed"); } }),
      runCollector({ id: "timeout", timeoutMs: 50, async collect({ exec }) { await exec({ program: process.execPath, args: ["-e", "setTimeout(()=>{},10000)"] }); } }),
      runCollector({ id: "recovery", async collect({ resultDir }) { await writeFile(path.join(resultDir, "recovery.txt"), "collected"); } }),
    ] });
    const result = await executeRun(config, { configDir: root, signal: controller.signal });
    assert.equal(result.status, "ERROR");
    assert.deepEqual(result.collectors.map(c => c.status), ["ERROR", "ERROR", "SUCCESS"]);
    const dir = path.join(root, ".cautest/results", result.id);
    await access(path.join(dir, "recovery.txt"));
    assert.match(await readFile(path.join(dir, "failures.jsonl"), "utf8"), /collectors\/broken/);
    assert.match(formatJUnitReport(result), /merge failed/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("list、plan、doctor 不执行 Run Collector；失败收集仍提供可解析 JSON 和错误码", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ct-collector-cli-"));
  try {
    let calls = 0;
    const config = testConfig({ jobs: [job()], collectors: [runCollector({ id: "broken", collect() { calls++; throw new Error("collect rejected"); } })] });
    const loadedConfig = { config, path: path.join(root, "config.mjs"), dir: root, hash: "fixture", sources: [] };
    for (const command of ["list", "plan", "doctor"]) {
      const streams = { stdout: { write() {} }, stderr: { write() {} } };
      assert.equal(await runCli([command, "--json"], streams, { loadedConfig }), 0);
      assert.equal(calls, 0);
    }
    let stdout = "";
    assert.equal(await runCli(["run", "--json", "--reporter", "json,junit"], { stdout: { write(s) { stdout += s; } }, stderr: { write() {} } }, { loadedConfig }), 2);
    const result = JSON.parse(stdout);
    assert.equal(result.status, "ERROR"); assert.equal(calls, 1);
    assert.match(await readFile(path.join(result.resultDir, "junit.xml"), "utf8"), /collect rejected/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Run Collector 声明严格校验", () => {
  assert.throws(() => runCollector({ id: "../bad", collect() {} }), /安全标识符/);
  assert.throws(() => runCollector({ id: "bad", timeoutMs: 0, collect() {} }), /正数/);
  assert.throws(() => testConfig({ jobs: [], collectors: [{ id: "bad", collect() {} }] }), /runCollector/);
  const collector = runCollector({ id: "duplicate", collect() {} });
  assert.throws(() => testConfig({ jobs: [], collectors: [collector, collector] }), /重复/);
});

test("fail-fast 只汇总已执行 Job，不启动后续测试", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ct-collector-fast-"));
  try {
    const never = testJob({id: "unit.never", level: "unit", workflow: [defineStep({kind: "never", phase: "run", execute() { throw new Error("不得运行"); }})]});
    let ids;
    const config = testConfig({jobs: [job("FAIL"), never], collectors: [runCollector({id: "summary", collect({run}) { ids = run.jobs.map(j => j.jobId); }})]});
    const result = await executeRun(config, {configDir: root, failFast: true});
    assert.deepEqual(ids, ["unit.fixture"]); assert.equal(result.status, "FAIL");
  } finally { await rm(root, {recursive: true, force: true}); }
});
