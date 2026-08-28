import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { scriptSystemTestJob } from "../dist/config/index.js";
import { executeWorkflow } from "../dist/workflow/engine.js";

test("Script System Job 产生结构化 Case 结果", async () => {
  const root = path.resolve(new URL("..", import.meta.url).pathname);
  const job = scriptSystemTestJob({ id: "system.api", file: "test/fixtures/system/api.test.mjs" });
  const result = await executeWorkflow(job, { project: { configDir: root } });
  assert.equal(result.status, "ERROR");
  assert.equal(result.steps[0].status, "FAIL");
  assert.deepEqual(result.steps[0].testResults[0].cases.map((item) => item.status), ["PASS", "ERROR"]);
});
