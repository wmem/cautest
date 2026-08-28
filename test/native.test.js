import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { nativeCTestJob } from "../dist/config/index.js";
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
