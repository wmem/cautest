import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CAUTEST_VERSIONS, CautestError, EventRecorder, mcuCTestJob, SimulatedMcuBoard } from "../dist/config/index.js";
import { executeWorkflow } from "../dist/workflow/engine.js";

test("Host Simulated MCU 完成 Firmware 构建、Board Reset 和 CTP3 Run", async () => {
  const root = path.resolve(new URL("..", import.meta.url).pathname);
  const temporary = await mkdtemp(path.join(os.tmpdir(), "cautest-v2-mcu-"));
  const job = mcuCTestJob({ id: "component.mcu.smoke", firmware: { kind: "host-simulated", output: path.join(temporary, "firmware"), sources: ["test/fixtures/mcu/firmware.c"] } });
  const result = await executeWorkflow(job, { project: { configDir: root, workDir: path.join(temporary, "work"), resultDir: path.join(temporary, "results") } });
  assert.equal(result.status, "SUCCESS");
  assert.equal(result.steps[2].testResults[0].cases[0].status, "PASS");
  assert.deepEqual(result.artifacts.map((item) => `${item.kind}:${item.name}`), ["mcu-firmware:firmware", "log:board-target", "log:board-stdout", "log:board-stderr"]);
  assert.equal(result.resources[0].state, "closed");
});

test("External MCU Adapter 通过统一 CTP3 Transport 执行", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "cautest-v2-mcu-external-"));
  const firmware = path.join(temporary, "firmware.bin");
  await writeFile(firmware, "firmware");
  await writeFile(path.join(temporary, "board.log"), "board output\n");
  const buildId = "fixture-firmware-id";
  const responses = [
    `+HELLO:3,0,${buildId},boot-1,64,512`, "OK:HELLO", "+LIST:START", "+CASE:1,1,0,suite,case,", "+LIST:END,1", "OK:LIST",
    "+EXEC-START:1,SUITE,1,0,0", "+SUITE-START:1,1", "+CASE-START:1,1,1,0", "+LOG:1,CASE,1,1,0,TARGET,INFO,external target log", "+CASE-END:1,1,1,0,PASS", "+SUITE-END:1,1,PASS", "+EXEC-END:1,PASS,1,0,0,0", "OK:SUITE,1", "OK:BYE",
  ];
  let flashed = false;
  let closed = false;
  const adapter = {
    async flash(value) { flashed = value.path === firmware; },
    reset() { return "boot-1"; },
    openTransport() { return { open() {}, write() {}, nextLine() { return responses.shift(); }, close() {} }; },
    close() { closed = true; },
  };
  const job = mcuCTestJob({ id: "component.mcu.external", firmware: { kind: "existing", file: firmware, buildId }, board: { kind: "external", adapter }, logFiles: ["board.log"] });
  const result = await executeWorkflow(job, { project: { configDir: temporary, workDir: path.join(temporary, "work"), resultDir: path.join(temporary, "results") } });
  assert.equal(result.status, "SUCCESS");
  assert.equal(result.steps[2].testResults[0].cases[0].status, "PASS");
  assert.equal(flashed, true);
  assert.equal(closed, true);
  assert.equal(await readFile(path.join(temporary, "results/mcu/board/board.log"), "utf8"), "board output\n");
  assert.equal(await readFile(path.join(temporary, "results/mcu/board/board.target.log"), "utf8"), "[INFO] CASE: external target log\n");
  assert.deepEqual(result.artifacts.map((item) => `${item.kind}:${item.name}`), ["mcu-firmware:firmware", "log:board-target", "log:board-board-log"]);
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
  const buildId = "fixture-firmware-id";
  const responses = [`+HELLO:3,0,${buildId},stale-boot,64,512`, "OK:HELLO"];
  let closed = false;
  const adapter = { flash() {}, reset() { return "fresh-boot"; }, openTransport() { return { write() {}, nextLine() { return responses.shift(); }, close() {} }; }, close() { closed = true; } };
  const result = await executeWorkflow(mcuCTestJob({ id: "component.mcu.boot", firmware: { kind: "existing", file: firmware, buildId }, board: { kind: "external", adapter } }), { project: { configDir: temporary, workDir: path.join(temporary, "work"), resultDir: path.join(temporary, "results") } });
  assert.equal(result.status, "ERROR");
  assert.match(result.errors[0].message, /Boot ID 不匹配/u);
  assert.equal(closed, true);
});

test("Profile Env 覆盖 MCU Job Env，并进入 Firmware 指纹和模拟 Target", async () => {
  const root = path.resolve(new URL("..", import.meta.url).pathname);
  const temporary = await mkdtemp(path.join(os.tmpdir(), "cautest-v2-mcu-profile-env-"));
  const base = mcuCTestJob({ id: "component.mcu.profile-env", env: { CAUTEST_PROFILE_ENV: "job-value" }, firmware: { kind: "host-simulated", output: path.join(temporary, "firmware"), sources: ["test/fixtures/mcu/profile_env.c"] } });
  const withProfile = (value) => Object.freeze({ ...base, env: Object.freeze({ ...base.env, CAUTEST_PROFILE_ENV: value }) });
  const project = { configDir: root, workDir: path.join(temporary, "work"), resultDir: path.join(temporary, "results") };
  const first = await executeWorkflow(withProfile("profile-one"), { project });
  const second = await executeWorkflow(withProfile("profile-two"), { project });
  assert.equal(first.status, "SUCCESS", JSON.stringify(first.errors));
  assert.equal(second.status, "SUCCESS", JSON.stringify(second.errors));
  assert.notEqual(first.artifacts.find((item) => item.kind === "mcu-firmware").buildId, second.artifacts.find((item) => item.kind === "mcu-firmware").buildId);
  const restored = await executeWorkflow(withProfile("profile-one"), {project});
  assert.equal(restored.status, "SUCCESS", JSON.stringify(restored.errors));
  assert.equal(restored.artifacts.find((item) => item.kind === "mcu-firmware").buildId, first.artifacts.find((item) => item.kind === "mcu-firmware").buildId);
});

test("模拟 MCU 分片 I/O 与一次断线后重连会重新 HELLO/LIST", async () => {
  const root = path.resolve(new URL("..", import.meta.url).pathname);
  const temporary = await mkdtemp(path.join(os.tmpdir(), "cautest-v2-mcu-reconnect-"));
  const board = new SimulatedMcuBoard({ maxReadSize: 1, maxWriteSize: 2, disconnectOnce: 80 });
  const events = new EventRecorder();
  const job = mcuCTestJob({
    id: "component.mcu.reconnect",
    firmware: { kind: "host-simulated", output: path.join(temporary, "firmware"), sources: ["test/fixtures/mcu/firmware.c"] },
    board: { kind: "external", adapter: board, ownership: "borrowed" },
    reconnects: 1,
  });
  const result = await executeWorkflow(job, { project: { configDir: root, workDir: path.join(temporary, "work"), resultDir: path.join(temporary, "results") }, events });
  assert.equal(result.status, "SUCCESS", JSON.stringify(result.errors));
  assert.equal(board.disconnectUsed, true);
  assert.equal(board.logs.filter((item) => item.channel === "command" && item.text === "AT+HELLO").length, 2);
  assert.equal(board.logs.filter((item) => item.channel === "command" && item.text === "AT+LIST").length, 2);
  assert.equal(events.list().filter((event) => event.type === "MCU_RECONNECT").length, 1);
  const firstBoot = board.bootId;
  assert.notEqual(board.reset(), firstBoot);
  await board.close();
});

test("模拟 MCU 一次性命令损坏可复现 Protocol/Target 错误", async () => {
  const root = path.resolve(new URL("..", import.meta.url).pathname);
  const temporary = await mkdtemp(path.join(os.tmpdir(), "cautest-v2-mcu-corrupt-"));
  const board = new SimulatedMcuBoard({ corruptWriteOnce: true });
  const result = await executeWorkflow(mcuCTestJob({ id: "component.mcu.corrupt", firmware: { kind: "host-simulated", output: path.join(temporary, "firmware"), sources: ["test/fixtures/mcu/firmware.c"] }, board: { kind: "external", adapter: board } }), { project: { configDir: root, workDir: path.join(temporary, "work"), resultDir: path.join(temporary, "results") } });
  assert.equal(result.status, "ERROR");
  assert.equal(board.corruptionUsed, true);
  assert.ok(result.errors.some((error) => error.code === "target_error" || error.code === "protocol_error"));
});

test("External MCU 可选择恢复一次 Timeout 并重新发现 Catalog", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "cautest-v2-mcu-timeout-recovery-"));
  const firmware = path.join(temporary, "firmware.bin");
  await writeFile(firmware, "firmware");
  const buildId = "fixture-firmware-id";
  const responses = [`+HELLO:3,0,${buildId},boot-timeout,64,512`, "OK:HELLO", "+LIST:START", "+CASE:1,1,0,suite,case,", "+LIST:END,1", "OK:LIST", "+EXEC-START:1,SUITE,1,0,0", "+SUITE-START:1,1", "+CASE-START:1,1,1,0", "+CASE-END:1,1,1,0,PASS", "+SUITE-END:1,1,PASS", "+EXEC-END:1,PASS,1,0,0,0", "OK:SUITE,1", "OK:BYE"];
  let attempts = 0;
  const adapter = {
    flash() {}, reset() { return "boot-timeout"; },
    openTransport() {
      attempts += 1;
      if (attempts === 1) return { write() {}, nextLine() { throw new CautestError("injected timeout", { code: "timeout_error" }); }, close() {} };
      return { write() {}, nextLine() { return responses.shift(); }, close() {} };
    },
  };
  const events = new EventRecorder();
  const result = await executeWorkflow(mcuCTestJob({ id: "component.mcu.timeout-recovery", firmware: { kind: "existing", file: firmware, buildId }, board: { kind: "external", adapter }, reconnects: 1, recoverTimeouts: true }), { project: { configDir: temporary, workDir: path.join(temporary, "work"), resultDir: path.join(temporary, "results") }, events });
  assert.equal(result.status, "SUCCESS", JSON.stringify(result.errors));
  assert.equal(attempts, 2);
  assert.equal(events.list().filter((event) => event.type === "MCU_RECONNECT")[0].reason, "timeout_error");
});
