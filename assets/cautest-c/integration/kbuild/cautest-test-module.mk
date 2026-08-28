# 项目 Kbuild 在定义 CAUTEST_TEST_MODULE/CAUTEST_TEST_OBJS 后 include 本文件。
ifndef CAUTEST_TEST_MODULE
$(error CAUTEST_TEST_MODULE 未定义)
endif
ifndef CAUTEST_TEST_OBJS
$(error CAUTEST_TEST_OBJS 未定义)
endif

obj-m += $(CAUTEST_TEST_MODULE).o
$(CAUTEST_TEST_MODULE)-y += $(CAUTEST_TEST_OBJS)

CAUTEST_C_ROOT ?= $(src)/../../../packages/cautest-c
ccflags-y += -I$(CAUTEST_C_ROOT)/include
ccflags-y += -I$(CAUTEST_C_ROOT)/target/linux-kernel/include
