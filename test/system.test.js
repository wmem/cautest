import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { EventRecorder, scriptSystemTestJob } from "../dist/config/index.js";
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

test("Script System 顶层 exec/env/signal 和 Case Event 进入 Workflow", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cautest-script-exec-"));
  const configModule = new URL("../dist/config/index.js", import.meta.url).href;
  await writeFile(path.join(root, "script.mjs"), `import { defineScriptTest } from ${JSON.stringify(configModule)};
export default defineScriptTest(async ({ test, exec, env, signal }) => {
  const command = await exec({ program: process.execPath, args: ['-e', 'process.stdout.write(process.env.SCRIPT_VALUE ?? "")'] });
  await test.case('exec', async (t) => { t.assert(!signal.aborted); t.assertEqual('profile', command.stdout); t.attach('stdout', command.stdout); });
  await test.case('failure', async (t) => t.fail(env.SCRIPT_VALUE));
});\n`);
  const events = new EventRecorder();
  const result = await executeWorkflow(scriptSystemTestJob({ id: "system.script-exec", file: "script.mjs", env: { SCRIPT_VALUE: "profile" } }), { project: { configDir: root }, events });
  assert.equal(result.status, "FAIL");
  assert.deepEqual(result.groups[0].cases.map((item) => item.status), ["PASS", "FAIL"]);
  assert.deepEqual(result.groups[0].cases[0].attachments, [{ name: "stdout", value: "profile" }]);
  const caseEvents = events.list().filter((event) => event.type === "CASE_START" || event.type === "CASE_END" || event.type === "ASSERTION");
  assert.deepEqual(caseEvents.map((event) => event.type), ["CASE_START", "CASE_END", "CASE_START", "ASSERTION", "CASE_END"]);
  assert.ok(caseEvents.every((event) => event.jobId === "system.script-exec"));
});
