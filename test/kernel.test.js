import assert from "node:assert/strict";
import test from "node:test";
import { kernelCTestJob, kernelCTestJobFactory, testConfig, umlKernelEnvironment } from "../dist/config/index.js";
import { planConfig } from "../dist/config/plan.js";

test("Kernel Environment 独立复用并展开自动 Test Module Workflow", () => {
  const environment = umlKernelEnvironment({
    kernel: { sourceDir: "vendor/linux", arch: "um" },
    busybox: { sourceDir: "vendor/busybox" },
    moduleDefaults: { headers: ["include/**/*.h"], defines: { DRIVER_TEST: 1 } },
    runtime: { maxRegistries: 64, eventCapacity: 512 },
  });
  const factory = kernelCTestJobFactory({ environment, defaults: { tags: ["kernel-unit"] } });
  const job = factory({ id: "unit.utils.queue", tests: ["test/unit/queue_test.c"], sources: ["src/queue.c"], headers: ["src/queue.h"] });
  const plan = planConfig(testConfig({ jobs: [job] }))[0];
  assert.equal(plan.id, "unit.utils.queue");
  assert.deepEqual(plan.workflow.map((step) => step.kind), ["kernelBuild", "busyboxBuild", "kernelModuleBuild", "generatedKernelTestModule", "umlRootfsBuild", "umlStart", "cTestRun", "umlLogs"]);
  assert.deepEqual(plan.workflow[3].details.suites, ["queue"]);
  assert.deepEqual(job.tags, ["kernel-unit"]);
});

test("Kernel Job 拒绝手写 Environment", () => {
  assert.throws(() => kernelCTestJob({ id: "unit.invalid", environment: {}, tests: ["test.c"] }), /umlKernelEnvironment/u);
});
