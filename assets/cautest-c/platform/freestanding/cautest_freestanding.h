#ifndef CAUTEST_FREESTANDING_H
#define CAUTEST_FREESTANDING_H

#include <cautest/cautest.h>

#ifdef __cplusplus
extern "C" {
#endif

/* 所有内存由调用方静态提供；Backend 不依赖 libc 或动态分配。 */
struct cautest_freestanding_runtime {
    const struct cautest_registry *registry;
    struct cautest_workspace workspace;
    struct cautest_event *events;
    unsigned long event_capacity;
    unsigned long event_head;
    unsigned long event_count;
    unsigned long dropped_events;
    unsigned long boot_id;
    int initialized;
};

struct cautest_freestanding_selection {
    unsigned long suite_index;
    unsigned long instance_index;
};

int cautest_freestanding_init(
    struct cautest_freestanding_runtime *runtime,
    const struct cautest_registry *registry,
    struct cautest_workspace workspace,
    struct cautest_event *event_storage,
    unsigned long event_capacity);
void cautest_freestanding_reset(struct cautest_freestanding_runtime *runtime);
int cautest_freestanding_run(
    struct cautest_freestanding_runtime *runtime,
    const struct cautest_run_config *config,
    struct cautest_run_result *result);
int cautest_freestanding_run_selected(
    struct cautest_freestanding_runtime *runtime,
    const struct cautest_run_config *config,
    const struct cautest_freestanding_selection *selection,
    unsigned long selection_count,
    struct cautest_run_result *result);
int cautest_freestanding_poll(
    struct cautest_freestanding_runtime *runtime,
    struct cautest_event *event);

#ifdef __cplusplus
}
#endif

#endif
