#define _POSIX_C_SOURCE 200809L

#include "probe_client.h"

#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <stddef.h>
#include <string.h>
#include <sys/ioctl.h>
#include <unistd.h>

static void cautest_probe_client_header(struct cautest_probe_abi_header *header,
					size_t size)
{
	header->abi_major = CAUTEST_PROBE_ABI_MAJOR;
	header->abi_minor = CAUTEST_PROBE_ABI_MINOR;
	header->struct_size = (uint32_t)size;
}

int cautest_probe_client_open(struct cautest_probe_client *client,
			      const char *device, const char *channel)
{
	struct cautest_probe_select select;
	size_t length;

	if (!client || !device || !channel)
		return -EINVAL;
	client->fd = -1;
	client->dropped_events = 0;
	length = strnlen(channel, sizeof(select.channel));
	if (!length || length == sizeof(select.channel))
		return -ENAMETOOLONG;
	client->fd = open(device, O_RDONLY | O_CLOEXEC);
	if (client->fd < 0)
		return -errno;
	memset(&select, 0, sizeof(select));
	cautest_probe_client_header(&select.header, sizeof(select));
	memcpy(select.channel, channel, length + 1);
	if (ioctl(client->fd, CAUTEST_PROBE_IOCTL_SELECT, &select) < 0) {
		int saved = errno;
		close(client->fd);
		client->fd = -1;
		return -saved;
	}
	return 0;
}

void cautest_probe_client_close(struct cautest_probe_client *client)
{
	if (!client)
		return;
	if (client->fd >= 0)
		(void)close(client->fd);
	client->fd = -1;
}

int cautest_probe_client_reset(struct cautest_probe_client *client)
{
	if (!client || client->fd < 0)
		return -EINVAL;
	if (ioctl(client->fd, CAUTEST_PROBE_IOCTL_RESET) < 0)
		return -errno;
	client->dropped_events = 0;
	return 0;
}

int cautest_probe_client_dropped(struct cautest_probe_client *client,
				 uint64_t *dropped_events)
{
	struct cautest_probe_dropped dropped;

	if (!client || client->fd < 0 || !dropped_events)
		return -EINVAL;
	memset(&dropped, 0, sizeof(dropped));
	cautest_probe_client_header(&dropped.header, sizeof(dropped));
	if (ioctl(client->fd, CAUTEST_PROBE_IOCTL_DROPPED, &dropped) < 0)
		return -errno;
	client->dropped_events = dropped.dropped_events;
	*dropped_events = dropped.dropped_events;
	return 0;
}

int cautest_probe_client_wait(struct cautest_probe_client *client,
			      int timeout_ms)
{
	struct pollfd descriptor;
	int rc;

	if (!client || client->fd < 0 || timeout_ms < -1)
		return -EINVAL;
	descriptor.fd = client->fd;
	descriptor.events = POLLIN;
	descriptor.revents = 0;
	do {
		rc = poll(&descriptor, 1, timeout_ms);
	} while (rc < 0 && errno == EINTR);
	if (rc < 0)
		return -errno;
	if (!rc)
		return -ETIMEDOUT;
	if (descriptor.revents & POLLERR) {
		uint64_t dropped;
		(void)cautest_probe_client_dropped(client, &dropped);
		return -EOVERFLOW;
	}
	if (!(descriptor.revents & POLLIN))
		return -EIO;
	return 0;
}

int cautest_probe_client_read(struct cautest_probe_client *client,
			      struct cautest_probe_event_record *event)
{
	ssize_t size;

	if (!client || client->fd < 0 || !event)
		return -EINVAL;
	do {
		size = read(client->fd, event, sizeof(*event));
	} while (size < 0 && errno == EINTR);
	if (size < 0) {
		int saved = errno;
		if (saved == EOVERFLOW) {
			uint64_t dropped;
			(void)cautest_probe_client_dropped(client, &dropped);
		}
		return -saved;
	}
	if ((size_t)size != sizeof(*event) ||
	    event->header.abi_major != CAUTEST_PROBE_ABI_MAJOR ||
	    event->header.abi_minor > CAUTEST_PROBE_ABI_MINOR ||
	    event->header.struct_size != sizeof(*event) ||
	    event->payload_length > CAUTEST_PROBE_PAYLOAD_MAX)
		return -EPROTO;
	return 0;
}
