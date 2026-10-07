#include <cautest/cautest.h>
CAUTEST_SUITE_DECLARE(runtime);
CAUTEST_SUITE_DECLARE(board);
CAUTEST_REGISTRY(cautest_mcu_registry, CAUTEST_SUITE_REF(runtime), CAUTEST_SUITE_REF(board));
