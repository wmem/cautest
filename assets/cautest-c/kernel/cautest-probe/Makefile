ifeq ($(CONFIG_CAUTEST),y)
obj-m += cautest_probe.o
ccflags-y += -DCONFIG_CAUTEST=1
endif

ccflags-y += -I$(src)/../../platform/linux-kernel/include
