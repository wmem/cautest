import path from "node:path";
import { fileURLToPath } from "node:url";
import { executeRun, kernelCTestJob, testConfig, umlKernelEnvironment } from "../../dist/config/index.js";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const kernelSource = process.env.KERNEL_SRC ?? "/home/mem/work/src/linux/ubuntu/ubuntu-kernel-src-6.8.0-138";
const busyboxSource = process.env.BUSYBOX_SRC ?? "/home/mem/work/src/busybox/busybox-1.38.0";
const environment = umlKernelEnvironment({
  kernel: { sourceDir: kernelSource, timeoutMs: 20 * 60_000 },
  busybox: { sourceDir: busyboxSource, timeoutMs: 10 * 60_000 },
  moduleDefaults: { timeoutMs: 5 * 60_000 },
  machine: { readyTimeoutMs: 60_000, startTimeoutMs: 90_000 },
});
const config = testConfig({ jobs: [kernelCTestJob({
  id: "integration.uml.smoke",
  environment,
  tests: ["test/fixtures/kernel/smoke_test.c"],
  suites: ["kernel_smoke"],
  run: { include: ["kernel_smoke/passes"], caseTimeoutMs: 2_000, runTimeoutMs: 20_000, stepTimeoutMs: 60_000 },
  timeoutMs: 30 * 60_000,
})] });

const result = await executeRun(config, { configDir: project, resultDir: path.join(project, ".cautest/results") });
const summary = { runId: result.runId, status: result.status, resultDir: result.resultDir, jobs: result.jobs.map((job) => ({ id: job.jobId, status: job.status, groups: job.groups.length, cases: job.groups.flatMap((group) => group.cases).length, artifacts: job.artifacts.map((artifact) => `${artifact.kind}:${artifact.name}`) })) };
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
if (result.status !== "SUCCESS") process.exitCode = 1;
