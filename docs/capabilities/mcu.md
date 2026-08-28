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
  board: {
    kind: "simulated",
    maxReadSize: 3,
    maxWriteSize: 2,
    disconnectOnce: 40,
  },
  reconnects: 1,
});
```

内置 `SimulatedMcuBoard` 通过真实子进程 FD 模拟串口，并支持读写分片、一次性写损坏和一次性断线；每次 Reset 都生成新的 Boot ID。断线属于可恢复错误，`reconnects` 控制重试次数；`recoverTimeouts: true` 还允许恢复 timeout。每次重连都会创建新的 CTP3 Session，重新执行 HELLO 和 LIST，旧 Catalog ID 不会复用。

真实 Board 由项目提供 Adapter：

```js
mcuCTestJob({
  id: "component.board.uart",
  firmware: {
    kind: "command",
    program: "make",
    args: ["-C", "firmware", "all"],
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

Adapter 的 Transport 与 Native/UML 共用完整 CTP3 Session 逻辑。Flash 后的 Build ID 与 Reset 返回的 Boot ID 都必须匹配 HELLO；旧固件或旧启动实例会在执行前被拒绝。外部 Adapter 同样支持 `reconnects` 与可选 timeout 恢复。`logFiles` 可以把项目生成的串口或 Board 日志按相对路径发布到结果目录。owned Adapter 在 Cleanup 中关闭，borrowed Adapter 只附加不关闭。调用链：Firmware Build/Load → Board Flash/Reset → CTP3 Transport → 结构化 Result → Logs/Cleanup。

权威 Schema：`McuCTestJobInput`、`McuFirmwareInput`、`McuBoardAdapter`、`McuCtpTransport`，见源码 `src/config/schema/mcu.ts` 或安装后的 `lib/config/schema/mcu.d.ts`。
