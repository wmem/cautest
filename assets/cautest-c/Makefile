CAUTEST_C_VERSION := 0.2.0

CC ?= cc
AR ?= ar
CPPFLAGS ?=
CFLAGS ?= -O2
BUILD_DIR ?= build
PREFIX ?= /usr/local
LIBDIR ?= $(PREFIX)/lib
INCLUDEDIR ?= $(PREFIX)/include

COMMON_FLAGS := -std=c99 -Wall -Wextra -I$(CURDIR)/include
FREESTANDING_FLAGS := -ffreestanding -fno-builtin
LIB_OUTPUT := $(BUILD_DIR)/lib

CORE_OBJECT := $(BUILD_DIR)/core/cautest.o
PROTOCOL_OBJECT := $(BUILD_DIR)/protocol/ctp3.o
FREESTANDING_OBJECT := $(BUILD_DIR)/platform/freestanding/cautest_freestanding.o
MCU_REFERENCE_OBJECT := $(BUILD_DIR)/target/mcu-reference/mcu_reference.o

CORE_LIBRARY := $(LIB_OUTPUT)/libcautest-core.a
PROTOCOL_LIBRARY := $(LIB_OUTPUT)/libcautest-protocol.a
FREESTANDING_LIBRARY := $(LIB_OUTPUT)/libcautest-freestanding.a
MCU_REFERENCE_LIBRARY := $(LIB_OUTPUT)/libcautest-mcu-reference.a
LIBRARIES := $(CORE_LIBRARY) $(PROTOCOL_LIBRARY) $(FREESTANDING_LIBRARY) $(MCU_REFERENCE_LIBRARY)

.PHONY: all core protocol freestanding mcu-reference install clean

all: $(LIBRARIES)
core: $(CORE_LIBRARY)
protocol: $(PROTOCOL_LIBRARY)
freestanding: $(FREESTANDING_LIBRARY)
mcu-reference: $(MCU_REFERENCE_LIBRARY)

$(CORE_OBJECT): core/cautest.c include/cautest/cautest.h include/cautest/version.h
	@mkdir -p "$(@D)"
	$(CC) $(CPPFLAGS) $(CFLAGS) $(COMMON_FLAGS) -c "$<" -o "$@"

$(PROTOCOL_OBJECT): protocol/ctp3.c include/cautest/ctp3.h include/cautest/version.h
	@mkdir -p "$(@D)"
	$(CC) $(CPPFLAGS) $(CFLAGS) $(COMMON_FLAGS) -c "$<" -o "$@"

$(FREESTANDING_OBJECT): platform/freestanding/cautest_freestanding.c platform/freestanding/cautest_freestanding.h include/cautest/cautest.h
	@mkdir -p "$(@D)"
	$(CC) $(CPPFLAGS) $(CFLAGS) $(COMMON_FLAGS) $(FREESTANDING_FLAGS) -I$(CURDIR)/platform/freestanding -c "$<" -o "$@"

$(MCU_REFERENCE_OBJECT): target/mcu-reference/mcu_reference.c target/mcu-reference/mcu_reference.h platform/freestanding/cautest_freestanding.h
	@mkdir -p "$(@D)"
	$(CC) $(CPPFLAGS) $(CFLAGS) $(COMMON_FLAGS) $(FREESTANDING_FLAGS) -I$(CURDIR)/platform/freestanding -I$(CURDIR)/target/mcu-reference -c "$<" -o "$@"

$(CORE_LIBRARY): $(CORE_OBJECT)
	@mkdir -p "$(@D)"
	$(AR) rcs "$@" "$<"

$(PROTOCOL_LIBRARY): $(PROTOCOL_OBJECT)
	@mkdir -p "$(@D)"
	$(AR) rcs "$@" "$<"

$(FREESTANDING_LIBRARY): $(FREESTANDING_OBJECT)
	@mkdir -p "$(@D)"
	$(AR) rcs "$@" "$<"

$(MCU_REFERENCE_LIBRARY): $(MCU_REFERENCE_OBJECT)
	@mkdir -p "$(@D)"
	$(AR) rcs "$@" "$<"

install: all
	install -d "$(DESTDIR)$(LIBDIR)" "$(DESTDIR)$(LIBDIR)/cautest-c"
	install -m 0644 $(LIBRARIES) "$(DESTDIR)$(LIBDIR)"
	install -m 0644 cautest-c.mk "$(DESTDIR)$(LIBDIR)/cautest-c/cautest-c.mk"
	install -d "$(DESTDIR)$(INCLUDEDIR)/cautest"
	install -m 0644 include/cautest/*.h "$(DESTDIR)$(INCLUDEDIR)/cautest"
	install -d "$(DESTDIR)$(INCLUDEDIR)/cautest/platform/freestanding"
	install -m 0644 platform/freestanding/cautest_freestanding.h "$(DESTDIR)$(INCLUDEDIR)/cautest/platform/freestanding"
	install -d "$(DESTDIR)$(INCLUDEDIR)/cautest/target/mcu-reference"
	install -m 0644 target/mcu-reference/mcu_reference.h "$(DESTDIR)$(INCLUDEDIR)/cautest/target/mcu-reference"

clean:
	@case "$(abspath $(BUILD_DIR))" in /|"$(CURDIR)") echo "拒绝清理 BUILD_DIR=$(BUILD_DIR)" >&2; exit 1;; esac
	rm -rf -- "$(BUILD_DIR)"
