# 在真实 MCU 上运行 C 测试

真实 MCU 接入分为 C 测试运行时、板端移植和主机 Board Adapter。断言、Fixture、Registry 和 CTP3 使用同一份 C 代码；板端提供接收和发送回调，主机负责构建、烧录、复位及串口连接。这些职责不依赖 Xmake，也不要求被测产品使用 Cmlib 或 RT-Thread。

## 板端只移植收发和启动

公共入口是 [`cautest/mcu.h`](../../assets/cautest-c/include/cautest/mcu.h)。把 `core/cautest.c`、`protocol/ctp3.c`、`target/mcu/mcu.c` 加入固件，提供静态 Registry 和 Workspace，再调用 `cautest_mcu_init()` 和 `cautest_mcu_poll()`。JS 构建集成也可用 `resolveCautestC({ platform: "mcu" })` 获取这三个源文件及 include 路径；该入口不包含模拟板模型。

移植的接收回调非阻塞，返回收到的字节数、暂无数据的 0 或错误的负数。发送回调遵循现有 CTP3 的完整写契约：发完传入的数据返回 0，失败返回非零。驱动若只能短写，由移植层循环发送并设定适当的超时。公共层不包含芯片头文件，不使用堆或 libc；存储和回调上下文由调用方持有。精确签名、生命周期及返回值以头文件为准。

### 必须提供什么，是否需要 malloc

Cautest 不要求实现 `malloc/free`、线程、锁、文件或时钟移植接口。平台必须提供两个回调，并配置 Registry、Workspace、Build ID 和 Boot ID：

```c
long read(void *context, unsigned char *data, unsigned long capacity);
int write(void *context, const unsigned char *data, unsigned long size);
```

`read` 返回实际字节数，不能超过 capacity；返回 0 表示暂无数据，负数表示收发错误。`write` 必须完整发送，成功返回 0，失败返回非零，不能把短写字节数直接作为成功结果返回。GD32 示例的实现见 [`port/board.c`](../../examples/mcu-gd32/port/board.c)。

Runtime 实例、Registry 和 Workspace 可全部静态分配。Workspace 使用 `CAUTEST_WORKSPACE` / `CAUTEST_WORKSPACE_INIT` 定义，Fixture 从这块调用方存储中分配，不调用系统 malloc；容量不足会形成运行时错误，而不是自动转向堆分配。Runtime 内部接收缓冲区与 Workspace 分开保存。协议配置在初始化时复制，Registry、Workspace、身份字符串和回调 context 指向的对象仍须在会话期间有效。运行中不要从其他线程并发修改它们。

如果用例调用 RT-Thread 动态创建线程、创建 IPC 对象或测试堆内存，这些被测接口仍依赖 RT-Thread 的正常内存配置。这不是 Cautest 要求的 malloc 移植。`protocol.run_instance` 是可选高级执行回调，普通接入保持空值即可；它不要求平台先实现抢占或故障隔离。

`poll()` 每次最多接收一批数据，调用方可放在裸机主循环或独立 RTOS 线程中。空闲时如何等待、初始化时钟和 GPIO/UART、发生错误后如何复位，由平台决定。收到 BYE 后重新初始化即可接受下一次会话；收发错误保持 ERROR，修复底层连接后显式重新初始化。协议串口不能同时输出 Shell 或普通 printf；测试日志使用 `CAUTEST_LOG_*`。

通常无需移植断言、Fixture 或测试文件。硬件专属用例通过产品 HAL 或自己的板端接口访问外设；移植板端收发不等于完成 SPI/UART 驱动验收。需要引脚环回或从设备的测试，应显式提供相应夹具。

默认同步执行测试，Host 超时可以结束等待，但不能抢占挂死的 MCU 测试。硬件看门狗、HardFault 记录及测试隔离由平台提供；高级平台可通过已有 `protocol.run_instance` 回调报告故障。当前 GD32 示例没有实现这类隔离，挂死后需要显式复位。

## 集成到保留 RTOS 和真实驱动的测试固件

测试固件可以保留产品的 RTOS、HAL、驱动和组件，启动后在线程中运行 Cautest；无需把产品改成裸机示例。UART 专供协议使用，应用 Shell 和普通串口打印不能争用这条通道。测试日志用 `CAUTEST_LOG_*` 返回 Host，普通应用日志使用另一条通道或在测试固件中关闭。

平台先初始化内核和设备，再准备 Runtime 并启动测试线程。UART 中断只写入接收缓冲区、唤醒线程；`cautest_mcu_poll()` 和断言在线程上下文运行。暂无输入时，线程应等待接收事件或适当让出 CPU，避免忙轮询使其他线程无法调度。每个 Runtime 由一个测试线程串行执行用例；用例需要的辅助线程只记录观察结果，测试线程汇总并执行断言，不并发操作同一个测试 Context。

按模块组织普通 `test*.c`，例如 `tests/rtos/test_thread.c`、`tests/rtos/test_semaphore.c`、`tests/flash/test_flash.c`，再用 Registry 汇总 Suite。测试可移植 HAL 时调用 HAL 接口，直接验证 `rt_*` 时把用例归入 RT-Thread 专属 Suite；Cautest 公共运行时不包含这些系统或驱动依赖。

Fixture 的 setup/teardown 为每个测试准备和释放线程、IPC 及设备状态。外部 Flash 测试在板配置指定的测试区域内擦除、写入、读回；固件注册并启用该 Suite 时，必须具备对应硬件及驱动。不能把未接硬件描述为已经通过。完整测试是运行本测试固件注册且配置选中的用例，不会自动发现或验证板上的全部外设。

同一份固件内，Host 可以用 `--suite`、`--case` 或 `--include` 选择用例，不需要因筛选而重新编译。构建和烧录仍由选用的 Job 决定。当前已验证裸机 GD32 的直接 CLI 接入及 gd32-template 独立 RT-Thread 固件的 xmake ctest 接入；两者分别保留验收记录，见 [RTOS 验收](../tests/mcu-rtthread-xmake-20261007.md)。公开 MCU 构建规则与命令见 [Xmake 接入](xmake.md#真实-mcu-固件)。

## 主机负责真实板生命周期

配置使用 `mcuCTestJob()` 的 `firmware.kind: "command"` 或 `"existing"`，并提供 `board.kind: "external"`。Adapter 的 `flash()` 烧录固件，`reset()` 返回本轮启动的 Boot ID，`openTransport()` 返回行式串口连接，`close()` 释放资源。身份必须与固件 HELLO 相符；接口契约见 [`McuBoardAdapter`](../../src/config/schema/mcu.ts)，避免把芯片或下载工具写进通用 Workflow。

Build ID 是固件协议标识，不是文件内容摘要。Boot ID 应能区分复位前后，例如由平台保存启动计数，或由主机复位后注入 nonce。仅返回一个固定字符串不能识别陈旧启动实例。

已烧好并正在运行的测试固件，可用直接 `session serial` 连接，见 [CLI Direct Session](cli.md#direct-session)。它不构建、烧录或复位，也不加载 Board Adapter。但当前通用串口实现只通过 stty 配置串口，没有 CH340 的 DTR/RTS/HUPCL 策略；对于下文所述的特殊控制线接线，不能直接认定该入口可用。普通应用仅能通过 UART/Shell 交互，也不等于已经包含 Cautest Registry 和协议服务。

## GD32F427 示例

[`examples/mcu-gd32`](../../examples/mcu-gd32/) 使用 Make 直接交叉编译，复用 GD32 MSP 中的原厂库、原厂裸机启动代码、链接脚本、原始 Pack 和烧录/串口工具。`port/board.c` 负责芯片相关代码，`test/` 分别放通用断言和板端检查，`host/` 延迟加载 GD32 MSP 的 tools/cautest/board.mjs 板适配器；MSP 必须包含该目录。更换 MCU 时保留公共运行时和通用测试，替换板端移植与主机下载方式。

运行前需要已准备好的 Cautest `dist`、Make、`arm-none-eabi-gcc`、uv 和带 pyOCD/pyelftools 的 Python。示例默认使用本工作区的 GD32 MSP 路径；其他位置通过 `MSP_DIR` 指定。`PYOCD_PYTHON` 可指定已有 Python，未指定时从 pyOCD 可执行文件的 shebang 定位，不自动安装依赖。

示例当前对应 GD32F427VET6、25 MHz 晶振、200 MHz 系统时钟和 USART0 PA9/PA10。板型和引脚在移植代码中定义；`SERIAL_PORT`、`PROBE_ID` 可覆盖板外连接。默认 CH340 接线使用 DTR asserted、RTS deasserted；串口复用 MSP 的 `serial_port`，关闭时清除 HUPCL。其他板的控制线策略应修改传给 Adapter 的 `serial.board_control`。

这些命令会烧录测试固件，替换当前应用。请先保存需要恢复的固件：

```sh
cd examples/mcu-gd32
export MSP_DIR=/path/to/msp-gd32f4xx
node ../../cautest.js --config cautest.config.mjs doctor
node ../../cautest.js --config cautest.config.mjs run gd32.real
node ../../cautest.js --config cautest.config.mjs run gd32.real --suite board
INJECT_FAILURE=1 node ../../cautest.js --config cautest.config.mjs run gd32.real
node host/verify.mjs
```

正常运行预期 PASS 3、SKIP 1，退出 0；筛选 board 预期 PASS 2；故意注入失败预期 FAIL 1、退出 1，随后正常运行会重新构建。`verify.mjs` 验证同次启动下 BYE 后的新会话、再次复位、拒绝旧 Boot ID，以及拒绝后仍可运行。普通 `npm test` 不连接硬件。

示例通过 SWD 复位并暂停，在 `.cautest_noinit` SRAM 区域写入随机 nonce 后继续运行。原厂启动代码不清除该区域，C 移植层把 nonce 格式化为 Boot ID；这是此示例采用的板端身份方案，不是其他 MCU 必须照搬的接口。烧录依次尝试 1 MHz、100 kHz，并读回验证；复位及 nonce 写入固定使用已验证的 100 kHz。桥接进程在整轮测试持有探针锁和串口独占，退出后释放。

结构化报告在示例 `.cautest/results/`，下载及读回记录在 `.cautest/board/flash-*/`。实际执行范围与结果见[真实 GD32 验证记录](../tests/mcu-gd32-20261007.md)。
