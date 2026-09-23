import path from "node:path";
import {mkdir, readFile, rename, writeFile} from "node:fs/promises";
import {randomUUID} from "node:crypto";
import type {CTestRunInput, StepExecutionContext, TestJob, TestJobCommonInput, UmlKernelEnvironment, UmlKernelEnvironmentInput, WorkflowStep} from "../config/schema/index.js";
import {testJob} from "../config/define.js";
import {artifactBuildStep, getArtifact, type ArtifactRef, type BuildContext, type BuildProvider} from "../artifacts/index.js";
import {hashBytes, stableSerialize} from "../cache/fingerprint.js";
import {CautestError} from "../model/error.js";
import {defineStep} from "../workflow/step.js";
import {environmentValue, kernelRuntimeBuildStep, umlEnvironmentBuildSteps} from "./kernel.js";
import {umlRuntimeSteps} from "./uml-runtime.js";
import {assertKernelContext, captureKernelContext, consumeDriverGuest, consumeKernelModule, type KernelArtifactContext} from "../kernel/artifact-context.js";
import type {KernelModuleArtifact} from "../kernel/module-build.js";
import {buildRootfs, type BusyBoxArtifact, type GuestProgramArtifact} from "../uml/runtime.js";

export interface UmlArtifactJobInput extends TestJobCommonInput {
  readonly environment: UmlKernelEnvironment;
  readonly provider: BuildProvider;
  readonly context?: BuildContext;
  readonly buildTimeoutMs?: number;
  readonly run?: CTestRunInput;
}
export interface KernelArtifactJobInput extends UmlArtifactJobInput {readonly artifact: ArtifactRef}
export interface DriverArtifactJobInput extends UmlArtifactJobInput {readonly drivers: readonly ArtifactRef[]; readonly guest: ArtifactRef}
const contextKey = "cautest:kernel-context";
const contextFileKey = "cautest:kernel-context-file";
const moduleNamesKey = "cautest:kernel-module-names";
function fail(message: string): never {throw new CautestError(message, {code: "build_error"});}
function kernelContext(context: StepExecutionContext): KernelArtifactContext {
  const identity = context.state.get(contextKey) as KernelArtifactContext | undefined;
  if (!identity) fail("The shared UML Environment has not produced a Kernel context");
  return identity;
}
function requireUml(environment: Readonly<UmlKernelEnvironmentInput>): void {
  if ((environment.kernel.arch ?? "um") !== "um" || environment.kernel.crossCompile) throw new CautestError("Artifact UML jobs currently support native x86_64 ARCH=um only; host/SSH and cross-architecture require explicit providers", {code: "config_error"});
}
function common(input: UmlArtifactJobInput): TestJobCommonInput {
  const {id, description, enabled, timeoutMs, env, policy} = input;
  return {id, ...(description === undefined ? {} : {description}), ...(enabled === undefined ? {} : {enabled}),
    ...(timeoutMs === undefined ? {} : {timeoutMs}), ...(env === undefined ? {} : {env}), ...(policy === undefined ? {} : {policy})};
}
function identityStep(environment: Readonly<UmlKernelEnvironmentInput>, name: string): WorkflowStep {
  return defineStep({kind: "kernelArtifactContext", name, phase: "build", details: {arch: "um", schemaVersion: 1}, async execute(context) {
    const output = context.state.get("kernelOutput");
    if (typeof output !== "string") fail("Kernel Output is missing");
    const config = await readFile(path.join(output, ".config"), "utf8");
    if (!/^CONFIG_UML=y$/mu.test(config) || !/^CONFIG_64BIT=y$/mu.test(config)) fail("Shared Environment must produce a 64-bit UML Kernel, not host Kernel headers");
    const identity = await captureKernelContext(output, environment.kernel);
    const digest = hashBytes(stableSerialize(identity));
    const file = path.join(context.project.workDir, "kernel-context", `${digest}.json`);
    await mkdir(path.dirname(file), {recursive: true});
    const temporary = `${file}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(identity, null, 2) + "\n"); await rename(temporary, file);
    context.state.set(contextKey, identity); context.state.set(contextFileKey, file);
    context.state.set(moduleNamesKey, []);
    context.artifacts.publish({kind: "kernel-context", name, path: file, fingerprint: digest});
    return {diagnostics: [{code: "kernel_context_ready", message: identity.release}]};
  }});
}
/** Build targets receive this context only inside a build Step; no global process.env mutation. */
function contextualProvider(provider: BuildProvider, environment: Readonly<UmlKernelEnvironmentInput>): BuildProvider {
  return {async build(ref, context) {
    const expected = kernelContext(context);
    assertKernelContext(expected, await captureKernelContext(expected.outputDir, environment.kernel));
    const symbols = ((context.state.get(moduleNamesKey) ?? []) as string[]).map(name => {
      const module = context.state.get(`module:${name}`) as KernelModuleArtifact | undefined;
      if (!module) fail(`Module dependency was not built: ${name}`);
      if (/\s/u.test(module.symbols)) fail("Kbuild extra symbol paths may not contain whitespace; use an isolated build directory");
      return module.symbols;
    });
    const injected = {
      CAUTEST_KERNEL_BUILD: expected.outputDir,
      CAUTEST_KERNEL_CONTEXT: String(context.state.get(contextFileKey)),
      CAUTEST_KERNEL_ARCH: expected.arch,
      CAUTEST_KERNEL_CROSS_COMPILE: expected.crossCompile,
      CAUTEST_EXTRA_SYMBOLS: symbols.join(" "),
    };
    for (const [key, value] of Object.entries(injected)) if (context.job.env[key] !== undefined && context.job.env[key] !== value) fail(`Reserved environment variable ${key} conflicts with the shared UML Environment`);
    const derived: StepExecutionContext = {...context, job: {...context.job, env: {...context.job.env, ...injected}}};
    const receipt = await provider.build(ref, derived);
    context.signal.throwIfAborted();
    assertKernelContext(expected, await captureKernelContext(expected.outputDir, environment.kernel));
    return receipt;
  }};
}
function moduleSteps(input: UmlArtifactJobInput, provider: BuildProvider, ref: ArtifactRef, name: string): WorkflowStep[] {
  const artifactRef = {target: ref.target, output: ref.output ?? "ko"};
  return [artifactBuildStep({name, ref: artifactRef, provider, protocolRequired: false,
    ...(input.context === undefined ? {} : {context: input.context}), ...(input.buildTimeoutMs === undefined ? {} : {timeoutMs: input.buildTimeoutMs})}),
    defineStep({kind: "kernelArtifactValidate", name, phase: "build", details: {artifact: artifactRef, roles: ["ko", "symbols", "order", "kernel-context"]}, async execute(context) {
      const module = await consumeKernelModule(getArtifact(context, name), kernelContext(context), name);
      context.state.set(`module:${name}`, module);
      (context.state.get(moduleNamesKey) as string[]).push(name);
      context.artifacts.publish({kind: "kernel-module", name, path: module.module, fingerprint: module.cacheKey, metadata: {symbols: module.symbols, modulesOrder: module.modulesOrder, externalArtifact: true}});
      return {diagnostics: [{code: "kernel_artifact_verified", message: module.module}]};
    }})];
}
function rootfsStep(input: UmlArtifactJobInput, environment: Readonly<UmlKernelEnvironmentInput>, name: string, guest?: string): WorkflowStep {
  return defineStep({kind: "umlRootfsBuild", name, phase: "build", details: {...environment.rootfs, externalArtifacts: true},
    ...(environment.rootfs?.timeoutMs === undefined ? {} : {timeoutMs: environment.rootfs.timeoutMs}), async execute(context) {
      const kernel = kernelContext(context), busybox = context.state.get("busybox") as BusyBoxArtifact | undefined;
      if (!busybox) fail("BusyBox Artifact is missing");
      assertKernelContext(kernel, await captureKernelContext(kernel.outputDir, environment.kernel));
      const modules = (context.state.get(moduleNamesKey) as string[]).map(key => context.state.get(`module:${key}`) as KernelModuleArtifact);
      const programs = guest ? [context.state.get(`guest:${guest}`) as GuestProgramArtifact] : [];
      const image = await buildRootfs({name, environment, kernelOutput: kernel.outputDir, busybox, modules, programs}, context);
      context.state.set(`image:${name}`, image);
      context.artifacts.publish({kind: "uml-image", name, path: image.rootfsPath, fingerprint: image.buildId, buildId: image.buildId,
        metadata: {kernelPath: image.kernelPath, cacheHit: image.cacheHit, endpoints: [...image.endpoints.keys()]}});
      return {diagnostics: [{code: image.cacheHit ? "cache_hit" : "cache_miss", message: image.rootfsPath}]};
    }});
}
/** Internal Kernel tests: external .ko + shared Cautest Kernel Runtime, never a host executable. */
export function kernelArtifactJob(input: KernelArtifactJobInput): TestJob {
  const environment = environmentValue(input.environment); requireUml(environment);
  const name = input.id.replace(/[^A-Za-z0-9_-]/gu, "_");
  const env = umlEnvironmentBuildSteps(environment, name), provider = contextualProvider(input.provider, environment);
  const runtime = kernelRuntimeBuildStep(environment);
  const registerRuntime = defineStep({kind: "kernelRuntimeSymbols", name, phase: "build", details: {}, execute(context) {
    (context.state.get(moduleNamesKey) as string[]).push("cautest_kernel"); return {};
  }});
  const {start, run, collect} = umlRuntimeSteps({name, environment, endpoint: "kernel", label: "Kernel C Test", transportDetail: true,
    ...(input.run === undefined ? {} : {run: input.run}), allowEmpty: input.policy?.allowEmpty === true});
  return testJob({...common(input), level: input.level ?? "unit", tags: input.tags ?? ["unit", "kernel", "uml"],
    workflow: [env.kernel, env.busybox, identityStep(environment, name), runtime, registerRuntime, ...moduleSteps(input, provider, input.artifact, "test-module"), rootfsStep(input, environment, name), start, run, collect]});
}
/** Driver ABI: product .ko refs and a separate static CTP Guest executable ref. */
export function driverArtifactJob(input: DriverArtifactJobInput): TestJob {
  if (!Array.isArray(input.drivers) || input.drivers.length === 0) throw new CautestError("driverArtifactJob.drivers must be nonempty", {code: "config_error"});
  const references = input.drivers.map(ref => `${ref.target}\0${ref.output ?? "ko"}`);
  if (new Set(references).size !== references.length) throw new CautestError("Duplicate Driver artifact reference", {code: "config_error"});
  const environment = environmentValue(input.environment); requireUml(environment);
  const name = input.id.replace(/[^A-Za-z0-9_-]/gu, "-"), guestName = "driver-guest";
  const env = umlEnvironmentBuildSteps(environment, name), provider = contextualProvider(input.provider, environment);
  const guest = artifactBuildStep({name: guestName, ref: input.guest, provider: input.provider,
    ...(input.context === undefined ? {} : {context: input.context}), ...(input.buildTimeoutMs === undefined ? {} : {timeoutMs: input.buildTimeoutMs})});
  const validateGuest = defineStep({kind: "driverGuestArtifactValidate", name: guestName, phase: "build", details: {artifact: input.guest}, async execute(context) {
    const program = await consumeDriverGuest(getArtifact(context, guestName), guestName);
    context.state.set(`guest:${guestName}`, program);
    context.artifacts.publish({kind: "guest-program", name: guestName, path: program.path, buildId: program.buildId, metadata: {externalArtifact: true, endpoint: program.endpoint}});
    return {diagnostics: [{code: "driver_guest_verified", message: program.path}]};
  }});
  const {start, run, collect} = umlRuntimeSteps({name, environment, endpoint: guestName, label: "Driver Guest C Test",
    ...(input.run === undefined ? {} : {run: input.run}), allowEmpty: input.policy?.allowEmpty === true});
  return testJob({...common(input), level: input.level ?? "integration", tags: input.tags ?? ["integration", "driver", "uml"],
    workflow: [env.kernel, env.busybox, identityStep(environment, name), ...input.drivers.flatMap((ref, index) => moduleSteps(input, provider, ref, `driver-${index + 1}`)), guest, validateGuest, rootfsStep(input, environment, name, guestName), start, run, collect]});
}
