import type { DriverAbiCTestJobFactoryInput, DriverAbiCTestJobInput, TestJob } from "../config/schema/index.js";
import { testJob } from "../config/define.js";
import { CautestError } from "../model/error.js";
import { defineStep } from "../workflow/step.js";

function safe(value: string): string { return value.replace(/[^A-Za-z0-9_-]/gu, "-"); }

/** 将 Driver Module、Guest ABI Test 与 UML Session 展开为标准 Workflow。 */
export function driverAbiCTestJob(input: DriverAbiCTestJobInput): TestJob {
  if (!Array.isArray(input.drivers) || input.drivers.length === 0) throw new CautestError("driverAbiCTestJob.drivers 必须非空", { code: "config_error" });
  if (typeof input.guest !== "object" || input.guest === null || !Array.isArray(input.guest.tests) || input.guest.tests.length === 0) throw new CautestError("driverAbiCTestJob.guest.tests 必须非空", { code: "config_error" });
  const driverNames = new Set<string>();
  for (const driver of input.drivers) { if (driverNames.has(driver.name)) throw new CautestError(`Driver Module 名称重复: ${driver.name}`, { code: "config_error" }); driverNames.add(driver.name); }
  const name = safe(input.id);
  const build = defineStep({ kind: "driverKernelEnvironmentBuild", name, phase: "build", details: { environment: "uml-kernel" }, execute() { throw new CautestError("Driver UML Environment 必须先由 Kernel Build Provider 解析", { code: "build_error" }); } });
  const modules = input.drivers.map((driver) => defineStep({ kind: "kernelModuleBuild", name: driver.name, phase: "build", details: { ...driver, probe: input.probe ?? {} }, ...(driver.timeoutMs === undefined ? {} : { timeoutMs: driver.timeoutMs }), execute() { throw new CautestError(`Driver Module ${driver.name} 缺少 Kernel Output`, { code: "build_error" }); } }));
  const guest = defineStep({ kind: "driverGuestCTestBuild", name: input.guest.name ?? name, phase: "build", details: { ...input.guest }, ...(input.guest.timeoutMs === undefined ? {} : { timeoutMs: input.guest.timeoutMs }), execute() { throw new CautestError("Driver Guest Program 需要 UML Rootfs Build Provider", { code: "build_error" }); } });
  const rootfs = defineStep({ kind: "umlRootfsBuild", name, phase: "build", details: { drivers: [...driverNames], guest: input.guest.name ?? name }, execute() { return { diagnostics: [] }; } });
  const start = defineStep({ kind: "umlStart", name, phase: "provision", details: {}, execute() { throw new CautestError("Driver UML Image 尚未构建", { code: "provision_error" }); } });
  const run = defineStep({ kind: "cTestRun", name, phase: "run", details: { endpoint: input.guest.endpoint ?? "driver-guest", selection: input.run ?? {} }, ...(input.run?.stepTimeoutMs === undefined ? {} : { timeoutMs: input.run.stepTimeoutMs }), execute() { throw new CautestError("Driver Guest CTP3 Endpoint 尚未启动", { code: "transport_error" }); } });
  const collect = defineStep({ kind: "umlLogs", name, phase: "collect", runWhen: "always", details: {}, execute() { return { diagnostics: [] }; } });
  return testJob({ id: input.id, level: input.level ?? "integration", tags: input.tags ?? ["integration", "driver", "uml"], workflow: [build, ...modules, guest, rootfs, start, run, collect], ...(input.description === undefined ? {} : { description: input.description }), ...(input.enabled === undefined ? {} : { enabled: input.enabled }), ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }), ...(input.env === undefined ? {} : { env: input.env }), ...(input.policy === undefined ? {} : { policy: input.policy }) });
}

/** 绑定 Driver Job 公共 UML Environment。 */
export function driverAbiCTestJobFactory(options: DriverAbiCTestJobFactoryInput): (input: Omit<DriverAbiCTestJobInput, "environment">) => TestJob {
  return (input) => driverAbiCTestJob({ ...options.defaults, ...input, environment: options.environment, run: { ...options.defaults?.run, ...input.run } });
}
