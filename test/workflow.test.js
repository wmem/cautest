import assert from "node:assert/strict";
import test from "node:test";
import { defineStep, testJob } from "../dist/config/index.js";
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
