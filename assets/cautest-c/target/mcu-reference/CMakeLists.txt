add_library(cautest-mcu-reference STATIC mcu_reference.c)
add_library(cautest::mcu-reference ALIAS cautest-mcu-reference)
set_target_properties(cautest-mcu-reference PROPERTIES EXPORT_NAME mcu-reference C_STANDARD 99 C_STANDARD_REQUIRED YES C_EXTENSIONS NO)
target_compile_options(cautest-mcu-reference PRIVATE -ffreestanding -fno-builtin)
target_include_directories(cautest-mcu-reference PUBLIC
  $<BUILD_INTERFACE:${CMAKE_CURRENT_LIST_DIR}>
  $<BUILD_INTERFACE:${CMAKE_CURRENT_LIST_DIR}/../../include>
  $<BUILD_INTERFACE:${CMAKE_CURRENT_LIST_DIR}/../../platform/freestanding>
  $<INSTALL_INTERFACE:include>
  $<INSTALL_INTERFACE:include/cautest/platform/freestanding>
  $<INSTALL_INTERFACE:include/cautest/target/mcu-reference>)
target_link_libraries(cautest-mcu-reference PUBLIC cautest-freestanding cautest-protocol)
