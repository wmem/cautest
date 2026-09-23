#!/usr/bin/env bash
# Build only BusyBox's static bc applet from user-provided source, out of tree.
set -euo pipefail
[[ $# == 2 ]] || { echo "Usage: $0 BUSYBOX_SOURCE NEW_OUTPUT_DIRECTORY" >&2; exit 2; }
source_dir=$(cd "$1" && pwd -P)
[[ -f "$source_dir/Makefile" && -f "$source_dir/miscutils/bc.c" ]] || { echo 'Expected BusyBox source with the bc applet' >&2; exit 2; }
[[ ! -e "$2" ]] || { echo "Refusing to overwrite $2" >&2; exit 2; }
mkdir -p "$2/build"
output=$(cd "$2" && pwd -P)
make -C "$source_dir" "O=$output/build" allnoconfig
sed -i -e 's/# CONFIG_BC is not set/CONFIG_BC=y/' -e 's/# CONFIG_STATIC is not set/CONFIG_STATIC=y/' "$output/build/.config"
# oldconfig may introduce defaults when BC selects its internal math routines.
# Do not treat yes's SIGPIPE after make exits as a build failure.
set +e
yes '' | make -C "$source_dir" "O=$output/build" oldconfig
statuses=("${PIPESTATUS[@]}")
set -e
[[ ${statuses[1]} == 0 ]] || exit "${statuses[1]}"
make -C "$source_dir" "O=$output/build" -j"${CAUTEST_BUILD_JOBS:-4}"
ln -s build/busybox "$output/bc"
printf 'scale=0\n2^64\nquit\n' > "$output/probe.bc"
actual=$("$output/bc" "$output/probe.bc")
[[ "$actual" == 18446744073709551616 ]] || { echo "bc arithmetic probe failed: $actual" >&2; exit 1; }
(cd "$output"; sha256sum build/busybox > SHA256SUMS)
printf '\nStatic bc built and arithmetic verified. Add this directory to PATH: %s\n' "$output"
