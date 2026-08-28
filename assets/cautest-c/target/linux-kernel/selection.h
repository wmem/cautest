#ifndef CAUTEST_KERNEL_SELECTION_H
#define CAUTEST_KERNEL_SELECTION_H

#include <cautest/cautest.h>

/* 单实例 registry 视图不分配内存，原 registry 在运行期间必须保持有效。 */
struct cautest_kernel_selection {
	struct cautest_case_definition selected_case;
	struct cautest_suite_definition selected_suite;
	const struct cautest_suite_definition *suite_ref;
	struct cautest_registry registry;
};

int cautest_kernel_select_instance(const struct cautest_registry *source,
				   unsigned long instance_index,
				   struct cautest_kernel_selection *selection);
int cautest_kernel_select_suite(const struct cautest_registry *source,
				unsigned long suite_index,
				struct cautest_kernel_selection *selection);

#endif
