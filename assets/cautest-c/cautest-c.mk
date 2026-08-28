# 安装后的 Consumer Makefile 可 include 本文件；调用方可以预先覆盖 CAUTEST_C_PREFIX。
CAUTEST_C_PREFIX ?= $(abspath $(dir $(lastword $(MAKEFILE_LIST)))/../..)
CAUTEST_C_CPPFLAGS ?= -I$(CAUTEST_C_PREFIX)/include
CAUTEST_C_LDFLAGS ?= -L$(CAUTEST_C_PREFIX)/lib
CAUTEST_C_LIBS ?= -lcautest-mcu-reference -lcautest-freestanding -lcautest-protocol -lcautest-core
