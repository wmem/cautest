#include "selection.h"

int cautest_kernel_select_instance(const struct cautest_registry *source,
				   unsigned long instance_index,
				   struct cautest_kernel_selection *selection)
{
	unsigned long suite_index;

	if (!selection || cautest_registry_validate(source) !=
			  CAUTEST_FRAMEWORK_ERROR_NONE)
		return -1;
	for (suite_index = 0; suite_index < source->suite_count; ++suite_index) {
		const struct cautest_suite_definition *suite = source->suites[suite_index];
		unsigned long case_index;

		for (case_index = 0; case_index < suite->case_count; ++case_index) {
			const struct cautest_case_definition *test_case =
				&suite->cases[case_index];
			unsigned long count = test_case->parameter_count == 0UL ?
				1UL : test_case->parameter_count;

			if (instance_index >= count) {
				instance_index -= count;
				continue;
			}
			selection->selected_case = *test_case;
			if (test_case->parameter_count != 0UL) {
				selection->selected_case.parameter_rows =
					(const unsigned char *)test_case->parameter_rows +
					instance_index * test_case->parameter_stride;
				selection->selected_case.parameter_count = 1UL;
			}
			selection->selected_suite = *suite;
			selection->selected_suite.cases = &selection->selected_case;
			selection->selected_suite.case_count = 1UL;
			selection->suite_ref = &selection->selected_suite;
			selection->registry.name = source->name;
			selection->registry.suites = &selection->suite_ref;
			selection->registry.suite_count = 1UL;
			return 0;
		}
	}
	return -1;
}

int cautest_kernel_select_suite(const struct cautest_registry *source,
				unsigned long suite_index,
				struct cautest_kernel_selection *selection)
{
	if (!selection || cautest_registry_validate(source) !=
			  CAUTEST_FRAMEWORK_ERROR_NONE ||
	    suite_index >= source->suite_count)
		return -1;
	selection->selected_suite = *source->suites[suite_index];
	selection->suite_ref = &selection->selected_suite;
	selection->registry.name = source->name;
	selection->registry.suites = &selection->suite_ref;
	selection->registry.suite_count = 1UL;
	return 0;
}
