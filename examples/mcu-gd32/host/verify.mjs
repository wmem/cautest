// 手动实板验证：同一次启动的 BYE/重连、再次复位及旧 Boot ID 拒绝。
// 不加入自动 npm test，避免普通单测操作硬件。
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { gd32Board } from "./board.mjs";

const developmentApi = new URL("../../../dist/config/index.js", import.meta.url);
const { runCTestSession } = await import((existsSync(developmentApi)
  ? developmentApi : new URL("../../../lib/config/index.js", import.meta.url)).href);

const directory = fileURLToPath(new URL("..", import.meta.url));
const msp = path.resolve(directory, process.env.MSP_DIR ?? "../../../../gd32-template/src/components/gd32f4xx");
execFileSync("make", ["-j4", `MSP_DIR=${msp}`, "INJECT_FAILURE=0"], { cwd: directory });
const board = gd32Board({
  msp, output: path.join(directory, ".cautest/board"),
  probe: process.env.PROBE_ID ?? "CA6BCA57C554B615", frequencies: [1000000, 100000],
  serial: { port: process.env.SERIAL_PORT ?? "/dev/ttyUSB0", baud_rate: 115200,
    board_control: { dtr: true, rts: false } },
});
const buildId = "gd32-cautest-v1";
const run = async (bootId) => runCTestSession({
  transport: await board.openTransport(), expectedBuildId: buildId, expectedBootId: bootId,
});
try {
  await board.flash({ path: path.join(directory, ".cautest/firmware/firmware.elf"), buildId });
  const firstBoot = await board.reset();
  for (let i = 0; i < 2; ++i) {
    const result = await run(firstBoot);
    assert.deepEqual(result.groups.flatMap((group) => group.cases.map((item) => item.status)),
      ["PASS", "SKIP", "PASS", "PASS"]);
  }
  const secondBoot = await board.reset();
  assert.notEqual(firstBoot, secondBoot);
  await assert.rejects(() => run(firstBoot), /Boot ID|boot.*mismatch|bootId/i);
  const result = await run(secondBoot);
  assert.equal(result.groups.flatMap((group) => group.cases).filter((item) => item.status === "PASS").length, 3);
  console.log(JSON.stringify({ status: "PASS", firstBoot, secondBoot,
    checks: ["BYE/reconnect", "reset/new boot identity", "reject stale boot", "run after rejection"] }, null, 2));
} finally {
  await board.close();
}
