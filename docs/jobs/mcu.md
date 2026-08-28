# MCU C Test

Firmware 输入使用明确的 `kind`，不会根据字符串或对象形状猜测。Host 模拟最小示例：

```js
mcuCTestJob({
  id: "component.mcu.smoke",
  firmware: {
    kind: "host-simulated",
    output: ".cautest/generated/mcu/smoke",
    sources: ["test/mcu/smoke.c"],
  },
});
```

真实 Board 由项目提供 Adapter：

```js
mcuCTestJob({
  id: "component.board.uart",
  firmware: {
    kind: "command",
    program: "cmake",
    args: ["--build", "build", "--target", "firmware"],
    output: "build/firmware.bin",
  },
  board: {
    kind: "external",
    adapter: boardAdapter, // flash/reset/openTransport/close
  },
  serial: { options: { port: "/dev/ttyUSB0", baudRate: 115200 } },
  run: { include: ["uart/*"] },
});
```

Adapter 的 Transport 与 Native/UML 共用完整 CTP3 Session 逻辑。`logFiles` 可以把项目生成的串口或 Board 日志按相对路径发布到结果目录。调用链：Firmware Build/Load → Board Flash/Reset → CTP3 Transport → 结构化 Result → Logs/Adapter Close。

权威 Schema：`McuCTestJobInput`、`McuFirmwareInput`、`McuBoardAdapter`、`McuCtpTransport`，见源码 `src/config/schema/mcu.ts` 或安装后的 `lib/config/schema/mcu.d.ts`。
