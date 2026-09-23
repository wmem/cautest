#!/usr/bin/env bash
# Run on an online Debian/Ubuntu amd64 host. Download only; never install packages.
set -euo pipefail
packages=(flex bison bc libelf-dev libssl-dev zlib1g-dev cpio)
out="${PWD}/cautest-uml-deps"
dry_run=false
while (($#)); do
    case "$1" in
        --output) [[ $# -ge 2 ]] || { echo 'Missing --output value' >&2; exit 2; }; out=$2; shift 2 ;;
        --dry-run) dry_run=true; shift ;;
        -h|--help) printf 'Usage: %s [--output DIRECTORY] [--dry-run]\nDownloads full dependencies even when already installed. Never runs apt install without --download-only.\n' "$0"; exit 0 ;;
        *) echo "Unknown argument: $1" >&2; exit 2 ;;
    esac
done
for command in apt-get dpkg dpkg-deb tar sha256sum awk; do
    command -v "$command" >/dev/null || { echo "Required command missing: $command" >&2; exit 2; }
done
arch=$(dpkg --print-architecture)
[[ "$arch" == amd64 ]] || { echo "Expected amd64 host, found $arch" >&2; exit 2; }
[[ ! -e "$out" ]] || { echo "Refusing to overwrite existing path: $out" >&2; exit 2; }
mkdir -p "$out/debs/partial" "$out/root"
out=$(cd "$out" && pwd -P)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
: > "$tmp/status"
cp /etc/os-release "$out/host-os-release"
printf '%s\n' "${packages[@]}" > "$out/requested-packages.txt"
# An empty dpkg status is intentional: an installed flex/bc must still be
# downloaded, along with its complete dependency closure. Reinstalling only
# top-level packages would still omit dependencies already present locally.
args=(-y -o "Dir::State::status=$tmp/status" -o "Dir::Cache::archives=$out/debs/"
      -o Debug::NoLocking=true --download-only --no-install-recommends)
if "$dry_run"; then
    apt-get "${args[@]}" --simulate install "${packages[@]}" | tee "$out/apt-simulation.log"
    printf 'Dry run only; no uploadable archive was created: %s\n' "$out"
    exit 0
fi
apt-get "${args[@]}" install "${packages[@]}" 2>&1 | tee "$out/apt-download.log"
shopt -s nullglob
archives=("$out"/debs/*.deb)
((${#archives[@]})) || { echo 'APT returned no .deb files; refusing an empty bundle' >&2; exit 1; }
: > "$out/packages.tsv"
for deb in "${archives[@]}"; do
    name=$(dpkg-deb -f "$deb" Package)
    version=$(dpkg-deb -f "$deb" Version)
    architecture=$(dpkg-deb -f "$deb" Architecture)
    [[ "$architecture" == amd64 || "$architecture" == all ]] || { echo "Wrong architecture: $deb" >&2; exit 1; }
    printf '%s\t%s\t%s\t%s\n' "$name" "$version" "$architecture" "$(basename "$deb")" >> "$out/packages.tsv"
    dpkg-deb -x "$deb" "$out/root"
done
for name in "${packages[@]}"; do
    awk -F '\t' -v name="$name" '$1 == name { found=1 } END { exit !found }' "$out/packages.tsv" || { echo "Missing requested package: $name" >&2; exit 1; }
done
for tool in flex bison bc cpio; do
    [[ -x "$out/root/usr/bin/$tool" || -x "$out/root/bin/$tool" ]] || { echo "Missing tool bytes: $tool" >&2; exit 1; }
done
(cd "$out"; sha256sum debs/*.deb > SHA256SUMS)
cat > "$out/activate.sh" <<'ACTIVATE'
# Source this from bash. Do not blanket-prepend an Ubuntu glibc to the host.
_CAUTEST_DEPS_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/root" && pwd -P)
export PATH="$_CAUTEST_DEPS_ROOT/usr/bin:$_CAUTEST_DEPS_ROOT/bin:$PATH"
export BISON_PKGDATADIR="$_CAUTEST_DEPS_ROOT/usr/share/bison"
unset _CAUTEST_DEPS_ROOT
ACTIVATE
archive="${out}.tar.gz"
[[ ! -e "$archive" ]] || { echo "Refusing to overwrite $archive" >&2; exit 2; }
tar -czf "$archive" -C "$(dirname "$out")" "$(basename "$out")"
sha256sum "$archive"
printf '\nUpload this archive: %s\n' "$archive"
