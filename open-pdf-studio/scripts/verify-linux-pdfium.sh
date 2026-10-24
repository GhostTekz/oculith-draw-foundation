#!/usr/bin/env bash
set -euo pipefail

# bblanchon/pdfium-binaries release chromium/8076, asset pdfium-linux-x64.tgz.
# Source: https://github.com/bblanchon/pdfium-binaries/releases/tag/chromium%2F8076
# GitHub release asset 598237537 reports this SHA-256; verified against a fresh
# download with sha256sum on 2026-10-13.
expected=d9d67bc40af03aef4fe28a60b19b1086f28ace019c8c9caf19cb7fe3d14ceca3
archive=${1:?Usage: verify-linux-pdfium.sh ARCHIVE}

printf '%s  %s\n' "$expected" "$archive" | sha256sum --check --status - || {
  echo "Linux PDFium checksum mismatch: $archive" >&2
  exit 1
}
