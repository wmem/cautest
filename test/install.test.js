import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const exec = promisify(execFile);
const projectRoot = path.resolve(new URL("..", import.meta.url).pathname);
const installer = path.join(projectRoot, "dist/install.js");

async function prepareBuildInfo() {
  await exec(process.execPath, ["dist/build-info.js"], { cwd: projectRoot });
}

test("安装器生成无 TypeScript 和 node_modules 的自包含便携目录", async () => {
  await prepareBuildInfo();
  const temporary = await mkdtemp(path.join(os.tmpdir(), "cautest-v2-install-"));
  const destination = path.join(temporary, "tools/cautest");
  await exec(process.execPath, [installer, destination], { cwd: temporary });
  const rootEntries = await readdir(destination);
  assert.ok(rootEntries.includes("cautest.js"));
  assert.ok(rootEntries.includes("lib"));
  assert.ok(!rootEntries.includes("node_modules"));
  assert.deepEqual(await readdir(path.join(destination, "lib/runtime")), ["cli.d.ts", "cli.d.ts.map", "cli.js", "cli.js.map"]);

  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const location = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(location);
      else assert.ok(!entry.name.endsWith(".ts") || entry.name.endsWith(".d.ts"), `便携目录包含 TypeScript 源码: ${location}`);
    }
  }
  await visit(destination);

  const config = path.join(temporary, "cautest.config.mjs");
  await writeFile(config, `import { defineStep, testConfig, testJob } from '@cautest/config';

const prepare = defineStep({ kind: 'prepareFixture', phase: 'prepare', execute() {} });
const run = defineStep({ kind: 'runFixture', phase: 'run', execute() {} });

export default testConfig({ jobs: [
  testJob({ id: 'unit.example', level: 'unit', tags: ['unit'], workflow: [prepare, run] }),
] });
`);
  const listed = await exec(path.join(destination, "cautest.js"), ["--config", config, "list"], { cwd: temporary });
  assert.match(listed.stdout, /^unit\.example\tunit\tenabled\tunit$/mu);
  const planned = await exec(path.join(destination, "cautest.js"), ["--config", config, "plan", "unit.example"], { cwd: temporary });
  assert.match(planned.stdout, /01-prepare-prepareFixture-prepareFixture/u);
  assert.match(planned.stdout, /02-run-runFixture-runFixture/u);
  assert.match((await exec(path.join(destination, "cautest.js"), ["--version"])).stdout, /^Cautest 0\.2\.0 \(commit /u);
  assert.equal((await lstat(path.join(destination, "cautest.js"))).mode & 0o111, 0o111);
  assert.equal(JSON.parse(await readFile(path.join(destination, "manifest.json"), "utf8")).product, "cautest-portable");
});

test("安装器拒绝非空目录且不覆盖内容", async () => {
  await prepareBuildInfo();
  const temporary = await mkdtemp(path.join(os.tmpdir(), "cautest-v2-safe-"));
  const destination = path.join(temporary, "cautest");
  await mkdir(destination);
  await writeFile(path.join(destination, "keep.txt"), "keep\n");
  await assert.rejects(exec(process.execPath, [installer, destination], { cwd: temporary }));
  assert.equal(await readFile(path.join(destination, "keep.txt"), "utf8"), "keep\n");
});
