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
  const result = JSON.parse(await readFile(summary.resultPath, "utf8"));
  assert.equal(summary.status, "SUCCESS");
  assert.equal(summary.schemaVersion, 1);
  assert.equal(summary.command, "run");
  assert.equal("jobs" in summary, false);
  assert.match(io.value.stderr, /START Job unit\.fixture/u);
  assert.match(io.value.stderr, /HEARTBEAT Step/u);
  assert.match(io.value.stderr, /CACHE HIT/u);
  assert.match(io.value.stderr, /build-log/u);
  assert.match(io.value.stderr, /END Job unit\.fixture SUCCESS \d+ms/u);
  assert.equal(result.jobs[0].durationMs > 0, true);
  assert.equal(JSON.parse(await readFile(path.join(summary.resultDir, "summary.json"), "utf8")).runId, summary.runId);
});

test("doctor 在执行前报告稳定错误码", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cautest-cli-doctor-"));
  const config = path.join(root, "cautest.config.mjs");
  await writeFile(config, `import { defineStep, testConfig, testJob } from ${JSON.stringify(configModule)};
const build = defineStep({ kind: 'kernelModuleBuild', name: 'bad', phase: 'build', details: { sourceDir: 'missing', output: '../bad.ko', extraModules: ['unknown'] }, execute() { throw new Error('不得执行'); } });
export default testConfig({ jobs: [testJob({ id: 'unit.bad', level: 'unit', workflow: [build] })] });\n`);
  const io = streams();
  assert.equal(await runCli(["--config", config, "doctor", "--json"], io.streams), 2);
  const codes = JSON.parse(io.value.stdout).issues.map((issue) => issue.code);
  assert.ok(codes.includes("CT-DOCTOR-KMOD-001"));
  assert.ok(codes.includes("CT-DOCTOR-KMOD-003"));
  assert.ok(codes.includes("CT-DOCTOR-KMOD-004"));
});

test("doctor 警告 Kernel 和 BusyBox Build 继承通用 60 秒超时", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cautest-cli-doctor-timeout-"));
  await mkdir(path.join(root, "kernel"), { recursive: true });
  await mkdir(path.join(root, "busybox"), { recursive: true });
  await writeFile(path.join(root, "kernel/Makefile"), "all:\n\t@true\n");
  await writeFile(path.join(root, "busybox/Makefile"), "all:\n\t@true\n");
  const configSource = (timeoutFields) => `import { defineStep, testConfig, testJob } from ${JSON.stringify(configModule)};
const steps = [
  defineStep({ kind: 'kernelBuild', phase: 'build', details: { sourceDir: 'kernel', make: '/usr/bin/make' }, ${timeoutFields.kernel}execute() {} }),
  defineStep({ kind: 'busyboxBuild', phase: 'build', details: { sourceDir: 'busybox', make: '/usr/bin/make', static: false }, ${timeoutFields.busybox}execute() {} }),
];
export default testConfig({ jobs: [testJob({ id: 'integration.timeout', level: 'integration', workflow: steps })] });\n`;

  const inheritedConfig = path.join(root, "inherited.config.mjs");
  await writeFile(inheritedConfig, configSource({ kernel: "", busybox: "" }));
  const inherited = streams();
  assert.equal(await runCli(["--config", inheritedConfig, "doctor", "--json"], inherited.streams), 0);
  const inheritedResult = JSON.parse(inherited.value.stdout);
  assert.equal(inheritedResult.status, "SUCCESS");
  const warnings = inheritedResult.issues.filter((item) => item.code === "CT-DOCTOR-TIMEOUT-001");
  assert.deepEqual(warnings.map((item) => item.step), ["kernelBuild", "busyboxBuild"]);
  assert.ok(warnings.every((item) => item.severity === "warning"));
  assert.ok(warnings.every((item) => item.hint.includes("--run-timeout 只控制 C Test Run")));

  const explicitConfig = path.join(root, "explicit.config.mjs");
  await writeFile(explicitConfig, configSource({ kernel: "timeoutMs: 20 * 60_000, ", busybox: "timeoutMs: 10 * 60_000, " }));
  const explicit = streams();
  assert.equal(await runCli(["--config", explicitConfig, "doctor", "--json"], explicit.streams), 0);
  assert.equal(JSON.parse(explicit.value.stdout).issues.some((item) => item.code === "CT-DOCTOR-TIMEOUT-001"), false);
});

test("doctor 检查 Toolchain、静态链接、UML ptrace、受管目录和 Kernel 污染", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cautest-cli-doctor-host-"));
  const config = path.join(root, "cautest.config.mjs");
  await mkdir(path.join(root, "kernel"), { recursive: true });
  await writeFile(path.join(root, "kernel/Makefile"), "all:\n\t@true\n");
  await writeFile(path.join(root, "kernel/.config"), "CONFIG_TEST=y\n");
  await writeFile(path.join(root, "blocked"), "not a directory");
  await writeFile(config, `import { defineStep, testConfig, testJob } from ${JSON.stringify(configModule)};
const steps = [
  defineStep({ kind: 'kernelBuild', phase: 'build', details: { sourceDir: 'kernel', make: '/usr/bin/make' }, execute() {} }),
  defineStep({ kind: 'driverGuestCTestBuild', phase: 'build', details: { compiler: process.execPath, static: true }, execute() {} }),
  defineStep({ kind: 'umlRootfsBuild', phase: 'build', details: { cpio: 'missing-cautest-cpio' }, execute() {} }),
  defineStep({ kind: 'umlStart', phase: 'provision', execute() {} }),
  defineStep({ kind: 'nativeCoverage', phase: 'collect', runWhen: 'always', details: { tool: 'missing-cautest-gcov' }, execute() {} }),
];
export default testConfig({ defaults: { resultDir: 'blocked/results' }, jobs: [testJob({ id: 'integration.doctor.host', level: 'integration', env: { PATH: '/missing' }, workflow: steps })] });\n`);
  const io = streams();
  assert.equal(await runCli(["--config", config, "doctor", "--json"], io.streams), 2);
  const issues = JSON.parse(io.value.stdout).issues;
  const codes = new Set(issues.map((item) => item.code));
  for (const code of ["CT-DOCTOR-TOOL-001", "CT-DOCTOR-STATIC-001", "CT-DOCTOR-UML-PTRACE-001", "CT-DOCTOR-DIRECTORY-001", "CT-DOCTOR-KERNEL-DIRTY-001"]) assert.ok(codes.has(code), code);
  assert.ok(issues.some((item) => /missing-cautest-cpio/u.test(item.message)));
  assert.ok(issues.some((item) => /missing-cautest-gcov/u.test(item.message)));
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

test("clean 支持选择性范围且不删除未选择目录", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cautest-cli-clean-selected-"));
  const config = path.join(root, "cautest.config.mjs");
  await writeFile(config, `import { defineStep, testConfig, testJob } from ${JSON.stringify(configModule)};
const step = defineStep({ kind: 'fixture', phase: 'run', execute() {} });
export default testConfig({ defaults: { resultDir: '.managed/results', cacheDir: '.managed/cache' }, jobs: [testJob({ id: 'unit.fixture', level: 'unit', workflow: [step] })] });\n`);
  await mkdir(path.join(root, ".managed/results"), { recursive: true });
  await mkdir(path.join(root, ".managed/cache"), { recursive: true });
  await writeFile(path.join(root, ".managed/results/result"), "result");
  await writeFile(path.join(root, ".managed/cache/artifact"), "cache");
  const io = streams();
  assert.equal(await runCli(["--config", config, "clean", "--results"], io.streams), 0);
  await assert.rejects(readFile(path.join(root, ".managed/results/result")));
  assert.equal(await readFile(path.join(root, ".managed/cache/artifact"), "utf8"), "cache");
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
  const result = JSON.parse(await readFile(summary.resultPath, "utf8"));
  assert.equal(result.jobs[0].groups[0].cases[0].name, "profile-applied");
  assert.match(await readFile(path.join(summary.resultDir, "junit.xml"), "utf8"), /<testsuites/u);
  assert.match(await readFile(path.join(summary.resultDir, "report.html"), "utf8"), /Step 时间线/u);
  assert.equal(JSON.parse(await readFile(path.join(summary.resultDir, "run.json"), "utf8")).id, summary.runId);
});

test("CLI Profile Env 实际覆盖标准 Native Job 的构建期闭包环境", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cautest-cli-native-profile-"));
  const config = path.join(root, "cautest.config.mjs");
  await writeFile(path.join(root, "profile.c"), `#include <cautest/cautest.h>\n#include <stdlib.h>\n#include <string.h>\nCAUTEST_CASE(profile_env) { const char *value = getenv("CAUTEST_PROFILE_ENV"); (void)suite_fixture; (void)case_fixture; (void)cautest_parameter; CAUTEST_EXPECT_TRUE(value != 0 && strcmp(value, "profile-value") == 0); }\nCAUTEST_SUITE(profile_suite, CAUTEST_CASE_ENTRY(profile_env));\n`);
  await writeFile(config, `import { nativeCTestJob, testConfig } from ${JSON.stringify(configModule)};
export default testConfig({ defaults: { resultDir: '.state/results' }, profiles: [{ id: 'ci', env: { CAUTEST_PROFILE_ENV: 'profile-value' } }], jobs: [
  nativeCTestJob({ id: 'unit.native.profile', env: { CAUTEST_PROFILE_ENV: 'job-value' }, tests: ['profile.c'], suites: ['profile_suite'] }),
] });\n`);
  const io = streams();
  assert.equal(await runCli(["--config", config, "run", "--profile", "ci", "--json"], io.streams), 0, io.value.stderr);
  const summary = JSON.parse(io.value.stdout);
  const result = JSON.parse(await readFile(summary.resultPath, "utf8"));
  assert.equal(summary.status, "SUCCESS");
  assert.equal(result.jobs[0].groups[0].cases[0].status, "PASS");
});

test("CLI C Test 覆盖、显式 Reporter、输出目录和 Direct Process Session", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cautest-cli-direct-"));
  const config = path.join(root, "cautest.config.mjs");
  await writeFile(path.join(root, "cases.c"), `#include <cautest/cautest.h>\nCAUTEST_CASE(passes) { (void)suite_fixture; (void)case_fixture; (void)cautest_parameter; CAUTEST_EXPECT_TRUE(1); }\nCAUTEST_CASE(fails) { (void)suite_fixture; (void)case_fixture; (void)cautest_parameter; CAUTEST_EXPECT_TRUE(0); }\nCAUTEST_SUITE(cli_suite, CAUTEST_CASE_ENTRY(passes), CAUTEST_CASE_ENTRY(fails));\n`);
  await writeFile(config, `import { nativeCTestJob, testConfig } from ${JSON.stringify(configModule)};
export default testConfig({ jobs: [nativeCTestJob({ id: 'unit.cli.filter', tests: ['cases.c'], suites: ['cli_suite'] })] });\n`);
  const filtered = streams();
  assert.equal(await runCli(["--config", config, "run", "--case", "passes", "--case-timeout", "1000", "--run-timeout", "5000", "--suite-policy", "STOP_ON_FAIL", "--reporter", "junit,html", "--output-dir", "custom-results", "--json"], filtered.streams), 0, filtered.value.stderr);
  const first = JSON.parse(filtered.value.stdout);
  const firstResult = JSON.parse(await readFile(first.resultPath, "utf8"));
  assert.deepEqual(firstResult.jobs[0].groups[0].cases.map((item) => item.name), ["passes"]);
  assert.equal(path.dirname(first.resultDir), path.join(root, "custom-results"));
  assert.match(await readFile(path.join(first.resultDir, "junit.xml"), "utf8"), /cli_suite/u);
  assert.match(await readFile(path.join(first.resultDir, "report.html"), "utf8"), /passes/u);

  const binary = firstResult.jobs[0].artifacts.find((item) => item.kind === "native-test");
  const direct = streams();
  assert.equal(await runCli(["session", "process", "--target", binary.path, "--case", "passes", "--reporter", "junit", "--output-dir", path.join(root, "direct-results"), "--json"], direct.streams), 0, direct.value.stderr);
  const second = JSON.parse(direct.value.stdout);
  const secondResult = JSON.parse(await readFile(second.resultPath, "utf8"));
  assert.equal(secondResult.jobs[0].jobId, "direct.session");
  assert.deepEqual(secondResult.jobs[0].groups[0].cases.map((item) => item.name), ["passes"]);
  assert.match(await readFile(path.join(second.resultDir, "junit.xml"), "utf8"), /passes/u);
});

test("describe 支持公开 Job Factory/Preset 概要", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cautest-cli-describe-preset-"));
  const config = path.join(root, "cautest.config.mjs");
  await writeFile(config, `import { defineStep, testConfig, testJob } from ${JSON.stringify(configModule)};\nconst step = defineStep({ kind: 'fixture', phase: 'run', execute() {} });\nexport default testConfig({ jobs: [testJob({ id: 'unit.fixture', level: 'unit', workflow: [step] })] });\n`);
  const io = streams();
  assert.equal(await runCli(["--config", config, "describe", "nativeCTestJob", "--json"], io.streams), 0, io.value.stderr);
  const value = JSON.parse(io.value.stdout);
  assert.equal(value.preset.name, "nativeCTestJob");
  assert.match(value.preset.summary, /CTP3/u);
});

test("CLI 稳定区分 FAIL、ERROR、参数错误和显式空选择", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cautest-cli-exit-codes-"));
  const config = path.join(root, "cautest.config.mjs");
  await writeFile(config, `import { defineStep, testConfig, testJob } from ${JSON.stringify(configModule)};
const failed = defineStep({ kind: 'fixture', name: 'failed', phase: 'run', execute() { return { outcome: 'FAIL', testResults: [{ name: 'suite', cases: [{ name: 'failed', status: 'FAIL', assertions: [], diagnostics: [] }] }] }; } });
const broken = defineStep({ kind: 'fixture', name: 'broken', phase: 'run', execute() { throw new Error('infrastructure broken'); } });
export default testConfig({ jobs: [
  testJob({ id: 'unit.failed', level: 'unit', tags: ['selected'], workflow: [failed] }),
  testJob({ id: 'unit.broken', level: 'unit', workflow: [broken] }),
  testJob({ id: 'unit.disabled', level: 'unit', enabled: false, workflow: [failed] }),
] });\n`);
  assert.equal(await runCli(["--config", config, "run", "unit.failed", "--json"], streams().streams), 1);
  assert.equal(await runCli(["--config", config, "run", "unit.broken", "--json"], streams().streams), 2);
  assert.equal(await runCli(["--config", config, "run", "--level", "typo"], streams().streams), 3);
  assert.equal(await runCli(["--config", config, "run", "unit.disabled"], streams().streams), 4);
  assert.equal(await runCli(["--config", config, "plan", "missing.*"], streams().streams), 4);
  assert.equal(await runCli(["--config", config, "list", "--tag", "missing"], streams().streams), 4);
  assert.equal(await runCli(["--config", config, "doctor", "--tag", "missing"], streams().streams), 4);
  assert.equal(await runCli(["--config", config, "describe", "missing", "--json"], streams().streams), 4);
});
