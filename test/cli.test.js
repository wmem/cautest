import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runCli } from "../dist/runtime/cli.js";

const configModule = new URL("../dist/config/index.js", import.meta.url).href;

function streams() {
  let stdout = "";
  let stderr = "";
  return {
    value: { get stdout() { return stdout; }, get stderr() { return stderr; } },
    streams: { stdout: { write(text) { stdout += text; } }, stderr: { write(text) { stderr += text; } } },
  };
}

test("run --json 保持 stdout 结构化并实时写 stderr", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cautest-cli-run-"));
  const config = path.join(root, "cautest.config.mjs");
  await writeFile(config, `import { defineStep, testConfig, testJob } from ${JSON.stringify(configModule)};
const build = defineStep({ kind: 'fixtureBuild', phase: 'build', async execute({ output }) { output('stdout', 'build-log\\n'); await new Promise((resolve) => setTimeout(resolve, 25)); return { diagnostics: [{ code: 'cache_hit' }] }; } });
const run = defineStep({ kind: 'fixtureRun', phase: 'run', execute() { return { testResults: [{ name: 'suite', cases: [{ name: 'case', status: 'PASS', assertions: [], diagnostics: [] }] }] }; } });
export default testConfig({ defaults: { resultDir: '.state/results' }, jobs: [testJob({ id: 'unit.fixture', level: 'unit', workflow: [build, run] })] });\n`);
  const io = streams();
  const previous = process.env.CAUTEST_HEARTBEAT_MS;
  process.env.CAUTEST_HEARTBEAT_MS = "5";
  try {
    assert.equal(await runCli(["--config", config, "run", "--json", "--verbose"], io.streams), 0);
  } finally {
    if (previous === undefined) delete process.env.CAUTEST_HEARTBEAT_MS;
    else process.env.CAUTEST_HEARTBEAT_MS = previous;
  }
  const summary = JSON.parse(io.value.stdout);
  assert.equal(summary.status, "SUCCESS");
  assert.match(io.value.stderr, /START Job unit\.fixture/u);
  assert.match(io.value.stderr, /HEARTBEAT Step/u);
  assert.match(io.value.stderr, /CACHE HIT/u);
  assert.match(io.value.stderr, /build-log/u);
  assert.match(io.value.stderr, /END Job unit\.fixture SUCCESS \d+ms/u);
  assert.equal(summary.jobs[0].durationMs > 0, true);
  assert.equal(JSON.parse(await readFile(path.join(summary.resultDir, "summary.json"), "utf8")).runId, summary.runId);
});

test("doctor 在执行前报告稳定错误码", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cautest-cli-doctor-"));
  const config = path.join(root, "cautest.config.mjs");
  await writeFile(config, `import { defineStep, testConfig, testJob } from ${JSON.stringify(configModule)};
const build = defineStep({ kind: 'kernelModuleBuild', name: 'bad', phase: 'build', details: { sourceDir: 'missing', output: '../bad.ko', extraModules: ['unknown'] }, execute() { throw new Error('不得执行'); } });
export default testConfig({ jobs: [testJob({ id: 'unit.bad', level: 'unit', workflow: [build] })] });\n`);
  const io = streams();
  assert.equal(await runCli(["--config", config, "doctor", "--json"], io.streams), 5);
  const codes = JSON.parse(io.value.stdout).issues.map((issue) => issue.code);
  assert.ok(codes.includes("CT-DOCTOR-KMOD-001"));
  assert.ok(codes.includes("CT-DOCTOR-KMOD-003"));
  assert.ok(codes.includes("CT-DOCTOR-KMOD-004"));
});

test("clean --all 只删除配置声明的受管目录", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cautest-cli-clean-"));
  const config = path.join(root, "cautest.config.mjs");
  await writeFile(config, `import { defineStep, testConfig, testJob } from ${JSON.stringify(configModule)};
const step = defineStep({ kind: 'fixture', phase: 'run', execute() {} });
export default testConfig({ defaults: { resultDir: '.managed/results', cacheDir: '.managed/cache', generatedDir: '.managed/generated', workDir: '.managed/work' }, jobs: [testJob({ id: 'unit.fixture', level: 'unit', workflow: [step] })] });\n`);
  await mkdir(path.join(root, ".managed/cache"), { recursive: true });
  await writeFile(path.join(root, ".managed/cache/artifact"), "x");
  await writeFile(path.join(root, "keep.txt"), "keep");
  const io = streams();
  assert.equal(await runCli(["--config", config, "clean", "--all"], io.streams), 0);
  assert.equal(await readFile(path.join(root, "keep.txt"), "utf8"), "keep");
  await assert.rejects(readFile(path.join(root, ".managed/cache/artifact")));
});

test("run 子命令提供独立帮助", async () => {
  const io = streams();
  assert.equal(await runCli(["run", "--help"], io.streams), 0);
  assert.match(io.value.stdout, /^用法: cautest .* run/u);
});

test("--version 和 -V 无需配置即可显示 Release 与 Commit", async () => {
  for (const option of ["--version", "-V"]) {
    const io = streams();
    assert.equal(await runCli([option], io.streams), 0);
    assert.match(io.value.stdout, /^Cautest 0\.2\.0 \(commit /u);
  }
});

test("CLI Profile 生成 Reporter，并支持 level/tag/Glob 筛选", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cautest-cli-profile-"));
  const config = path.join(root, "cautest.config.mjs");
  await writeFile(config, `import { defineStep, testConfig, testJob } from ${JSON.stringify(configModule)};
const run = defineStep({ kind: 'fixtureRun', phase: 'run', execute({ job }) { return { testResults: [{ name: 'suite', cases: [{ name: job.env.PROFILE ?? 'missing', status: 'PASS', assertions: [], diagnostics: [] }] }] }; } });
export default testConfig({ defaults: { resultDir: '.state/results' }, profiles: [{ id: 'ci', reporters: ['json', 'junit', 'html'], env: { PROFILE: 'profile-applied' } }], jobs: [
  testJob({ id: 'unit.fast', level: 'unit', tags: ['fast'], workflow: [run] }),
  testJob({ id: 'system.slow', level: 'system', tags: ['slow'], workflow: [run] }),
] });\n`);
  const listed = streams();
  assert.equal(await runCli(["--config", config, "list", "unit.*", "--level", "unit", "--tag", "fast"], listed.streams), 0);
  assert.match(listed.value.stdout, /unit\.fast/u);
  assert.doesNotMatch(listed.value.stdout, /system\.slow/u);

  const io = streams();
  assert.equal(await runCli(["--config", config, "run", "unit.*", "--profile", "ci", "--json"], io.streams), 0);
  const summary = JSON.parse(io.value.stdout);
  assert.equal(summary.jobs[0].groups[0].cases[0].name, "profile-applied");
  assert.match(await readFile(path.join(summary.resultDir, "junit.xml"), "utf8"), /<testsuites/u);
  assert.match(await readFile(path.join(summary.resultDir, "report.html"), "utf8"), /Step 时间线/u);
  assert.equal(JSON.parse(await readFile(path.join(summary.resultDir, "run.json"), "utf8")).id, summary.id);
});
