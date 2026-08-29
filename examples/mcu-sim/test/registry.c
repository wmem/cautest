#include <cautest/cautest.h>

CAUTEST_SUITE_DECLARE(mcu_math);
CAUTEST_SUITE_DECLARE(mcu_limits);

CAUTEST_REGISTRY(cautest_mcu_registry,
    CAUTEST_SUITE_REF(mcu_math),
    CAUTEST_SUITE_REF(mcu_limits));
