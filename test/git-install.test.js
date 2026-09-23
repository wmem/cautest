import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const exec = promisify(execFile);
const projectRoot = path.resolve(new URL("..", import.meta.url).pathname);

async function createGitSnapshot() {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "cautest-v2-git-"));
  const repository = path.join(temporary, "repository");
  await mkdir(repository);
  for (const entry of ["cautest.js", "xmake.lua", "adapters", "assets", "docs", "examples", "scripts", "src", "package.json", "package-lock.json", "README.md", "tsconfig.json", "versions.json"]) {
    await cp(path.join(projectRoot, entry), path.join(repository, entry), { recursive: true });
  }
  await exec("git", ["init", "-b", "main"], { cwd: repository });
  await exec("git", ["config", "user.name", "Cautest Test"], { cwd: repository });
  await exec("git", ["config", "user.email", "cautest@example.invalid"], { cwd: repository });
  await exec("git", ["add", "."], { cwd: repository });
  await exec("git", ["commit", "-m", "测试快照"], { cwd: repository });
  const commit = (await exec("git", ["rev-parse", "HEAD"], { cwd: repository })).stdout.trim();
  return { temporary, repository, url: `git+file://${repository}#${commit}` };
}

async function verifyPortable(destination) {
  const names = await readdir(destination);
  assert.ok(names.includes("cautest.js"));
  assert.ok(names.includes("docs"));
  assert.ok(names.includes("xmake.lua"));
  assert.ok(names.includes("adapters"));
  assert.ok(!names.includes("usage"));
  assert.ok(!names.includes("node_modules"));
  const config = path.join(path.dirname(path.dirname(destination)), `${path.basename(destination)}.config.mjs`);
    await writeFile(config, `import { defineStep, testConfig, testJob } from '@cautest/config.js';
const step = defineStep({ kind: 'gitFixture', phase: 'run', execute() {} });
export default testConfig({ jobs: [testJob({ id: 'system.git', level: 'system', workflow: [step] })] });
`);
  const result = await exec(path.join(destination, "cautest.js"), ["--config", config, "plan", "system.git"]);
  assert.match(result.stdout, /01-run-gitFixture-gitFixture/u);
  const build = JSON.parse(await readFile(path.join(destination, "build-info.json"), "utf8"));
  assert.match(build.commit, /^[0-9a-f]{40}$/u);
}

test("npx 和 npm exec 都可从 Git Commit 编译并安装", { timeout: 360_000 }, async (t) => {
  const snapshot = await createGitSnapshot();
  t.after(() => rm(snapshot.temporary, { recursive: true, force: true }));
  const npxDestination = path.join(snapshot.temporary, "npx-project/tools/cautest");
  const npmDestination = path.join(snapshot.temporary, "npm-project/tools/cautest");
  await mkdir(path.dirname(path.dirname(npxDestination)), { recursive: true });
  await mkdir(path.dirname(path.dirname(npmDestination)), { recursive: true });

  await exec("npx", ["--yes", snapshot.url, npxDestination], {
    cwd: path.join(snapshot.temporary, "npx-project"),
    timeout: 180_000,
    maxBuffer: 10 * 1024 * 1024,
  });
  await verifyPortable(npxDestination);

  await exec("npm", ["exec", "--yes", `--package=${snapshot.url}`, "--", "cautest-install", npmDestination], {
    cwd: path.join(snapshot.temporary, "npm-project"),
    timeout: 180_000,
    maxBuffer: 10 * 1024 * 1024,
  });
  await verifyPortable(npmDestination);
});
