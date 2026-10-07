import path from "node:path";
import { fileURLToPath } from "node:url";
import { mcuCTestJob, testConfig } from "@cautest/config.js";
import { gd32Board } from "./host/board.mjs";

const directory = fileURLToPath(new URL(".", import.meta.url));
const msp = path.resolve(directory, process.env.MSP_DIR ?? "../../../../gd32-template/src/components/gd32f4xx");

export default testConfig({ jobs: [mcuCTestJob({
  id: "gd32.real",
  description: "GD32F427 真实 MCU：C Runtime、CTP3、时钟及 UART 基础检查",
  firmware: {
    kind: "command", program: "make", args: ["-j4", `MSP_DIR=${msp}`,
      `INJECT_FAILURE=${process.env.INJECT_FAILURE ?? "0"}`],
    output: ".cautest/firmware/firmware.elf", buildId: "gd32-cautest-v1",
  },
  board: { kind: "external", ownership: "owned", adapter: gd32Board({
    msp, output: path.join(directory, ".cautest/board"),
    probe: process.env.PROBE_ID ?? "CA6BCA57C554B615",
    frequencies: [1000000, 100000],
    serial: { port: process.env.SERIAL_PORT ?? "/dev/ttyUSB0", baud_rate: 115200,
      board_control: { dtr: true, rts: false } },
  }) },
})] });
