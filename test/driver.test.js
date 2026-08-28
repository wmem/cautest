import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { driverAbiCTestJobFactory, testConfig, umlKernelEnvironment } from "../dist/config/index.js";
import { planConfig } from "../dist/config/plan.js";
import { runNativeSession } from "../dist/protocol/native-session.js";
import { buildDriverGuestCTest } from "../dist/uml/runtime.js";

test("Driver ABI Job 使用唯一 Schema 展开 Driver、Guest 和 UML Workflow", () => {
  const environment = umlKernelEnvironment({ kernel: { sourceDir: "linux" }, busybox: { sourceDir: "busybox" } });
  const job = driverAbiCTestJobFactory({ environment })({ id: "integration.driver.demo", drivers: [{ name: "demo", sourceDir: "driver", output: "demo.ko" }], guest: { tests: ["test/driver_test.c"] } });
  assert.deepEqual(planConfig(testConfig({ jobs: [job] }))[0].workflow.map((step) => step.kind), ["driverKernelEnvironmentBuild", "kernelModuleBuild", "driverGuestCTestBuild", "umlRootfsBuild", "umlStart", "cTestRun", "umlLogs"]);
});

test("Driver Guest C Test 自动生成 Registry 和入口并可执行 CTP3", async () => {
  const project = path.resolve(new URL("..", import.meta.url).pathname);
  const temporary = await mkdtemp(path.join(os.tmpdir(), "cautest-v2-driver-guest-"));
  const signal = new AbortController().signal;
  const artifact = await buildDriverGuestCTest("integration.driver.smoke", { tests: ["test/fixtures/native/smoke_test.c"], suites: ["smoke"] }, {
    job: { id: "integration.driver.smoke", env: {} }, signal, state: new Map(), output() {},
    project: { configDir: project, resultDir: path.join(temporary, "results"), cacheDir: path.join(temporary, "cache"), generatedDir: path.join(temporary, "generated"), workDir: path.join(temporary, "work") },
  });
  const results = await runNativeSession({ program: artifact.path, cwd: project, env: process.env, expectedBuildId: artifact.buildId, run: { include: ["smoke/passes"] }, signal });
  assert.equal(results[0].cases[0].status, "PASS");
});
