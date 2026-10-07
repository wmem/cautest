/* 主机复位并暂停后写入 nonce；原厂启动代码只清零 .bss，不覆盖此区域。 */
SECTIONS {
    .cautest_noinit (NOLOAD) : { KEEP(*(.cautest_noinit)) }
} INSERT AFTER .bss;
