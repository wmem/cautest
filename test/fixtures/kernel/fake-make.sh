#!/bin/sh

if [ "$1" = "--version" ]; then
    printf '%s\n' 'GNU Make fake-kbuild 1.0'
    exit 0
fi

module_dir=''
for argument in "$@"; do
    case "$argument" in
        M=*) module_dir=${argument#M=} ;;
    esac
done
if [ -z "$module_dir" ]; then
    printf '%s\n' '缺少 M=' >&2
    exit 2
fi

printf '%s\n' 'sandbox object' > "$module_dir/driver.o"
printf 'module %s\n' "$*" > "$module_dir/driver.ko"
printf '%s\n' 'sandbox command' > "$module_dir/.driver.o.cmd"
printf '%s\n' 'sandbox generated' > "$module_dir/driver.mod.c"
printf '0x1\tdriver_symbol\tdriver\tEXPORT_SYMBOL\n' > "$module_dir/Module.symvers"
printf '%s\n' 'driver.ko' > "$module_dir/modules.order"
mkdir -p "$module_dir/../product"
printf '%s\n' 'sandbox product object' > "$module_dir/../product/product.o"
