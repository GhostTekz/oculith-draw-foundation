#!/usr/bin/env bash
set -euo pipefail

package=${1:?"usage: linux-deb-smoke.sh <package.deb> [survival-seconds]"}
survival_seconds=${2:-10}

apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
  dbus-x11 libegl1 libgles2 xauth xvfb
DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "$package"

binary=/usr/bin/ocudraw-community
test -x "$binary"
test -x /usr/bin/ocudraw-community-pdfium-worker

linked=$(ldd "$binary")
if grep -q 'not found' <<<"$linked"; then
  printf '%s\n' "$linked" >&2
  exit 1
fi

set +e
timeout --kill-after=5s "${survival_seconds}s" \
  dbus-run-session -- xvfb-run -a "$binary" >/tmp/foundation-startup.log 2>&1
status=$?
set -e

if [[ $status -ne 124 ]]; then
  echo "Installed Foundation exited before the ${survival_seconds}s survival window (status $status)" >&2
  cat /tmp/foundation-startup.log >&2
  exit 1
fi

if grep -Eiq 'panicked at|PDFium initialisation failed|Could not create default EGL display' /tmp/foundation-startup.log; then
  cat /tmp/foundation-startup.log >&2
  exit 1
fi

echo 'Installed Foundation DEB startup smoke passed'
