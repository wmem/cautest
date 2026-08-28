#define _POSIX_C_SOURCE 200809L

#include "posix_target.h"
#include "posix_platform.h"

#include <cautest/ctp3.h>

#include <errno.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

#if defined(__linux__)
#include <sys/prctl.h>
#endif

#define CAUTEST_POSIX_CONTROL_FD 3
#define CAUTEST_POSIX_EVENT_FD 4

#ifdef CAUTEST_GCOV
void __gcov_dump(void);
#endif

struct posix_target_state {
    int event_fd;
    unsigned long case_timeout_ms;
    char fault_message[64];
};

static volatile sig_atomic_t active_case_group = -1;

static void terminate_target(int signal_number)
{
    pid_t group = (pid_t)active_case_group;
    (void)signal_number;
    if (group > 0)
        (void)kill(-group, SIGKILL);
    _exit(128 + SIGTERM);
}

static int posix_write(void *context, const unsigned char *data,
                       unsigned long size)
{
    struct posix_target_state *state =
        (struct posix_target_state *)context;
    return cautest_posix_write_all(state->event_fd, data, (size_t)size);
}

static int run_isolated_instance(
    void *context,
    struct cautest_suite_execution *suite_execution,
    unsigned long instance_index,
    struct ctp3_instance_outcome *outcome)
{
    struct posix_target_state *state =
        (struct posix_target_state *)context;
    pid_t child;
    int wait_status = 0;
    unsigned long long deadline;

    (void)fflush((FILE *)0);
    child = fork();
    if (child < 0) {
        outcome->status = CAUTEST_STATUS_ERROR;
        outcome->fault = CTP3_PLATFORM_FAULT_RUNTIME;
        outcome->message = "fork failed";
        outcome->result_recorded = 0;
        outcome->events_complete = 0;
        return 0;
    }
    if (child == 0) {
        enum cautest_status status = CAUTEST_STATUS_ERROR;
        (void)setpgid(0, 0);
#if defined(__linux__)
        (void)prctl(PR_SET_PDEATHSIG, SIGKILL);
        if (getppid() == 1)
            _exit((int)CAUTEST_STATUS_ERROR);
#endif
        if (cautest_suite_execution_run_instance(
                suite_execution, instance_index, &status) != 0)
            status = CAUTEST_STATUS_ERROR;
#ifdef CAUTEST_GCOV
        __gcov_dump();
#endif
        (void)fflush((FILE *)0);
        _exit((int)status);
    }
    (void)setpgid(child, child);
    active_case_group = (sig_atomic_t)child;
    deadline = (unsigned long long)cautest_posix_time_ms() +
               (unsigned long long)state->case_timeout_ms;
    for (;;) {
        pid_t waited = waitpid(child, &wait_status, WNOHANG);
        if (waited == child)
            break;
        if (waited < 0 && errno != EINTR) {
            (void)kill(-child, SIGKILL);
            (void)waitpid(child, &wait_status, 0);
            outcome->status = CAUTEST_STATUS_ERROR;
            outcome->fault = CTP3_PLATFORM_FAULT_RUNTIME;
            outcome->message = "waitpid failed";
            outcome->result_recorded = 0;
            outcome->events_complete = 0;
            active_case_group = -1;
            return 0;
        }
        if ((unsigned long long)cautest_posix_time_ms() >= deadline) {
            (void)kill(-child, SIGKILL);
            (void)kill(child, SIGKILL);
            (void)waitpid(child, &wait_status, 0);
            outcome->status = CAUTEST_STATUS_ERROR;
            outcome->fault = CTP3_PLATFORM_FAULT_TIMEOUT;
            outcome->message = "case timeout";
            outcome->result_recorded = 0;
            outcome->events_complete = 0;
            active_case_group = -1;
            return 0;
        }
        {
            struct timespec delay;
            delay.tv_sec = 0;
            delay.tv_nsec = 1000000L;
            (void)nanosleep(&delay, (struct timespec *)0);
        }
    }
    active_case_group = -1;
    /* Case 退出后清理仍留在同一进程组中的后代进程。 */
    (void)kill(-child, SIGKILL);
    outcome->result_recorded = 0;
    if (WIFSIGNALED(wait_status)) {
        (void)snprintf(state->fault_message, sizeof(state->fault_message),
                       "case signal %d", WTERMSIG(wait_status));
        outcome->status = CAUTEST_STATUS_ERROR;
        outcome->fault = CTP3_PLATFORM_FAULT_CRASH;
        outcome->message = state->fault_message;
        outcome->events_complete = 0;
        return 0;
    }
    if (!WIFEXITED(wait_status) ||
        WEXITSTATUS(wait_status) > (int)CAUTEST_STATUS_ERROR) {
        outcome->status = CAUTEST_STATUS_ERROR;
        outcome->fault = CTP3_PLATFORM_FAULT_RUNTIME;
        outcome->message = "case child failed";
        outcome->events_complete = 0;
        return 0;
    }
    outcome->status = (enum cautest_status)WEXITSTATUS(wait_status);
    outcome->fault = CTP3_PLATFORM_FAULT_NONE;
    outcome->message = (const char *)0;
    outcome->events_complete = 1;
    return 0;
}

int cautest_posix_target_main(
    const struct cautest_registry *registry,
    const struct cautest_posix_target_config *config)
{
    struct posix_target_state state;
    struct ctp3_server server;
    struct ctp3_server_config server_config;
    struct sigaction action;
    unsigned char input[32];
    unsigned char *workspace_data;
    char boot_id[64];

    if (registry == (const struct cautest_registry *)0 ||
        config == (const struct cautest_posix_target_config *)0 ||
        config->build_id == (const char *)0)
        return 2;
    workspace_data = config->workspace_size == 0UL ?
        (unsigned char *)0 : (unsigned char *)malloc(config->workspace_size);
    if (config->workspace_size != 0UL &&
        workspace_data == (unsigned char *)0)
        return 2;
    state.event_fd = CAUTEST_POSIX_EVENT_FD;
    state.case_timeout_ms = config->default_case_timeout_ms == 0UL ?
                            1000UL : config->default_case_timeout_ms;
    state.fault_message[0] = '\0';
    (void)snprintf(boot_id, sizeof(boot_id), "native-%ld", (long)getpid());
    server_config.registry = registry;
    server_config.build_id = config->build_id;
    server_config.boot_id = boot_id;
    server_config.workspace.data = workspace_data;
    server_config.workspace.capacity = config->workspace_size;
    server_config.write = posix_write;
    server_config.write_context = &state;
    server_config.run_instance = run_isolated_instance;
    server_config.run_instance_context = &state;
    if (ctp3_server_init(&server, &server_config) != 0) {
        free(workspace_data);
        return 2;
    }
    action.sa_handler = terminate_target;
    (void)sigemptyset(&action.sa_mask);
    action.sa_flags = 0;
    (void)sigaction(SIGTERM, &action, (struct sigaction *)0);
    (void)sigaction(SIGINT, &action, (struct sigaction *)0);
    for (;;) {
        ssize_t count = read(CAUTEST_POSIX_CONTROL_FD, input, sizeof(input));
        if (count == 0)
            break;
        if (count < 0) {
            if (errno == EINTR)
                continue;
            free(workspace_data);
            return 2;
        }
        if (ctp3_server_feed(&server, input, (unsigned long)count) != 0) {
            free(workspace_data);
            return 2;
        }
        if (ctp3_server_is_closing(&server))
            break;
    }
    free(workspace_data);
    return 0;
}
