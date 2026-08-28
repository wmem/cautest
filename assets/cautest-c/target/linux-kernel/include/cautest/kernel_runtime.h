#ifndef CAUTEST_KERNEL_RUNTIME_H
#define CAUTEST_KERNEL_RUNTIME_H

#include <linux/module.h>

#include <cautest/cautest.h>

/*
 * Kernel Test Module 在 module_init() 中只注册 registry，在 module_exit()
 * 中注销。Runtime 会在 active run 期间持有 owner，阻止模块卸载。
 */
int cautest_kernel_register(const struct cautest_registry *registry,
			    struct module *owner);
int cautest_kernel_unregister(const struct cautest_registry *registry);

/* 长循环 Case 可周期性检查该标志，实现 cooperative cancel。 */
int cautest_kernel_should_cancel(void);

#define CAUTEST_KERNEL_REGISTER(registry_) \
	cautest_kernel_register(&(registry_), THIS_MODULE)
#define CAUTEST_KERNEL_UNREGISTER(registry_) \
	cautest_kernel_unregister(&(registry_))

#endif
