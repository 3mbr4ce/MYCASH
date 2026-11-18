# MYCASH LAN sync (v0.0.1)

Devices sync directly over the local network. No server, no internet, no account.
Both apps must be open (Android: app in foreground; Windows: window open).

## Pairing
1. Device A: Sync → "Pair device". It shows a QR code and the same text, e.g.
   `MYCASH1;192.168.1.20,10.0.0.5;47870;<pairing id>;<secret>`.
2. Device B scans the QR (Android camera) or pastes the text ("Enter pairing text").
   B connects to A (TCP 47870) and sends `hello`.
3. A shows a 6-digit confirmation code. The user types it on B.
   B sends `pair` encrypted with a key derived from the secret and the code.
   3 wrong codes cancel the session; a session expires after 10 minutes.
4. Both store each other (id, name, last address, a fresh random 32-byte shared key). B syncs at once.

## Transport
- TCP, port 47870. Frame = 4-byte big-endian length + JSON.
- Every payload is AES-256-GCM encrypted. AAD = `op|pairing-id` (or `op|sender-id`); responses use `resp|op|tag`.
- Keys: hello `SHA256("MYCASH-hello|secret")`, pair `SHA256("MYCASH-pair|secret|code")`, get/put the per-peer 32-byte key from pairing.
- Requests carry the sender's port and name, so a peer learns new addresses when the other side's IP changes.
- Implemented twice with the same protocol: Go (`desktop/syncnet`) and Java (`android/src/com/mysuite/mycash/net/SyncNode.java`).
  `tests/lan-e2e.js` checks go↔go, go↔java, java↔go, java↔java.

## Merge strategy
- All data is a map of records `id → {ts, dev, del?, ...}` (debts, borrowings, payments, items, monthly values).
- A sync round (`web/sync.js`): `get` the peer's document → merge locally → save → `put` the merged
  document back if the peer lacks something. `put` sends the etag read by `get`; if the peer changed in between
  it answers "conflict" and the round repeats (up to 4 tries).
- Per record **last writer wins**: higher `ts` wins; on a tie the higher device id, then the JSON text,
  decide (deterministic, both sides get the same result).
- Deletes are tombstones (`del: true`) so a delete wins over an older edit and is not revived.
- Monthly values have ids like `val|<item>|<YYYY-MM>` and payments `pay|<debt>|<YYYY-MM>`, so edits to
  different months or different items never conflict; only the same field edited on two devices does,
  and then the later edit wins.
- Clocks: `ts` is the device clock in ms. A device with a badly wrong clock can win/lose wrongly.

## Limits (v0.0.1)
- No automatic discovery; the address comes from the QR or from the last request.
- Windows may ask to allow MYCASH in the firewall (the installer can add a private-network rule for TCP 47870).
- Sync only while both apps are open.
