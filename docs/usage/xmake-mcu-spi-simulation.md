# SPI behavioral simulation

This example compiles the actual C model and test cases with Xmake and exchanges
CTP through the reference MCU target with fragmented serial I/O and one injected
disconnect. It is a host-executed behavioral model, not an instruction-set,
cycle-accurate, pin-level or electrical MCU/SPI simulator.

Clone Cautest into `tools/cautest`, prepare it with npm, then run:

```sh
xmake ct --tag=simulated,mcu,spi --reporter=json,junit
xmake ct --case=device_identity integration.spi.protocol
xmake f -y --spi-fault=y
xmake ct --reporter=json,junit
# The injected wrong device ID must produce FAIL / exit 1, not success.
xmake f -y --spi-fault=n
xmake ct --reporter=json,junit
```

Two Jobs share one compiled firmware but have separate flash/reset/transport and
cleanup lifecycles. Four C cases cover device identity, chip select/mode, memory
read/write and write enable, bounds/invalid command handling, and model reset.
The known-error variant corrupts the received ID and must fail the identity case.
A subsequent normal configuration must recover to four passing cases.

Per the user's revised delivery scope, MCU software acceptance can use this
simulation. The original plan's real-board SPI gate remains separately unrun;
no firmware download, GPIO waveform or physical-device claim follows from it.


## 无板卡的启动与链接构建检查

`CAUTEST_XMAKE=/absolute/xmake npm run test:xmake:matrix` 另含真实 Cortex-M3 的编译检查，要求 PATH 中存在 Clang、LLD、llvm-objcopy 和 readelf。它实际使用 Xmake 的 Clang 工具链生成 ARM ELF32 与 BIN，检查两组独立宏定义、Flash/RAM 布局、栈顶与 Thumb Reset 向量；明确重复的 `Reset_Handler` 必须链接失败，恢复后再次构建成功。

这是产品构建边界验收：不运行该 ARM 镜像，不把它当作硬件或指令集仿真，也不声称测试了板卡启动代码。Cautest 的 SPI 协议、资源锁和失败恢复仍由独立的 Host 编译行为模型执行。该检查证明 `includes` 不向普通固件 target 注入 Cautest Registry 或 POSIX 入口，产品保有自己的启动文件和链接脚本。
