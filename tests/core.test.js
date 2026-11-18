// Unit tests for web/core.js: node tests/core.test.js
'use strict';
const assert = require('assert');
const C = require('../web/core.js');
let n = 0, failed = 0;
function t(name, fn) { try { fn(); n++; console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + e.message); } }
const NB = '\u00a0';
function clock(start) { let x = start || 1000; return () => x += 10; }

t('parse: German formats', () => {
  const cases = { '1.234,56': 123456, '1234,56': 123456, '0,5': 50, ',5': 50, '12': 1200, '12,-': 1200, '1.234': 123400,
    '1.234.567,89': 123456789, '12.5': 1250, '12.50': 1250, '1.234,56 €': 123456, '€ 99': 9900, '  7,07 ': 707,
    '1 234,56': 123456, '0': 0, '000,10': 10, '100.000': 10000000, '+5': 500 };
  for (const k in cases) { const r = C.parseMoney(k); assert.ok(r.ok, k + ' should parse'); assert.strictEqual(r.cents, cases[k], k); }
});
t('parse: invalid input rejected', () => {
  for (const k of ['1,2,3', '12,345', 'abc', '1.23.4', '12.3456', '1.2345', '1,5€x', '0.123', '-5', '1..2', '1.234.56', '9999999999']) {
    assert.strictEqual(C.parseMoney(k).ok, false, k + ' should be rejected');
  }
});
t('parse: empty and negative', () => {
  assert.deepStrictEqual(C.parseMoney(''), { ok: true, cents: 0, empty: true });
  assert.strictEqual(C.parseMoney('-1.000,50', true).cents, -100050);
  assert.strictEqual(C.parseMoney('\u22122,00', true).cents, -200);
});
t('format: German number format', () => {
  assert.strictEqual(C.formatMoney(123456), '1.234,56' + NB + '€');
  assert.strictEqual(C.formatMoney(5), '0,05' + NB + '€');
  assert.strictEqual(C.formatMoney(0), '0,00' + NB + '€');
  assert.strictEqual(C.formatMoney(-100000), '-1.000,00' + NB + '€');
  assert.strictEqual(C.formatMoney(123456789012), '1.234.567.890,12' + NB + '€');
  assert.strictEqual(C.formatInput(123456), '1.234,56');
  assert.strictEqual(C.formatInput(0, true), '');
});
t('format/parse round trip', () => {
  for (let i = 0; i < 2000; i++) { const c = Math.floor(Math.random() * 1e10); assert.strictEqual(C.parseMoney(C.formatMoney(c)).cents, c); }
});
t('months', () => {
  assert.strictEqual(C.addMonths('2026-11', 1), '2026-12');
  assert.strictEqual(C.addMonths('2026-12', 1), '2027-01');
  assert.strictEqual(C.addMonths('2027-01', -1), '2026-12');
  assert.strictEqual(C.addMonths('2026-11', -23), '2024-12');
  assert.strictEqual(C.monthDiff('2026-11', '2027-02'), 3);
  assert.strictEqual(C.monthLabel('2026-11'), 'November 2026');
  assert.ok(C.isMonth('2026-01') && !C.isMonth('2026-13') && !C.isMonth('26-01'));
});
t('debt: payments reduce, borrowing increases, carried month to month', () => {
  const s = new C.Store(null, 'A', clock());
  const d = s.addDebt('Bank', 500000, '2026-11');
  s.setPayment(d.id, '2026-11', 20000);
  s.setPayment(d.id, '2026-12', 30000);
  s.addBorrow(d.id, '2027-01', 10000, 'extra', false);
  const idx = C.buildIndex(s.doc);
  const D = idx.debtById[d.id];
  assert.strictEqual(C.debtBalanceBefore(idx, D, '2026-11'), 500000);
  assert.strictEqual(C.debtBalance(idx, D, '2026-11'), 480000);
  assert.strictEqual(C.debtBalanceBefore(idx, D, '2026-12'), 480000);
  assert.strictEqual(C.debtBalance(idx, D, '2026-12'), 450000);
  assert.strictEqual(C.debtBalance(idx, D, '2027-01'), 460000);
  assert.strictEqual(C.debtBalance(idx, D, '2030-01'), 460000);
  assert.strictEqual(C.debtBalance(idx, D, '2026-10'), 0);
});
t('debt: payment can be changed or set to 0 (no fixed rate)', () => {
  const s = new C.Store(null, 'A', clock());
  const d = s.addDebt('Max', 80000, '2026-11');
  s.setPayment(d.id, '2026-11', 5000); s.setPayment(d.id, '2026-11', 7000);
  let idx = C.buildIndex(s.doc);
  assert.strictEqual(C.paymentIn(idx, d.id, '2026-11'), 7000);
  s.setPayment(d.id, '2026-11', 0);
  idx = C.buildIndex(s.doc);
  assert.strictEqual(C.paymentIn(idx, d.id, '2026-11'), 0);
  assert.strictEqual(C.debtBalance(idx, idx.debtById[d.id], '2026-11'), 80000);
});
t('debt: entries before the start month are ignored; paid-off debts leave later months', () => {
  const s = new C.Store(null, 'A', clock());
  const d = s.addDebt('Card', 10000, '2026-11');
  s.setPayment(d.id, '2026-10', 999);
  s.setPayment(d.id, '2026-11', 10000);
  const idx = C.buildIndex(s.doc);
  assert.strictEqual(C.debtBalance(idx, idx.debtById[d.id], '2026-11'), 0);
  assert.strictEqual(C.monthSummary(idx, '2026-11').debts.length, 1);
  assert.strictEqual(C.monthSummary(idx, '2026-12').debts.length, 0);
  assert.strictEqual(C.monthSummary(idx, '2026-10').debts.length, 0);
  const ov = C.debtOverview(idx, '2026-12');
  assert.strictEqual(ov.rows[0].status, 'paid'); assert.strictEqual(ov.total, 0);
});
t('income: regular income carries over, editable per month (applies from that month on)', () => {
  const s = new C.Store(null, 'A', clock());
  const sal = s.addItem('income', 'Salary', '', true, '2026-11', 250000);
  const side = s.addItem('income', 'Side job', '', false, '2026-11', 30000);
  let idx = C.buildIndex(s.doc);
  assert.strictEqual(C.itemAmount(idx, idx.itemById[sal.id], '2027-05'), 250000);
  assert.strictEqual(C.itemAmount(idx, idx.itemById[side.id], '2026-11'), 30000);
  assert.strictEqual(C.itemAmount(idx, idx.itemById[side.id], '2026-12'), null);
  assert.strictEqual(C.itemAmount(idx, idx.itemById[sal.id], '2026-10'), null);
  s.setItemAmount(sal.id, '2027-02', 260000);
  idx = C.buildIndex(s.doc);
  assert.strictEqual(C.itemAmount(idx, idx.itemById[sal.id], '2027-01'), 250000);
  assert.strictEqual(C.itemAmount(idx, idx.itemById[sal.id], '2027-02'), 260000);
  assert.strictEqual(C.itemAmount(idx, idx.itemById[sal.id], '2027-08'), 260000);
  assert.ok(C.itemSetThisMonth(idx, idx.itemById[sal.id], '2027-02'));
  assert.ok(!C.itemSetThisMonth(idx, idx.itemById[sal.id], '2027-03'));
});
t('costs: fixed costs carry over; stop from a month; remove', () => {
  const s = new C.Store(null, 'A', clock());
  const rent = s.addItem('cost', 'Rent', 'Rent', true, '2026-11', 90000);
  const once = s.addItem('cost', 'Repair', 'Other', false, '2026-12', 12000);
  s.setItemAmount(rent.id, '2027-03', 95000);
  s.stopItem(rent.id, '2027-01'); // also drops the later 2027-03 value
  let idx = C.buildIndex(s.doc);
  const R = idx.itemById[rent.id];
  assert.strictEqual(C.itemAmount(idx, R, '2026-12'), 90000);
  assert.strictEqual(C.itemAmount(idx, R, '2027-01'), null);
  assert.strictEqual(C.itemAmount(idx, R, '2027-04'), null);
  assert.strictEqual(C.itemAmount(idx, idx.itemById[once.id], '2026-12'), 12000);
  s.removeItem(once.id);
  idx = C.buildIndex(s.doc);
  assert.strictEqual(idx.itemById[once.id], undefined);
  // resume after stop by setting a value again
  s.setItemAmount(rent.id, '2027-06', 99000);
  idx = C.buildIndex(s.doc);
  assert.strictEqual(C.itemAmount(idx, idx.itemById[rent.id], '2027-06'), 99000);
});
t('subscriptions: monthly and yearly cycles', () => {
  const s = new C.Store(null, 'A', clock());
  const a = s.addItem('sub', 'Streaming', '', true, '2026-11', 1399, 1);
  const y = s.addItem('sub', 'Cloud', '', true, '2026-11', 9999, 12);
  const idx = C.buildIndex(s.doc);
  assert.strictEqual(C.itemAmount(idx, idx.itemById[a.id], '2027-03'), 1399);
  assert.strictEqual(C.itemAmount(idx, idx.itemById[y.id], '2026-11'), 9999);
  assert.strictEqual(C.itemAmount(idx, idx.itemById[y.id], '2027-03'), null);
  assert.strictEqual(C.itemAmount(idx, idx.itemById[y.id], '2027-11'), 9999);
});
t('surplus = income + borrowed cash - costs - subscriptions - payments; shortfall negative', () => {
  const s = new C.Store(null, 'A', clock());
  s.addItem('income', 'Salary', '', true, '2026-11', 250000);
  s.addItem('income', 'Side job', '', true, '2026-11', 30000);
  s.addItem('cost', 'Rent', 'Rent', true, '2026-11', 90000);
  s.addItem('cost', 'Food', 'Food', true, '2026-11', 35000);
  s.addItem('cost', 'Ticket', 'Transport', true, '2026-11', 5800);
  s.addItem('sub', 'Phone', '', true, '2026-11', 1500);
  s.addItem('sub', 'Streaming', '', true, '2026-11', 1300);
  const b = s.addDebt('Bank', 500000, '2026-11'), m = s.addDebt('Max', 80000, '2026-11');
  s.setPayment(b.id, '2026-11', 40000); s.setPayment(m.id, '2026-11', 10000);
  let idx = C.buildIndex(s.doc), sum = C.monthSummary(idx, '2026-11');
  assert.strictEqual(sum.totals.income, 280000);
  assert.strictEqual(sum.totals.costs, 130800);
  assert.strictEqual(sum.totals.subs, 2800);
  assert.strictEqual(sum.totals.payments, 50000);
  assert.strictEqual(sum.surplus, 280000 - 130800 - 2800 - 50000);
  // December: carry-over, no payments yet
  sum = C.monthSummary(idx, '2026-12');
  assert.strictEqual(sum.surplus, 280000 - 130800 - 2800);
  assert.strictEqual(sum.debts.find(x => x.debt.id === b.id).before, 460000);
  // shortfall, plus borrowed cash counts as money in
  s.setPayment(b.id, '2026-12', 200000);
  s.addBorrow(m.id, '2026-12', 5000, 'cash from Max', true);
  s.addBorrow(m.id, '2026-12', 2000, 'paid my bill', false);
  idx = C.buildIndex(s.doc); sum = C.monthSummary(idx, '2026-12');
  assert.strictEqual(sum.totals.borrowedCash, 5000);
  assert.strictEqual(sum.surplus, 280000 + 5000 - 130800 - 2800 - 200000);
  assert.ok(sum.surplus < 0);
  assert.strictEqual(sum.debts.find(x => x.debt.id === m.id).after, 70000 + 7000);
});
t('overview: global remaining and total', () => {
  const s = new C.Store(null, 'A', clock());
  const b = s.addDebt('Bank', 500000, '2026-11'), m = s.addDebt('Max', 80000, '2026-12');
  s.setPayment(b.id, '2026-11', 50000); s.setPayment(b.id, '2027-01', 50000);
  const idx = C.buildIndex(s.doc), ov = C.debtOverview(idx, '2026-11');
  assert.strictEqual(ov.rows.find(r => r.debt.id === b.id).remaining, 450000);
  assert.strictEqual(ov.rows.find(r => r.debt.id === b.id).remainingAll, 400000);
  assert.strictEqual(ov.rows.find(r => r.debt.id === m.id).remaining, 80000); // starts later: full amount
  assert.strictEqual(ov.total, 530000);
  const rg = C.dataRange(idx, '2026-11');
  assert.deepStrictEqual(rg, { from: '2026-11', to: '2027-01' });
});
t('remove debt drops its payments', () => {
  const s = new C.Store(null, 'A', clock());
  const b = s.addDebt('Bank', 500000, '2026-11'); s.setPayment(b.id, '2026-11', 50000);
  s.removeDebt(b.id);
  const idx = C.buildIndex(s.doc);
  assert.strictEqual(idx.debts.length, 0);
  assert.strictEqual(C.monthSummary(idx, '2026-11').totals.payments, 0);
});
t('store: timestamps are monotonic even if the clock goes back', () => {
  let x = 5000; const s = new C.Store(null, 'A', () => x);
  const a = s.addDebt('a', 1, '2026-11'); x = 10; const b = s.addDebt('b', 1, '2026-11');
  assert.ok(b.ts > a.ts);
});
t('merge: union, last writer wins, tombstones, flags', () => {
  const A = new C.Store(null, 'A', clock(1000)), B = new C.Store(null, 'B', clock(5000));
  const d = A.addDebt('Bank', 500000, '2026-11');
  let m = C.mergeDocs(B.doc, A.doc); assert.ok(m.localChanged); assert.ok(!m.remoteChanged);
  B.doc = m.doc; B.lastTs = Math.max(B.lastTs, 1010);
  // concurrent edits of the same payment cell: newer wins
  A.setPayment(d.id, '2026-11', 100);
  B.setPayment(d.id, '2026-11', 200); // B's clock is ahead -> B wins
  const x = A.addDebt('OnlyA', 1, '2026-11');
  m = C.mergeDocs(A.doc, B.doc);
  assert.ok(m.localChanged && m.remoteChanged);
  let idx = C.buildIndex(m.doc);
  assert.strictEqual(C.paymentIn(idx, d.id, '2026-11'), 200);
  assert.ok(idx.debtById[x.id]);
  // merge is symmetric
  const m2 = C.mergeDocs(B.doc, A.doc);
  assert.strictEqual(JSON.stringify(sorted(m2.doc)), JSON.stringify(sorted(m.doc)));
  // deletion travels as tombstone
  A.doc = m.doc; A.lastTs = Math.max(A.lastTs, B.lastTs);
  A.removeDebt(x.id);
  m = C.mergeDocs(B.doc, A.doc);
  idx = C.buildIndex(m.doc); assert.ok(!idx.debtById[x.id]);
  // idempotent
  const m3 = C.mergeDocs(m.doc, m.doc); assert.ok(!m3.localChanged && !m3.remoteChanged);
});
t('merge: random fuzz converges', () => {
  for (let round = 0; round < 200; round++) {
    const devs = ['A', 'B', 'C'].map((d, i) => new C.Store(null, d, clock(i * 3)));
    const ids = [];
    for (let step = 0; step < 40; step++) {
      const s = devs[Math.floor(Math.random() * 3)], r = Math.random();
      if (r < 0.2 || ids.length === 0) ids.push(s.addDebt('d' + step, 1000, '2026-11').id);
      else if (r < 0.7) s.setPayment(ids[Math.floor(Math.random() * ids.length)], '2026-1' + Math.floor(Math.random() * 3), Math.floor(Math.random() * 3) * 100);
      else if (r < 0.8) s.remove(ids[Math.floor(Math.random() * ids.length)]);
      else { // sync a random pair
        const a = devs[Math.floor(Math.random() * 3)], b = devs[Math.floor(Math.random() * 3)];
        const mm = C.mergeDocs(a.doc, b.doc); a.doc = JSON.parse(JSON.stringify(mm.doc)); b.doc = JSON.parse(JSON.stringify(mm.doc));
        a.lastTs = b.lastTs = Math.max(a.lastTs, b.lastTs);
      }
    }
    // full sync: everyone ends identical
    let all = devs[0].doc; for (const s of devs) all = C.mergeDocs(all, s.doc).doc;
    for (const s of devs) { const mm = C.mergeDocs(s.doc, all); assert.strictEqual(JSON.stringify(sorted(mm.doc)), JSON.stringify(sorted(all))); }
  }
});
t('parseDoc rejects foreign files', () => {
  assert.strictEqual(C.parseDoc('{"x":1}'), null);
  assert.strictEqual(C.parseDoc('not json'), null);
  assert.deepStrictEqual(C.parseDoc(''), C.emptyDoc());
});
function sorted(doc) { const o = {}; Object.keys(doc.records).sort().forEach(k => o[k] = doc.records[k]); return o; }
console.log(`\n${n} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
