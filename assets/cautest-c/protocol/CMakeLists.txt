add_library(cautest-protocol STATIC ctp3.c)
add_library(cautest::protocol ALIAS cautest-protocol)
set_target_properties(cautest-protocol PROPERTIES EXPORT_NAME protocol C_STANDARD 99 C_STANDARD_REQUIRED YES C_EXTENSIONS NO)
target_include_directories(cautest-protocol PUBLIC
  $<BUILD_INTERFACE:${CMAKE_CURRENT_LIST_DIR}/../include>
  $<INSTALL_INTERFACE:include>)
target_link_libraries(cautest-protocol PUBLIC cautest-core)
