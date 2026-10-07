#ifndef CAUTEST_MCU_H
#define CAUTEST_MCU_H

#include <cautest/ctp3.h>

#ifdef __cplusplus
extern "C" {
#endif

/* 非阻塞接收：返回 0 表示暂无数据，正数为字节数（不得超过 capacity），负数为错误。 */
typedef long (*cautest_mcu_read_fn)(void *context, unsigned char *data,
                                   unsigned long capacity);

enum cautest_mcu_poll_result {
    CAUTEST_MCU_ERROR = -1,
    CAUTEST_MCU_IDLE = 0,
    CAUTEST_MCU_PROGRESS = 1,
    CAUTEST_MCU_CLOSED = 2
};

struct cautest_mcu_config {
    /* write 必须发送完整缓冲区：成功返回 0，失败返回非零；禁止混入应用串口输出。
     * registry、身份字符串、workspace 及回调上下文必须存活至会话结束。
     * run_instance 留空时同步运行测试；通用层不抢占挂死的测试。 */
    struct ctp3_server_config protocol;
    cautest_mcu_read_fn read;
    void *read_context;
};

/* 调用方静态分配；禁止直接修改字段。同一实例只能由一个执行上下文调用。 */
struct cautest_mcu {
    struct ctp3_server server;
    cautest_mcu_read_fn read;
    void *read_context;
    unsigned char input[32];
    int failed;
};

int cautest_mcu_init(struct cautest_mcu *runtime,
                     const struct cautest_mcu_config *config);
/* 每次最多读一批数据。BYE 后返回 CLOSED，收发错误保持 ERROR；重新 init 开启新会话。
 * 必须先成功 init。调用方决定轮询调度、空闲等待、重连及硬件复位策略。 */
enum cautest_mcu_poll_result cautest_mcu_poll(struct cautest_mcu *runtime);

#ifdef __cplusplus
}
#endif
#endif
