/* MYCASH client-side sync round (shared by the apps and the LAN tests).
 * native.call(method, args) -> Promise<result>; the transport and encryption live in the native layer
 * (desktop/syncnet in Go, android/.../net/SyncNode.java), the merge (last writer wins per record) lives here. */
(function (root) {
  'use strict';
  var C = (typeof module !== 'undefined' && module.exports) ? require('./core.js') : root.MCCore;

  /** One sync with a paired device: pull its document, merge, store the result locally, push it back if the
   *  other side is missing something. getLocal() returns the current local doc; applyLocal(doc) must store it. */
  function syncWithPeer(native, peerId, getLocal, applyLocal) {
    var attempt = 0, received = false, sent = false;
    function round() {
      attempt++;
      return native.call('pull', [peerId]).then(function (p) {
        if (!p || !p.ok) return { ok: false, error: (p && p.error) || 'no answer' };
        var remote = C.parseDoc(p.doc);
        if (!remote) return { ok: false, error: 'the other device sent unreadable data' };
        var m = C.mergeDocs(getLocal(), remote);
        var done = Promise.resolve();
        if (m.localChanged) { received = true; done = Promise.resolve(applyLocal(m.doc)); }
        return done.then(function () {
          if (!m.remoteChanged) return { ok: true };
          return native.call('push', [peerId, JSON.stringify(m.doc), p.etag]).then(function (r) {
            if (r && r.ok) { sent = true; return { ok: true }; }
            if (r && r.error === 'conflict' && attempt < 4) return round();
            return { ok: false, error: (r && r.error) || 'no answer' };
          });
        });
      });
    }
    return round().then(function (r) {
      if (r.ok) { r.received = received; r.sent = sent; return native.call('synced', [peerId]).then(function () { return r; }); }
      return r;
    });
  }

  var api = { syncWithPeer: syncWithPeer };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MCSync = api;
})(this);
