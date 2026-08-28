import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { mcuCTestJob } from "../dist/config/index.js";
import { executeWorkflow } from "../dist/workflow/engine.js";

test("Host Simulated MCU 完成 Firmware 构建、Board Reset 和 CTP3 Run", async () => {
  const root = path.resolve(new URL("..", import.meta.url).pathname);
  const temporary = await mkdtemp(path.join(os.tmpdir(), "cautest-v2-mcu-"));
  const job = mcuCTestJob({ id: "component.mcu.smoke", firmware: { kind: "host-simulated", output: path.join(temporary, "firmware"), sources: ["test/fixtures/mcu/firmware.c"] } });
  const result = await executeWorkflow(job, { project: { configDir: root, workDir: path.join(temporary, "work"), resultDir: path.join(temporary, "results") } });
  assert.equal(result.status, "SUCCESS");
  assert.equal(result.steps[2].testResults[0].cases[0].status, "PASS");
});
