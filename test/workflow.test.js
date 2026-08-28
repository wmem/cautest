import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { defineStep, EventRecorder, executeRun, testConfig, testJob, writeRunDirectory } from "../dist/config/index.js";
import { executeWorkflow } from "../dist/workflow/engine.js";

test("Workflow 严格顺序执行并在错误后只运行失败路径 Collect", async () => {
  const calls = [];
  const job = testJob({
    id: "system.order",
    level: "system",
    workflow: [
      defineStep({ kind: "prepare", phase: "prepare", execute() { calls.push("prepare"); } }),
      defineStep({ kind: "fail", phase: "run", execute() { calls.push("fail"); throw new Error("boom"); } }),
      defineStep({ kind: "skipped", phase: "run", execute() { calls.push("skipped"); } }),
      defineStep({ kind: "always", phase: "collect", runWhen: "always", execute() { calls.push("always"); } }),
      defineStep({ kind: "failure", phase: "collect", runWhen: "on-failure", execute() { calls.push("failure"); } }),
    ],
  });
  const result = await executeWorkflow(job);
  assert.deepEqual(calls, ["prepare", "fail", "always", "failure"]);
  assert.equal(result.status, "ERROR");
  assert.deepEqual(result.steps.map((step) => step.status), ["SUCCESS", "ERROR", "SKIPPED", "SUCCESS", "SUCCESS"]);
});

test("Step timeout 产生 ERROR 并向 Executor 发送 Abort", async () => {
  let aborted = false;
  const step = defineStep({
    kind: "timeout",
    phase: "run",
    timeoutMs: 10,
    async execute({ signal }) {
      await new Promise((resolve) => {
        signal.addEventListener("abort", () => { aborted = true; resolve(); }, { once: true });
      });
    },
  });
  const result = await executeWorkflow(testJob({ id: "system.timeout", level: "system", workflow: [step] }));
  assert.equal(result.status, "ERROR");
  assert.equal(result.steps[0].error.code, "timeout_error");
  assert.equal(aborted, true);
});

test("结构化测试失败保持 FAIL，并执行失败路径 Collect", async () => {
  const events = [];
  const run = defineStep({ kind: "testFailure", phase: "run", execute() { return { outcome: "FAIL" }; } });
  const collect = defineStep({ kind: "failureCollect", phase: "collect", runWhen: "on-failure", execute() { events.push("collect"); } });
  const job = testJob({ id: "unit.failure", level: "unit", workflow: [run, collect] });
  const result = await executeWorkflow(job);
  assert.equal(result.status, "FAIL");
  assert.deepEqual(result.steps.map((step) => step.status), ["FAIL", "SUCCESS"]);
  assert.deepEqual(events, ["collect"]);
});

test("Step 返回 ERROR 时保留已取得测试结果和诊断", async () => {
  const groups = [{ name: "suite", cases: [{ name: "before-error", status: "PASS", assertions: [], diagnostics: [] }] }];
  const step = defineStep({ kind: "partialTargetError", phase: "run", execute() { return { outcome: "ERROR", error: new Error("suite setup failed"), diagnostics: [{ code: "FIXTURE" }], testResults: groups }; } });
  const result = await executeWorkflow(testJob({ id: "unit.partial-error", level: "unit", workflow: [step] }));
  assert.equal(result.status, "ERROR");
  assert.equal(result.groups[0].cases[0].name, "before-error");
  assert.equal(result.steps[0].status, "ERROR");
  assert.equal(result.steps[0].testResults[0].name, "suite");
  assert.equal(result.steps[0].diagnostics[0].code, "FIXTURE");
  assert.equal(result.errors[0].code, "target_error");
});

function failedSuite() {
  return [{ name: "suite", cases: [{ name: "bad", status: "FAIL", assertions: [{ status: "FAIL", expression: "actual == expected", file: "case.c", line: 42, expected: { type: "integer", value: "1" }, actual: { type: "integer", value: "2" } }], diagnostics: [{ code: "ASSERT", message: "values differ" }] }] }];
}

test("Case FAIL 默认不阻断后续 Step，stopOnTestFailure 可显式停止", async () => {
  const defaultCalls = [];
  const strictCalls = [];
  const run = (calls) => defineStep({ kind: "case", phase: "run", execute() { calls.push("case"); return { testResults: failedSuite() }; } });
  const after = (calls) => defineStep({ kind: "after", phase: "run", execute() { calls.push("after"); } });
  const normal = await executeWorkflow(testJob({ id: "unit.continue", level: "unit", workflow: [run(defaultCalls), after(defaultCalls)] }));
  const strict = await executeWorkflow(testJob({ id: "unit.stop", level: "unit", policy: { stopOnTestFailure: true }, workflow: [run(strictCalls), after(strictCalls)] }));
  assert.equal(normal.status, "FAIL");
  assert.deepEqual(defaultCalls, ["case", "after"]);
  assert.deepEqual(strictCalls, ["case"]);
  assert.equal(strict.steps[1].status, "SKIPPED");
});

test("Workflow Context 统一管理 Artifact、Resource、Result、Event 和 LIFO Cleanup", async () => {
  const order = [];
  const events = new EventRecorder();
  const step = defineStep({ kind: "lifecycle", phase: "run", execute(context) {
    context.artifacts.publish({ kind: "log", name: "main", path: "." });
    context.resources.publish({ kind: "process", name: "target", state: "starting" });
    context.resources.ready("process:target");
    context.defer(() => { order.push("first"); }, "first");
    context.defer(() => { order.push("second"); }, "second");
    return { testResults: [{ name: "suite", cases: [{ name: "ok", status: "PASS", assertions: [], diagnostics: [] }] }] };
  } });
  const result = await executeWorkflow(testJob({ id: "system.lifecycle", level: "system", workflow: [step] }), { events });
  assert.equal(result.status, "SUCCESS");
  assert.deepEqual(order, ["second", "first"]);
  assert.equal(result.artifacts[0].name, "main");
  assert.equal(result.resources[0].state, "closed");
  assert.deepEqual(result.cleanup.map((item) => item.name), ["second", "first"]);
  assert.ok(events.list().some((event) => event.type === "ARTIFACT_PUBLISHED"));
  assert.ok(events.list().some((event) => event.type === "RESOURCE_CLOSED"));
});

test("空结果由统一 allowEmpty 策略聚合", async () => {
  const step = defineStep({ kind: "empty", phase: "run", execute() {} });
  assert.equal((await executeWorkflow(testJob({ id: "unit.empty-error", level: "unit", workflow: [step] }))).status, "ERROR");
  assert.equal((await executeWorkflow(testJob({ id: "unit.empty-skip", level: "unit", policy: { allowEmpty: true }, workflow: [step] }))).status, "SKIP");
});

test("executeRun 和结果目录保留事件、Job 快照及失败索引", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cautest-run-result-"));
  const step = defineStep({ kind: "failure", phase: "run", execute() { return { testResults: failedSuite() }; } });
  const config = testConfig({ defaults: { resultDir: "events" }, jobs: [testJob({ id: "unit.failure-index", level: "unit", workflow: [step] })] });
  const run = await executeRun(config, { runId: "run-fixed", configDir: root });
  const directory = await writeRunDirectory(run, path.join(root, "results"));
  assert.equal(run.status, "FAIL");
  assert.match(await readFile(path.join(root, "events/run-fixed/events.jsonl"), "utf8"), /RUN_END/u);
  const summary = JSON.parse(await readFile(path.join(directory, "summary.json"), "utf8"));
  assert.equal(summary.counts.failureRecords, 1);
  assert.deepEqual(summary.failedJobs, [{ jobId: "unit.failure-index", status: "FAIL", detailRef: "jobs/unit.failure-index/job.json" }]);
  const failure = JSON.parse((await readFile(path.join(directory, "failures.jsonl"), "utf8")).trim());
  assert.deepEqual({ status: failure.status, suite: failure.suite, case: failure.case, location: failure.location }, { status: "FAIL", suite: "suite", case: "bad", location: { file: "case.c", line: 42 } });
  assert.equal(failure.assertion.expression, "actual == expected");
  assert.equal(failure.diagnostic.code, "ASSERT");
  assert.equal(failure.detailRef, "jobs/unit.failure-index/job.json#/groups/0/cases/0");
  assert.equal(JSON.parse(await readFile(path.join(directory, "jobs/unit.failure-index/job.json"), "utf8")).status, "FAIL");
});
