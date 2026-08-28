# MCU C Test

MCU C Test 把 Firmware 构建或加载、Board 生命周期、Transport 和 CTP3 执行组织为标准 Test Job。Host 模拟与真实 Board 使用相同的 Session 和 Result 语义；差别只在 Firmware 来源和 Board Adapter，不在 Workflow Engine 中形成隐藏分支。

## Host 模拟与真实 Board

Host 模拟会真实编译并启动一个 Firmware 子进程，再通过受控 FD 模拟串口 Transport。内置 `SimulatedMcuBoard` 可以制造读写分片、一次性损坏和一次性断线，用于验证 Freestanding Runtime、协议 Decoder 和恢复逻辑，但不验证真实交叉编译器、Flash、串口或硬件外设。

真实 Board 由项目提供 Adapter，负责 Flash、Reset、打开 Transport 和关闭资源。Firmware 可以由外部命令构建，也可以引用已有产物；Cautest 不猜测项目的 Board 启动协议。项目生成的串口或 Board 日志可以作为 Artifact 发布到标准结果目录。

## 身份、恢复与所有权

Flash 后的 Build ID 和 Reset 返回的 Boot ID 必须与 HELLO 一致，旧 Firmware 或旧启动实例会在执行前被拒绝。断线属于可恢复错误时，Job 可以在限定次数内重新连接；每次重连都会建立新 Session、重新 HELLO 和 LIST，旧 Catalog ID 不会复用。执行超时只有在显式允许时参与恢复。

owned Adapter 在 Cleanup 中关闭；borrowed Adapter 只附加、不代替项目管理生命周期。重试耗尽、身份不匹配、Transport 或协议错误属于基础设施错误，Firmware 中的 Assertion、FAIL、SKIP 和 ERROR 则进入标准 C Test 结果。

测试作者从[使用主机模拟运行 MCU C 测试](../usage/mcu-simulated.md)开始；C 测试与 Registry 边界见 [C Test API](../specifications/c-test-api.md)，连接和恢复约束见 [CTP3](../specifications/ctp3.md)。精确配置由 `McuCTestJobInput`、`McuFirmwareInput`、`McuBoardAdapter` 和 `McuCtpTransport` 定义，见源码 `src/config/schema/mcu.ts` 或安装后的 `lib/config/schema/mcu.d.ts`。
