import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile, access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root = fileURLToPath(new URL("..", import.meta.url));

test("npm scripts and lockfile no longer require a pnpm installation", async () => {
  const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  const lock = JSON.parse(await readFile(path.join(root, "package-lock.json"), "utf8"));
  assert.match(manifest.packageManager, /^npm@/u);
  for (const [name, script] of Object.entries(manifest.scripts)) assert.doesNotMatch(script, /\bpnpm\b/u, name);
  assert.deepEqual(lock.packages[""].devDependencies, manifest.devDependencies);
  for (const [name, version] of Object.entries(manifest.devDependencies)) {
    const item = lock.packages[`node_modules/${name}`];
    assert.equal(item.version, version);
    assert.match(item.integrity, /^sha512-[A-Za-z0-9+/]+=*$/u);
    assert.ok(item.dev);
    assert.ok(!item.link);
  }
  await assert.rejects(access(path.join(root, "pnpm-lock.yaml")), { code: "ENOENT" });
});

test("npm tarball installs and runs in an empty consumer offline without dev dependencies", { timeout: 120_000 }, async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "cautest-npm-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const consumer = path.join(temporary, "consumer with spaces 中文");
  await mkdir(consumer);
  const env = { ...process.env, npm_config_offline: "true", npm_config_audit: "false", npm_config_fund: "false", npm_config_cache: path.join(temporary, "cache") };
  const packed = JSON.parse((await exec("npm", ["pack", "--json", "--pack-destination", temporary], { cwd: root, env, maxBuffer: 10 * 1024 * 1024 })).stdout)[0];
  await writeFile(path.join(consumer, "package.json"), JSON.stringify({ name: "consumer", private: true, type: "module" }));
  await exec("npm", ["install", "--offline", "--no-audit", "--no-fund", path.join(temporary, packed.filename)], { cwd: consumer, env });
  const api = await exec(process.execPath, ["--input-type=module", "-e", "import { selectJobs } from 'cautest'; import { testJob } from 'cautest/config.js'; console.log(typeof selectJobs, typeof testJob);"], { cwd: consumer, env });
  assert.equal(api.stdout.trim(), "function function");
  await assert.rejects(access(path.join(consumer, "node_modules/typescript")), { code: "ENOENT" });
  const destination = path.join(consumer, "tools/cautest");
  await exec(process.execPath, [path.join(consumer, "node_modules/cautest/dist/install.js"), destination], { cwd: consumer, env });
  const config = path.join(consumer, "cautest.config.mjs");
  await writeFile(config, `import { defineStep, testConfig, testJob } from '@cautest/config.js';
export default testConfig({ jobs: [testJob({ id: 'unit.npm', level: 'unit', policy: { allowEmpty: true }, workflow: [defineStep({kind: 'npmSmoke', phase: 'run', execute() { return { testResults: [{ name: 'npm', cases: [{ name: 'installed', status: 'PASS', assertions: [], diagnostics: [] }] }] }; }} )] })] });\n`);
  const executable = path.join(destination, "cautest.js");
  assert.match((await exec(process.execPath, [executable, "--version"], { cwd: temporary, env })).stdout, /^Cautest /u);
  const result = await exec(process.execPath, [executable, "--config", config, "run", "--json"], { cwd: temporary, env });
  assert.equal(JSON.parse(result.stdout).status, "SUCCESS", result.stderr);
  // Exercise npm's named installer path without fetching or creating a consumer dependency.
  const execDestination = path.join(temporary, "exec/tools/cautest");
  await exec("npm", ["exec", "--offline", "--yes", `--package=${path.join(temporary, packed.filename)}`, "--", "cautest-install", execDestination], { cwd: temporary, env, timeout: 60_000 });
  assert.match((await exec(process.execPath, [path.join(execDestination, "cautest.js"), "--version"], { env })).stdout, /^Cautest /u);
});
