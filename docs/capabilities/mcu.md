# MCU C Test

MCU C Test 把 Firmware 构建或加载、Board 生命周期、Transport 和 CTP3 执行组织为标准 Test Job。Host 模拟与真实 Board 使用相同的 Session 和 Result 语义；差别只在 Firmware 来源和 Board Adapter，不在 Workflow Engine 中形成隐藏分支。

## Host 模拟与真实 Board

Host 模拟会真实编译并启动一个 Firmware 子进程，再通过受控 FD 模拟串口 Transport。内置 `SimulatedMcuBoard` 可以制造读写分片、一次性损坏和一次性断线，用于验证 Freestanding Runtime、协议 Decoder 和恢复逻辑，但不验证真实交叉编译器、Flash、串口或硬件外设。

真实 Board 由项目提供 Adapter，负责 Flash、Reset、打开 Transport 和关闭资源。Firmware 可以由外部命令构建，也可以引用已有产物；Cautest 不猜测项目的 Board 启动协议。项目生成的串口或 Board 日志可以作为 Artifact 发布到标准结果目录。

## 身份、恢复与所有权

Flash 后的 Build ID 和 Reset 返回的 Boot ID 必须与 HELLO 一致，其他 Target 身份或旧启动实例会在执行前被拒绝。Build ID 不代表固件内容摘要：同一构建目录内的源码重建可以保留 ID。existing/command 固件须显式提供与固件 HELLO 一致的 `firmware.buildId`，也可用 `run.expectedBuildId`；工具不从固件字节推断协议身份。断线属于可恢复错误时，Job 可以在限定次数内重新连接；每次重连都会建立新 Session、重新 HELLO 和 LIST，旧 Catalog ID 不会复用。执行超时只有在显式允许时参与恢复。

owned Adapter 在 Cleanup 中关闭；borrowed Adapter 只附加、不代替项目管理生命周期。重试耗尽、身份不匹配、Transport 或协议错误属于基础设施错误，Firmware 中的 Assertion、FAIL、SKIP 和 ERROR 则进入标准 C Test 结果。

板端公共接口使用 `cautest/mcu.h`，只要求非阻塞接收和完整发送回调，复用 CTP3、静态 Registry 和 Workspace，不依赖芯片、RTOS、堆或 libc。真实 GD32 示例通过 Make 交叉编译、SWD 烧录及读回、USART0 运行，验证范围见[实板记录](../tests/mcu-gd32-20261007.md)。

Xmake Addon 通过 `cautest.mcu` 提供公共运行时和 Registry，应用继续管理真实固件入口、RTOS、HAL 和 Board Provider。GD32 独立 RT-Thread 固件已经验证线程、信号量、互斥锁、筛选和 FAIL 退出码，见[RTOS 验收](../tests/mcu-rtthread-xmake-20261007.md)；不代表 SPI 或其他 MCU 已通过。

测试作者从[使用主机模拟运行 MCU C 测试](../usage/mcu-simulated.md)或[真实 MCU 接入](../usage/mcu-real.md)开始；C 测试与 Registry 边界见 [C Test API](../specifications/c-test-api.md)，连接和恢复约束见 [CTP3](../specifications/ctp3.md)。精确配置由 `McuCTestJobInput`、`McuFirmwareInput`、`McuBoardAdapter` 和 `McuCtpTransport` 定义，见源码 `src/config/schema/mcu.ts` 或安装后的 `lib/config/schema/mcu.d.ts`。
