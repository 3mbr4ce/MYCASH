#!/bin/sh
# Builds dist/MYCASH.exe (Windows x64, no cgo) from Linux or Windows (Git Bash). Needs Go and go-winres
# (go install github.com/tc-hib/go-winres@latest; default path below is the copy on the MYSUITE build box).
set -eu
cd "$(dirname "$0")"
WINRES=${GO_WINRES:-/workspace/myyt-tools/gobin/go-winres}
python3 ../tools/build-web.py ui/index.html
(cd winres && "$WINRES" make --in winres.json --out ../rsrc >/dev/null) && ls rsrc_windows_*.syso >/dev/null
mkdir -p ../dist
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -buildvcs=false -trimpath -ldflags "-s -w -H=windowsgui" -o ../dist/MYCASH.exe .
ls -l ../dist/MYCASH.exe
