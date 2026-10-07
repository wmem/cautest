#include "gd32f4xx.h"
#include "board.h"
#include <cautest/mcu.h>

extern const struct cautest_registry cautest_mcu_registry;
CAUTEST_WORKSPACE(workspace, 2048);
static struct cautest_mcu runtime;
static volatile uint32_t milliseconds;
/* 板外 Adapter 注入启动标识；这不是通用 C 接口要求的硬件实现方式。 */
volatile uint32_t cautest_boot_nonce __attribute__((section(".cautest_noinit")));
static char boot_id[9];

void SysTick_Handler(void) { ++milliseconds; }
uint32_t board_millis(void) { return milliseconds; }
uint32_t board_clock_hz(void) { return SystemCoreClock; }
int board_uart_ready(void) { return (USART_CTL0(USART0) & USART_CTL0_UEN) != 0; }

static long uart_read(void *context, unsigned char *data, unsigned long capacity)
{
    unsigned long size = 0;
    (void)context;
    while (size < capacity && usart_flag_get(USART0, USART_FLAG_RBNE) == SET)
        data[size++] = (unsigned char)usart_data_receive(USART0);
    return (long)size;
}

static int uart_write(void *context, const unsigned char *data, unsigned long size)
{
    unsigned long i;
    uint32_t started = board_millis();
    (void)context;
    for (i = 0; i < size; ++i) {
        while (usart_flag_get(USART0, USART_FLAG_TBE) == RESET) {
            if ((uint32_t)(board_millis() - started) > 1000U)
                return -1;
        }
        usart_data_transmit(USART0, data[i]);
    }
    return 0;
}

int main(void)
{
    static const char hex[] = "0123456789abcdef";
    unsigned int i;
    struct cautest_mcu_config config = {0};
    SystemCoreClockUpdate();
    if (SysTick_Config(SystemCoreClock / 1000U) != 0U)
        for (;;) {}
    rcu_periph_clock_enable(RCU_GPIOA);
    rcu_periph_clock_enable(RCU_USART0);
    gpio_af_set(GPIOA, GPIO_AF_7, GPIO_PIN_9 | GPIO_PIN_10);
    gpio_mode_set(GPIOA, GPIO_MODE_AF, GPIO_PUPD_PULLUP, GPIO_PIN_9 | GPIO_PIN_10);
    gpio_output_options_set(GPIOA, GPIO_OTYPE_PP, GPIO_OSPEED_50MHZ, GPIO_PIN_9 | GPIO_PIN_10);
    usart_deinit(USART0);
    usart_baudrate_set(USART0, 115200U);
    usart_word_length_set(USART0, USART_WL_8BIT);
    usart_stop_bit_set(USART0, USART_STB_1BIT);
    usart_parity_config(USART0, USART_PM_NONE);
    usart_receive_config(USART0, USART_RECEIVE_ENABLE);
    usart_transmit_config(USART0, USART_TRANSMIT_ENABLE);
    usart_enable(USART0);
    for (i = 0; i < 8; ++i)
        boot_id[i] = hex[(cautest_boot_nonce >> ((7U - i) * 4U)) & 15U];
    config.protocol.registry = &cautest_mcu_registry;
    config.protocol.build_id = "gd32-cautest-v1";
    config.protocol.boot_id = boot_id;
    config.protocol.workspace = (struct cautest_workspace)CAUTEST_WORKSPACE_INIT(workspace);
    config.protocol.write = uart_write;
    config.read = uart_read;
    if (cautest_mcu_init(&runtime, &config) != 0)
        for (;;) {}
    for (;;) {
        enum cautest_mcu_poll_result result = cautest_mcu_poll(&runtime);
        if (result == CAUTEST_MCU_CLOSED)
            (void)cautest_mcu_init(&runtime, &config);
        else if (result == CAUTEST_MCU_ERROR)
            for (;;) {} /* 真实收发错误交给主机超时及显式复位处理。 */
    }
}

/* 原厂启动代码使用 __libc_init_array；裸机没有额外初始化。 */
void _init(void) {}
