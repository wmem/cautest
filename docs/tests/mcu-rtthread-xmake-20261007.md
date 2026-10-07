# GD32 RT-Thread 与 Xmake 实板验收（2026-10-07）

本轮在 gd32-template 新增独立 mcu-test 固件，使用 GD32F427VET6、RT-Thread v5.2.2 核心、cmlib OS/设备接口和 GD32 UART 驱动。测试通过 Addon 命令 xmake ctest 执行构建、烧录读回、复位、USART0 CTP3 和资源清理；与此前的[裸机 CLI 验收](mcu-gd32-20261007.md)分开记录。

硬件为 25 MHz 外部晶振、200 MHz CPU、USART0 PA9/PA10、/dev/ttyUSB0 115200 8N1、CMSIS-DAP v2 CA6BCA57C554B615、pyOCD 0.45.1。软件基于 Cautest 6f2fdaa、GD32 MSP 073fa12、模板 8796c64 的本次工作区修改；公开版本及锁定 SHA 由消费工程最终锁文件确认。

| 执行 | 实际结果 | 证据 |
| --- | --- | --- |
| Debug，xmake ctest mcu.all | 线程、信号量、互斥锁 PASS 3，FAIL/ERROR 0，退出 0 | [全部](evidence/mcu-rtthread-xmake-20261007/all.log) |
| --case=semaphore | 只运行信号量，PASS 1，退出 0 | [筛选](evidence/mcu-rtthread-xmake-20261007/selected.log) |
| --mcu-test-fail=y | PASS 2、FAIL 1、ERROR 0，退出 1，报告断言位置和期望/实际值 | [故障注入](evidence/mcu-rtthread-xmake-20261007/failure.log) |
| Release，--suite='rtos_*'，JSON/JUnit | PASS 3、FAIL/ERROR 0，退出 0；失败选项已关闭 | [Release](evidence/mcu-rtthread-xmake-20261007/release.log) |
| 恢复原 hello 并验收基础 Shell | 命令、查询、编辑、历史、补全及等待后再次交互通过 | [恢复](evidence/mcu-rtthread-xmake-20261007/restored-shell.log) |

[结构化用例结果](evidence/mcu-rtthread-xmake-20261007/results.json)保留各轮状态与断言。原始构建、Receipt、串口协议和下载逐段读回记录位于消费工程 build/mcu-integration 与 build/mcu-test/board；这些生成产物不作为源码托管。

三个 Suite 分别位于 tests/rtos/test_thread.c、test_semaphore.c、test_mutex.c，共享 Fixture 创建和清理真实 rt_thread/rt_sem/rt_mutex。辅助线程只记录结果，断言由 Cautest 主线程执行。测试 firmware 的 Xdtc 配置继承正常 board.lua，关闭同一路打印和 Shell，另行生成系统和内核配置；正常 hello 不编入测试代码。公共 Runtime 静态分配，不要求 malloc，被测 RT-Thread 动态对象使用真实内核堆。

另有真实 ARM 交叉构建回归检查 MCU 规则保留应用入口、生成路径在工具链切换后保持一致、没有 POSIX entry、重复构建保留 Build ID，入口为 test/xmake-mcu-runtime.test.js。MSP 工具回归检查唯一默认 target 的选择及显式选择非默认 target。

本轮 1 MHz 下载及读回通过，复位/Boot ID 注入和恢复应用使用 100 kHz。工具仍保留 1 MHz→100 kHz 回退；本轮连续成功不代表长期稳定。coresight 警告仍出现。

没有验收 SPI、外部 Flash、其他 MCU、看门狗或 HardFault 隔离。Host 超时不能抢占挂死的板端用例；UART 仅作为协议传输，不代表全部模式、DMA、压力或电气指标已验证。
