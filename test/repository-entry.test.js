import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { access, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root = fileURLToPath(new URL("..", import.meta.url));

async function temporary(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cautest-checkout-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test("source checkout CLI provides version/help from another working directory", async (t) => {
  const cwd = await temporary(t);
  for (const argument of ["--version", "--help"]) {
    const result = await exec(process.execPath, [path.join(root, "cautest.js"), argument], { cwd });
    assert.match(result.stdout, argument === "--version" ? /^Cautest /u : /用法: cautest/u);
  }
  await assert.rejects(access(path.join(cwd, ".cautest")), { code: "ENOENT" });
});

test("tools/cautest checkout works after relocation without node_modules and runs Native CTP", { timeout: 60_000 }, async (t) => {
  const directory = await temporary(t);
  const project = path.join(directory, "工程 with spaces");
  const checkout = path.join(project, "tools/cautest");
  await mkdir(checkout, { recursive: true });
  for (const entry of ["cautest.js", "package.json", "dist", "assets"]) {
    await cp(path.join(root, entry), path.join(checkout, entry), { recursive: true });
  }
  await cp(path.join(root, "examples/c-lib"), project, { recursive: true });
  await assert.rejects(access(path.join(checkout, "node_modules")), { code: "ENOENT" });
  const executable = path.join(checkout, "cautest.js");
  const config = path.join(project, "cautest.config.mjs");
  const listed = await exec(process.execPath, [executable, "--config", config, "list", "--json"], { cwd: directory });
  assert.equal(JSON.parse(listed.stdout)[0].id, "unit.example-math");
  await assert.rejects(access(path.join(project, ".cautest")), { code: "ENOENT" });
  const result = await exec(process.execPath, [executable, "--config", config, "run", "--json", "--reporter", "json", "--reporter", "junit"], { cwd: directory });
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.status, "SUCCESS", result.stderr);
  assert.ok(summary.resultDir.startsWith(path.join(project, ".cautest/results")));
  await access(path.join(summary.resultDir, "junit.xml"));
  const run = JSON.parse(await readFile(summary.resultPath, "utf8"));
  assert.ok(run.jobs[0].groups.flatMap((suite) => suite.cases).length > 1);
});

test("unbuilt source checkout fails with an actionable npm diagnostic and performs no install", async (t) => {
  const directory = await temporary(t);
  await cp(path.join(root, "cautest.js"), path.join(directory, "cautest.js"));
  await writeFile(path.join(directory, "package.json"), JSON.stringify({ type: "module" }));
  await assert.rejects(exec(process.execPath, [path.join(directory, "cautest.js"), "--help"], { cwd: directory }), (error) => {
    assert.equal(error.code, 2);
    assert.match(error.stderr, /npm ci/u);
    assert.match(error.stderr, /npm run prepare/u);
    return true;
  });
  await assert.rejects(access(path.join(directory, "node_modules")), { code: "ENOENT" });
  await assert.rejects(access(path.join(directory, ".cautest")), { code: "ENOENT" });
});

test("source entry SIGINT returns 130 after executing registered cleanup", { timeout: 15_000 }, async (t) => {
  const directory = await temporary(t);
  const config = path.join(directory, "cautest.config.mjs");
  const marker = path.join(directory, "cleanup");
  await writeFile(config, `import { testConfig, testJob, defineStep } from '@cautest/config.js';
import { writeFile } from 'node:fs/promises';
export default testConfig({ jobs: [testJob({ id:'unit.interrupt', level:'unit', workflow: [defineStep({kind:'wait', phase:'run', async execute(context) {
  context.defer(() => writeFile(${JSON.stringify(marker)}, 'closed'));
  context.output('stdout', 'INTERRUPT_READY\\n');
  await new Promise((_, reject) => { const handle = setInterval(() => {}, 100); context.signal.addEventListener('abort', () => { clearInterval(handle); reject(context.signal.reason); }, {once:true}); });
}})] })] });\n`);
  const child = spawn(process.execPath, [path.join(root, "cautest.js"), "--config", config, "run", "--verbose"], { cwd: directory, stdio: ["ignore", "pipe", "pipe"] });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); });
  const exit = once(child, "exit");
  let stderr = "";
  const ready = new Promise((resolve) => {
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); if (stderr.includes("INTERRUPT_READY")) resolve(); });
  });
  const winner = await Promise.race([ready.then(() => "ready"), exit.then(() => "exit")]);
  assert.equal(winner, "ready", stderr);
  child.kill("SIGINT");
  const [code, signal] = await exit;
  assert.equal(code, 130, stderr);
  assert.equal(signal, null);
  assert.equal(await readFile(marker, "utf8"), "closed");
});
