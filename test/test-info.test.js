import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import test from "node:test";
import { readCTestInformation } from "../dist/result/test-info.js";
import { executeRun, nativeCTestJob, nativeArtifactJob, testConfig, writeRunDirectory, formatHtmlReport, formatJUnitReport } from "../dist/config/index.js";

async function fixture(callback) {
  const root = await mkdtemp(path.join(os.tmpdir(), "cautest-info-"));
  try { await callback(root); } finally { await rm(root, {recursive: true, force: true}); }
}

test("extract annotated registration syntax, ignore strings/comments/preprocessor macros, inherit parameter info", () => fixture(async root => {
  const file = path.join(root, "tests.c");
  await writeFile(file, `
#define FAKE(name) \\
  CAUTEST_CASE(name)
const char *text = "CAUTEST_SUITE(fake, CAUTEST_CASE_ENTRY(fake))";
/* CAUTEST_CASE(fake) CAUTEST_SUITE(fake, CAUTEST_CASE_ENTRY(fake)) */
/**
 * @purpose 验证相加 <正确>
 * 支持多行说明
 * @expected 返回指定值
 * @other 不能混入说明
 */
CAUTEST_PARAM_CASE(
  adds, struct input, value) { }
CAUTEST_CASE(bare) { }
/** @purpose 算术接口 */
CAUTEST_SUITE_WITH_FIXTURES(math, fixture, CAUTEST_NO_FIXTURE,
  CAUTEST_PARAM_CASE_ENTRY(adds, rows), CAUTEST_CASE_ENTRY(bare));
`);
  const info = await readCTestInformation([file, file], root);
  assert.equal(info.suite("math").description, "算术接口");
  assert.equal(info.case("math", "adds").description, "验证相加 <正确>\n支持多行说明");
  assert.equal(info.case("math", "adds").expectedBehavior, "返回指定值");
  assert.equal(info.case("math", "bare").description, "");
  assert.equal(info.suite("fake").description, "");
  const groups = info.enrich([{name: "math", cases: ["adds@positive", "adds@negative", "bare"].map(name => ({name, status: "PASS", assertions: [], diagnostics: []}))}]);
  assert.equal(groups[0].cases[1].description, groups[0].cases[0].description);
  assert.equal(groups[0].cases[2].expectedBehavior, "");
  assert.equal(groups[0].cases[0].source.file, file);
  assert.ok(groups[0].cases[0].source.line > 0);
  assert.deepEqual(info.diagnostics, []);
}));

test("same Case name stays in its own file and Suite; ambiguous conditional definitions remain empty", () => fixture(async root => {
  const files = [];
  for (const [name, purpose] of [["first", "第一个"], ["second", "第二个"]]) {
    const file = path.join(root, `${name}.c`); files.push(file);
    await writeFile(file, `/** @purpose ${purpose} */\nCAUTEST_CASE(same) {}\nCAUTEST_SUITE(${name}, CAUTEST_CASE_ENTRY(same));`);
  }
  let info = await readCTestInformation(files, root);
  assert.equal(info.case("first", "same").description, "第一个");
  assert.equal(info.case("second", "same").description, "第二个");
  await writeFile(files[1], `#if OPTION\n/** @purpose 一 */\nCAUTEST_CASE(same) {}\n#else\n/** @purpose 二 */\nCAUTEST_CASE(same) {}\n#endif\nCAUTEST_SUITE(second, CAUTEST_CASE_ENTRY(same));`);
  info = await readCTestInformation(files, root);
  assert.equal(info.case("second", "same").description, "");
  assert.equal(info.case("second", "same").expectedBehavior, "");
  assert.ok(info.diagnostics.some(item => item.code === "test_info_ambiguous"));
  const missing = await readCTestInformation([path.join(root, "missing.c")], root);
  assert.equal(missing.case("unknown", "unknown").description, "");
  assert.equal(missing.diagnostics[0].code, "test_info_unavailable");
}));

test("real C results aggregate documentation into Job, persist empty fields, preserve failures and support artifact source lists", () => fixture(async root => {
  const file = path.join(root, "test.c");
  await writeFile(file, `#include <cautest/cautest.h>
/**
 * @purpose 验证加法
 * @expected 2 + 3 返回 5
 */
CAUTEST_CASE(adds) { CAUTEST_EXPECT_EQ_INT(5, 2 + 3); }
/**
 * @purpose 验证失败证据 <expected>
 * @expected 返回 1
 */
CAUTEST_CASE(fails) { CAUTEST_EXPECT_EQ_INT(1, 2); }
CAUTEST_CASE(bare) { CAUTEST_EXPECT_TRUE(1); }
/** @purpose 数学接口 */
CAUTEST_SUITE(math, CAUTEST_CASE_ENTRY(adds), CAUTEST_CASE_ENTRY(fails), CAUTEST_CASE_ENTRY(bare));
`);
  const job = nativeCTestJob({id: "unit.math", description: "验证数学接口与失败证据", tests: ["test.c"], suites: ["math"]});
  const run = await executeRun(testConfig({jobs: [job]}), {configDir: root});
  assert.equal(run.status, "FAIL");
  assert.equal(run.jobs[0].description, "验证数学接口与失败证据");
  const group = run.jobs[0].groups[0];
  assert.equal(group.description, "数学接口");
  assert.equal(group.cases[0].description, "验证加法");
  assert.equal(group.cases[0].expectedBehavior, "2 + 3 返回 5");
  assert.equal(group.cases[1].status, "FAIL");
  assert.equal(group.cases[2].description, "");
  assert.equal(group.cases[2].expectedBehavior, "");
  const directory = await writeRunDirectory(run, path.join(root, "reports"));
  const saved = JSON.parse(await readFile(path.join(directory, "jobs/unit.math/job.json"), "utf8"));
  assert.deepEqual(saved.groups, run.jobs[0].steps[1].testResults);
  assert.equal(saved.groups[0].cases[2].description, "");
  const html = formatHtmlReport(run), junit = formatJUnitReport(run);
  assert.match(html, /验证数学接口与失败证据/);
  assert.match(html, /验证失败证据 &lt;expected&gt;/);
  assert.match(html, /expected=.*1.*actual=.*2/);
  assert.match(junit, /expectedBehavior.*2 \+ 3 返回 5/);
  const events = (await readFile(path.join(root, ".cautest/results", run.id, "events.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line));
  assert.equal(events.find(event => event.type === "CASE_SELECTION").total, 3);
  assert.equal(events.find(event => event.type === "CASE_START").description, "验证加法");
  const artifact = run.jobs[0].artifacts.find(item => item.kind === "native-test");
  const provider = {async build() { return {schemaVersion: 2, kind: "cautest.artifact-receipt", target: "math", context: {projectRoot: root, buildDir: path.join(root, "build"), plat: "linux", arch: "x86_64", mode: "release"}, protocolBuildId: artifact.buildId,
    sourceFiles: [file], outputs: [{role: "primary", path: artifact.path, size: (await stat(artifact.path)).size}]}; }};
  const filtered = await executeRun(testConfig({jobs: [nativeArtifactJob({id: "unit.filtered", artifact: {target: "math"}, provider, run: {case: "adds"}})]}), {configDir: root});
  assert.equal(filtered.jobs[0].description, "");
  assert.equal(filtered.jobs[0].groups[0].cases.length, 1);
  assert.equal(filtered.jobs[0].groups[0].cases[0].description, "验证加法");
}));
