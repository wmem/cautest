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
export type * from "./schema/index.js";
