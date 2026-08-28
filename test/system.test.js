import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
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

test("Script System Job 可加载 defineScriptTest 渐进 API", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cautest-script-job-"));
  const configModule = new URL("../dist/config/index.js", import.meta.url).href;
  await writeFile(path.join(root, "script.mjs"), `import { defineScriptTest } from ${JSON.stringify(configModule)};
export default defineScriptTest(async ({ test, env }) => {
  await test.case('expect', async (t) => t.expectEqual(env.VALUE, 'expected'));
  await test.case('skip', async (t) => t.skip('optional'));
});\n`);
  const result = await executeWorkflow(scriptSystemTestJob({ id: "system.script-api", file: "script.mjs", env: { VALUE: "expected" } }), { project: { configDir: root } });
  assert.equal(result.status, "SUCCESS");
  assert.deepEqual(result.groups[0].cases.map((item) => item.status), ["PASS", "SKIP"]);
});
