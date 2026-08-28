#ifndef CAUTEST_CTP3_H
#define CAUTEST_CTP3_H

#include <cautest/cautest.h>

#define CTP3_PROTOCOL_MAJOR 3U
#define CTP3_PROTOCOL_MINOR 1U
#define CTP3_RX_LINE_MAX 64U
#define CTP3_TX_LINE_MAX 512U
#define CTP3_IDENTITY_MAX 127U
#define CTP3_NAME_MAX 63U

#ifdef __cplusplus
extern "C" {
#endif

struct ctp3_server;

enum ctp3_platform_fault {
    CTP3_PLATFORM_FAULT_NONE = 0,
    CTP3_PLATFORM_FAULT_TIMEOUT,
    CTP3_PLATFORM_FAULT_CRASH,
    CTP3_PLATFORM_FAULT_RUNTIME
};

struct ctp3_instance_outcome {
    enum cautest_status status;
    enum ctp3_platform_fault fault;
    const char *message;
    int result_recorded;
    int events_complete;
};

typedef int (*ctp3_write_fn)(void *context,
                             const unsigned char *data,
                             unsigned long size);
typedef int (*ctp3_run_instance_fn)(
    void *context,
    struct cautest_suite_execution *suite_execution,
    unsigned long instance_index,
    struct ctp3_instance_outcome *outcome);

struct ctp3_server_config {
    const struct cautest_registry *registry;
    const char *build_id;
    const char *boot_id;
    struct cautest_workspace workspace;
    ctp3_write_fn write;
    void *write_context;
    ctp3_run_instance_fn run_instance;
    void *run_instance_context;
};

/*
 * Server 的存储完全由调用方持有。字段是公开的以允许静态分配，调用方不得
 * 直接修改；初始化后只通过下列 API 使用。
 */
struct ctp3_server {
    struct ctp3_server_config config;
    unsigned char rx[CTP3_RX_LINE_MAX];
    unsigned long rx_size;
    unsigned long last_execution_id;
    unsigned long execution_id;
    unsigned long suite_id;
    unsigned long case_id;
    unsigned long param_id;
    unsigned long assertion_id;
    unsigned long registry_suite_count;
    unsigned long registry_instance_count;
    unsigned long long registry_signature;
    int handshaken;
    int discarding;
    int closing;
    int io_failed;
};

int ctp3_server_init(struct ctp3_server *server,
                     const struct ctp3_server_config *config);
int ctp3_server_feed(struct ctp3_server *server,
                     const unsigned char *data,
                     unsigned long size);
int ctp3_server_is_closing(const struct ctp3_server *server);

int ctp3_server_log_target(struct ctp3_server *server,
                           enum cautest_log_level level,
                           const char *message);

#ifdef __cplusplus
}
#endif

#endif
