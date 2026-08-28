obj-m += cautest_kernel.o
cautest_kernel-y := cautest_kernel_runtime.o cautest_core_adapter.o \
	cautest_selection_adapter.o

ccflags-y += -I$(src)/../../include
ccflags-y += -I$(src)/../../platform/linux-kernel/include
ccflags-y += -I$(src)/../../target/linux-kernel/include
ccflags-y += -DCAUTEST_KERNEL_MAX_REGISTRIES=$(CAUTEST_KERNEL_MAX_REGISTRIES)
ccflags-y += -DCAUTEST_KERNEL_EVENT_CAPACITY=$(CAUTEST_KERNEL_EVENT_CAPACITY)
ccflags-y += -DCAUTEST_KERNEL_WORKSPACE_SIZE=$(CAUTEST_KERNEL_WORKSPACE_SIZE)

CAUTEST_KERNEL_MAX_REGISTRIES ?= 16
CAUTEST_KERNEL_EVENT_CAPACITY ?= 128
CAUTEST_KERNEL_WORKSPACE_SIZE ?= 16384
