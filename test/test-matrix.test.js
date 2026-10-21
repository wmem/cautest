import assert from "node:assert/strict";
import test from "node:test";
import { defineStep, selectJobs, testConfig, testJob } from "../dist/config/index.js";
import { runCli } from "../dist/runtime/cli.js";

let executed = 0;
const step = defineStep({ kind: "matrixFixture", phase: "run", execute() { executed++; } });
const selection = {
  defaultEnvironments: ["host"],
  collections: { quick: [], smoke: [], regression: ["quick", "smoke"], release: ["regression"], all: ["*"] },
};
const make = (id, level, testEnvironment, collections) => testJob({ id, level, testEnvironment, collections, workflow: [step] });
const fixture = () => [make("math", "unit", "host", ["quick", "smoke"]), make("service", "component", "host", ["regression"]),
  make("rtos", "integration", "board-debug", ["smoke"]), make("network", "system", "board-network", ["release"])];
const ids = (jobs) => jobs.map((job) => job.id);

test("默认环境不会因 level 或 collection 选择而隐式取得硬件，显式 ID 可选择硬件", () => {
  const jobs = fixture();
  assert.deepEqual(ids(selectJobs(jobs, { policy: selection })), ["math", "service"]);
  assert.deepEqual(ids(selectJobs(jobs, { policy: selection, levels: ["integration"] })), []);
  assert.deepEqual(ids(selectJobs(jobs, { policy: selection, collections: ["release"] })), ["math", "service"]);
  assert.deepEqual(ids(selectJobs(jobs, { policy: selection, selectors: ["rtos"] })), ["rtos"]);
});

test("集合继承、同维 OR、跨维 AND 与重叠去重", () => {
  const jobs = fixture();
  assert.deepEqual(ids(selectJobs(jobs, { policy: selection, environments: ["host", "board-debug"], collections: ["quick", "smoke"] })), ["math", "rtos"]);
  assert.deepEqual(ids(selectJobs(jobs, { policy: selection, environments: ["*"], collections: ["regression"] })), ["math", "service", "rtos"]);
  assert.deepEqual(ids(selectJobs(jobs, { policy: selection, environments: ["*"], collections: ["release"] })), ids(jobs));
  assert.deepEqual(ids(selectJobs(jobs, { policy: selection, environments: ["board-network"], collections: ["all"] })), ["network"]);
  assert.equal(executed, 0);
});

test("无效环境、集合、循环及拼错登记必须报错", () => {
  for (const input of [{ environments: ["missing"] }, { collections: ["qucik"] }])
    assert.throws(() => selectJobs(fixture(), { policy: selection, ...input }), { code: "config_error" });
  assert.throws(() => testConfig({ jobs: fixture(), selection: { ...selection, collections: { a: ["b"], b: ["a"] } } }), { code: "config_error" });
  assert.throws(() => testConfig({ jobs: [make("typo", "unit", "host", ["qucik"])], selection }), { code: "config_error" });
});

test("公共 selector 拒绝错误 policy 的类型与未知字段", () => {
  for (const policy of [null, [], {defaultEnvironments: "host"}, {typo: true}, {collections: []}])
    assert.throws(() => selectJobs([], {policy}), {code: "config_error"});
});

test("CLI list/plan 展示环境及集合，不执行 Step；原生 C --suite 不被项目集合接管", async () => {
  const config = testConfig({ jobs: fixture(), selection });
  const loadedConfig = { config, path: "/tmp/matrix.js", dir: "/tmp", hash: "fixture", sources: [] };
  for (const command of ["list", "plan"]) {
    let stdout = "", stderr = "";
    const code = await runCli([command, "--environment", "board-debug,board-network", "--collection", "release", "--json"],
      { stdout: { write(t) { stdout += t; } }, stderr: { write(t) { stderr += t; } } }, { loadedConfig });
    assert.equal(code, 0, stderr);
    const result = JSON.parse(stdout);
    assert.deepEqual(ids(result), ["rtos", "network"]);
    assert.equal(result[0].testEnvironment, "board-debug");
    assert.deepEqual(result[0].collections, ["smoke"]);
  }
  assert.equal(executed, 0);
});
