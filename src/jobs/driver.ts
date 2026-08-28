import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DriverAbiCTestJobFactoryInput, DriverAbiCTestJobInput, TestJob } from "../config/schema/index.js";
import { testJob } from "../config/define.js";
import { buildIsolatedKernelModule, type KernelModuleArtifact } from "../kernel/module-build.js";
import { CautestError } from "../model/error.js";
import { defineStep } from "../workflow/step.js";
import { buildKernel, environmentValue } from "./kernel.js";
import { buildBusyBox, buildDriverGuestCTest, buildRootfs, collectUml, runUmlEndpoint, startUml, type BusyBoxArtifact, type GuestProgramArtifact, type UmlImageArtifact } from "../uml/runtime.js";

function safe(value: string): string { return value.replace(/[^A-Za-z0-9_-]/gu, "-"); }
const kitRoot = fileURLToPath(new URL("../../assets/cautest-c", import.meta.url));

/** 将 Driver Module、自动 Guest ABI Test 与 UML Session 展开为标准 Workflow。 */
export function driverAbiCTestJob(input: DriverAbiCTestJobInput): TestJob {
  if (!Array.isArray(input.drivers) || input.drivers.length === 0) throw new CautestError("driverAbiCTestJob.drivers 必须非空", { code: "config_error" });
  if (typeof input.guest !== "object" || input.guest === null || !Array.isArray(input.guest.tests) || input.guest.tests.length === 0) throw new CautestError("driverAbiCTestJob.guest.tests 必须非空", { code: "config_error" });
  const environment = environmentValue(input.environment);
  const driverNames = new Set<string>();
  for (const driver of input.drivers) { if (driverNames.has(driver.name)) throw new CautestError(`Driver Module 名称重复: ${driver.name}`, { code: "config_error" }); driverNames.add(driver.name); }
  const name = safe(input.id);
  const build = defineStep({
    kind: "driverKernelEnvironmentBuild", name, phase: "build", details: { kernel: environment.kernel, busybox: environment.busybox },
    async execute(context) {
      const [kernel, busybox] = await Promise.all([buildKernel(environment, context, name), buildBusyBox(environment.busybox, context)]);
      context.state.set("kernelOutput", kernel.path); context.state.set("busybox", busybox);
      return { diagnostics: [{ code: kernel.cacheHit ? "cache_hit" : "cache_miss", message: kernel.path }, { code: busybox.cacheHit ? "cache_hit" : "cache_miss", message: busybox.path }] };
    },
  });
  const probe = input.probe === undefined ? [] : [defineStep({
    kind: "kernelModuleBuild", name: "cautest_probe", phase: "build", details: { builtIn: true, sourceDir: "assets/cautest-c/kernel/cautest-probe", output: "cautest_probe.ko" },
    async execute(context) {
      const kernelOutput = context.state.get("kernelOutput"); if (typeof kernelOutput !== "string") throw new CautestError("Driver Kernel Output 不存在", { code: "build_error" });
      const artifact = await buildIsolatedKernelModule({ module: { name: "cautest_probe", sourceDir: "kernel/cautest-probe", sandboxRoot: ".", output: "cautest_probe.ko", makeVariables: { CONFIG_CAUTEST: "y" } }, kernelOutput, configDir: kitRoot, cacheDir: path.join(context.project.cacheDir, "kernel-modules"), workDir: path.join(context.project.workDir, "kernel-modules"), arch: environment.kernel.arch ?? "um", ...(environment.kernel.crossCompile === undefined ? {} : { crossCompile: environment.kernel.crossCompile }), signal: context.signal, output: context.output });
      context.state.set("module:cautest_probe", artifact); return { diagnostics: [{ code: artifact.cacheHit ? "cache_hit" : "cache_miss", message: artifact.module }] };
    },
  })];
  const modules = input.drivers.map((driver) => defineStep({
    kind: "kernelModuleBuild", name: driver.name, phase: "build", details: { ...driver, probe: input.probe ?? {} }, ...(driver.timeoutMs === undefined ? {} : { timeoutMs: driver.timeoutMs }),
    async execute(context) {
      const kernelOutput = context.state.get("kernelOutput");
      if (typeof kernelOutput !== "string") throw new CautestError("Driver Kernel Output 不存在", { code: "build_error" });
      const dependencies = [...(input.probe === undefined ? [] : ["cautest_probe"]), ...(driver.extraModules ?? [])].map((dependency) => { const artifact = context.state.get(`module:${dependency}`) as KernelModuleArtifact | undefined; if (artifact === undefined) throw new CautestError(`Driver Module 依赖尚未构建: ${dependency}`, { code: "config_error" }); return artifact.symbols; });
      const artifact = await buildIsolatedKernelModule({
        module: { ...driver, makeVariables: { ...(input.probe === undefined ? {} : { CONFIG_CAUTEST: "y", CAUTEST_C_ROOT: kitRoot }), ...driver.makeVariables, ...input.probe?.makeVariables } }, kernelOutput,
        configDir: context.project.configDir, cacheDir: path.join(context.project.cacheDir, "kernel-modules"), workDir: path.join(context.project.workDir, "kernel-modules"),
        arch: environment.kernel.arch ?? "um", ...(environment.kernel.crossCompile === undefined ? {} : { crossCompile: environment.kernel.crossCompile }),
        ...(input.env === undefined ? {} : { env: input.env }), dependencySymbols: dependencies, signal: context.signal, output: context.output,
      });
      context.state.set(`module:${driver.name}`, artifact);
      return { diagnostics: [{ code: artifact.cacheHit ? "cache_hit" : "cache_miss", message: artifact.module }] };
    },
  }));
  const guestName = input.guest.name ?? name;
  const guest = defineStep({
    kind: "driverGuestCTestBuild", name: guestName, phase: "build", details: { ...input.guest }, ...(input.guest.timeoutMs === undefined ? {} : { timeoutMs: input.guest.timeoutMs }),
    async execute(context) { const artifact = await buildDriverGuestCTest(input.id, input.guest, context); context.state.set(`guest:${guestName}`, artifact); return { diagnostics: [{ code: artifact.cacheHit ? "cache_hit" : "cache_miss", message: artifact.path }] }; },
  });
  const rootfs = defineStep({
    kind: "umlRootfsBuild", name, phase: "build", details: { drivers: [...driverNames], guest: guestName, overlays: environment.rootfs?.overlays ?? [] }, ...(environment.rootfs?.timeoutMs === undefined ? {} : { timeoutMs: environment.rootfs.timeoutMs }),
    async execute(context) {
      const kernelOutput = context.state.get("kernelOutput"); const busybox = context.state.get("busybox") as BusyBoxArtifact | undefined; const program = context.state.get(`guest:${guestName}`) as GuestProgramArtifact | undefined;
      if (typeof kernelOutput !== "string" || busybox === undefined || program === undefined) throw new CautestError("Driver Rootfs 输入 Artifact 不完整", { code: "build_error" });
      const driverArtifacts = [...(input.probe === undefined ? [] : ["cautest_probe"]), ...driverNames].map((driver) => { const artifact = context.state.get(`module:${driver}`) as KernelModuleArtifact | undefined; if (artifact === undefined) throw new CautestError(`Driver Artifact 不存在: ${driver}`, { code: "build_error" }); return artifact; });
      const image = await buildRootfs({ name, environment, kernelOutput, busybox, modules: driverArtifacts, programs: [program] }, context); context.state.set(`image:${name}`, image);
      return { diagnostics: [{ code: image.cacheHit ? "cache_hit" : "cache_miss", message: image.rootfsPath }] };
    },
  });
  const start = defineStep({ kind: "umlStart", name, phase: "provision", details: { ...environment.machine }, ...(environment.machine?.startTimeoutMs === undefined ? {} : { timeoutMs: environment.machine.startTimeoutMs }), async execute(context) { const image = context.state.get(`image:${name}`) as UmlImageArtifact | undefined; if (image === undefined) throw new CautestError("Driver UML Image 不存在", { code: "provision_error" }); const resource = await startUml(name, image, environment, context); return { diagnostics: [{ code: "uml_ready", message: `pid=${resource.child.pid}` }] }; } });
  const run = defineStep({ kind: "cTestRun", name, phase: "run", details: { endpoint: input.guest.endpoint ?? guestName, selection: input.run ?? {} }, ...(input.run?.stepTimeoutMs === undefined ? {} : { timeoutMs: input.run.stepTimeoutMs }), async execute(context) { const image = context.state.get(`image:${name}`) as UmlImageArtifact | undefined; if (image === undefined) throw new CautestError("Driver UML Image 不存在", { code: "transport_error" }); const results = await runUmlEndpoint(name, input.guest.endpoint ?? guestName, image, input.run ?? {}, context); const cases = results.flatMap((suite) => suite.cases); if (cases.length === 0 && input.policy?.allowEmpty !== true) throw new CautestError("Driver Guest C Test 没有选中 Case", { code: "selection_error" }); return { outcome: cases.some((item) => item.status === "FAIL" || item.status === "ERROR") ? "FAIL" : "SUCCESS", testResults: results }; } });
  const collect = defineStep({ kind: "umlLogs", name, phase: "collect", runWhen: "always", details: {}, ...(environment.machine?.collectTimeoutMs === undefined ? {} : { timeoutMs: environment.machine.collectTimeoutMs }), async execute(context) { return { diagnostics: await collectUml(name, context) }; } });
  return testJob({ id: input.id, level: input.level ?? "integration", tags: input.tags ?? ["integration", "driver", "uml"], workflow: [build, ...probe, ...modules, guest, rootfs, start, run, collect], ...(input.description === undefined ? {} : { description: input.description }), ...(input.enabled === undefined ? {} : { enabled: input.enabled }), ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }), ...(input.env === undefined ? {} : { env: input.env }), ...(input.policy === undefined ? {} : { policy: input.policy }) });
}

/** 绑定 Driver Job 公共 UML Environment。 */
export function driverAbiCTestJobFactory(options: DriverAbiCTestJobFactoryInput): (input: Omit<DriverAbiCTestJobInput, "environment">) => TestJob {
  environmentValue(options.environment);
  return (input) => driverAbiCTestJob({ ...options.defaults, ...input, environment: options.environment, run: { ...options.defaults?.run, ...input.run } });
}
