# C Kit 构建与消费

`assets/cautest-c` 是可独立消费的 C99 Kit。根 `Makefile` 只依赖 Make、C99 编译器、`ar` 和基础安装工具，同时构建四个边界清晰的静态库：

- `libcautest-core.a`：Suite/Case、Fixture、Assertion 和执行模型；
- `libcautest-protocol.a`：CTP3 Parser/Server；
- `libcautest-freestanding.a`：无 libc 假设的事件存储与执行适配；
- `libcautest-mcu-reference.a`：分片 Ring I/O、Flash/Reset/Boot 和 MCU Reference Board。

构建并安装到项目目录：

```sh
make -C tools/cautest/assets/cautest-c \
  BUILD_DIR="$PWD/build/cautest-c" -j2
make -C tools/cautest/assets/cautest-c \
  BUILD_DIR="$PWD/build/cautest-c" \
  PREFIX="$PWD/build/cautest-prefix" install
```

Consumer Makefile 可以 include 安装后的可重定位变量文件：

```make
CAUTEST_C_PREFIX := $(CURDIR)/build/cautest-prefix
include $(CAUTEST_C_PREFIX)/lib/cautest-c/cautest-c.mk

my_test_firmware: main.c
	$(CC) -std=c99 $(CAUTEST_C_CPPFLAGS) $< \
	  $(CAUTEST_C_LDFLAGS) $(CAUTEST_C_LIBS) -o $@
```

`CC`、`AR`、`CPPFLAGS`、`CFLAGS`、`BUILD_DIR`、`PREFIX`、`LIBDIR` 和 `INCLUDEDIR` 均可覆盖。安装会发布 Header、四个静态库和 `cautest-c.mk`；链接顺序由 `CAUTEST_C_LIBS` 统一提供。C Kit 的 `package.json.version`、Makefile 版本、根 Package 与 `versions.json.release` 受同一漂移门禁约束。便携安装测试会从安装后的 C Kit 真实执行 Make 构建/安装，再用独立 Consumer Makefile 构建并运行程序。
