import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
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

test("External MCU Adapter 通过统一 CTP3 Transport 执行", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "cautest-v2-mcu-external-"));
  const firmware = path.join(temporary, "firmware.bin");
  await writeFile(firmware, "firmware");
  await writeFile(path.join(temporary, "board.log"), "board output\n");
  const crypto = await import("node:crypto");
  const buildId = crypto.createHash("sha256").update("firmware").update("{}").digest("hex").slice(0, 24);
  const responses = [
    `+HELLO:3,external,${buildId}`, "OK:HELLO", "+CASE:1,1,0,suite,case,", "OK:LIST",
    "+CASE-BEGIN:1,1,1,0,suite,case,", "+CASE-END:1,1,1,0,PASS", "OK:CASE", "OK:BYE",
  ];
  let flashed = false;
  let closed = false;
  const adapter = {
    async flash(value) { flashed = value.path === firmware; },
    reset() { return "boot-1"; },
    openTransport() { return { write() {}, nextLine() { return responses.shift(); }, close() {} }; },
    close() { closed = true; },
  };
  const job = mcuCTestJob({ id: "component.mcu.external", firmware: { kind: "existing", file: firmware }, board: { kind: "external", adapter }, logFiles: ["board.log"] });
  const result = await executeWorkflow(job, { project: { configDir: temporary, workDir: path.join(temporary, "work"), resultDir: path.join(temporary, "results") } });
  assert.equal(result.status, "SUCCESS");
  assert.equal(result.steps[2].testResults[0].cases[0].status, "PASS");
  assert.equal(flashed, true);
  assert.equal(closed, true);
  assert.equal(await readFile(path.join(temporary, "results/mcu/board/board.log"), "utf8"), "board output\n");
});
