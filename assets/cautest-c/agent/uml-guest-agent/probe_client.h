#ifndef CAUTEST_GUEST_PROBE_CLIENT_H
#define CAUTEST_GUEST_PROBE_CLIENT_H

#include <stdint.h>

#include <cautest/probe_abi.h>

struct cautest_probe_client {
	int fd;
	uint64_t dropped_events;
};

/* 所有函数成功返回 0；失败返回负 errno。Overflow 固定返回 -EOVERFLOW。 */
int cautest_probe_client_open(struct cautest_probe_client *client,
			      const char *device, const char *channel);
void cautest_probe_client_close(struct cautest_probe_client *client);
int cautest_probe_client_reset(struct cautest_probe_client *client);
int cautest_probe_client_wait(struct cautest_probe_client *client,
			      int timeout_ms);
int cautest_probe_client_read(struct cautest_probe_client *client,
			      struct cautest_probe_event_record *event);
int cautest_probe_client_dropped(struct cautest_probe_client *client,
				 uint64_t *dropped_events);

#endif
