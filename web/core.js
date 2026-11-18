/* MYCASH core logic (shared by Android, Windows and tests). Plain ES2017, no regex parsing, no dependencies.
 * Money is always an integer number of euro cents. Months are "YYYY-MM" strings (they sort as text).
 */
(function (root) {
  'use strict';

  // ---------- money ----------
  var NBSP = '\u00a0';

  function isDigits(s) {
    if (s.length === 0) return false;
    for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); if (c < 48 || c > 57) return false; }
    return true;
  }

  // "1.234.567" -> "1234567" when the dots are valid German thousands groups, else null
  function joinGroups(s) {
    var parts = s.split('.');
    if (parts.length === 1) return isDigits(s) ? s : null;
    if (!isDigits(parts[0]) || parts[0].length > 3) return null;
    for (var i = 1; i < parts.length; i++) if (parts[i].length !== 3 || !isDigits(parts[i])) return null;
    return parts.join('');
  }

  var MAX_CENTS = 99999999999; // 999.999.999,99 €

  /** Parses a German-style euro amount. Accepts "1.234,56", "1234,56", "1234", "12,5", "12.50", "1.234", "€ 12",
   *  "12,-". Returns {ok:true, cents, empty} or {ok:false, error}. Negative values only with allowNegative. */
  function parseMoney(input, allowNegative) {
    var s = String(input == null ? '' : input), t = '';
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      if (ch === ' ' || ch === NBSP || ch === '\u202f' || ch === '€' || ch === "'" || ch === '\t') continue;
      t += ch;
    }
    if (t === '') return { ok: true, cents: 0, empty: true };
    var neg = false;
    if (t[0] === '-' || t[0] === '\u2212') { neg = true; t = t.slice(1); } else if (t[0] === '+') t = t.slice(1);
    if (neg && !allowNegative) return { ok: false, error: 'Negative amounts are not allowed' };
    if (t.length > 2 && t.slice(-2) === ',-') t = t.slice(0, -2) + ',00';
    var commas = t.split(',').length - 1, dots = t.split('.').length - 1;
    var intPart, frac = '';
    if (commas > 1) return { ok: false, error: 'Invalid amount' };
    if (commas === 1) {
      var ci = t.indexOf(',');
      intPart = t.slice(0, ci); frac = t.slice(ci + 1);
      if (intPart === '') intPart = '0';
      intPart = joinGroups(intPart);
      if (intPart === null) return { ok: false, error: 'Invalid amount' };
    } else if (dots === 0) {
      intPart = t;
    } else if (dots === 1) {
      var di = t.indexOf('.'), a = t.slice(0, di), b = t.slice(di + 1);
      if (b.length === 3 && a.length >= 1 && a.length <= 3 && a[0] !== '0') { intPart = a + b; }
      else if (b.length >= 1 && b.length <= 2) { intPart = a === '' ? '0' : a; frac = b; }
      else return { ok: false, error: 'Invalid amount' };
    } else {
      intPart = joinGroups(t);
      if (intPart === null) return { ok: false, error: 'Invalid amount' };
    }
    if (!isDigits(intPart)) return { ok: false, error: 'Invalid amount' };
    if (frac !== '' && (!isDigits(frac) || frac.length > 2)) return { ok: false, error: 'Use at most 2 decimals' };
    while (frac.length < 2) frac += '0';
    while (intPart.length > 1 && intPart[0] === '0') intPart = intPart.slice(1);
    if (intPart.length > 9) return { ok: false, error: 'Amount too large' };
    var cents = parseInt(intPart, 10) * 100 + parseInt(frac, 10);
    if (cents > MAX_CENTS) return { ok: false, error: 'Amount too large' };
    return { ok: true, cents: neg ? -cents : cents, empty: false };
  }

  function groupThousands(n) {
    var s = String(n), out = '';
    while (s.length > 3) { out = '.' + s.slice(-3) + out; s = s.slice(0, -3); }
    return s + out;
  }

  /** 123456 -> "1.234,56 €" (non-breaking space before €). */
  function formatMoney(cents, opts) {
    cents = Math.round(cents || 0);
    var neg = cents < 0, a = Math.abs(cents);
    var c = a % 100, e = (a - c) / 100;
    var txt = groupThousands(e) + ',' + (c < 10 ? '0' : '') + c;
    if (!(opts && opts.noSymbol)) txt += NBSP + '€';
    if (neg) txt = '-' + txt;
    else if (opts && opts.plus && cents > 0) txt = '+' + txt;
    return txt;
  }

  /** Value for an edit field: "1.234,56" (empty for 0 when blankZero). */
  function formatInput(cents, blankZero) {
    if (!cents && blankZero) return '';
    return formatMoney(cents, { noSymbol: true });
  }

  // ---------- months ----------
  function monthKey(y, m) { return y + '-' + (m < 10 ? '0' : '') + m; }
  function parseMonth(k) { return { y: parseInt(k.slice(0, 4), 10), m: parseInt(k.slice(5, 7), 10) }; }
  function isMonth(k) {
    if (typeof k !== 'string' || k.length !== 7 || k[4] !== '-') return false;
    if (!isDigits(k.slice(0, 4)) || !isDigits(k.slice(5))) return false;
    var m = parseInt(k.slice(5), 10); return m >= 1 && m <= 12;
  }
  function addMonths(k, n) {
    var p = parseMonth(k), t = p.y * 12 + (p.m - 1) + n;
    return monthKey(Math.floor(t / 12), (t % 12 + 12) % 12 + 1);
  }
  function monthDiff(a, b) { var x = parseMonth(a), y = parseMonth(b); return (y.y * 12 + y.m) - (x.y * 12 + x.m); }
  function currentMonth(d) { d = d || new Date(); return monthKey(d.getFullYear(), d.getMonth() + 1); }
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function monthLabel(k, short) { var p = parseMonth(k), n = MONTHS[p.m - 1]; return (short ? n.slice(0, 3) : n) + ' ' + p.y; }

  // ---------- document / records ----------
  // doc = {format:"mycash", schema:1, records:{id: record}}
  // every record: {id, type, ts (ms, last change), dev (device id of last change), del (tombstone)}
  //   debt   {name, start (cents), startMonth, note}
  //   borrow {debtId, month, amount, note, cash (adds to the month's money)}
  //   pay    id "pay|<debtId>|<month>"  {debtId, month, amount}
  //   item   {kind: income|cost|sub, name, cat, recurring, cycle (months: 1/3/6/12), startMonth}
  //   val    id "val|<itemId>|<month>"  {itemId, month, amount, stop}
  var COST_CATEGORIES = ['Rent', 'Utilities', 'Food', 'Transport', 'Insurance', 'Phone & internet', 'Health', 'Household', 'Leisure', 'Other'];

  function emptyDoc() { return { format: 'mycash', schema: 1, records: {} }; }

  function parseDoc(text) {
    if (!text) return emptyDoc();
    var d;
    try { d = JSON.parse(text); } catch (e) { return null; }
    if (!d || d.format !== 'mycash' || typeof d.records !== 'object' || d.records === null) return null;
    return d;
  }

  function randomId() {
    var s = '';
    for (var i = 0; i < 12; i++) s += 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)];
    return Date.now().toString(36) + s;
  }

  /** Mutations go through a Store so every changed record gets a fresh timestamp and this device's id. */
  function Store(doc, deviceId, now) {
    this.doc = doc || emptyDoc();
    this.dev = deviceId || 'local';
    this.now = now || function () { return Date.now(); };
    var mx = 0, r = this.doc.records;
    for (var k in r) if (r[k].ts > mx) mx = r[k].ts;
    this.lastTs = mx;
  }
  Store.prototype.tick = function () {
    var t = this.now();
    if (t <= this.lastTs) t = this.lastTs + 1; // monotonic even if the clock jumps back or a peer is ahead
    this.lastTs = t; return t;
  };
  Store.prototype.get = function (id) { var r = this.doc.records[id]; return r && !r.del ? r : null; };
  Store.prototype.put = function (rec) {
    var r = {}; for (var k in rec) r[k] = rec[k];
    if (!r.id) r.id = randomId();
    r.ts = this.tick(); r.dev = this.dev; r.del = false;
    this.doc.records[r.id] = r; return r;
  };
  Store.prototype.patch = function (id, fields) {
    var cur = this.get(id); if (!cur) return null;
    var r = {}; for (var k in cur) r[k] = cur[k];
    for (var f in fields) r[f] = fields[f];
    return this.put(r);
  };
  Store.prototype.remove = function (id) {
    var cur = this.doc.records[id]; if (!cur || cur.del) return;
    this.doc.records[id] = { id: id, type: cur.type, ts: this.tick(), dev: this.dev, del: true };
  };

  // ----- debts -----
  Store.prototype.addDebt = function (name, startCents, startMonth, note) {
    return this.put({ type: 'debt', name: name, start: startCents, startMonth: startMonth, note: note || '' });
  };
  Store.prototype.setPayment = function (debtId, month, cents) {
    var id = 'pay|' + debtId + '|' + month;
    if (!cents) { this.remove(id); return null; }
    return this.put({ id: id, type: 'pay', debtId: debtId, month: month, amount: cents });
  };
  Store.prototype.addBorrow = function (debtId, month, cents, note, cash) {
    return this.put({ type: 'borrow', debtId: debtId, month: month, amount: cents, note: note || '', cash: !!cash });
  };
  Store.prototype.removeDebt = function (debtId) {
    var r = this.doc.records;
    for (var k in r) if (!r[k].del && (r[k].type === 'pay' || r[k].type === 'borrow') && r[k].debtId === debtId) this.remove(k);
    this.remove(debtId);
  };

  // ----- income / costs / subscriptions -----
  Store.prototype.addItem = function (kind, name, cat, recurring, month, cents, cycle) {
    var it = this.put({ type: 'item', kind: kind, name: name, cat: cat || '', recurring: kind === 'sub' ? true : !!recurring,
      cycle: kind === 'sub' ? (cycle || 1) : 1, startMonth: month });
    this.setItemAmount(it.id, month, cents);
    return it;
  };
  /** Sets the amount from this month on (recurring items carry it to later months until the next change). */
  Store.prototype.setItemAmount = function (itemId, month, cents) {
    return this.put({ id: 'val|' + itemId + '|' + month, type: 'val', itemId: itemId, month: month, amount: cents, stop: false });
  };
  /** Ends a recurring item from this month on (earlier months keep it). */
  Store.prototype.stopItem = function (itemId, month) {
    var it = this.get(itemId); if (!it) return;
    if (!it.recurring || month <= it.startMonth) { this.removeItem(itemId); return; }
    this.put({ id: 'val|' + itemId + '|' + month, type: 'val', itemId: itemId, month: month, amount: 0, stop: true });
    // later explicit values would revive it: drop them
    var r = this.doc.records;
    for (var k in r) if (!r[k].del && r[k].type === 'val' && r[k].itemId === itemId && r[k].month > month) this.remove(k);
  };
  Store.prototype.removeItem = function (itemId) {
    var r = this.doc.records;
    for (var k in r) if (!r[k].del && r[k].type === 'val' && r[k].itemId === itemId) this.remove(k);
    this.remove(itemId);
  };

  // ---------- calculations ----------
  function byMonth(a, b) { return a.month < b.month ? -1 : a.month > b.month ? 1 : 0; }

  /** Builds lookup tables once per render. */
  function buildIndex(doc) {
    var idx = { debts: [], items: [], debtById: {}, itemById: {}, vals: {}, pays: {}, borrows: {} };
    var r = doc.records, k, x;
    for (k in r) {
      x = r[k]; if (x.del) continue;
      if (x.type === 'debt') { idx.debts.push(x); idx.debtById[x.id] = x; }
      else if (x.type === 'item') { idx.items.push(x); idx.itemById[x.id] = x; }
    }
    for (k in r) {
      x = r[k]; if (x.del) continue;
      if (x.type === 'val' && idx.itemById[x.itemId]) (idx.vals[x.itemId] = idx.vals[x.itemId] || []).push(x);
      else if (x.type === 'pay' && idx.debtById[x.debtId]) (idx.pays[x.debtId] = idx.pays[x.debtId] || []).push(x);
      else if (x.type === 'borrow' && idx.debtById[x.debtId]) (idx.borrows[x.debtId] = idx.borrows[x.debtId] || []).push(x);
    }
    for (k in idx.vals) idx.vals[k].sort(byMonth);
    for (k in idx.pays) idx.pays[k].sort(byMonth);
    for (k in idx.borrows) idx.borrows[k].sort(byMonth);
    var byName = function (a, b) { var x = (a.name || '').toLowerCase(), y = (b.name || '').toLowerCase(); return x < y ? -1 : x > y ? 1 : (a.id < b.id ? -1 : 1); };
    idx.debts.sort(function (a, b) { return a.startMonth < b.startMonth ? -1 : a.startMonth > b.startMonth ? 1 : byName(a, b); });
    idx.items.sort(byName);
    return idx;
  }

  /** Amount of an income/cost/subscription item in a month, or null when it does not apply. */
  function itemAmount(idx, item, month) {
    if (month < item.startMonth) return null;
    var vals = idx.vals[item.id] || [];
    if (!item.recurring) {
      if (month !== item.startMonth) return null;
      for (var i = 0; i < vals.length; i++) if (vals[i].month === month) return vals[i].amount;
      return null;
    }
    var cur = null;
    for (var j = 0; j < vals.length && vals[j].month <= month; j++) cur = vals[j];
    if (!cur || cur.stop) return null;
    var cyc = item.cycle || 1;
    if (cyc > 1 && monthDiff(item.startMonth, month) % cyc !== 0) return null;
    return cur.amount;
  }

  /** True when the item has its own value in exactly this month (not carried over). */
  function itemSetThisMonth(idx, item, month) {
    var vals = idx.vals[item.id] || [];
    for (var i = 0; i < vals.length; i++) if (vals[i].month === month) return true;
    return false;
  }

  function sumRange(list, from, to) { // months from..to inclusive
    var s = 0; if (!list) return 0;
    for (var i = 0; i < list.length; i++) { var m = list[i].month; if (m >= from && m <= to) s += list[i].amount; }
    return s;
  }
  function inMonth(list, month) { return sumRange(list, month, month); }

  /** Remaining balance of a debt at the end of a month: start + borrowed - paid from its start month up to month.
   *  Entries dated before the debt's start month are ignored. */
  function debtBalance(idx, debt, month) {
    if (month < debt.startMonth) return 0;
    return debt.start + sumRange(idx.borrows[debt.id], debt.startMonth, month) - sumRange(idx.pays[debt.id], debt.startMonth, month);
  }
  /** Balance carried into a month (end of the month before; the start amount in the start month). */
  function debtBalanceBefore(idx, debt, month) {
    if (month < debt.startMonth) return 0;
    if (month === debt.startMonth) return debt.start;
    return debtBalance(idx, debt, addMonths(month, -1));
  }
  function debtTotals(idx, debt) {
    return { borrowed: sumRange(idx.borrows[debt.id], debt.startMonth, '9999-12'), paid: sumRange(idx.pays[debt.id], debt.startMonth, '9999-12') };
  }
  function paymentIn(idx, debtId, month) { return inMonth(idx.pays[debtId], month); }
  function borrowsIn(idx, debtId, month) {
    var out = [], L = idx.borrows[debtId] || [];
    for (var i = 0; i < L.length; i++) if (L[i].month === month) out.push(L[i]);
    return out;
  }

  /** Everything the month screen shows. */
  function monthSummary(idx, month) {
    var s = { month: month, incomes: [], costs: [], subs: [], debts: [],
      totals: { income: 0, costs: 0, subs: 0, payments: 0, borrowedCash: 0, borrowed: 0 }, surplus: 0 };
    for (var i = 0; i < idx.items.length; i++) {
      var it = idx.items[i], a = itemAmount(idx, it, month);
      if (a === null) continue;
      var row = { item: it, amount: a, own: itemSetThisMonth(idx, it, month) };
      if (it.kind === 'income') { s.incomes.push(row); s.totals.income += a; }
      else if (it.kind === 'sub') { s.subs.push(row); s.totals.subs += a; }
      else { s.costs.push(row); s.totals.costs += a; }
    }
    for (var j = 0; j < idx.debts.length; j++) {
      var d = idx.debts[j];
      if (month < d.startMonth) continue;
      var before = debtBalanceBefore(idx, d, month), pay = paymentIn(idx, d.id, month), br = borrowsIn(idx, d.id, month);
      var bsum = 0, bcash = 0;
      for (var q = 0; q < br.length; q++) { bsum += br[q].amount; if (br[q].cash) bcash += br[q].amount; }
      var after = before + bsum - pay;
      if (before <= 0 && pay === 0 && bsum === 0) continue; // paid off earlier and nothing happens this month
      s.debts.push({ debt: d, before: before, payment: pay, borrowed: bsum, borrowedCash: bcash, after: after, borrows: br });
      s.totals.payments += pay; s.totals.borrowed += bsum; s.totals.borrowedCash += bcash;
    }
    s.surplus = s.totals.income + s.totals.borrowedCash - s.totals.costs - s.totals.subs - s.totals.payments;
    return s;
  }

  /** Global debt list as of the end of a month. */
  function debtOverview(idx, month) {
    var out = [], total = 0;
    for (var i = 0; i < idx.debts.length; i++) {
      var d = idx.debts[i], t = debtTotals(idx, d), rem = debtBalance(idx, d, month), all = d.start + t.borrowed - t.paid;
      out.push({ debt: d, remaining: month < d.startMonth ? all : rem, remainingAll: all, borrowed: t.borrowed, paid: t.paid,
        status: all <= 0 ? 'paid' : 'open' });
      total += Math.max(0, month < d.startMonth ? all : rem);
    }
    return { rows: out, total: total };
  }

  /** First and last month that have any data (or the current month). */
  function dataRange(idx, fallback) {
    var lo = null, hi = null, r, k, upd = function (m) { if (!m) return; if (lo === null || m < lo) lo = m; if (hi === null || m > hi) hi = m; };
    for (k = 0; k < idx.debts.length; k++) upd(idx.debts[k].startMonth);
    for (k = 0; k < idx.items.length; k++) upd(idx.items[k].startMonth);
    for (r in idx.pays) idx.pays[r].forEach(function (p) { upd(p.month); });
    for (r in idx.borrows) idx.borrows[r].forEach(function (p) { upd(p.month); });
    for (r in idx.vals) idx.vals[r].forEach(function (p) { upd(p.month); });
    return { from: lo || fallback, to: hi || fallback };
  }

  function monthsBetween(from, to) { var out = []; for (var m = from; m <= to && out.length < 600; m = addMonths(m, 1)) out.push(m); return out; }

  // ---------- sync merge (last writer wins per record) ----------
  function newer(a, b) { // true when record a wins over b
    if (!b) return true; if (!a) return false;
    if (a.ts !== b.ts) return a.ts > b.ts;
    var ad = a.dev || '', bd = b.dev || '';
    if (ad !== bd) return ad > bd;
    return JSON.stringify(a) > JSON.stringify(b); // fully deterministic tie-break
  }
  function sameRec(a, b) { return a.ts === b.ts && (a.dev || '') === (b.dev || '') && JSON.stringify(a) === JSON.stringify(b); }

  function validRecord(x) {
    return x && typeof x === 'object' && typeof x.id === 'string' && typeof x.type === 'string' && typeof x.ts === 'number';
  }

  /** Merges two documents. Returns {doc, localChanged, remoteChanged}: whether the merged result differs from
   *  local (UI must reload) and from remote (must be sent back). Inputs are not modified. */
  function mergeDocs(local, remote) {
    var out = emptyDoc(), lr = (local && local.records) || {}, rr = (remote && remote.records) || {};
    var localChanged = false, remoteChanged = false, k;
    for (k in lr) if (validRecord(lr[k])) out.records[k] = lr[k];
    for (k in rr) {
      var x = rr[k]; if (!validRecord(x) || x.id !== k) continue;
      var cur = out.records[k];
      if (!cur) { out.records[k] = x; localChanged = true; }
      else if (sameRec(cur, x)) continue;
      else if (newer(x, cur)) { out.records[k] = x; localChanged = true; }
      else remoteChanged = true;
    }
    for (k in out.records) if (!rr[k] || !validRecord(rr[k])) remoteChanged = true;
    return { doc: out, localChanged: localChanged, remoteChanged: remoteChanged };
  }

  /** Removes tombstones older than maxAgeMs (keeps files small; peers that were offline longer may revive them). */
  function compact(doc, nowMs, maxAgeMs) {
    var r = doc.records, n = 0;
    for (var k in r) if (r[k].del && nowMs - r[k].ts > maxAgeMs) { delete r[k]; n++; }
    return n;
  }

  var api = {
    parseMoney: parseMoney, formatMoney: formatMoney, formatInput: formatInput, groupThousands: groupThousands,
    monthKey: monthKey, isMonth: isMonth, addMonths: addMonths, monthDiff: monthDiff, currentMonth: currentMonth, monthLabel: monthLabel,
    MONTHS: MONTHS, COST_CATEGORIES: COST_CATEGORIES,
    emptyDoc: emptyDoc, parseDoc: parseDoc, randomId: randomId, Store: Store,
    buildIndex: buildIndex, itemAmount: itemAmount, itemSetThisMonth: itemSetThisMonth, debtBalance: debtBalance,
    debtBalanceBefore: debtBalanceBefore, debtTotals: debtTotals, paymentIn: paymentIn, borrowsIn: borrowsIn,
    monthSummary: monthSummary, debtOverview: debtOverview, dataRange: dataRange, monthsBetween: monthsBetween,
    mergeDocs: mergeDocs, compact: compact
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MCCore = api;
})(this);
