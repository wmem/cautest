#include "cautest_freestanding.h"

static int cautest_freestanding_emit(void *context,
                                     const struct cautest_event *event)
{
    struct cautest_freestanding_runtime *runtime;
    unsigned long tail;

    runtime = (struct cautest_freestanding_runtime *)context;
    if (runtime->event_count >= runtime->event_capacity) {
        runtime->dropped_events += 1UL;
        return -1;
    }
    tail = (runtime->event_head + runtime->event_count) %
           runtime->event_capacity;
    runtime->events[tail] = *event;
    runtime->event_count += 1UL;
    return 0;
}

int cautest_freestanding_init(
    struct cautest_freestanding_runtime *runtime,
    const struct cautest_registry *registry,
    struct cautest_workspace workspace,
    struct cautest_event *event_storage,
    unsigned long event_capacity)
{
    if (runtime == (struct cautest_freestanding_runtime *)0 ||
        registry == (const struct cautest_registry *)0 ||
        workspace.data == (unsigned char *)0 || workspace.capacity == 0UL ||
        event_storage == (struct cautest_event *)0 || event_capacity == 0UL)
        return -1;

    runtime->registry = registry;
    runtime->workspace = workspace;
    runtime->events = event_storage;
    runtime->event_capacity = event_capacity;
    runtime->event_head = 0UL;
    runtime->event_count = 0UL;
    runtime->dropped_events = 0UL;
    runtime->boot_id = 1UL;
    runtime->initialized = 1;
    return 0;
}

void cautest_freestanding_reset(struct cautest_freestanding_runtime *runtime)
{
    if (runtime == (struct cautest_freestanding_runtime *)0 ||
        !runtime->initialized)
        return;
    runtime->event_head = 0UL;
    runtime->event_count = 0UL;
    runtime->dropped_events = 0UL;
    runtime->boot_id += 1UL;
    if (runtime->boot_id == 0UL)
        runtime->boot_id = 1UL;
}

int cautest_freestanding_run(
    struct cautest_freestanding_runtime *runtime,
    const struct cautest_run_config *config,
    struct cautest_run_result *result)
{
    struct cautest_event_sink sink;

    if (runtime == (struct cautest_freestanding_runtime *)0 ||
        !runtime->initialized || result == (struct cautest_run_result *)0)
        return -1;
    runtime->event_head = 0UL;
    runtime->event_count = 0UL;
    runtime->dropped_events = 0UL;
    sink.emit = cautest_freestanding_emit;
    sink.context = runtime;
    return cautest_run(runtime->registry, config, runtime->workspace,
                       sink, result);
}

int cautest_freestanding_run_selected(
    struct cautest_freestanding_runtime *runtime,
    const struct cautest_run_config *config,
    const struct cautest_freestanding_selection *selection,
    unsigned long selection_count,
    struct cautest_run_result *result)
{
    struct cautest_event_sink sink;
    struct cautest_execution execution;
    unsigned long suite_index;
    int status;

    if (runtime == (struct cautest_freestanding_runtime *)0 ||
        !runtime->initialized || result == (struct cautest_run_result *)0 ||
        (selection_count != 0UL &&
         selection == (const struct cautest_freestanding_selection *)0))
        return -1;
    runtime->event_head = 0UL;
    runtime->event_count = 0UL;
    runtime->dropped_events = 0UL;
    sink.emit = cautest_freestanding_emit;
    sink.context = runtime;
    if (cautest_execution_begin(&execution, runtime->registry, config,
                                runtime->workspace, sink, result) != 0)
        return -1;
    status = 0;
    for (suite_index = 0UL; suite_index < runtime->registry->suite_count;
         ++suite_index) {
        struct cautest_suite_execution suite_execution;
        unsigned long index;
        int selected = 0;
        for (index = 0UL; index < selection_count; ++index) {
            if (selection[index].suite_index == suite_index) {
                selected = 1;
                break;
            }
        }
        if (!selected)
            continue;
        if (cautest_suite_execution_begin(&execution, suite_index,
                                          &suite_execution) != 0) {
            status = -1;
            continue;
        }
        for (index = 0UL; index < selection_count; ++index) {
            enum cautest_status case_status;
            if (selection[index].suite_index != suite_index)
                continue;
            if (cautest_suite_execution_run_instance(
                    &suite_execution, selection[index].instance_index,
                    &case_status) != 0)
                status = -1;
        }
        if (cautest_suite_execution_end(&suite_execution) != 0)
            status = -1;
    }
    if (cautest_execution_finish(&execution) != 0)
        status = -1;
    return status;
}

int cautest_freestanding_poll(
    struct cautest_freestanding_runtime *runtime,
    struct cautest_event *event)
{
    if (runtime == (struct cautest_freestanding_runtime *)0 ||
        event == (struct cautest_event *)0 || runtime->event_count == 0UL)
        return 0;
    *event = runtime->events[runtime->event_head];
    runtime->event_head = (runtime->event_head + 1UL) %
                          runtime->event_capacity;
    runtime->event_count -= 1UL;
    return 1;
}
