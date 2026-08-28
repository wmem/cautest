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
  assert.deepEqual(result.artifacts.map((item) => `${item.kind}:${item.name}`), ["mcu-firmware:firmware"]);
  assert.equal(result.resources[0].state, "closed");
});

test("External MCU Adapter 通过统一 CTP3 Transport 执行", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "cautest-v2-mcu-external-"));
  const firmware = path.join(temporary, "firmware.bin");
  await writeFile(firmware, "firmware");
  await writeFile(path.join(temporary, "board.log"), "board output\n");
  const crypto = await import("node:crypto");
  const buildId = crypto.createHash("sha256").update("firmware").update("{}").digest("hex").slice(0, 24);
  const responses = [
    `+HELLO:3,0,${buildId},boot-1,64,512`, "OK:HELLO", "+LIST:START", "+CASE:1,1,0,suite,case,", "+LIST:END,1", "OK:LIST",
    "+EXEC-START:1,SUITE,1,0,0", "+SUITE-START:1,1", "+CASE-START:1,1,1,0", "+CASE-END:1,1,1,0,PASS", "+SUITE-END:1,1,PASS", "+EXEC-END:1,PASS,1,0,0,0", "OK:SUITE,1", "OK:BYE",
  ];
  let flashed = false;
  let closed = false;
  const adapter = {
    async flash(value) { flashed = value.path === firmware; },
    reset() { return "boot-1"; },
    openTransport() { return { open() {}, write() {}, nextLine() { return responses.shift(); }, close() {} }; },
    close() { closed = true; },
  };
  const job = mcuCTestJob({ id: "component.mcu.external", firmware: { kind: "existing", file: firmware }, board: { kind: "external", adapter }, logFiles: ["board.log"] });
  const result = await executeWorkflow(job, { project: { configDir: temporary, workDir: path.join(temporary, "work"), resultDir: path.join(temporary, "results") } });
  assert.equal(result.status, "SUCCESS");
  assert.equal(result.steps[2].testResults[0].cases[0].status, "PASS");
  assert.equal(flashed, true);
  assert.equal(closed, true);
  assert.equal(await readFile(path.join(temporary, "results/mcu/board/board.log"), "utf8"), "board output\n");
  assert.deepEqual(result.artifacts.map((item) => `${item.kind}:${item.name}`), ["mcu-firmware:firmware", "log:board-board-log"]);
  assert.equal(result.resources[0].state, "closed");
});

test("Host MCU 保留 PASS/FAIL/SKIP/ERROR，并在 Hang 超时后可重新运行", async () => {
  const root = path.resolve(new URL("..", import.meta.url).pathname);
  const temporary = await mkdtemp(path.join(os.tmpdir(), "cautest-v2-mcu-status-"));
  const expected = [["pass_case", "SUCCESS", "PASS"], ["fail_case", "FAIL", "FAIL"], ["skip_case", "SKIP", "SKIP"], ["error_case", "ERROR", "ERROR"]];
  for (const [caseName, workflowStatus, caseStatus] of expected) {
    const job = mcuCTestJob({ id: `component.mcu.${caseName}`, firmware: { kind: "host-simulated", output: path.join(temporary, caseName), sources: ["test/fixtures/mcu/firmware_cases.c"] }, run: { include: [`mcu_actual/${caseName}`], runTimeoutMs: 1_000 } });
    const result = await executeWorkflow(job, { project: { configDir: root, workDir: path.join(temporary, "work", caseName), resultDir: path.join(temporary, "results", caseName) } });
    assert.equal(result.status, workflowStatus, JSON.stringify(result.errors));
    assert.equal(result.groups[0].cases[0].status, caseStatus);
  }

  const hang = mcuCTestJob({ id: "component.mcu.hang", firmware: { kind: "host-simulated", output: path.join(temporary, "hang"), sources: ["test/fixtures/mcu/firmware_cases.c"] }, run: { include: ["mcu_actual/hang_case"], runTimeoutMs: 30, stepTimeoutMs: 500 } });
  const hung = await executeWorkflow(hang, { project: { configDir: root, workDir: path.join(temporary, "work/hang"), resultDir: path.join(temporary, "results/hang") } });
  assert.equal(hung.status, "ERROR");
  const recovered = mcuCTestJob({ id: "component.mcu.recovered", firmware: { kind: "host-simulated", output: path.join(temporary, "recovered"), sources: ["test/fixtures/mcu/firmware_cases.c"] }, run: { include: ["mcu_actual/pass_case"], runTimeoutMs: 1_000 } });
  const recovery = await executeWorkflow(recovered, { project: { configDir: root, workDir: path.join(temporary, "work/recovered"), resultDir: path.join(temporary, "results/recovered") } });
  assert.equal(recovery.status, "SUCCESS", JSON.stringify(recovery.errors));
});

test("External MCU 校验 Reset 返回的 Boot ID", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "cautest-v2-mcu-boot-"));
  const firmware = path.join(temporary, "firmware.bin");
  await writeFile(firmware, "firmware");
  const crypto = await import("node:crypto");
  const buildId = crypto.createHash("sha256").update("firmware").update("{}").digest("hex").slice(0, 24);
  const responses = [`+HELLO:3,0,${buildId},stale-boot,64,512`, "OK:HELLO"];
  let closed = false;
  const adapter = { flash() {}, reset() { return "fresh-boot"; }, openTransport() { return { write() {}, nextLine() { return responses.shift(); }, close() {} }; }, close() { closed = true; } };
  const result = await executeWorkflow(mcuCTestJob({ id: "component.mcu.boot", firmware: { kind: "existing", file: firmware }, board: { kind: "external", adapter } }), { project: { configDir: temporary, workDir: path.join(temporary, "work"), resultDir: path.join(temporary, "results") } });
  assert.equal(result.status, "ERROR");
  assert.match(result.errors[0].message, /Boot ID 不匹配/u);
  assert.equal(closed, true);
});
