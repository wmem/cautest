#include <cautest/cautest.h>
static unsigned checksum(const unsigned char *data, unsigned n) { unsigned sum = 0; for (unsigned i=0;i<n;i++) sum+=data[i]; return sum; }
CAUTEST_CASE(empty) { CAUTEST_EXPECT_EQ_INT(0, checksum(0, 0)); }
CAUTEST_CASE(bytes) { const unsigned char data[]={1,2,3}; CAUTEST_EXPECT_EQ_INT(6, checksum(data,3)); }
CAUTEST_SUITE(checksum_test, CAUTEST_CASE_ENTRY(empty), CAUTEST_CASE_ENTRY(bytes));
