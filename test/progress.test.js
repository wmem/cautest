import assert from "node:assert/strict";
import test from "node:test";
import { TerminalProgress } from "../dist/runtime/progress.js";
import { executeRun, defineStep, testConfig, testJob } from "../dist/config/index.js";
import { formatConsoleReport } from "../dist/reporters/index.js";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { stripVTControlCharacters } from "node:util";

function progress(isTTY = false) {
  let output = "";
  const value = new TerminalProgress({isTTY, columns: 120, write(text) { output += text; }}, [{id: "unit.test", description: "接口验证"}]);
  const step = {kind: "cTestRun", name: "run", phase: "run"};
  value.callbacks.onJob({type: "START", jobId: "unit.test"});
  value.callbacks.onStep({type: "START", jobId: "unit.test", step});
  let sequence = 0;
  const event = (type, data = {}) => value.callbacks.onEvent({version: 1, sequence: ++sequence, timestamp: "", type, jobId: "unit.test", step: "run", ...data});
  return {value, event, output: () => stripVTControlCharacters(output), raw: () => output, step};
}

test("progress distinguishes completed count from pass count, prints current Case and failure evidence, deduplicates results", () => {
  const p = progress();
  p.event("CASE_SELECTION", {total: 3});
  for (const [name, status] of [["passes", "PASS"], ["fails", "FAIL"], ["skips", "SKIP"]]) {
    p.event("CASE_START", {case: name, description: "测试目的"});
    if (status === "FAIL") p.event("ASSERTION", {case: name, status, expression: "expected == actual", expected: 1, actual: 2});
    p.event("CASE_END", {case: name, status});
    p.event("CASE_END", {case: name, status});
  }
  p.value.close();
  assert.match(p.output(), /RUN passes（测试目的）/);
  assert.match(p.output(), /fails 结果：FAIL \| 已完成 2\/3 \| PASS 1  FAIL 1/);
  assert.match(p.output(), /expected=1 actual=2/);
  assert.match(p.output(), /已完成 3\/3 \| PASS 1  FAIL 1  ERROR 0  SKIP 1/);
  assert.doesNotMatch(p.raw(), /\u001b/u);
});

test("dynamic script totals stay unknown; TTY failures stay visible and transient status is cleared", async () => {
  const p = progress(true);
  p.event("CASE_START", {case: "dynamic"});
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.match(p.output(), /当前  dynamic/);
  assert.match(p.output(), /用例.*0\/\?/);
  p.event("CASE_END", {case: "dynamic", status: "FAIL"});
  p.value.close();
  const output = p.output();
  assert.match(output, /dynamic 结果：FAIL \| 已完成 1\/\?/);
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(p.output(), output);
});

test("many passing cases reuse the TTY status line without flooding durable output", () => {
  const p = progress(true);
  p.event("CASE_SELECTION", {total: 1000});
  for (let index = 0; index < 1000; index++) {
    p.event("CASE_START", {case: `case-${index}`});
    p.event("CASE_END", {case: `case-${index}`, status: "PASS"});
  }
  p.value.callbacks.onStep({type: "END", jobId: "unit.test", step: p.step, status: "SUCCESS", durationMs: 10});
  p.value.close();
  assert.ok(p.output().split("\n").length < 50);
  assert.match(p.output(), /用例.*1000\/1000.*PASS\s+1000/);
  assert.doesNotMatch(p.output(), /START Job|END Job|START Step|END Step/);
});

test("generic Steps reconcile Job counts from actual results, summarize passes and preserve skip/fail-fast status", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cautest-progress-"));
  try {
    let output = "";
    const make = id => testJob({id, level: "unit", workflow: [defineStep({kind: "external", phase: "run", execute() {return {testResults: [{name: "external", cases: [{name: "passed", status: "PASS", assertions: [], diagnostics: []}, {name: "failed", status: "FAIL", assertions: [], diagnostics: []}]}]};}})]});
    const jobs = [make("first"), make("second")];
    const progress = new TerminalProgress({write(text) {output += text;}}, jobs);
    const run = await executeRun(testConfig({jobs}), {configDir: root, failFast: true, ...progress.callbacks});
    progress.close();
    assert.equal(run.jobs.length, 1);
    assert.match(output, /\[Job 1\/2\].*END Job first FAIL.*PASS 1  FAIL 1/);
    const report = formatConsoleReport(run);
    assert.doesNotMatch(report, /PASS external\/passed/);
    assert.match(report, /FAIL external\/failed/);
    assert.match(formatConsoleReport(run, {verbose: true}), /PASS external\/passed/);
    const many = formatConsoleReport({...run, jobs: [...run.jobs, {...run.jobs[0], jobId: "last.pass", status: "SUCCESS", groups: []}]});
    assert.ok(many.indexOf("FAIL external/failed") > many.indexOf("SUCCESS last.pass"));
    const manyPassing = {...run, status: "SUCCESS", jobs: Array.from({length: 1000}, (_, index) => ({...run.jobs[0], jobId: `passing-${index}`, status: "SUCCESS", groups: []}))};
    const compact = formatConsoleReport(manyPassing, {compact: true});
    assert.match(compact, /任务  1000\/1000  成功 1000/);
    assert.ok(compact.split("\n").length < 6);
    assert.doesNotMatch(compact, /passing-/);
  } finally {await rm(root, {recursive: true, force: true});}
});

test("TTY overview counts completed Jobs, updates elapsed time during silence and stops on close", async () => {
  let output = "";
  const p = new TerminalProgress({isTTY: true, columns: 120, write(text) {output += text;}}, [{id: "first", description: ""}, {id: "second", description: ""}]);
  p.callbacks.onJob({type: "START", jobId: "first"});
  assert.match(stripVTControlCharacters(output), /总览.*0\/2.*0%/);
  p.callbacks.onJob({type: "END", jobId: "first", status: "SUCCESS", result: {groups: [], errors: []}});
  p.callbacks.onJob({type: "START", jobId: "second"});
  assert.match(stripVTControlCharacters(output), /总览.*1\/2.*50%.*成功\s+1/);
  const before = output;
  await new Promise(resolve => setTimeout(resolve, 240));
  assert.ok(output.length > before.length);
  p.callbacks.onEvent({type: "JOB_CLEANUP_START", jobId: "second"});
  assert.match(output, /清理中/);
  p.close();
  const closed = output;
  await new Promise(resolve => setTimeout(resolve, 240));
  assert.equal(output, closed);
  assert.doesNotMatch(output, /START Job|END Job/);
});

test("TTY displays assertion errors immediately and compiler errors with bounded multiline output", () => {
  const p = progress(true);
  p.event("CASE_START", {case: "failure"});
  p.event("ASSERTION", {case: "failure", status: "FAIL", expression: "expected == actual", file: "test.c", line: 12, expected: 1, actual: 2});
  assert.match(p.output(), /FAIL failure\n  expected == actual at test.c:12 expected=1 actual=2/);
  p.event("CASE_END", {case: "failure", status: "FAIL"});
  assert.equal(p.output().split("expected == actual").length - 1, 1);
  p.value.callbacks.onStep({type: "START", jobId: "unit.test", step: {kind: "compile", name: "cc", phase: "build"}});
  for (let index = 0; index < 100; index++) p.value.callbacks.onOutput({text: `compiler-line-${index}\n`, channel: "stderr"});
  p.value.callbacks.onOutput({text: "test.c:12: error: broken\n  invalid expression\n", channel: "stderr"});
  assert.doesNotMatch(p.output(), /compiler-line-|error: broken/);
  const error = {code: "build_error", message: "compile failed\nexit code: 2"};
  p.value.callbacks.onStep({type: "END", jobId: "unit.test", step: {kind: "compile", name: "cc", phase: "build"}, status: "ERROR", error});
  assert.match(p.output(), /compile failed\nexit code: 2/);
  assert.match(p.output(), /test.c:12: error: broken\n  invalid expression/);
  assert.doesNotMatch(p.output(), /compiler-line-0\n/);
  p.value.callbacks.onJob({type: "END", jobId: "unit.test", status: "ERROR", result: {groups: [], errors: [error]}});
  p.value.close();
  assert.equal(p.output().split("compile failed").length - 1, 1);
});

test("script error diagnostics are visible in TTY without verbose logging", () => {
  const p = progress(true);
  p.event("CASE_START", {case: "throws"});
  p.event("CASE_END", {case: "throws", status: "ERROR", error: {message: "device disconnected"}});
  p.value.close();
  assert.match(p.output(), /ERROR throws\n  device disconnected/);
});

test("TTY without reported dimensions still shows readable progress and current test", () => {
  let output = "";
  const p = new TerminalProgress({isTTY: true, columns: 0, write(text) {output += text;}}, [{id: "unit.test", description: ""}]);
  p.callbacks.onJob({type: "START", jobId: "unit.test"});
  p.callbacks.onStep({type: "START", jobId: "unit.test", step: {kind: "test", name: "run", phase: "run"}});
  p.callbacks.onEvent({type: "CASE_START", case: "read_register"});
  p.callbacks.onStep({type: "HEARTBEAT", jobId: "unit.test", step: {kind: "test", name: "run", phase: "run"}, durationMs: 1000});
  p.close();
  assert.match(stripVTControlCharacters(output), /当前  read_register/);
  assert.match(stripVTControlCharacters(output), /PASS\s+0\s+FAIL\s+0\s+ERROR\s+0\s+SKIP\s+0/);
});

test("dashboard aligns labels and progress columns, keeps counters visible at 80 columns and clips long CJK names", () => {
  for (const columns of [80, 120]) {
    const frames = [];
    const id = `unit.${"长任务名".repeat(30)}`;
    const p = new TerminalProgress({isTTY: true, columns, write(text) {
      const plain = stripVTControlCharacters(text);
      if (plain.startsWith("  总览")) frames.push(plain);
    }}, [{id, description: ""}]);
    p.callbacks.onJob({type: "START", jobId: id});
    const step = {kind: "test", name: "test", phase: "run"};
    p.callbacks.onStep({type: "START", jobId: id, step});
    p.callbacks.onEvent({type: "CASE_SELECTION", total: 10});
    p.callbacks.onEvent({type: "CASE_START", case: "读取寄存器".repeat(30)});
    p.callbacks.onStep({type: "HEARTBEAT", jobId: id, step, durationMs: 1000});
    p.close();
    const lines = frames.at(-1).split("\n");
    assert.equal(lines.length, 5);
    assert.deepEqual(lines.map(line => line.slice(2, 4)), ["总览", "用例", "任务", "状态", "当前"]);
    assert.equal(lines[0].indexOf("["), lines[1].indexOf("["));
    assert.match(lines[0], /成功\s+0.*失败\s+0.*错误\s+0.*跳过\s+0/);
    assert.match(lines[1], /0\/10.*PASS\s+0.*FAIL\s+0.*ERROR\s+0.*SKIP\s+0/);
    assert.match(lines[3], /阶段 00:01.*总计 00:/);
    assert.match(lines[4], /…$/);
    for (const line of lines) assert.ok(line.replace(/\p{Script=Han}/gu, "xx").length < columns, line);
  }
});

test("NO_COLOR disables decorative styling without disabling the dynamic dashboard", () => {
  const previous = process.env.NO_COLOR;
  process.env.NO_COLOR = "1";
  try {
    const p = progress(true);
    p.value.close();
    assert.match(p.output(), /总览/);
    assert.doesNotMatch(p.raw(), /\u001b\[(?:2|22|31|32|36|39)m/u);
  } finally {
    if (previous === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = previous;
  }
});
