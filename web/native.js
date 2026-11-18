/* MYCASH native bridge shim: one promise API for Android (window.MCAndroid), Windows (Go WebView2 bindings
 * mcCall/mcWin) and a plain browser (localStorage mock, used for UI development and screenshots). */
(function () {
  'use strict';
  var pending = {}, seq = 0, listeners = [];
  window.MC_done = function (id, result) { var p = pending[id]; if (p) { delete pending[id]; p(result); } };
  window.MC_event = function (name) { for (var i = 0; i < listeners.length; i++) try { listeners[i](name); } catch (e) { console.error(e); } };

  var platform = window.MCAndroid ? 'android' : (window.mcCall ? 'windows' : 'browser');
  var N = { platform: platform, on: function (fn) { listeners.push(fn); } };

  if (platform === 'android') {
    N.call = function (m, args) {
      return new Promise(function (res) { var id = ++seq; pending[id] = res; window.MCAndroid.call(id, m, JSON.stringify(args || [])); });
    };
    N.canScan = true;
    N.win = function () {};
  } else if (platform === 'windows') {
    N.call = function (m, args) {
      return new Promise(function (res) { var id = ++seq; pending[id] = res; window.mcCall(id, m, JSON.stringify(args || [])); });
    };
    N.canScan = false;
    N.win = function (op, arg) { try { window.mcWin(op, arg || 0); } catch (e) {} };
  } else {
    // ---- browser mock: data in localStorage, pairing simulated ----
    var LS = window.localStorage, peers = JSON.parse(LS.getItem('mc.peers') || '[]'), sess = null;
    var info = JSON.parse(LS.getItem('mc.info') || 'null') || { deviceId: 'browser' + Math.floor(Math.random() * 1e6), name: 'This browser', kind: 'browser', version: '0.0.1', port: 47870, ips: ['192.168.178.24'], listening: true, listenError: '' };
    LS.setItem('mc.info', JSON.stringify(info));
    function fakeMatrix(text) { // NOT a real QR code: a deterministic pattern so the layout can be previewed
      var n = 33, rows = [], h = 7;
      for (var i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
      for (var y = 0; y < n; y++) { var r = ''; for (var x = 0; x < n; x++) {
        var f = function (cx, cy) { var dx = x - cx, dy = y - cy; return dx >= 0 && dx < 7 && dy >= 0 && dy < 7 && (dx === 0 || dx === 6 || dy === 0 || dy === 6 || (dx > 1 && dx < 5 && dy > 1 && dy < 5)); };
        var inF = (x < 8 && y < 8) || (x > n - 9 && y < 8) || (x < 8 && y > n - 9);
        if (inF) r += (f(0, 0) || f(n - 7, 0) || f(0, n - 7)) ? '1' : '0';
        else { h = (h * 1103515245 + 12345) >>> 0; r += (h >>> 16) & 1 ? '1' : '0'; }
      } rows.push(r); }
      return { n: n, rows: rows };
    }
    var M = {
      info: function () { return info; },
      setName: function (a) { info.name = a[0] || info.name; LS.setItem('mc.info', JSON.stringify(info)); return info; },
      load: function () { return LS.getItem('mc.doc') || ''; },
      save: function (a) { LS.setItem('mc.doc', a[0]); return { ok: true, etag: 'e' + Date.now() }; },
      pairStart: function () { var t = 'MYCASH1;192.168.178.24;47870;a1b2c3d4e5f6;Zm9vYmFyYmF6cXV4cXV1eA'; sess = { state: 'waiting', t0: Date.now() }; return { qr: t, matrix: fakeMatrix(t), expiresIn: 600 }; },
      pairStatus: function () { if (!sess) return { state: 'idle' }; if (window.MC_MOCK_PAIR_CODE && Date.now() - sess.t0 > 1500) return { state: 'code', code: '482 913'.replace(' ', ''), peerName: 'Galaxy A52' }; return { state: sess.state }; },
      pairCancel: function () { sess = null; return { ok: true }; },
      pairJoin: function () { return { ok: false, error: 'pairing needs the MYCASH app (browser preview)' }; },
      pairConfirm: function () { return { ok: false, error: 'pairing needs the MYCASH app (browser preview)' }; },
      peers: function () { return peers; },
      removePeer: function (a) { peers = peers.filter(function (p) { return p.id !== a[0]; }); LS.setItem('mc.peers', JSON.stringify(peers)); return peers; },
      pull: function () { return { ok: false, error: 'not available in the browser preview' }; },
      push: function () { return { ok: false, error: 'not available in the browser preview' }; },
      synced: function () { return { ok: true }; },
      qr: function (a) { return fakeMatrix(a[0]); }
    };
    N.call = function (m, args) { return new Promise(function (res) { setTimeout(function () { res(M[m] ? M[m](args || []) : { ok: false, error: 'unknown' }); }, 10); }); };
    N.canScan = false;
    N.win = function () {};
    N.mockPeers = function (list) { peers = list; LS.setItem('mc.peers', JSON.stringify(peers)); };
  }
  window.MCN = N;
})();
