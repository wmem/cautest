# C Kit 构建与消费

`assets/cautest-c` 是可独立消费的 C99 Kit。根 `CMakeLists.txt` 同时构建四个边界清晰的静态库：

- `cautest::core`：Suite/Case、Fixture、Assertion 和执行模型；
- `cautest::protocol`：CTP3 Parser/Server；
- `cautest::freestanding`：无 libc 假设的事件存储与执行适配；
- `cautest::mcu-reference`：分片 Ring I/O、Flash/Reset/Boot 和 MCU Reference Board。

源码树内使用：

```cmake
add_subdirectory(tools/cautest/assets/cautest-c)
target_link_libraries(my_test_firmware PRIVATE cautest::mcu-reference)
```

也可以安装后通过 CMake Package 消费：

```sh
cmake -S tools/cautest/assets/cautest-c -B build/cautest-c \
  -DCMAKE_INSTALL_PREFIX="$PWD/build/cautest-prefix"
cmake --build build/cautest-c
cmake --install build/cautest-c
```

```cmake
find_package(cautest-c 0.2 CONFIG REQUIRED)
target_link_libraries(my_test_firmware PRIVATE cautest::mcu-reference)
```

安装会发布 Header、四个 Library、CMake Config/Version File 和 Exported Targets。C Kit 的 `package.json.version`、CMake Project Version、根 Package 与 `versions.json.release` 受同一漂移门禁约束。便携安装测试会从安装后的 C Kit 真正执行 configure/build/install，再用 `find_package()` 构建并运行 Consumer。
