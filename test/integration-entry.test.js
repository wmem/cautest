import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { planConfig } from "../dist/config/plan.js";
import { driverUmlSmokeConfig, kernelUmlSmokeConfig } from "./integration/uml-configs.mjs";
import { inspectUmlPrerequisites } from "./integration/uml-support.mjs";

const exec = promisify(execFile);
const root = path.resolve(new URL("..", import.meta.url).pathname);

test("真实 UML 入口缺少源码时以 BLOCKED/77 结束且不回退到私有路径", async () => {
  const environment = { ...process.env };
  delete environment.KERNEL_SRC;
  delete environment.BUSYBOX_SRC;
  for (const script of ["uml-smoke.mjs", "uml-driver-smoke.mjs"]) {
    await assert.rejects(
      exec(process.execPath, [path.join("test/integration", script)], { cwd: root, env: environment }),
      (error) => {
        assert.equal(error.code, 77);
        const report = JSON.parse(error.stderr);
        assert.equal(report.status, "BLOCKED");
        assert.equal(report.code, "uml_prerequisites_missing");
        assert.deepEqual(report.problems.map((item) => item.name), ["KERNEL_SRC", "BUSYBOX_SRC"]);
        assert.doesNotMatch(error.stderr, /\/home\/|vendor\/linux|vendor\/busybox/u);
        return true;
      },
    );
  }
});

test("UML 前置检查验证 Kernel UML 与 BusyBox 源码树结构", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "cautest-v2-uml-prerequisites-"));
  const kernel = path.join(temporary, "linux");
  const busybox = path.join(temporary, "busybox");
  await mkdir(path.join(kernel, "arch/um"), { recursive: true });
  await mkdir(busybox, { recursive: true });
  await Promise.all([
    writeFile(path.join(kernel, "Makefile"), "all:\n\t@true\n"),
    writeFile(path.join(kernel, "arch/um/Kconfig"), "config UML\n\tbool\n"),
    writeFile(path.join(busybox, "Makefile"), "all:\n\t@true\n"),
  ]);
  const result = await inspectUmlPrerequisites({ KERNEL_SRC: kernel, BUSYBOX_SRC: busybox });
  assert.equal(result.ok, true);
  assert.equal(result.kernelSource, kernel);
  assert.equal(result.busyboxSource, busybox);
});

test("真实入口展开 Kernel 与 Driver/Probe/Guest ABI UML Workflow", () => {
  const prerequisites = { kernelSource: "/kernel", busyboxSource: "/busybox" };
  const [kernel, driverUnit] = planConfig(kernelUmlSmokeConfig(prerequisites));
  assert.equal(kernel.id, "component.kernel-counter");
  assert.equal(kernel.level, "component");
  assert.deepEqual(kernel.tags, ["component", "kernel", "uml"]);
  assert.deepEqual(kernel.workflow.map((step) => step.kind), [
    "kernelBuild", "busyboxBuild", "kernelModuleBuild", "generatedKernelTestModule",
    "umlRootfsBuild", "umlStart", "cTestRun", "umlLogs",
  ]);
  assert.equal(driverUnit.id, "unit.example-driver-core");
  assert.deepEqual(driverUnit.workflow.map((step) => step.kind), kernel.workflow.map((step) => step.kind));
  assert.deepEqual(driverUnit.workflow[3].details.tests, ["examples/linux-driver-unit/test/example_driver_core_test.c"]);

  const driver = planConfig(driverUmlSmokeConfig(prerequisites))[0];
  assert.equal(driver.id, "integration.uml.driver-probe-smoke");
  assert.deepEqual(driver.workflow.map((step) => step.kind), [
    "kernelBuild", "busyboxBuild", "kernelModuleBuild", "kernelModuleBuild",
    "driverGuestCTestBuild", "umlRootfsBuild", "umlStart", "cTestRun", "umlLogs",
  ]);
  assert.equal(driver.workflow[2].name, "cautest_probe");
  assert.equal(driver.workflow[3].name, "example_driver");
  assert.deepEqual(driver.workflow[4].details.tests, ["examples/linux-driver/guest/driver_abi_test.c"]);
  assert.deepEqual(driver.workflow[7].details.selection.include, ["driver_api/read_reaches_driver_boundary"]);
});
