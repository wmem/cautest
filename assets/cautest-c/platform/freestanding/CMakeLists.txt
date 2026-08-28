add_library(cautest-freestanding STATIC cautest_freestanding.c)
add_library(cautest::freestanding ALIAS cautest-freestanding)
set_target_properties(cautest-freestanding PROPERTIES EXPORT_NAME freestanding C_STANDARD 99 C_STANDARD_REQUIRED YES C_EXTENSIONS NO)
target_compile_options(cautest-freestanding PRIVATE -ffreestanding -fno-builtin)
target_include_directories(cautest-freestanding PUBLIC
  $<BUILD_INTERFACE:${CMAKE_CURRENT_LIST_DIR}>
  $<BUILD_INTERFACE:${CMAKE_CURRENT_LIST_DIR}/../../include>
  $<INSTALL_INTERFACE:include>
  $<INSTALL_INTERFACE:include/cautest/platform/freestanding>)
target_link_libraries(cautest-freestanding PUBLIC cautest-core)
