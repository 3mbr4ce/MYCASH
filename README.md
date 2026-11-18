# MYCASH (MYSUITE)

Personal finance planner: debts with a running balance, flexible monthly payments, income sources,
categorized living costs, subscriptions, immediate surplus/shortfall, month and global overviews,
euro in German format, local storage, LAN-only device sync.

- Version: see `VERSION` (0.0.1). Android package ID: `com.mysuite.mycash` (stable, never change).
- Android: versionCode 1, versionName 0.0.1, minSdk 26, targetSdk 34.

## Stack
- `web/`: one shared UI (plain JS, no framework). `core.js` holds all money/month/carry-over/merge logic.
  `tools/build-web.py` inlines everything into one `index.html` and bundles a copy of `mysuite-apps.json`.
- `android/`: Java WebView shell, built without Gradle (aapt2, javac, d8, zipalign, apksigner) via `android/build.sh`.
  ZXing for the QR scanner and QR display.
- `desktop/`: Windows app in Go + go-webview2 (`desktop/build.sh` → `dist/MYCASH.exe`).
- `installer/`: NSIS per-user installer (`installer/build-installer.sh` → `dist/MYCASH-<v>-setup.exe`).

## Data
- Android: app files dir `mycash/` (survives updates; `allowBackup=false`).
- Windows: `%LOCALAPPDATA%\MYCASH\data\` (`data.json`, `sync.json`, `.bak` copies), log `%LOCALAPPDATA%\MYCASH\mycash.log`.
  Uninstall keeps data unless "Delete my data too" is ticked.

## Signing
Release keystore: `keys/mycash-release.jks` (alias `mycash`, password in `keys/release.pass`).
Not in git. **Keep it and reuse it for every version**, otherwise Android cannot update the installed app.

## Tests
- `node tests/core.test.js` – logic unit tests
- `cd desktop && go test ./syncnet/` – Go sync node
- `node tests/lan-e2e.js` – real TCP sync between Go and Java nodes
- `node tests/ui-browser.js` – UI in headless Chromium with a mock bridge (screenshots)

Sync protocol and merge: `docs/SYNC.md`.
