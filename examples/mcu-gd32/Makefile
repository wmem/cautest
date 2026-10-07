# MSP_DIR 仅提供原厂库、启动代码及链接脚本，不使用 MSP 的 Xmake 规则。
MSP_DIR ?= ../../../../gd32-template/src/components/gd32f4xx
MSP := $(abspath $(MSP_DIR))
KIT := $(abspath ../../assets/cautest-c)
GD := $(MSP)/third_party/gd32
CC := arm-none-eabi-gcc
BUILD ?= .cautest/firmware
INJECT_FAILURE ?= 0
CPPFLAGS := -DGD32F427 -DUSE_STDPERIPH_DRIVER -DHXTAL_VALUE=25000000 \
 -DINJECT_FAILURE=$(INJECT_FAILURE) -Iport -I$(KIT)/include -isystem $(GD)/CMSIS \
 -isystem $(GD)/CMSIS/GD/GD32F4xx/Include -isystem $(GD)/GD32F4xx_standard_peripheral/Include
CFLAGS := -std=c99 -O2 -g3 -Wall -Wextra -Werror -mcpu=cortex-m4 -mthumb \
 -mfloat-abi=soft -ffunction-sections -fdata-sections -fno-common
STARTUP := $(GD)/CMSIS/GD/GD32F4xx/Source/GCC/startup_gd32f407_427.S
LINKER := $(GD)/CMSIS/GD/GD32F4xx/Source/GCC/Ld/gd32f425_427_xE_flash.ld
SOURCES := $(KIT)/core/cautest.c $(KIT)/protocol/ctp3.c $(KIT)/target/mcu/mcu.c \
 port/board.c test/runtime_test.c test/board_test.c test/registry.c \
 $(GD)/CMSIS/GD/GD32F4xx/Source/system_gd32f4xx.c \
 $(addprefix $(GD)/GD32F4xx_standard_peripheral/Source/gd32f4xx_,rcu.c gpio.c usart.c misc.c)
OBJECTS := $(addprefix $(BUILD)/,$(notdir $(SOURCES:.c=.o))) $(BUILD)/startup.o
vpath %.c $(sort $(dir $(SOURCES)))

.PHONY: all
all: $(BUILD)/firmware.elf

$(BUILD)/flags: FORCE
	@mkdir -p $(@D)
	@printf '%s\n' '$(CC) $(CPPFLAGS) $(CFLAGS)' > $@.tmp
	@cmp -s $@.tmp $@ && rm $@.tmp || mv $@.tmp $@

$(BUILD)/%.o: %.c $(BUILD)/flags
	$(CC) $(CPPFLAGS) $(CFLAGS) -MMD -MP -c $< -o $@

$(BUILD)/startup.o: $(STARTUP) $(BUILD)/flags
	$(CC) $(CPPFLAGS) $(CFLAGS) -c $< -o $@

$(BUILD)/firmware.elf: $(OBJECTS) $(LINKER) port/noinit.ld
	$(CC) $(CFLAGS) -nostartfiles --specs=nosys.specs -Wl,--gc-sections \
 -Wl,-Map,$(BUILD)/firmware.map -Tport/noinit.ld -T$(LINKER) $(OBJECTS) -o $@

.PHONY: FORCE
FORCE:
-include $(OBJECTS:.o=.d)
