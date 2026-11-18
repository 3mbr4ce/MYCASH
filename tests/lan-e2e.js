// LAN sync end-to-end between real sync nodes (Go desktop node and/or the Android Java node on a JVM),
// with the app's own merge (web/core.js + web/sync.js).
//   node tests/lan-e2e.js go go | go java | java go | java java
'use strict';
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const C = require('../web/core.js'), S = require('../web/sync.js');
const ROOT = path.join(__dirname, '..');
const GO_PEER = process.env.GO_PEER || '/workspace/mycash-tools/mycash-peer';
const JAVA = process.env.JAVA || '/workspace/.android-tools/jdk-17.0.21+9/bin/java';
const JCP = process.env.JVMPEER_CP || '/workspace/mycash-tools/jvmpeer';

class Device {
  constructor(kind, name, port) {
    this.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mycash-' + kind + '-'));
    const args = ['-dir', this.dir, '-name', name, '-port', String(port)];
    this.p = kind === 'go' ? spawn(GO_PEER, args) : spawn(JAVA, ['-cp', JCP, 'JvmPeer', ...args]);
    this.p.stderr.on('data', d => process.stderr.write('[' + name + '] ' + d));
    this.seq = 0; this.wait = {}; this.events = []; this.buf = '';
    this.ready = new Promise(res => { this.onReady = res; });
    this.p.stdout.on('data', d => {
      this.buf += d; let i;
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, i); this.buf = this.buf.slice(i + 1);
        const m = JSON.parse(line);
        if (m.ev === 'ready') { this.info = m.info; this.onReady(); }
        else if (m.ev) { this.events.push(m.ev); if (m.ev === 'change') this.reload(); }
        else if (this.wait[m.id]) { this.wait[m.id](m.r); delete this.wait[m.id]; }
      }
    });
    this.store = new C.Store(null, name, Date.now);
    this.native = { call: (m, a) => this.call(m, a) };
  }
  call(m, a) { const id = ++this.seq; return new Promise(res => { this.wait[id] = res; this.p.stdin.write(JSON.stringify({ id, m, a: a || [] }) + '\n'); }); }
  async save() { await this.call('save', [JSON.stringify(this.store.doc)]); }
  async reload() { const t = await this.call('load'); const d = C.parseDoc(t); if (d) this.store.doc = C.mergeDocs(this.store.doc, d).doc; }
  sync(peerId) { return S.syncWithPeer(this.native, peerId, () => this.store.doc, d => { this.store.doc = d; return this.save(); }); }
  stop() { this.p.kill(); }
}

let pass = 0, fail = 0;
function check(name, cond, extra) { if (cond) { pass++; console.log('ok   ' + name); } else { fail++; console.log('FAIL ' + name + (extra ? ' ' + JSON.stringify(extra) : '')); } }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const loop = qr => { const p = qr.split(';'); p[1] = '127.0.0.1'; return p.join(';'); };

(async () => {
  const [ka, kb] = [process.argv[2] || 'go', process.argv[3] || 'go'];
  console.log(`# host=${ka} client=${kb}`);
  const base = 48100 + Math.floor(Math.random() * 400) * 2;
  const A = new Device(ka, 'Host-' + ka, base), B = new Device(kb, 'Client-' + kb, base + 1);
  await Promise.all([A.ready, B.ready]);
  check('both nodes listening', A.info.listening && B.info.listening, [A.info, B.info]);
  try {
    const ps = await A.call('pairStart');
    check('QR text has MYCASH1 prefix and 5 parts', ps.qr.startsWith('MYCASH1;') && ps.qr.split(';').length === 5, ps.qr);
    check('QR matrix rendered', ps.matrix.n >= 21 && ps.matrix.rows.length === ps.matrix.n);
    const j = await B.call('pairJoin', [loop(ps.qr)]);
    check('join reaches host', j.ok && j.hostName === 'Host-' + ka, j);
    const st = await A.call('pairStatus');
    check('host shows a 6-digit code after hello', st.state === 'code' && /^\d{6}$/.test(st.code) && st.peerName === 'Client-' + kb, st);
    const bad = await B.call('pairConfirm', [st.code === '123456' ? '654321' : '123456']);
    check('wrong code refused', !bad.ok && bad.error === 'wrong code', bad);
    const ok = await B.call('pairConfirm', [st.code]);
    check('right code pairs', ok.ok && ok.peer && ok.peer.name === 'Host-' + ka, ok);
    const pa = await A.call('peers'), pb = await B.call('peers');
    check('both sides list each other', pa.length === 1 && pb.length === 1 && pa[0].id === B.info.deviceId && pb[0].id === A.info.deviceId, { pa, pb });
    const aId = A.info.deviceId, bId = B.info.deviceId;

    // data on both sides
    const bank = A.store.addDebt('Bank', 500000, '2026-11');
    A.store.setPayment(bank.id, '2026-11', 25000);
    A.store.addItem('income', 'Salary', '', true, '2026-11', 250000);
    await A.save();
    const max = B.store.addDebt('Max', 80000, '2026-11');
    B.store.addItem('cost', 'Rent', 'Rent', true, '2026-11', 90000);
    await B.save();
    let r = await B.sync(aId);
    check('first sync ok (received + sent)', r.ok && r.received && r.sent, r);
    await sleep(300);
    const ia = C.buildIndex(A.store.doc), ib = C.buildIndex(B.store.doc);
    check('host got the client data', !!ia.debtById[max.id] && ia.items.length === 2, { debts: ia.debts.length, items: ia.items.length });
    check('client got the host data', !!ib.debtById[bank.id] && ib.items.length === 2);
    check('surplus identical on both', C.monthSummary(ia, '2026-11').surplus === C.monthSummary(ib, '2026-11').surplus && C.monthSummary(ia, '2026-11').surplus === 250000 - 90000 - 25000);
    check('host UI was told to reload', A.events.includes('change'));

    // concurrent edit of the same payment: newer wins; deletions travel; reverse direction (host pulls client)
    A.store.setPayment(bank.id, '2026-12', 10000); await A.save();
    await sleep(5);
    B.store.doc = JSON.parse(JSON.stringify(B.store.doc)); B.store.lastTs = Math.max(B.store.lastTs, A.store.lastTs);
    B.store.setPayment(bank.id, '2026-12', 20000); B.store.removeDebt(max.id); await B.save();
    r = await A.sync(bId);
    check('reverse sync (host -> client) ok', r.ok, r);
    await sleep(300);
    const ja = C.buildIndex(A.store.doc), jb = C.buildIndex(B.store.doc);
    check('newer payment wins on both', C.paymentIn(ja, bank.id, '2026-12') === 20000 && C.paymentIn(jb, bank.id, '2026-12') === 20000,
      [C.paymentIn(ja, bank.id, '2026-12'), C.paymentIn(jb, bank.id, '2026-12')]);
    check('deleted debt gone on both', !ja.debtById[max.id] && !jb.debtById[max.id]);
    r = await B.sync(aId);
    check('nothing to do when in sync', r.ok && !r.received && !r.sent, r);
    const pl = await B.call('peers');
    check('last sync time recorded', pl[0].lastSync > 0);

    // conflict retry: host changes between pull and push
    const orig = B.native.call; let once = true;
    B.native = { call: async (m, a) => { if (m === 'push' && once) { once = false; A.store.addDebt('Late', 100, '2026-11'); await A.save(); } return orig.call(B, m, a); } };
    B.store.addDebt('FromB', 100, '2026-11'); await B.save();
    r = await B.sync(aId);
    await sleep(300);
    const ka2 = C.buildIndex(A.store.doc), kb2 = C.buildIndex(B.store.doc);
    check('conflict is retried and both end equal', r.ok && ka2.debts.length === kb2.debts.length && ka2.debts.length === 3, { r, a: ka2.debts.length, b: kb2.debts.length });

    // unpaired device refused
    await A.call('removePeer', [bId]);
    r = await B.call('pull', [aId]);
    check('removed device can no longer pull', !r.ok && r.error === 'not paired', r);
  } catch (e) { fail++; console.log('FAIL exception ' + e.stack); }
  A.stop(); B.stop();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
