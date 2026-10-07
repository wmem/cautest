#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
build_dir=$(mktemp -d "${TMPDIR:-/tmp}/cautest-v2-c-runtime-XXXXXX")
trap 'rm -rf "$build_dir"' EXIT HUP INT TERM
cc=${CC:-cc}

strict='-std=c99 -Wall -Wextra -Werror -pedantic-errors'

# Common Core 行为及完整 Assertion API。
# shellcheck disable=SC2086
$cc $strict -I"$project_dir/assets/cautest-c/include" \
  "$project_dir/assets/cautest-c/core/cautest.c" \
  "$project_dir/test/c-runtime/test_cautest.c" \
  -o "$build_dir/cautest-core-test"
"$build_dir/cautest-core-test"

# CTP3 Target Parser/Encoder。
# shellcheck disable=SC2086
$cc $strict -I"$project_dir/assets/cautest-c/include" \
  "$project_dir/assets/cautest-c/core/cautest.c" \
  "$project_dir/assets/cautest-c/protocol/ctp3.c" \
  "$project_dir/test/c-runtime/test_ctp3.c" \
  -o "$build_dir/ctp3-test"
"$build_dir/ctp3-test"

# 真实 MCU 公共轮询接口：分片、空闲、BYE、重初始化及收发错误。
# shellcheck disable=SC2086
$cc $strict -I"$project_dir/assets/cautest-c/include" \
  "$project_dir/assets/cautest-c/core/cautest.c" \
  "$project_dir/assets/cautest-c/protocol/ctp3.c" \
  "$project_dir/assets/cautest-c/target/mcu/mcu.c" \
  "$project_dir/test/c-runtime/test_mcu.c" -o "$build_dir/mcu-test"
"$build_dir/mcu-test"

# 接口及协议可在没有系统头文件的环境编译，不引入堆或 libc。
for source in protocol/ctp3.c target/mcu/mcu.c; do
  object="$build_dir/$(basename "$source" .c)-portable.o"
  # shellcheck disable=SC2086
  $cc $strict -ffreestanding -fno-builtin -nostdinc \
    -I"$project_dir/assets/cautest-c/include" \
    -c "$project_dir/assets/cautest-c/$source" -o "$object"
  if nm -u "$object" | grep -E '\b(malloc|calloc|realloc|free|memcpy|memmove|memset|strlen)\b' >/dev/null; then
    echo "MCU 公共接口存在 libc/heap 依赖: $source" >&2
    exit 1
  fi
done

# Common Core 必须保持 freestanding 且没有 libc 未解析依赖。
# shellcheck disable=SC2086
$cc $strict -ffreestanding -fno-builtin -nostdinc \
  -I"$project_dir/assets/cautest-c/include" \
  -c "$project_dir/assets/cautest-c/core/cautest.c" \
  -o "$build_dir/cautest-freestanding-core.o"
# shellcheck disable=SC2086
$cc $strict -ffreestanding -fno-builtin -nostdinc \
  -I"$project_dir/assets/cautest-c/include" \
  -c "$project_dir/test/c-runtime/freestanding_smoke.c" \
  -o "$build_dir/cautest-freestanding-smoke.o"
if nm -u "$build_dir/cautest-freestanding-core.o" | grep . >/dev/null 2>&1; then
  echo "Common Core 存在未解析的外部依赖" >&2
  exit 1
fi

# Freestanding Runtime 与 MCU Reference Board 的容量、分片、Reset 模型。
# shellcheck disable=SC2086
$cc $strict -I"$project_dir/assets/cautest-c/include" \
  -I"$project_dir/assets/cautest-c/platform/freestanding" \
  -I"$project_dir/assets/cautest-c/target/mcu-reference" \
  "$project_dir/assets/cautest-c/core/cautest.c" \
  "$project_dir/assets/cautest-c/platform/freestanding/cautest_freestanding.c" \
  "$project_dir/assets/cautest-c/target/mcu-reference/mcu_reference.c" \
  "$project_dir/test/c-runtime/mcu_freestanding_model.c" \
  -o "$build_dir/mcu-freestanding-model"
"$build_dir/mcu-freestanding-model"
for source in \
  "$project_dir/assets/cautest-c/platform/freestanding/cautest_freestanding.c" \
  "$project_dir/assets/cautest-c/target/mcu-reference/mcu_reference.c"; do
  object="$build_dir/$(basename "$source" .c).o"
  # shellcheck disable=SC2086
  $cc $strict -ffreestanding -fno-builtin -I"$project_dir/assets/cautest-c/include" -c "$source" -o "$object"
  if nm -u "$object" | grep -E '\b(malloc|calloc|realloc|free|memcpy|memmove|memset|strlen)\b' >/dev/null; then
    echo "MCU Freestanding Runtime 存在 libc/heap 依赖: $source" >&2
    exit 1
  fi
done

# Kernel ABI、Selection Model 与 Probe Model 均可在 Host 侧独立验证。
# shellcheck disable=SC2086
$cc $strict -I"$project_dir/assets/cautest-c/include" \
  -I"$project_dir/assets/cautest-c/platform/linux-kernel/include" \
  "$project_dir/test/c-runtime/kernel_abi_smoke.c" -o "$build_dir/kernel-abi-test"
"$build_dir/kernel-abi-test"
# shellcheck disable=SC2086
$cc $strict -I"$project_dir/assets/cautest-c/include" -I"$project_dir/assets/cautest-c/target/linux-kernel" \
  "$project_dir/assets/cautest-c/core/cautest.c" \
  "$project_dir/assets/cautest-c/target/linux-kernel/selection.c" \
  "$project_dir/test/c-runtime/kernel_selection_model.c" \
  -o "$build_dir/kernel-selection-test"
"$build_dir/kernel-selection-test"
# shellcheck disable=SC2086
$cc $strict -I"$project_dir/assets/cautest-c/include" \
  -I"$project_dir/assets/cautest-c/platform/linux-kernel/include" \
  "$project_dir/test/c-runtime/probe_model_test.c" -o "$build_dir/probe-model-test"
"$build_dir/probe-model-test"

# Production Probe 只观察事实，配置默认关闭，IRQ-safe Emit 不分配内存。
grep -A3 '^config CAUTEST$' "$project_dir/assets/cautest-c/kernel/cautest-probe/Kconfig" | grep -q 'default n'
grep -q '#error.*CONFIG_CAUTEST' "$project_dir/assets/cautest-c/kernel/cautest-probe/cautest_probe.c"
emit_body=$(sed -n '/^int cautest_probe_emit(/,/^}/p' "$project_dir/assets/cautest-c/kernel/cautest-probe/cautest_probe.c")
printf '%s\n' "$emit_body" | grep -q 'spin_lock_irqsave'
if printf '%s\n' "$emit_body" | grep -Eq 'k(malloc|zalloc|calloc)|GFP_'; then
  echo "IRQ-safe Emit 路径不得分配内存" >&2
  exit 1
fi
if grep -R --include='*.c' --include='*.h' -E 'CAUTEST_(ASSERT|EXPECT|FAIL|STATUS_(PASS|FAIL)|EVENT_CASE)' \
  "$project_dir/assets/cautest-c/kernel/cautest-probe" \
  "$project_dir/assets/cautest-c/platform/linux-kernel/include/cautest/probe.h" >/dev/null; then
  echo "Probe 内核实现不得判定测试结果" >&2
  exit 1
fi

echo "C Runtime、CTP3、Kernel ABI 与 Probe 测试通过"
