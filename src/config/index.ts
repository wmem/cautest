/** 当前公共配置 Schema 的主版本。 */
export const CAUTEST_CONFIG_SCHEMA_VERSION = 2;

export { testConfig, testJob, withJobDefaults } from "./define.js";
export { expandFilePatterns } from "./file-pattern.js";
export { jobNamespace } from "./namespace.js";
export { nativeCTestJob, nativeCTestJobFactory } from "../jobs/native.js";
export { kernelCTestJob, kernelCTestJobFactory, umlKernelEnvironment } from "../jobs/kernel.js";
export { scriptSystemTestJob } from "../jobs/system.js";
export { mcuCTestJob } from "../jobs/mcu.js";
export { driverAbiCTestJob, driverAbiCTestJobFactory } from "../jobs/driver.js";
export { defineStep } from "../workflow/step.js";
export { executeWorkflow } from "../workflow/engine.js";
export { ArtifactStore, CleanupStack, ResourceStore, ResultRecorder } from "../workflow/lifecycle.js";
export { EventRecorder } from "../workflow/events.js";
export { executeRun, writeRunDirectory } from "../result/run.js";
export { CautestError, serializeError } from "../model/error.js";
export { CTP_PROTOCOL_MAJOR, CTP_PROTOCOL_MINOR, Ctp3Error, encodeCommand, escapeField, LineDecoder, parseProtocolLine, protocolError, splitEscapedFields } from "../protocol/ctp3.js";
export { ProcessTransport, processTransport, StreamTransport } from "../protocol/transport.js";
export { CTestSession, filterTestDescriptors, planCTestExecutions, runCTestSession } from "../protocol/session.js";
export { defineScriptTest, executeScriptTest } from "../system/script-test.js";
export { collectLogs, collectStep, execStep, externalTest, parseJsonResults, parseJUnit, processAttach, processStart, shellExec, waitForReady, waitReady } from "../steps/system.js";
export type { ScriptCaseContext, ScriptTestApi, ScriptTestDefinition } from "../system/script-test.js";
export type { ExternalTestInput, ProcessAttachInput, ProcessStartInput, ReadyProbe } from "../steps/system.js";
export { CacheClient } from "../cache/client.js";
export { createFingerprint, hashBytes, hashFile, stableSerialize } from "../cache/fingerprint.js";
export { resolveCautestC } from "../integration/cautest-c.js";
export type * from "./schema/index.js";
