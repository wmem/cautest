add_library(cautest-core STATIC cautest.c)
add_library(cautest::core ALIAS cautest-core)
set_target_properties(cautest-core PROPERTIES EXPORT_NAME core C_STANDARD 99 C_STANDARD_REQUIRED YES C_EXTENSIONS NO)
target_include_directories(cautest-core PUBLIC
  $<BUILD_INTERFACE:${CMAKE_CURRENT_LIST_DIR}/../include>
  $<INSTALL_INTERFACE:include>)
