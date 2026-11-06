import assert from "node:assert/strict";
import {mkdtemp, readFile, rm} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {stripVTControlCharacters} from "node:util";
import test from "node:test";
import {defineStep, testJob, testConfig, executeRun, executeWorkflow, writeRunDirectory, formatConsoleReport, formatHtmlReport, formatJUnitReport} from "../dist/config/index.js";
import {TerminalProgress} from "../dist/runtime/progress.js";

const step = (name, phase, execute = () => {}) => defineStep({kind: "generic", name, phase, execute, ...(phase === "collect" ? {runWhen: "always"} : {})});
const generic = (workflow, policy = {}) => testJob({id: "task.package", level: "system", policy: {resultMode: "steps", ...policy}, workflow});
async function fixture(callback) {
  const root = await mkdtemp(path.join(os.tmpdir(), "cautest-generic-"));
  try {await callback(root);} finally {await rm(root, {recursive: true, force: true});}
}

test("generic jobs succeed from steps without creating Cases, while default test jobs retain empty-result checks", async () => {
  const workflow = [step("prepare", "prepare"), step("build", "build"), step("verify", "run")];
  const result = await executeWorkflow(generic(workflow));
  assert.equal(result.status, "SUCCESS");
  assert.equal(result.resultMode, "steps");
  assert.deepEqual(result.groups, []);
  assert.deepEqual(result.steps.map(value => value.status), ["SUCCESS", "SUCCESS", "SUCCESS"]);
  assert.equal((await executeWorkflow(testJob({id: "test.empty", level: "unit", workflow}))).status, "ERROR");
  assert.equal((await executeWorkflow(testJob({id: "test.allowed", level: "unit", policy: {allowEmpty: true}, workflow}))).status, "SKIP");
  assert.throws(() => generic(workflow, {resultMode: "automatic"}), /resultMode/);
  const skipped = generic([defineStep({kind: "conditional", phase: "collect", runWhen: "on-failure", execute() {throw new Error("must not run");}})]);
  assert.equal((await executeWorkflow(skipped)).status, "SKIP");
});

test("generic errors skip downstream work, collect and clean up, update step progress and persist accurate reports", () => fixture(async root => {
  let cleaned = false, collected = false, output = "";
  const frames = [];
  const job = generic([
    step("prepare", "prepare", context => context.defer(() => {cleaned = true;}, "release")),
    step("build", "build", () => {throw new Error("output artifact missing");}),
    step("verify", "run", () => {throw new Error("must not execute");}),
    step("collect", "collect", () => {collected = true;}),
  ]);
  const progress = new TerminalProgress({isTTY: true, columns: 120, write(text) {
    const plain = stripVTControlCharacters(text); output += plain;
    if (plain.startsWith("  总览")) frames.push(plain);
  }}, [job]);
  const run = await executeRun(testConfig({jobs: [job]}), {configDir: root, ...progress.callbacks});
  progress.close();
  assert.equal(run.status, "ERROR"); assert.ok(cleaned && collected);
  assert.deepEqual(run.jobs[0].groups, []);
  assert.deepEqual(run.jobs[0].steps.map(value => value.status), ["SUCCESS", "ERROR", "SKIPPED", "SUCCESS"]);
  assert.ok(frames.some(frame => /步骤.*4\/4.*成功\s+2.*错误\s+1.*跳过\s+1/u.test(frame)));
  assert.doesNotMatch(output, /用例|0\/\?/u);
  assert.match(output, /output artifact missing/u);
  const summary = formatConsoleReport(run, {compact: true});
  assert.match(summary, /步骤  4  成功 2  失败 0  错误 1  跳过 1/u);
  assert.doesNotMatch(summary, /用例|PASS/u);
  const html = formatHtmlReport(run), junit = formatJUnitReport(run);
  assert.match(html, /Steps 4/u); assert.match(html, /<details open>/u); assert.doesNotMatch(html, /Cases 0/u);
  assert.match(junit, /workflowStep/u); assert.match(junit, /tests="4" failures="0" errors="1" skipped="1"/u);
  assert.match(junit, /output artifact missing/u);
  const directory = await writeRunDirectory(run, path.join(root, "reports"));
  const saved = JSON.parse(await readFile(path.join(directory, "result.json"), "utf8"));
  assert.equal(saved.jobs[0].resultMode, "steps"); assert.deepEqual(saved.jobs[0].groups, []);
  assert.equal(JSON.parse(await readFile(path.join(directory, "summary.json"), "utf8")).counts.cases.total, 0);
}));

test("generic FAIL outcomes keep diagnostics and failure indexes; mixed Jobs retain Case results", () => fixture(async root => {
  const job = generic([step("verify", "run", () => ({outcome: "FAIL", diagnostics: [{message: "checksum mismatch"}]}))]);
  const caseJob = testJob({id: "unit.case", level: "unit", workflow: [step("test", "run", () => ({testResults: [{name: "suite", cases: [{name: "pass", status: "PASS", assertions: [], diagnostics: []}]}]}))]});
  const run = await executeRun(testConfig({jobs: [job, caseJob]}), {configDir: root});
  assert.equal(run.status, "FAIL");
  const directory = await writeRunDirectory(run, path.join(root, "reports"));
  const failures = (await readFile(path.join(directory, "failures.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line));
  assert.equal(failures.length, 1); assert.equal(failures[0].kind, "step"); assert.equal(failures[0].status, "FAIL");
  assert.equal(failures[0].message, "checksum mismatch");
  const summary = formatConsoleReport(run, {compact: true});
  assert.match(summary, /步骤  2/u); assert.match(summary, /用例  1  PASS 1/u);
  assert.match(formatJUnitReport(run), /<failure.*checksum mismatch/u);
  assert.match(formatHtmlReport(run), /checksum mismatch/u);
}));

test("generic job cleanup failures, step timeouts, job timeouts and Case failures cannot become SUCCESS", async () => {
  const cleanup = await executeWorkflow(generic([step("defer", "run", context => context.defer(() => {throw new Error("cleanup failed");}))]));
  assert.equal(cleanup.status, "ERROR");
  const waitForAbort = async ({signal}) => {await new Promise((resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), {once: true}));};
  const timedStep = defineStep({kind: "timed", phase: "run", timeoutMs: 10, execute: waitForAbort});
  assert.equal((await executeWorkflow(generic([timedStep]))).status, "ERROR");
  const timedJob = testJob({...generic([step("before", "prepare"), step("wait", "run", waitForAbort)]), timeoutMs: 20});
  assert.equal((await executeWorkflow(timedJob)).status, "ERROR");
  const caseFailure = await executeWorkflow(generic([step("case", "run", () => ({testResults: [{name: "suite", cases: [{name: "fail", status: "FAIL", assertions: [], diagnostics: []}]}]}))]));
  assert.equal(caseFailure.status, "FAIL");
});
