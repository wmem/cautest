obj-m += example_driver.o
example_driver-y := example_driver_main.o example_driver_value.o
ccflags-y += -I$(src)/../include
ifeq ($(CONFIG_CAUTEST),y)
ccflags-y += -DCONFIG_CAUTEST=1
ccflags-y += -I$(CAUTEST_C_ROOT)/include
ccflags-y += -I$(CAUTEST_C_ROOT)/platform/linux-kernel/include
endif
