#!/bin/sh
# Builds dist/MYCASH-<version>-setup.exe from dist/MYCASH.exe (run desktop/build.sh first). Needs NSIS 3.x.
set -e
cd "$(dirname "$0")"
VERSION="${VERSION:-$(cat ../VERSION)}"
MAKENSIS=${MAKENSIS:-makensis}
if ! command -v "$MAKENSIS" >/dev/null 2>&1 && [ -x /workspace/mycash-tools/nsis/usr/bin/makensis ]; then
  MAKENSIS=/workspace/mycash-tools/nsis/usr/bin/makensis; export NSISDIR=/workspace/mycash-tools/nsis/usr/share/nsis
fi
test -f ../dist/MYCASH.exe || { echo "build ../dist/MYCASH.exe first" >&2; exit 1; }
"$MAKENSIS" -V2 -DVERSION="$VERSION" MYCASH.nsi
ls -l "../dist/MYCASH-$VERSION-setup.exe"
