import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import {
  composeJobWorkflows,
  defineFragment,
  defineStep,
  driverAbiCTestJob,
  expandFilePatterns,
  jobNamespace,
  kernelCTestJob,
  mcuCTestJob,
  nativeCTestJob,
  standardJobFragment,
  testConfig,
  testJob,
  withJobDefaults,
  umlKernelEnvironment,
} from "../dist/config/index.js";
import { loadConfig } from "../dist/config/load.js";
import { planConfig } from "../dist/config/plan.js";

const run = defineStep({ kind: "fixtureRun", phase: "run", execute() {} });

test("公共默认项与命名空间只展开为普通 Test Job", () => {
  const factory = withJobDefaults(testJob, { level: "unit", tags: ["unit"], workflow: [run] });
  const jobs = jobNamespace({
    namespace: "unit.utils",
    source: import.meta.url,
    factory,
    definitions: [
      { name: "queue" },
      { name: "ringbuf", tags: ["fast"] },
    ],
  });
  const config = testConfig({ jobs });
  assert.deepEqual(config.jobs.map((job) => job.id), ["unit.utils.queue", "unit.utils.ringbuf"]);
  assert.deepEqual(config.jobs[0].tags, ["unit"]);
  assert.deepEqual(config.jobs[1].tags, ["fast"]);
  assert.equal(planConfig(config)[0].origin.configPath, "jobs.unit.utils.queue");
});

test("Fragment 可嵌套，并能按 Phase 合并标准 Job Workflow", async () => {
  const calls = [];
  const first = testJob({ id: "unit.fragment.first", level: "unit", workflow: [
    defineStep({ kind: "firstBuild", phase: "build", execute() { calls.push("first-build"); } }),
    defineStep({ kind: "firstRun", phase: "run", execute() { calls.push("first-run"); return { testResults: [{ name: "first", cases: [{ name: "ok", status: "PASS", assertions: [], diagnostics: [] }] }] }; } }),
  ] });
  const second = testJob({ id: "unit.fragment.second", level: "unit", workflow: [
    defineFragment([defineStep({ kind: "secondBuild", phase: "build", execute() { calls.push("second-build"); } })]),
    defineStep({ kind: "secondRun", phase: "run", execute() { calls.push("second-run"); return { testResults: [{ name: "second", cases: [{ name: "ok", status: "PASS", assertions: [], diagnostics: [] }] }] }; } }),
  ] });
  const composed = testJob({ id: "unit.fragment.composed", level: "unit", workflow: [composeJobWorkflows(first, second)] });
  const { executeWorkflow } = await import("../dist/workflow/engine.js");
  const result = await executeWorkflow(composed);
  assert.equal(result.status, "SUCCESS");
  assert.deepEqual(calls, ["first-build", "second-build", "first-run", "second-run"]);
});

test("标准 Job Fragment 暴露 Native/Kernel/BusyBox/Module/Guest/Rootfs/UML/MCU 能力", () => {
  const environment = umlKernelEnvironment({ kernel: { sourceDir: "vendor/linux" }, busybox: { sourceDir: "vendor/busybox" } });
  const native = nativeCTestJob({ id: "unit.fragment.native", tests: ["native.c"] });
  const kernel = kernelCTestJob({ id: "unit.fragment.kernel", environment, tests: ["kernel.c"], extraModules: [{ name: "product", sourceDir: "driver", output: "product.ko" }], guestPrograms: [{ name: "helper", sources: ["helper.c"] }] });
  const driver = driverAbiCTestJob({ id: "integration.fragment.driver", environment, drivers: [{ name: "driver", sourceDir: "driver", output: "driver.ko" }], guest: { tests: ["guest.c"] } });
  const mcu = mcuCTestJob({ id: "component.fragment.mcu", firmware: { kind: "existing", file: "firmware.bin" } });
  assert.deepEqual(standardJobFragment(native).entries.map((step) => step.kind), ["nativeCompile", "cTestRun"]);
  const kernelKinds = standardJobFragment(kernel, { phases: ["build", "provision"] }).entries.map((step) => step.kind);
  for (const kind of ["kernelBuild", "busyboxBuild", "kernelModuleBuild", "umlGuestProgramBuild", "umlRootfsBuild", "umlStart"]) assert.ok(kernelKinds.includes(kind), kind);
  const driverKinds = standardJobFragment(driver).entries.map((step) => step.kind);
  for (const kind of ["kernelModuleBuild", "driverGuestCTestBuild", "umlRootfsBuild", "umlStart", "cTestRun"]) assert.ok(driverKinds.includes(kind), kind);
  assert.deepEqual(standardJobFragment(mcu).entries.map((step) => step.kind), ["mcuFirmwareBuild", "mcuBoardStart", "mcuCTestRun", "mcuLogs"]);
});

test("文件 Pattern 支持 Glob、排除、排序和逐项空匹配检查", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cautest-v2-glob-"));
  await mkdir(path.join(root, "src/generated"), { recursive: true });
  await Promise.all([
    writeFile(path.join(root, "src/b.c"), "b\n"),
    writeFile(path.join(root, "src/a.c"), "a\n"),
    writeFile(path.join(root, "src/a.h"), "h\n"),
    writeFile(path.join(root, "src/generated/skip.c"), "x\n"),
  ]);
  assert.deepEqual(await expandFilePatterns(["src/{a,b}.c", "!src/generated/**"], {
    baseDir: root,
    label: "jobs.unit.sources",
  }), ["src/a.c", "src/b.c"]);
  await assert.rejects(
    expandFilePatterns(["src/*.c", "missing/*.h"], { baseDir: root, label: "jobs.unit.sources" }),
    /missing\/\*\.h/u,
  );
  await assert.rejects(
    expandFilePatterns(["../outside.c"], { baseDir: root, label: "jobs.unit.sources" }),
    /根目录内/u,
  );
});

async function writeConfigTree(parent, extraComment = "") {
  const root = path.join(parent, "project");
  const fragments = path.join(root, "config");
  await mkdir(fragments, { recursive: true });
  const api = pathToFileURL(path.resolve("dist/config/index.js")).href;
  await writeFile(path.join(fragments, "factory.mjs"), `import { defineStep, testJob, withJobDefaults } from ${JSON.stringify(api)};
${extraComment}
const run = defineStep({ kind: 'hashFixture', phase: 'run', execute() {} });
export default withJobDefaults(testJob, { level: 'unit', workflow: [run] });
`);
  await writeFile(path.join(fragments, "jobs.mjs"), `import { jobNamespace } from ${JSON.stringify(api)};
import factory from './factory.mjs';
export default jobNamespace({ namespace: 'unit.hash', source: import.meta.url, factory, definitions: [{ name: 'example' }] });
`);
  await writeFile(path.join(fragments, "index.mjs"), "export { default } from './jobs.mjs';\n");
  await writeFile(path.join(root, "cautest.config.mjs"), `import { testConfig } from ${JSON.stringify(api)};
import jobs from './config/index.mjs';
export default testConfig({ jobs: [...jobs] });
`);
  return path.join(root, "cautest.config.mjs");
}

test("configHash 覆盖配置片段内容和最终解析结果且不依赖检出位置", async () => {
  const firstRoot = await mkdtemp(path.join(os.tmpdir(), "cautest-v2-hash-a-"));
  const secondRoot = await mkdtemp(path.join(os.tmpdir(), "cautest-v2-hash-b-"));
  const changedRoot = await mkdtemp(path.join(os.tmpdir(), "cautest-v2-hash-c-"));
  const first = await loadConfig(await writeConfigTree(firstRoot));
  const second = await loadConfig(await writeConfigTree(secondRoot));
  const changed = await loadConfig(await writeConfigTree(changedRoot, "// 修改片段内容也必须改变指纹"));
  assert.equal(first.hash, second.hash);
  assert.notEqual(first.hash, changed.hash);
  assert.deepEqual(first.sources.map((source) => path.basename(source)).sort(), ["cautest.config.mjs", "factory.mjs", "index.mjs", "jobs.mjs"]);
  assert.equal((await readFile(first.sources[1], "utf8")).length > 0, true);
});
