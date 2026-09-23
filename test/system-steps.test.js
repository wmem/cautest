import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { collectLogs, externalTest, parseJUnit, processAttach, processStart, testJob, waitForReady, waitReady } from "../dist/config/index.js";
import { executeWorkflow } from "../dist/workflow/engine.js";

const projectRoot = path.resolve(new URL("..", import.meta.url).pathname);
const fixture = (name) => path.join(projectRoot, "test/fixtures/steps", name);

test("Ready Probe 支持 Process、File、TCP 和 HTTP", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cautest-ready-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, "ready"); await writeFile(file, "yes");
  const server = http.createServer((_request, response) => response.end("healthy"));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve)); t.after(() => server.close());
  await waitForReady({ child: { exitCode: null, signalCode: null } }, { type: "process-alive" });
  await waitForReady(undefined, { type: "file-exists", path: file });
  await waitForReady(undefined, { kind: "tcp", port: server.address().port });
  await waitForReady(undefined, { kind: "http", url: `http://127.0.0.1:${server.address().port}`, bodyIncludes: "healthy" });
});

test("processStart Ready 后收集日志且 Cleanup 不泄漏进程", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cautest-process-")); t.after(() => rm(directory, { recursive: true, force: true }));
  const ready = path.join(directory, "port");
  const job = testJob({ id: "system.server", level: "system", policy: { allowEmpty: true }, workflow: [
    processStart({ name: "server", program: process.execPath, args: [fixture("server.js"), ready], ready: { kind: "file", path: ready }, readyTimeoutMs: 2_000 }),
    // The fixture publishes its Ready file before emitting stdout. File readiness
    // is not a guarantee that a different pipe's data event has reached the Host.
    waitReady({ from: "process:server", readyTimeoutMs: 2_000, probe: { type: "custom", check: ({ resource }) => Buffer.concat(resource.handle.stdout).includes(Buffer.from("server:")) } }),
    collectLogs({ from: "server" }),
  ] });
  const result = await executeWorkflow(job, { project: { configDir: projectRoot, resultDir: path.join(directory, "results") } });
  assert.equal(result.status, "SKIP");
  assert.equal(result.cleanup[0].status, "SUCCESS");
  assert.equal(result.resources[0].metadata.ownership, "owned");
  const stdout = result.artifacts.find((item) => item.name === "server-stdout"); await access(stdout.path); assert.match(await readFile(stdout.path, "utf8"), /server:/u);
});

test("Ready 失败仍收集启动日志并立即 Cleanup", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cautest-process-failed-")); t.after(() => rm(directory, { recursive: true, force: true }));
  const job = testJob({ id: "system.bad", level: "system", policy: { allowEmpty: true }, workflow: [
    processStart({ name: "bad", program: process.execPath, args: ["-e", "process.stdout.write('startup stdout\\n'); process.stderr.write('startup stderr\\n'); setInterval(() => {}, 1000)"], ready: { type: "custom", check: () => false }, readyTimeoutMs: 100, intervalMs: 5 }),
    collectLogs({ from: "bad" }),
  ] });
  const result = await executeWorkflow(job, { project: { configDir: projectRoot, resultDir: path.join(directory, "results") } });
  assert.equal(result.status, "ERROR"); assert.equal(result.steps[0].status, "ERROR"); assert.equal(result.steps[1].status, "SUCCESS"); assert.equal(result.cleanup[0].status, "SUCCESS"); assert.equal(result.resources[0].state, "failed");
  const stdout = result.artifacts.find((item) => item.name === "bad-stdout"); const stderr = result.artifacts.find((item) => item.name === "bad-stderr");
  assert.equal(stdout.metadata.startupFailed, true); assert.match(await readFile(stdout.path, "utf8"), /startup stdout/u); assert.match(await readFile(stderr.path, "utf8"), /startup stderr/u);
});

test("Attach Ownership 决定是否清理", async () => {
  let stopped = 0; const borrowed = { child: { exitCode: null, signalCode: null }, stop: () => { stopped += 1; } };
  const result = await executeWorkflow(testJob({ id: "system.attach", level: "system", policy: { allowEmpty: true }, workflow: [
    processAttach({ name: "borrowed", handle: borrowed, ownership: "borrowed", ready: { type: "process-alive" } }),
    processAttach({ name: "owned", handle: borrowed, ownership: "owned", ready: { type: "process-alive" } }),
  ] }));
  assert.equal(result.status, "SKIP"); assert.equal(stopped, 1);
});

test("External JUnit/JSON Adapter 保持 FAIL 与 ERROR Case 语义", async () => {
  assert.equal(parseJUnit('<testsuite name="x"><testcase name="a"><failure message="bad"/></testcase></testsuite>')[0].cases[0].status, "FAIL");
  const json = await executeWorkflow(testJob({ id: "system.json", level: "system", workflow: [externalTest({ program: process.execPath, args: [fixture("external-json.js")], resultAdapter: "json" })] }), { project: { configDir: projectRoot } });
  const junit = await executeWorkflow(testJob({ id: "system.junit", level: "system", workflow: [externalTest({ program: process.execPath, args: [fixture("external-junit.js")], resultAdapter: "junit" })] }), { project: { configDir: projectRoot } });
  assert.equal(json.status, "FAIL"); assert.equal(junit.status, "ERROR");
});
