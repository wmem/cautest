import assert from "node:assert/strict";
import test from "node:test";
import { driverAbiCTestJobFactory, testConfig, umlKernelEnvironment } from "../dist/config/index.js";
import { planConfig } from "../dist/config/plan.js";

test("Driver ABI Job 使用唯一 Schema 展开 Driver、Guest 和 UML Workflow", () => {
  const environment = umlKernelEnvironment({ kernel: { sourceDir: "linux" }, busybox: { sourceDir: "busybox" } });
  const job = driverAbiCTestJobFactory({ environment })({ id: "integration.driver.demo", drivers: [{ name: "demo", sourceDir: "driver", output: "demo.ko" }], guest: { tests: ["test/driver_test.c"] } });
  assert.deepEqual(planConfig(testConfig({ jobs: [job] }))[0].workflow.map((step) => step.kind), ["driverKernelEnvironmentBuild", "kernelModuleBuild", "driverGuestCTestBuild", "umlRootfsBuild", "umlStart", "cTestRun", "umlLogs"]);
});
