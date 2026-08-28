#ifndef CAUTEST_POSIX_TARGET_H
#define CAUTEST_POSIX_TARGET_H

#include <cautest/cautest.h>

struct cautest_posix_target_config {
    const char *build_id;
    unsigned long workspace_size;
    unsigned long default_case_timeout_ms;
};

int cautest_posix_target_main(
    const struct cautest_registry *registry,
    const struct cautest_posix_target_config *config);

#endif
