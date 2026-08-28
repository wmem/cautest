cmake_minimum_required(VERSION 3.16)
project(cautest-c VERSION 0.2.0 LANGUAGES C)

include(GNUInstallDirs)
include(CMakePackageConfigHelpers)

add_subdirectory(core)
add_subdirectory(protocol)
add_subdirectory(platform/freestanding)
add_subdirectory(target/mcu-reference)

install(DIRECTORY include/ DESTINATION ${CMAKE_INSTALL_INCLUDEDIR})
install(FILES platform/freestanding/cautest_freestanding.h DESTINATION ${CMAKE_INSTALL_INCLUDEDIR}/cautest/platform/freestanding)
install(FILES target/mcu-reference/mcu_reference.h DESTINATION ${CMAKE_INSTALL_INCLUDEDIR}/cautest/target/mcu-reference)
install(TARGETS cautest-core cautest-protocol cautest-freestanding cautest-mcu-reference
  EXPORT cautest-c-targets
  ARCHIVE DESTINATION ${CMAKE_INSTALL_LIBDIR})
install(EXPORT cautest-c-targets NAMESPACE cautest:: DESTINATION ${CMAKE_INSTALL_LIBDIR}/cmake/cautest-c)

write_basic_package_version_file(
  ${CMAKE_CURRENT_BINARY_DIR}/cautest-c-config-version.cmake
  VERSION ${PROJECT_VERSION}
  COMPATIBILITY SameMajorVersion)
configure_package_config_file(
  ${CMAKE_CURRENT_SOURCE_DIR}/cmake/cautest-c-config.cmake.in
  ${CMAKE_CURRENT_BINARY_DIR}/cautest-c-config.cmake
  INSTALL_DESTINATION ${CMAKE_INSTALL_LIBDIR}/cmake/cautest-c)
install(FILES
  ${CMAKE_CURRENT_BINARY_DIR}/cautest-c-config.cmake
  ${CMAKE_CURRENT_BINARY_DIR}/cautest-c-config-version.cmake
  DESTINATION ${CMAKE_INSTALL_LIBDIR}/cmake/cautest-c)
