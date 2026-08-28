#include <stddef.h>
#include <stdio.h>

#include <cautest/cautest.h>

#include "selection.h"

#define CHECK(expression_) \
	do { \
		if (!(expression_)) { \
			fprintf(stderr, "检查失败：%s:%d: %s\n", __FILE__, __LINE__, \
				#expression_); \
			return 1; \
		} \
	} while (0)

static int first_runs;
static int selected_runs;
static int parameter_runs;
static int parameter_value;

static void first_case(struct cautest_context *context, void *suite_fixture,
		       void *case_fixture, const void *parameter)
{
	(void)context;
	(void)suite_fixture;
	(void)case_fixture;
	(void)parameter;
	first_runs++;
}

static void selected_case(struct cautest_context *context, void *suite_fixture,
			  void *case_fixture, const void *parameter)
{
	(void)context;
	(void)suite_fixture;
	(void)case_fixture;
	(void)parameter;
	selected_runs++;
}

static void parameter_case(struct cautest_context *context, void *suite_fixture,
			   void *case_fixture, const void *parameter)
{
	(void)context;
	(void)suite_fixture;
	(void)case_fixture;
	parameter_runs++;
	parameter_value = *(const int *)parameter;
}

struct parameter_row {
	const char *name;
	int value;
};

static const struct parameter_row parameters[] = {
	{ "one", 1 },
	{ "two", 2 },
};

static const struct cautest_case_definition cases[] = {
	{ "unselected", first_case, NULL, 0UL, 0UL, 0UL },
	{ "selected", selected_case, NULL, 0UL, 0UL, 0UL },
	{ "parameterized", parameter_case, parameters, 2UL,
	  sizeof(parameters[0]), offsetof(struct parameter_row, value) },
};

static const struct cautest_suite_definition suite = {
	"selection", cases, 3UL, NULL, NULL
};
static const struct cautest_suite_definition *const suites[] = { &suite };
static const struct cautest_registry registry = {
	"selection-model", suites, 1UL
};

static int run_selection(unsigned long descriptor_id)
{
	struct cautest_kernel_selection selection;
	struct cautest_run_config config = { CAUTEST_STOP_CONTINUE };
	struct cautest_workspace workspace = { NULL, 0UL };
	struct cautest_event_sink sink = { NULL, NULL };
	struct cautest_run_result result;

	CHECK(cautest_kernel_select_instance(&registry, descriptor_id,
					     &selection) == 0);
	CHECK(cautest_run(&selection.registry, &config, workspace, sink, &result) == 0);
	CHECK(result.instance_count == 1UL);
	CHECK(result.status == CAUTEST_STATUS_PASS);
	return 0;
}

int main(void)
{
	struct cautest_kernel_selection selection;

	CHECK(run_selection(1UL) == 0);
	CHECK(first_runs == 0);
	CHECK(selected_runs == 1);
	CHECK(parameter_runs == 0);

	CHECK(run_selection(3UL) == 0);
	CHECK(first_runs == 0);
	CHECK(selected_runs == 1);
	CHECK(parameter_runs == 1);
	CHECK(parameter_value == 2);
	CHECK(cautest_kernel_select_instance(&registry, 4UL, &selection) != 0);
	puts("kernel selection model: PASS");
	return 0;
}
