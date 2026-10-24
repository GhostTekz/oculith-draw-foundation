#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
smoke="$script_dir/linux-appimage-smoke.sh"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

fake="$tmp/fake.AppImage"
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'set -euo pipefail' \
  'if [[ "${1:-}" == "--appimage-extract" ]]; then' \
  '  if [[ "${FAKE_MISSING_PDFIUM:-0}" != "1" ]]; then' \
  '    mkdir -p "squashfs-root/usr/lib/Oculith Draw"' \
  '    : > "squashfs-root/usr/lib/Oculith Draw/libpdfium.so"' \
  '  fi' \
  '  if [[ "${FAKE_BUNDLED_WAYLAND:-0}" == "1" ]]; then' \
  '    mkdir -p squashfs-root/usr/lib' \
  '    : > squashfs-root/usr/lib/libwayland-client.so.0' \
  '  fi' \
  '  if [[ -n "${FAKE_ELF_FILE:-}" ]]; then' \
  '    mkdir -p squashfs-root/usr/lib' \
  '    cp "$FAKE_ELF_FILE" squashfs-root/usr/lib/libbad.so' \
  '  fi' \
  '  exit 0' \
  'fi' \
  'if [[ "${BASH_SOURCE[0]}" == *"-gvfs.AppImage" ]]; then' \
  '  echo "Failed to load module: libgvfsdbus.so: undefined symbol: g_task_set_static_name" >&2' \
  'fi' \
  'while true; do sleep 1; done' \
  > "$fake"
chmod +x "$fake"

SMOKE_NO_DISPLAY_WRAPPERS=1 bash "$smoke" "$fake" 1

if FAKE_MISSING_PDFIUM=1 SMOKE_NO_DISPLAY_WRAPPERS=1 bash "$smoke" "$fake" 1 >"$tmp/missing.log" 2>&1; then
  echo "smoke unexpectedly accepted an AppImage without libpdfium.so" >&2
  exit 1
fi
grep -q 'libpdfium.so is missing' "$tmp/missing.log"

gvfs_fake="$tmp/fake-gvfs.AppImage"
cp "$fake" "$gvfs_fake"
if SMOKE_NO_DISPLAY_WRAPPERS=1 bash "$smoke" "$gvfs_fake" 1 >"$tmp/gvfs.log" 2>&1; then
  echo "smoke unexpectedly accepted a GVFS symbol failure" >&2
  exit 1
fi
grep -q 'forbidden startup diagnostic' "$tmp/gvfs.log"

if FAKE_BUNDLED_WAYLAND=1 SMOKE_NO_DISPLAY_WRAPPERS=1 bash "$smoke" "$fake" 1 >"$tmp/wayland.log" 2>&1; then
  echo "smoke unexpectedly accepted an AppImage with a bundled libwayland-client" >&2
  exit 1
fi
grep -q 'display-stack libraries are bundled' "$tmp/wayland.log"
grep -q 'usr/lib/libwayland-client.so.0' "$tmp/wayland.log"

# A twelfth program header reaches into the first 16 bytes of .gnu.hash in
# the damaged libleancrypto from a field-test AppImage. The intact fixture
# ends before that section and must pass the same checker.
mkdir -p "$tmp/elf"
python3 - "$tmp/elf/libexample.so" <<'PY'
import pathlib
import struct
import sys

path = pathlib.Path(sys.argv[1])
elf = bytearray(0x500)
elf[:6] = b'\x7fELF\x02\x01'
struct.pack_into('<QQ', elf, 32, 64, 0x400)
struct.pack_into('<HHHH', elf, 54, 56, 11, 64, 2)
section = 0x400 + 64
struct.pack_into('<I', elf, section + 4, 0x6ffffff6)  # SHT_GNU_HASH
struct.pack_into('<Q', elf, section + 8, 2)           # SHF_ALLOC
struct.pack_into('<QQ', elf, section + 24, 0x2d0, 0x20)
path.write_bytes(elf)
PY
python3 "$script_dir/check-appimage-elf.py" "$tmp/elf"
python3 - "$tmp/elf/libexample.so" <<'PY'
import pathlib
import struct
import sys

path = pathlib.Path(sys.argv[1])
elf = bytearray(path.read_bytes())
struct.pack_into('<H', elf, 56, 12)
path.write_bytes(elf)
PY
if python3 "$script_dir/check-appimage-elf.py" "$tmp/elf" >"$tmp/elf.log" 2>&1; then
  echo "ELF checker accepted an overwritten GNU hash section" >&2
  exit 1
fi
grep -q 'overlap allocated section' "$tmp/elf.log"

if FAKE_ELF_FILE="$tmp/elf/libexample.so" SMOKE_NO_DISPLAY_WRAPPERS=1 \
    bash "$smoke" "$fake" 1 >"$tmp/smoke-elf.log" 2>&1; then
  echo "smoke unexpectedly accepted a damaged ELF library" >&2
  exit 1
fi
grep -q 'AppImage contains damaged ELF files' "$tmp/smoke-elf.log"
