import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { EventRecorder, nativeCTestJob } from "../dist/config/index.js";
import { planConfig } from "../dist/config/plan.js";
import { testConfig } from "../dist/config/define.js";
import { executeWorkflow } from "../dist/workflow/engine.js";

const projectRoot = path.resolve(new URL("..", import.meta.url).pathname);

function job(id, include) {
  return nativeCTestJob({
    id,
    tests: ["test/fixtures/native/*.c"],
    headers: ["assets/cautest-c/include/cautest/*.h"],
    suites: ["smoke"],
    run: { include: [include] },
  });
}

test("Native Job 展开、真实编译并通过 CTP3 返回结构化结果和缓存命中", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "cautest-v2-native-"));
  const project = {
    configDir: projectRoot,
    resultDir: path.join(temporary, "results"),
    cacheDir: path.join(temporary, "cache"),
    generatedDir: path.join(temporary, "generated"),
    workDir: path.join(temporary, "work"),
  };
  const before = await readdir(path.join(projectRoot, "test/fixtures/native"));
  const passing = job("unit.native.passing", "smoke/passes");
  assert.deepEqual(planConfig(testConfig({ jobs: [passing] }))[0].workflow.map((step) => step.kind), ["nativeCompile", "cTestRun"]);
  const first = await executeWorkflow(passing, { project });
  assert.equal(first.status, "SUCCESS");
  assert.equal(first.steps[0].diagnostics[0].code, "cache_miss");
  assert.equal(first.steps[1].testResults[0].cases[0].status, "PASS");
  const second = await executeWorkflow(passing, { project });
  assert.equal(second.steps[0].diagnostics[0].code, "cache_hit");

  const failing = await executeWorkflow(job("unit.native.failing", "smoke/fails"), { project });
  assert.equal(failing.status, "FAIL");
  const failedCase = failing.steps[1].testResults[0].cases[0];
  assert.equal(failedCase.status, "FAIL");
  assert.deepEqual(failedCase.assertions[0].expected, { type: "integer", value: "1" });
  assert.deepEqual(failedCase.assertions[0].actual, { type: "integer", value: "2" });
  assert.deepEqual(await readdir(path.join(projectRoot, "test/fixtures/native")), before);
  const cacheKeys = await readdir(path.join(temporary, "cache/native"));
  assert.equal(cacheKeys.length, 1);
  assert.equal(JSON.parse(await readFile(path.join(temporary, "cache/native", cacheKeys[0], "manifest.json"), "utf8")).schema, 2);

  const covered = nativeCTestJob({
    id: "unit.native.coverage",
    tests: ["test/fixtures/native/*.c"],
    suites: ["smoke"],
    run: { include: ["smoke/passes"] },
    coverage: {},
  });
  const coverageResult = await executeWorkflow(covered, { project });
  assert.equal(coverageResult.status, "SUCCESS");
  assert.deepEqual(coverageResult.steps.map((step) => step.kind), ["nativeCompile", "cTestRun", "nativeCoverage"]);
  assert.equal((await readdir(path.join(temporary, "results/coverage/unit-native-coverage"))).some((name) => name.endsWith(".gcov")), true);
});

test("Native 发布 Build/Log/Coverage Artifact 并保持 Cache 完整性", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "cautest-v2-native-artifacts-"));
  const project = { configDir: projectRoot, resultDir: path.join(temporary, "results"), cacheDir: path.join(temporary, "cache"), generatedDir: path.join(temporary, "generated"), workDir: path.join(temporary, "work") };
  const definition = nativeCTestJob({ id: "unit.native.behavior", tests: ["test/fixtures/native/native_cases.c"], suites: ["native_cases", "snapshot_cases"], run: { include: ["native_cases/pass_case", "native_cases/parameter_case@*"] }, coverage: {} });
  const eventFile = path.join(temporary, "events.jsonl");
  const events = new EventRecorder({ file: eventFile });
  const first = await executeWorkflow(definition, { project, events });
  const eventProbe = await executeWorkflow(nativeCTestJob({ id: "unit.native.event-probe", tests: ["test/fixtures/native/native_cases.c"], suites: ["native_cases", "snapshot_cases"], run: { include: ["native_cases/fail_case"] } }), { project, events });
  await events.close();
  assert.equal(first.status, "SUCCESS");
  assert.equal(eventProbe.status, "FAIL");
  const binary = first.artifacts.find((item) => item.kind === "native-test");
  assert.equal(binary.buildId.length, 64); assert.equal(binary.metadata.cacheHit, false);
  assert.match(await readFile(first.artifacts.find((item) => item.name.endsWith("-stdout")).path, "utf8"), /native stdout marker/u);
  assert.match(await readFile(first.artifacts.find((item) => item.name.endsWith("-stderr")).path, "utf8"), /native stderr marker/u);
  assert.match(await readFile(first.artifacts.find((item) => item.name.endsWith("-target")).path, "utf8"), /native structured log/u);
  const eventTypes = (await readFile(eventFile, "utf8")).trim().split("\n").map((line) => JSON.parse(line).type);
  for (const type of ["EXEC_START", "SUITE_START", "CASE_START", "ASSERTION", "TARGET_LOG", "CASE_END", "SUITE_END", "EXEC_END"]) assert.equal(eventTypes.includes(type), true, type);
  const sessionDiagnostic = first.steps[1].diagnostics.find((item) => item.code === "c_test_session");
  assert.deepEqual(sessionDiagnostic.selection.map((item) => item.name), ["native_cases/pass_case", "native_cases/parameter_case@one", "native_cases/parameter_case@two"]);
  const coverage = first.artifacts.find((item) => item.kind === "coverage"); assert.equal(coverage.metadata.adapter, "gcov"); assert.ok(coverage.metadata.reports.some((file) => file.endsWith(".gcov")));
  await writeFile(binary.path, "corrupt");
  const repaired = await executeWorkflow(definition, { project }); assert.equal(repaired.status, "SUCCESS"); assert.equal(repaired.steps[0].diagnostics[0].code, "cache_miss");
});

test("Native Header 与 fingerprintEnv 进入指纹，自定义 Cache 根受边界保护", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "cautest-v2-native-fingerprint-")); const include = path.join(temporary, "include"); await mkdir(include); const header = path.join(include, "config.h"); await writeFile(header, "#define REV 1\n");
  await writeFile(path.join(temporary, "case.c"), "#include <cautest/cautest.h>\nCAUTEST_CASE(passes) { (void)suite_fixture; (void)case_fixture; (void)cautest_parameter; CAUTEST_EXPECT_TRUE(1); }\nCAUTEST_SUITE(smoke, CAUTEST_CASE_ENTRY(passes));\n");
  const project = { configDir: temporary, resultDir: path.join(temporary, "results"), cacheDir: path.join(temporary, ".cautest/cache"), generatedDir: path.join(temporary, ".cautest/generated"), workDir: path.join(temporary, ".cautest/work") };
  const make = (mode, cache) => nativeCTestJob({ id: "unit.native.fingerprint", tests: ["case.c"], headers: ["include/config.h"], suites: ["smoke"], env: { MODE: mode }, build: { cache: { fingerprintEnv: ["MODE"], ...(cache === undefined ? {} : { directory: cache }) } }, run: { include: ["smoke/passes"] } });
  const first = await executeWorkflow(make("debug"), { project }); await writeFile(header, "#define REV 2\n"); const headerChanged = await executeWorkflow(make("debug"), { project }); const envChanged = await executeWorkflow(make("release"), { project });
  assert.notEqual(first.artifacts[0].buildId, headerChanged.artifacts[0].buildId); assert.notEqual(headerChanged.artifacts[0].buildId, envChanged.artifacts[0].buildId);
  const unsafe = await executeWorkflow(make("debug", temporary), { project }); assert.equal(unsafe.status, "ERROR"); assert.match(unsafe.errors[0].message, /专用子目录/u);
});

test("Profile Env 覆盖 Native Job Env，并进入构建、运行和 Cache 指纹", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "cautest-v2-native-profile-env-"));
  const source = path.join(temporary, "profile.c");
  const compilerLog = path.join(temporary, "compiler-env.log");
  const compiler = path.join(temporary, "compiler.sh");
  await writeFile(source, `#include <cautest/cautest.h>\n#include <stdlib.h>\n#include <string.h>\nCAUTEST_CASE(profile_env) { const char *value = getenv("CAUTEST_PROFILE_ENV"); (void)suite_fixture; (void)case_fixture; (void)cautest_parameter; CAUTEST_EXPECT_TRUE(value != 0 && strncmp(value, "profile-", 8) == 0); }\nCAUTEST_SUITE(profile_suite, CAUTEST_CASE_ENTRY(profile_env));\n`);
  await writeFile(compiler, `#!/bin/sh\nprintf '%s\\n' "$CAUTEST_PROFILE_ENV" >> "$CAUTEST_COMPILER_ENV_LOG"\nexec cc "$@"\n`);
  await chmod(compiler, 0o755);
  const base = nativeCTestJob({ id: "unit.native.profile-env", env: { CAUTEST_PROFILE_ENV: "job-value", CAUTEST_COMPILER_ENV_LOG: compilerLog }, tests: ["profile.c"], suites: ["profile_suite"], build: { compiler } });
  const withProfile = (value) => Object.freeze({ ...base, env: Object.freeze({ ...base.env, CAUTEST_PROFILE_ENV: value }) });
  const project = { configDir: temporary, resultDir: path.join(temporary, "results"), cacheDir: path.join(temporary, "cache"), generatedDir: path.join(temporary, "generated"), workDir: path.join(temporary, "work") };
  const first = await executeWorkflow(withProfile("profile-one"), { project });
  const second = await executeWorkflow(withProfile("profile-two"), { project });
  assert.equal(first.status, "SUCCESS", JSON.stringify(first.errors));
  assert.equal(second.status, "SUCCESS", JSON.stringify(second.errors));
  assert.notEqual(first.artifacts.find((item) => item.kind === "native-test").buildId, second.artifacts.find((item) => item.kind === "native-test").buildId);
  const compilerEnvironments = (await readFile(compilerLog, "utf8")).trim().split("\n");
  assert.equal(compilerEnvironments.includes("job-value"), false);
  assert.equal(compilerEnvironments.includes("profile-one"), true);
  assert.equal(compilerEnvironments.includes("profile-two"), true);
});

test("Native Crash/Timeout 映射 ERROR 且后续 Case 继续", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "cautest-v2-native-isolation-"));
  const definition = nativeCTestJob({ id: "unit.native.isolation", tests: ["test/fixtures/native/native_cases.c"], suites: ["native_cases", "snapshot_cases"], build: { cache: { enabled: false } }, run: { include: ["native_cases/crash_case", "native_cases/timeout_case", "native_cases/parameter_case@one"], caseTimeoutMs: 80, runTimeoutMs: 5_000 } });
  const result = await executeWorkflow(definition, { project: { configDir: projectRoot, resultDir: path.join(temporary, "results"), workDir: path.join(temporary, "work") } });
  assert.equal(result.status, "ERROR"); assert.deepEqual(result.groups[0].cases.map((item) => [item.name, item.status]), [["crash_case", "ERROR"], ["timeout_case", "ERROR"], ["parameter_case@one", "PASS"]]);
});

test("Native 保留 FAIL/SKIP/ERROR，并让 Suite Fixture 使用同一初始快照", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "cautest-v2-native-semantics-")); const project = { configDir: projectRoot, resultDir: path.join(temporary, "results"), cacheDir: path.join(temporary, "cache"), workDir: path.join(temporary, "work") };
  const statuses = await executeWorkflow(nativeCTestJob({ id: "unit.native.statuses", tests: ["test/fixtures/native/native_cases.c"], suites: ["native_cases", "snapshot_cases"], run: { include: ["native_cases/fail_case", "native_cases/skip_case", "native_cases/error_case"] } }), { project });
  assert.equal(statuses.status, "ERROR"); assert.deepEqual(statuses.groups[0].cases.map((item) => [item.name, item.status]), [["fail_case", "FAIL"], ["skip_case", "SKIP"], ["error_case", "ERROR"]]);
  const snapshot = await executeWorkflow(nativeCTestJob({ id: "unit.native.snapshot", tests: ["test/fixtures/native/native_cases.c"], suites: ["native_cases", "snapshot_cases"], run: { suite: "snapshot_cases" } }), { project });
  assert.equal(snapshot.status, "SUCCESS"); assert.deepEqual(snapshot.groups[0].cases.map((item) => [item.name, item.status]), [["snapshot_first", "PASS"], ["snapshot_second", "PASS"]]);
  const stdout = await readFile(snapshot.artifacts.find((item) => item.name.endsWith("-stdout")).path, "utf8"); assert.equal(stdout.match(/suite setup marker/gu)?.length, 1); assert.equal(stdout.match(/suite teardown marker/gu)?.length, 1);
});

test("Native Suite Setup 错误保留 Session 诊断并映射基础设施 ERROR", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "cautest-v2-native-suite-error-"));
  const result = await executeWorkflow(nativeCTestJob({
    id: "unit.native.suite-error",
    tests: ["test/fixtures/native/suite_setup_error.c"],
    suites: ["suite_setup_error"],
  }), { project: { configDir: projectRoot, resultDir: path.join(temporary, "results"), cacheDir: path.join(temporary, "cache"), workDir: path.join(temporary, "work") } });
  assert.equal(result.status, "ERROR");
  assert.deepEqual(result.groups, []);
  assert.equal(result.steps.find((step) => step.kind === "cTestRun").status, "ERROR");
  assert.equal(result.steps.find((step) => step.kind === "cTestRun").diagnostics.some((item) => item.code === "FIXTURE"), true);
  assert.equal(result.errors.some((error) => error.code === "target_error"), true);
  assert.equal(result.errors.some((error) => error.code === "selection_error"), false);
});
