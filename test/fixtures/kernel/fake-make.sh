#!/bin/sh

if [ "$1" = "--version" ]; then
    printf '%s\n' 'GNU Make fake-kbuild 1.0'
    exit 0
fi

module_dir=''
coverage=''
for argument in "$@"; do
    case "$argument" in
        M=*) module_dir=${argument#M=} ;;
        CAUTEST_TEST_COVERAGE=1) coverage=1 ;;
    esac
done
if [ -z "$module_dir" ]; then
    printf '%s\n' '缺少 M=' >&2
    exit 2
fi

# 模拟 Make：输入/输出没有变化时不更新时间戳。
write_changed() {
    output=$1
    candidate="${output}.tmp"
    cat > "$candidate"
    if [ -f "$output" ] && cmp -s "$candidate" "$output"; then
        rm "$candidate"
    else
        mv "$candidate" "$output"
    fi
}
printf '%s\n' 'sandbox object' | write_changed "$module_dir/driver.o"
{ printf 'module %s\n' "$*"; cat "$module_dir/driver.c"; } | write_changed "$module_dir/driver.ko"
printf '%s\n' 'sandbox command' | write_changed "$module_dir/.driver.o.cmd"
printf '%s\n' 'sandbox generated' | write_changed "$module_dir/driver.mod.c"
printf '0x1\tdriver_symbol\tdriver\tEXPORT_SYMBOL\n' | write_changed "$module_dir/Module.symvers"
printf '%s\n' 'driver.ko' | write_changed "$module_dir/modules.order"
if [ -n "$coverage" ]; then
    printf '%s\n' 'gcov notes' | write_changed "$module_dir/driver.gcno"
fi
mkdir -p "$module_dir/../product"
printf '%s\n' 'sandbox product object' | write_changed "$module_dir/../product/product.o"
