CC ?= cc
CFLAGS ?= -O2 -std=c99 -Wall -Wextra
CAUTEST_C_ROOT ?= ../..

all: cautest-uml-agent

cautest-uml-agent: guest_agent.c
	$(CC) $(CFLAGS) -static \
		-I$(CAUTEST_C_ROOT)/include \
		-I$(CAUTEST_C_ROOT)/platform/linux-kernel/include \
		guest_agent.c -o $@

clean:
	rm -f cautest-uml-agent

.PHONY: all clean
