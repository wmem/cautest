import assert from "node:assert/strict";
import test from "node:test";
import { defineStep, testConfig, testJob } from "../dist/config/index.js";
import { planConfig } from "../dist/config/plan.js";

const build = defineStep({ kind: "compile", name: "target", phase: "build", execute() {} });
const run = defineStep({ kind: "run", name: "cases", phase: "run", execute() {} });

test("testConfig 只接受 TestJob 数组并生成稳定线性计划", () => {
  const job = testJob({ id: "unit.math", level: "unit", tags: ["unit"], workflow: [build, run] });
  const config = testConfig({ jobs: [job] });
  assert.deepEqual(planConfig(config), [{
    id: "unit.math",
    level: "unit",
    description: "",
    tags: ["unit"],
    enabled: true,
    workflow: [
      { id: "01-build-compile-target", index: 0, kind: "compile", name: "target", phase: "build", runWhen: "on-success" },
      { id: "02-run-run-cases", index: 1, kind: "run", name: "cases", phase: "run", runWhen: "on-success" },
    ],
  }]);
});

test("testConfig 拒绝普通对象、重复 ID 和未知字段", () => {
  const job = testJob({ id: "unit.math", level: "unit", workflow: [run] });
  assert.throws(() => testConfig({ jobs: [{}] }), /必须由 Test Job 构造函数创建/u);
  assert.throws(() => testConfig({ jobs: [job, job] }), /Test Job ID 重复/u);
  assert.throws(() => testJob({ id: "unit.math", level: "unit", workflow: [run], extra: true }), /未知字段/u);
});

test("Workflow 拒绝 Phase 逆序和非 collect 失败路径", () => {
  assert.throws(() => testJob({ id: "unit.reverse", level: "unit", workflow: [run, build] }), /phase .*逆序/u);
  assert.throws(() => defineStep({ kind: "bad", phase: "run", runWhen: "always", execute() {} }), /只有 collect/u);
});

test("plan 按 ID 选择并拒绝不存在的 Job", () => {
  const config = testConfig({ jobs: [testJob({ id: "unit.math", level: "unit", workflow: [run] })] });
  assert.equal(planConfig(config, ["unit.math"]).length, 1);
  assert.throws(() => planConfig(config, ["missing"]), /未找到 Test Job/u);
});
