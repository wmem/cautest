export { CAUTEST_BUILD_INFO_SCHEMA_VERSION, CAUTEST_CLI_SCHEMA_VERSION, CAUTEST_CONFIG_SCHEMA_VERSION, CAUTEST_EVENT_SCHEMA_VERSION, CAUTEST_PORTABLE_MANIFEST_SCHEMA_VERSION, CAUTEST_RELEASE_VERSION, CAUTEST_RESULT_SCHEMA_VERSION, CAUTEST_VERSIONS } from "./versions.js";

export { testConfig, testJob, withJobDefaults } from "./define.js";
export { runCollector } from "./collector.js";
export { expandFilePatterns } from "./file-pattern.js";
export { jobNamespace } from "./namespace.js";
export { nativeCTestJob, nativeCTestJobFactory } from "../jobs/native.js";
export { kernelCTestJob, kernelCTestJobFactory, umlKernelEnvironment } from "../jobs/kernel.js";
export { scriptSystemTestJob } from "../jobs/system.js";
export { mcuCTestJob } from "../jobs/mcu.js";
export { SimulatedMcuBoard } from "../integration/mcu-simulated.js";
export { driverAbiCTestJob, driverAbiCTestJobFactory } from "../jobs/driver.js";
export { defineStep } from "../workflow/step.js";
export { composeJobWorkflows, defineFragment, flattenWorkflow, isWorkflowFragment, standardJobFragment } from "../workflow/fragment.js";
export type { StandardJobFragmentSelection } from "../workflow/fragment.js";
export { executeWorkflow } from "../workflow/engine.js";
export { ArtifactStore, CleanupStack, ResourceStore, ResultRecorder } from "../workflow/lifecycle.js";
export { EventRecorder } from "../workflow/events.js";
export { executeRun, writeRunDirectory } from "../result/run.js";
export { formatConsoleReport, formatHtmlReport, formatJUnitReport, writeReports } from "../reporters/index.js";
export { CautestError, serializeError } from "../model/error.js";
export { CTP_PROTOCOL_MAJOR, CTP_PROTOCOL_MINOR, Ctp3Error, encodeCommand, escapeField, LineDecoder, parseProtocolLine, protocolError, splitEscapedFields } from "../protocol/ctp3.js";
export { ProcessTransport, processTransport, StreamTransport } from "../protocol/transport.js";
export { CTestSession, filterTestDescriptors, planCTestExecutions, runCTestSession } from "../protocol/session.js";
export { defineScriptTest, executeScriptTest } from "../system/script-test.js";
export { collectLogs, collectStep, execStep, externalTest, parseJsonResults, parseJUnit, processAttach, processStart, shellExec, waitForReady, waitReady } from "../steps/system.js";
export type { ScriptCaseContext, ScriptExec, ScriptExecRequest, ScriptExecResult, ScriptTestApi, ScriptTestContext, ScriptTestDefinition } from "../system/script-test.js";
export type { ExternalTestInput, ProcessAttachInput, ProcessStartInput, ReadyProbe } from "../steps/system.js";
export { CacheClient } from "../cache/client.js";
export { createFingerprint, hashBytes, hashFile, stableSerialize } from "../cache/fingerprint.js";
export { resolveCautestC } from "../integration/cautest-c.js";
export type * from "./schema/index.js";

export { selectJobs } from "./select.js";
export type { JobSelectionInput } from "./select.js";
export { nativeArtifactJob, mcuArtifactJob } from "../jobs/artifact.js";
export type { ArtifactJobInput, NativeArtifactJobInput } from "../jobs/artifact.js";
export { artifactBuildStep, getArtifact, resolveArtifact } from "../artifacts/index.js";
export type { ArtifactRef, BuildContext, ArtifactReceipt, ArtifactOutput, BuildProvider, ResolvedArtifact } from "../artifacts/index.js";

export {acquirePhysicalResource, physicalResourceStep, type PhysicalResourceLock} from "../integration/resource-lock.js";

export {kernelArtifactJob, driverArtifactJob} from "../jobs/kernel-artifact.js";
export type {UmlArtifactJobInput, KernelArtifactJobInput, DriverArtifactJobInput} from "../jobs/kernel-artifact.js";
export type {KernelArtifactContext} from "../kernel/artifact-context.js";
