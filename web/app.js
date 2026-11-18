/* MYCASH UI (shared by Android and Windows). Plain DOM, re-rendered on every change. */
(function () {
  'use strict';
  var C = window.MCCore, N = window.MCN, VERSION = '0.0.1';
  var S = {
    store: null, idx: null, info: null, peers: [], view: 'month', month: C.currentMonth(),
    layout: 'mobile', syncing: {}, lastSyncMsg: '', modal: null
  };

  // ---------- helpers ----------
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function $(sel, el) { return (el || document).querySelector(sel); }
  function $$(sel, el) { return Array.prototype.slice.call((el || document).querySelectorAll(sel)); }
  function eur(c, o) { return C.formatMoney(c, o); }
  var ICONS = {
    calendar: '<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/>',
    wallet: '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
    chart: '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
    sync: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
    plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
    left: '<path d="m15 18-6-6 6-6"/>', right: '<path d="m9 18 6-6-6-6"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
    pencil: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/>',
    qr: '<rect width="5" height="5" x="3" y="3" rx="1"/><rect width="5" height="5" x="16" y="3" rx="1"/><rect width="5" height="5" x="3" y="16" rx="1"/><path d="M21 16h-3a2 2 0 0 0-2 2v3"/><path d="M21 21v.01"/><path d="M12 7v3a2 2 0 0 1-2 2H7"/><path d="M3 12h.01"/><path d="M12 3h.01"/><path d="M12 16v.01"/><path d="M16 12h1"/><path d="M21 12v.01"/><path d="M12 21v-1"/>',
    camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
    up: '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',
    down: '<polyline points="22 17 13.5 8.5 8.5 13.5 2 7"/><polyline points="16 17 22 17 22 11"/>',
    repeat: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
    phone: '<rect width="14" height="20" x="5" y="2" rx="2" ry="2"/><path d="M12 18h.01"/>',
    monitor: '<rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/>',
    alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    min: '<path d="M5 12h14"/>', max: '<rect width="16" height="16" x="4" y="4" rx="1"/>',
    wifi: '<path d="M12 20h.01"/><path d="M2 8.82a15 15 0 0 1 20 0"/><path d="M5 12.859a10 10 0 0 1 14 0"/><path d="M8.5 16.429a5 5 0 0 1 7 0"/>',
    receipt: '<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 17.5v-11"/>'
  };
  function ic(n, cls) { return '<svg class="i' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24">' + (ICONS[n] || '') + '</svg>'; }
  function appIcon(letters, cls) {
    var fs = letters.length > 2 ? 330 : 420;
    return '<svg class="' + (cls || 'appicon') + '" viewBox="0 0 1024 1024"><rect width="1024" height="1024" rx="224" fill="#121214"/>' +
      '<text x="512" y="560" text-anchor="middle" dominant-baseline="middle" font-family="system-ui, Segoe UI, Roboto, Arial, sans-serif" font-weight="700" font-size="' + fs + '" fill="#F2F3F5">' + esc(letters) + '</text>' +
      '<circle cx="820" cy="204" r="72" fill="#8be5f3"/></svg>';
  }
  function tagHTML() { return '<b>MYSUITE</b> · MYCASH v' + VERSION; }
  function toast(msg, bad) {
    var t = $('#toast'); if (t) t.remove();
    t = document.createElement('div'); t.id = 'toast'; if (bad) t.className = 'bad'; t.textContent = msg;
    document.body.appendChild(t); setTimeout(function () { if (t.parentNode) t.remove(); }, 3200);
  }
  function confirmBox(text, yes, cb) {
    openModal('<h3>' + esc(text) + '</h3><div class="acts"><span class="grow"></span><button class="btn" data-a="close">Cancel</button><button class="btn primary danger-b" id="cy">' + esc(yes) + '</button></div>');
    $('#cy').onclick = function () { closeModal(); cb(); };
  }

  // ---------- data ----------
  function reindex() { S.idx = C.buildIndex(S.store.doc); }
  var saveTimer = null;
  function commit() { // after every change: recompute, re-render, save
    reindex(); render();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 150);
  }
  function saveNow() { clearTimeout(saveTimer); saveTimer = null; return N.call('save', [JSON.stringify(S.store.doc)]).then(function (r) { if (!r || !r.ok) toast('Could not save: ' + ((r && r.error) || '?'), true); }); }
  function reloadFromNative() { // a paired device replaced our file: merge it in (never drop local edits)
    return N.call('load').then(function (t) {
      var d = C.parseDoc(t); if (!d) return;
      var m = C.mergeDocs(S.store.doc, d);
      if (m.localChanged) { S.store = new C.Store(m.doc, S.info.deviceId); reindex(); render(); }
      if (m.remoteChanged) saveNow();
    });
  }

  // ---------- layout ----------
  var TABS = [['month', 'Month', 'calendar'], ['debts', 'Debts', 'wallet'], ['overview', 'Overview', 'chart'], ['sync', 'Sync', 'sync']];
  function render() {
    var app = $('#app'), sc = $('#main') ? $('#main').scrollTop : 0, focusId = document.activeElement && document.activeElement.id;
    document.body.className = S.layout;
    var body = S.view === 'month' ? viewMonth() : S.view === 'debts' ? viewDebts() : S.view === 'overview' ? viewOverview() : viewSync();
    var html = '';
    if (S.layout === 'desktop') {
      html += '<div class="topbar" id="tb"><div class="brand">' + appIcon('C$', 'logo') + 'MYCASH</div><div class="tabs">';
      TABS.forEach(function (t) { html += '<button class="tab' + (S.view === t[0] ? ' on' : '') + '" data-tab="' + t[0] + '">' + ic(t[2]) + t[1] + '</button>'; });
      html += '</div><div class="drag" id="drag"></div>';
      if (N.platform === 'windows') html += '<div class="winbtns"><button data-win="min" title="Minimize">' + ic('min') + '</button><button data-win="max" title="Maximize">' + ic('max') + '</button><button class="close" data-win="close" title="Close">' + ic('x') + '</button></div>';
      html += '</div><div id="main"><div class="page">' + body + '</div></div>';
      html += '<div class="footer"><button class="tag" data-a="suite">' + tagHTML() + '</button><span class="grow"></span><span>' + esc(syncFooter()) + '</span></div>';
      if (N.platform === 'windows') ['n', 's', 'w', 'e', 'nw', 'ne', 'sw', 'se'].forEach(function (e) { html += '<div class="edge ' + e + '" data-edge="' + e + '"></div>'; });
    } else {
      html += '<div id="main"><div class="page">' + body + '</div></div>';
      html += '<div class="bottomnav">';
      TABS.forEach(function (t) { html += '<button class="' + (S.view === t[0] ? 'on' : '') + '" data-tab="' + t[0] + '">' + ic(t[2]) + t[1] + '</button>'; });
      html += '</div><div class="tagrow"><button class="tag" data-a="suite">' + tagHTML() + '</button></div>';
    }
    app.innerHTML = html;
    $('#main').scrollTop = sc;
    if (focusId && document.getElementById(focusId)) { var el = document.getElementById(focusId); el.focus(); }
    bindPage();
  }
  function syncFooter() {
    if (!S.info) return '';
    var n = S.peers.length;
    if (!S.info.listening) return 'Sync off: ' + (S.info.listenError || 'port in use');
    return n ? n + (n === 1 ? ' paired device' : ' paired devices') + (S.lastSyncMsg ? ' · ' + S.lastSyncMsg : '') : 'No paired devices';
  }
  function monthSwitcher() {
    var cur = C.currentMonth();
    return '<div class="monthsw"><button class="btn ghost icon" data-a="mprev" title="Previous month">' + ic('left') + '</button>' +
      '<span class="lbl">' + esc(C.monthLabel(S.month)) + '</span>' +
      '<button class="btn ghost icon" data-a="mnext" title="Next month">' + ic('right') + '</button>' +
      (S.month !== cur ? '<button class="btn small" data-a="mtoday">Today</button>' : '') + '</div>';
  }

  // ---------- month view ----------
  function viewMonth() {
    var s = C.monthSummary(S.idx, S.month), t = s.totals, neg = s.surplus < 0;
    var sum = '<div class="card bar ' + (neg ? 'bad' : 'good') + '"><h2>' + (neg ? ic('alert') + 'Shortfall' : ic('check') + 'Surplus') + '</h2>' +
      '<div class="big num ' + (neg ? 'bad-t' : 'good-t') + '" id="surplus">' + eur(s.surplus) + '</div>' +
      '<div class="muted small">' + (neg ? 'Your planned spending is higher than your income this month.' : 'Left over after income, costs and debt payments.') + '</div>' +
      '<div class="sumrows" style="margin-top:12px">' +
      sumRow('Income', t.income, '+') + (t.borrowedCash ? sumRow('Borrowed cash', t.borrowedCash, '+') : '') +
      sumRow('Living costs', t.costs, '-') + sumRow('Subscriptions', t.subs, '-') + sumRow('Debt payments', t.payments, '-') +
      '<div class="row total"><span class="name">' + (neg ? 'Shortfall' : 'Surplus') + '</span><span class="num ' + (neg ? 'bad-t' : 'good-t') + '">' + eur(s.surplus) + '</span></div></div></div>';
    // debts
    var d = '<div class="card"><h2>' + ic('wallet') + 'Debt payments<span class="sum num">' + eur(t.payments) + '</span></h2>';
    if (!s.debts.length) d += '<div class="empty">' + ic('wallet') + (S.idx.debts.length ? 'No open debts in ' + esc(C.monthLabel(S.month)) + '.' : 'No debts yet.') + '<div class="btns" style="justify-content:center"><button class="btn" data-a="adddebt">' + ic('plus') + 'Add debt</button></div></div>';
    s.debts.forEach(function (x) {
      var over = x.payment > x.before + x.borrowed;
      d += '<div class="drow"><div class="top"><span class="name">' + esc(x.debt.name) + '</span>' +
        '<input class="amt" id="pay-' + esc(x.debt.id) + '" data-pay="' + esc(x.debt.id) + '" inputmode="decimal" placeholder="0,00" value="' + esc(C.formatInput(x.payment, true)) + '" aria-label="Payment to ' + esc(x.debt.name) + '"></div>' +
        '<div class="meta"><span>Owed at start <b class="num">' + eur(x.before) + '</b></span>' +
        (x.borrowed ? '<span class="warn-t">Borrowed <b class="num warn-t">+' + eur(x.borrowed) + '</b></span>' : '') +
        '<span>Left after <b class="num ' + (x.after <= 0 ? 'good-t' : '') + '">' + eur(x.after) + '</b></span>' +
        (over ? '<span class="warn-t">' + ic('alert') + ' more than owed</span>' : '') + '</div>' +
        '<div class="btns" style="margin-top:6px"><button class="btn ghost small" data-borrow="' + esc(x.debt.id) + '">' + ic('up') + 'Borrowed more</button>' +
        (x.borrows.length ? '<button class="btn ghost small" data-debt="' + esc(x.debt.id) + '">' + x.borrows.length + ' borrowing' + (x.borrows.length > 1 ? 's' : '') + ' this month</button>' : '') + '</div></div>';
    });
    if (s.debts.length) d += '<button class="btn add" data-a="adddebt">' + ic('plus') + 'Add debt</button>';
    d += '</div>';
    var inc = itemCard('income', 'Income', 'up', s.incomes, t.income, 'Add income');
    var cost = costCard(s.costs, t.costs);
    var subs = itemCard('sub', 'Subscriptions', 'repeat', s.subs, t.subs, 'Add subscription');
    var head = S.layout === 'desktop' ? '<div class="pagehead"><h1>Month plan</h1>' + monthSwitcher() + '</div>' : '<div class="pagehead">' + monthSwitcher() + '</div>';
    if (S.layout === 'desktop') return head + '<div class="grid two"><div class="col">' + sum + d + '</div><div class="col">' + inc + cost + subs + '</div></div>';
    return head + '<div class="grid">' + sum + d + inc + cost + subs + '</div>';
  }
  function sumRow(label, v, sign) {
    return '<div class="row"><span class="name muted">' + esc(label) + '</span><span class="num">' + (v ? sign + ' ' : '') + eur(v) + '</span></div>';
  }
  function itemLine(r) {
    var it = r.item, carried = it.recurring && !r.own;
    var sub = it.kind === 'sub' ? (it.cycle === 12 ? 'yearly' : it.cycle === 3 ? 'every 3 months' : it.cycle === 6 ? 'every 6 months' : 'monthly') : (it.recurring ? 'every month' : 'only this month');
    if (carried) sub += ' · carried over';
    return '<div class="row click" data-item="' + esc(it.id) + '"><span class="name">' + esc(it.name) + '<span class="sub">' + (it.recurring ? ic('repeat', 'tiny') + ' ' : '') + esc(sub) + '</span></span><span class="num">' + eur(r.amount) + '</span></div>';
  }
  function itemCard(kind, title, icon, rows, total, addLabel) {
    var h = '<div class="card"><h2>' + ic(icon) + esc(title) + '<span class="sum num">' + eur(total) + '</span></h2>';
    if (!rows.length) h += '<div class="muted small" style="padding:4px 0 2px">Nothing in ' + esc(C.monthLabel(S.month)) + '.</div>';
    rows.forEach(function (r) { h += itemLine(r); });
    return h + '<button class="btn add" data-additem="' + kind + '">' + ic('plus') + esc(addLabel) + '</button></div>';
  }
  function costCard(rows, total) {
    var h = '<div class="card"><h2>' + ic('receipt') + 'Living costs<span class="sum num">' + eur(total) + '</span></h2>';
    if (!rows.length) h += '<div class="muted small" style="padding:4px 0 2px">Nothing in ' + esc(C.monthLabel(S.month)) + '.</div>';
    var groups = {}, order = [];
    rows.forEach(function (r) { var c = r.item.cat || 'Other'; if (!groups[c]) { groups[c] = []; order.push(c); } groups[c].push(r); });
    order.sort(function (a, b) { var x = C.COST_CATEGORIES.indexOf(a), y = C.COST_CATEGORIES.indexOf(b); if (x < 0) x = 99; if (y < 0) y = 99; return x - y || (a < b ? -1 : 1); });
    order.forEach(function (c) {
      var st = 0; groups[c].forEach(function (r) { st += r.amount; });
      h += '<div class="catlabel"><span>' + esc(c) + '</span><span class="num">' + eur(st) + '</span></div>';
      groups[c].forEach(function (r) { h += itemLine(r); });
    });
    return h + '<button class="btn add" data-additem="cost">' + ic('plus') + 'Add cost</button></div>';
  }

  // ---------- debts view ----------
  function viewDebts() {
    var cur = C.currentMonth(), ov = C.debtOverview(S.idx, cur);
    var h = '<div class="pagehead"><h1>Debts</h1><button class="btn primary" data-a="adddebt">' + ic('plus') + 'Add debt</button></div>';
    var open = ov.rows.filter(function (r) { return r.status === 'open'; }).length;
    h += '<div class="card bar"><h2>' + ic('wallet') + 'Total owed</h2><div class="big num">' + eur(ov.total) + '</div><div class="muted small">' + open + ' open of ' + ov.rows.length + ' · end of ' + esc(C.monthLabel(cur)) + ' (includes payments planned up to then)</div></div>';
    if (!ov.rows.length) return h + '<div class="card" style="margin-top:12px"><div class="empty">' + ic('wallet') + 'Add every debt once with its name and the amount you owe now. Payments you plan in a month lower it, borrowing more raises it.</div></div>';
    h += '<div class="grid' + (S.layout === 'desktop' ? ' two' : '') + '" style="margin-top:12px">';
    ov.rows.forEach(function (r) {
      var base = r.debt.start + r.borrowed, pct = base > 0 ? Math.max(0, Math.min(100, Math.round(100 * (base - r.remainingAll) / base))) : 100;
      h += '<div class="card click" data-debt="' + esc(r.debt.id) + '" style="cursor:pointer"><div class="drow" style="padding:0"><div class="top"><span class="name" style="font-size:16px">' + esc(r.debt.name) + '</span>' +
        (r.status === 'paid' ? '<span class="chip good-t">' + ic('check') + ' Paid off</span>' : '') + '</div>' +
        '<div class="big num" style="font-size:24px;margin-top:6px">' + eur(r.remaining) + '</div>' +
        '<div class="progress"><div style="width:' + pct + '%"></div></div>' +
        '<div class="meta"><span>Start ' + esc(C.monthLabel(r.debt.startMonth, true)) + ' <b class="num">' + eur(r.debt.start) + '</b></span>' +
        (r.borrowed ? '<span>Borrowed <b class="num">+' + eur(r.borrowed) + '</b></span>' : '') +
        '<span>Paid <b class="num">' + eur(r.paid) + '</b></span>' +
        (r.remainingAll !== r.remaining ? '<span>After all planned <b class="num">' + eur(r.remainingAll) + '</b></span>' : '') + '</div></div></div>';
    });
    return h + '</div>';
  }

  // ---------- overview ----------
  function overviewRange() {
    var cur = C.currentMonth(), rg = C.dataRange(S.idx, cur);
    var from = rg.from < C.addMonths(cur, -24) ? C.addMonths(cur, -24) : rg.from;
    var to = rg.to > C.addMonths(cur, 5) ? rg.to : C.addMonths(cur, 5);
    if (to > C.addMonths(cur, 60)) to = C.addMonths(cur, 60);
    if (from > cur) from = cur;
    return C.monthsBetween(from, to);
  }
  function viewOverview() {
    var cur = C.currentMonth(), months = overviewRange(), ov = C.debtOverview(S.idx, cur);
    var h = '<div class="pagehead"><h1>Overview</h1></div>';
    // global debts
    var g = '<div class="card"><h2>' + ic('wallet') + 'All debts<span class="sum num">' + eur(ov.total) + '</span></h2>';
    if (!ov.rows.length) g += '<div class="muted small">No debts yet.</div>';
    var maxv = 1; ov.rows.forEach(function (r) { maxv = Math.max(maxv, r.debt.start + r.borrowed); });
    ov.rows.forEach(function (r) {
      g += '<div class="row click" data-debt="' + esc(r.debt.id) + '"><span class="name">' + esc(r.debt.name) + '<span class="sub">' + (r.status === 'paid' ? 'paid off' : 'after all planned: ' + eur(r.remainingAll)) + '</span>' +
        '<div class="progress"><div style="width:' + Math.round(100 * Math.max(0, r.remaining) / maxv) + '%;background:var(--ms-accent)"></div></div></span><span class="num">' + eur(r.remaining) + '</span></div>';
    });
    g += '</div>';
    // month by month
    var rows = months.map(function (m) { return C.monthSummary(S.idx, m); });
    var debtsSeen = S.idx.debts;
    var t = '<div class="card"><h2>' + ic('chart') + 'Month by month</h2>';
    if (S.layout === 'desktop') {
      t += '<div class="scrollx"><table class="t"><tr><th>Month</th><th>Income</th><th>Living costs</th><th>Subscriptions</th><th>Debt payments</th><th>Surplus</th><th>Still owed</th></tr>';
      rows.forEach(function (s) {
        var owed = 0; S.idx.debts.forEach(function (d) { if (s.month >= d.startMonth) owed += Math.max(0, C.debtBalance(S.idx, d, s.month)); else owed += 0; });
        t += '<tr class="click' + (s.month === cur ? ' cur' : '') + '" data-month="' + s.month + '"><td>' + esc(C.monthLabel(s.month, true)) + '</td><td>' + eur(s.totals.income + s.totals.borrowedCash) + '</td><td>' + eur(s.totals.costs) + '</td><td>' + eur(s.totals.subs) + '</td><td>' + eur(s.totals.payments) + '</td>' +
          '<td class="' + (s.surplus < 0 ? 'bad-t' : 'good-t') + '">' + eur(s.surplus) + '</td><td>' + eur(owed) + '</td></tr>';
      });
      t += '</table></div>';
      if (debtsSeen.length) {
        t += '<h2 style="margin-top:20px">' + ic('down') + 'Payments per debt</h2><div class="scrollx"><table class="t"><tr><th>Month</th>';
        debtsSeen.forEach(function (d) { t += '<th>' + esc(d.name) + '</th>'; });
        t += '</tr>';
        rows.forEach(function (s) {
          t += '<tr class="click' + (s.month === cur ? ' cur' : '') + '" data-month="' + s.month + '"><td>' + esc(C.monthLabel(s.month, true)) + '</td>';
          debtsSeen.forEach(function (d) {
            var x = null; s.debts.forEach(function (y) { if (y.debt.id === d.id) x = y; });
            t += '<td>' + (x ? (x.payment ? '<span>-' + eur(x.payment) + '</span>' : '<span class="muted">0,00 €</span>') + (x.borrowed ? '<br><span class="warn-t small">+' + eur(x.borrowed) + '</span>' : '') + '<br><span class="muted small">left ' + eur(x.after) + '</span>' : '<span class="muted">–</span>') + '</td>';
          });
          t += '</tr>';
        });
        t += '</table></div>';
      }
    } else {
      rows.forEach(function (s) {
        var neg = s.surplus < 0;
        t += '<div class="row click" data-month="' + s.month + '" style="display:block' + (s.month === cur ? ';background:rgba(88,101,242,.10);border-radius:6px;padding-left:6px;padding-right:6px' : '') + '"><div style="display:flex;gap:8px"><b style="flex:1">' + esc(C.monthLabel(s.month)) + '</b><span class="num ' + (neg ? 'bad-t' : 'good-t') + '">' + eur(s.surplus) + '</span></div>' +
          '<div class="muted small" style="margin-top:4px">In ' + eur(s.totals.income + s.totals.borrowedCash) + ' · Costs ' + eur(s.totals.costs + s.totals.subs) + ' · Paid ' + eur(s.totals.payments) + '</div>';
        s.debts.forEach(function (x) {
          if (!x.payment && !x.borrowed) return;
          t += '<div class="small" style="display:flex;gap:8px;margin-top:3px"><span style="flex:1" class="muted">' + esc(x.debt.name) + '</span>' + (x.payment ? '<span class="num">-' + eur(x.payment) + '</span>' : '') + (x.borrowed ? '<span class="num warn-t">+' + eur(x.borrowed) + '</span>' : '') + '<span class="num muted">left ' + eur(x.after) + '</span></div>';
        });
        t += '</div>';
      });
    }
    t += '</div>';
    return h + '<div class="grid">' + g + t + '</div>';
  }

  // ---------- sync view ----------
  function viewSync() {
    var i = S.info || {}, h = '<div class="pagehead"><h1>Sync</h1></div>';
    var dev = '<div class="card bar' + (i.listening ? '' : ' warn') + '"><h2>' + ic(N.platform === 'android' ? 'phone' : 'monitor') + 'This device</h2>' +
      '<div class="row click" data-a="rename"><span class="name"><b>' + esc(i.name || '') + '</b><span class="sub">Name shown on your other devices · tap to change</span></span>' + ic('pencil') + '</div>' +
      '<div class="row"><span class="name">' + (i.listening ? 'Ready on your local network' : 'Sync is off: ' + esc(i.listenError || 'could not open port')) + '<span class="sub">' + esc((i.ips && i.ips.length ? i.ips.join(', ') : 'no network address') + ' · port ' + (i.port || '')) + '</span></span>' + ic('wifi') + '</div>' +
      '<div class="muted small" style="margin-top:8px">Devices talk to each other directly in your home network. No internet, no cloud. Keep MYCASH open on both devices while syncing.</div></div>';
    var pair = '<div class="card"><h2>' + ic('qr') + 'Pair a device</h2><div class="muted small">On one device show the code, on the other scan it. Then type the 6-digit code that appears.</div><div class="btns">' +
      '<button class="btn primary" data-a="pairshow">' + ic('qr') + 'Show pairing code</button>' +
      (N.canScan ? '<button class="btn" data-a="pairscan">' + ic('camera') + 'Scan code</button>' : '') +
      '<button class="btn" data-a="pairtext">' + ic('link') + 'Enter pairing text</button></div></div>';
    var list = '<div class="card"><h2>' + ic('sync') + 'Paired devices' + (S.peers.length ? '<span class="sum"><button class="btn small" data-a="syncall">' + ic('sync') + 'Sync all</button></span>' : '') + '</h2>';
    if (!S.peers.length) list += '<div class="muted small">No paired devices yet.</div>';
    S.peers.forEach(function (p) {
      var busy = S.syncing[p.id];
      list += '<div class="row"><span style="color:var(--ms-muted)">' + ic(p.kind === 'android' ? 'phone' : 'monitor') + '</span><span class="name"><b>' + esc(p.name) + '</b><span class="sub">' + esc(p.addr + ':' + p.port) + ' · ' + (p.lastSync ? 'synced ' + esc(ago(p.lastSync)) : 'never synced') + '</span></span>' +
        '<button class="btn small" data-sync="' + esc(p.id) + '"' + (busy ? ' disabled' : '') + '>' + ic('sync') + (busy ? 'Syncing…' : 'Sync now') + '</button>' +
        '<button class="btn ghost small icon" data-unpair="' + esc(p.id) + '" title="Remove">' + ic('trash') + '</button></div>';
    });
    list += '</div>';
    var how = '<div class="card"><h2>' + ic('check') + 'How merging works</h2><div class="muted small">Every debt, payment, income and cost is kept as its own entry with the time of its last change. When two devices sync, each entry keeps the newest version, so edits on different devices never overwrite each other unless both changed the same entry; then the later change wins. Deleted entries stay deleted on all devices.</div></div>';
    if (S.layout === 'desktop') return h + '<div class="grid two"><div class="col">' + dev + pair + '</div><div class="col">' + list + how + '</div></div>';
    return h + '<div class="grid">' + dev + pair + list + how + '</div>';
  }
  function ago(ms) {
    var d = Math.round((Date.now() - ms) / 1000);
    if (d < 60) return 'just now'; if (d < 3600) return Math.floor(d / 60) + ' min ago'; if (d < 86400) return Math.floor(d / 3600) + ' h ago';
    var t = new Date(ms); return t.getDate() + '.' + (t.getMonth() + 1) + '.' + t.getFullYear();
  }

  // ---------- events ----------
  function bindPage() {
    $$('[data-tab]').forEach(function (b) { b.onclick = function () { S.view = b.getAttribute('data-tab'); if (S.view === 'sync') refreshSync(); render(); $('#main').scrollTop = 0; }; });
    $$('[data-a]').forEach(function (b) { b.onclick = function (e) { action(b.getAttribute('data-a'), e); }; });
    $$('[data-win]').forEach(function (b) { b.onclick = function () { N.win(b.getAttribute('data-win')); }; });
    $$('[data-edge]').forEach(function (b) { b.onmousedown = function (e) { e.preventDefault(); N.win('resize', { n: 12, s: 15, w: 10, e: 11, nw: 13, ne: 14, sw: 16, se: 17 }[b.getAttribute('data-edge')]); }; });
    var dr = $('#drag') || null;
    if (dr && N.platform === 'windows') {
      dr.onmousedown = function (e) { if (e.button === 0) N.win('drag'); };
      dr.ondblclick = function () { N.win('max'); };
      var br = $('.brand'); if (br) { br.onmousedown = dr.onmousedown; br.ondblclick = dr.ondblclick; }
    }
    $$('[data-pay]').forEach(function (inp) {
      var id = inp.getAttribute('data-pay');
      var apply = function () {
        var r = C.parseMoney(inp.value);
        if (!r.ok) { inp.classList.add('err'); toast(r.error + ' – use e.g. 1.234,56', true); return; }
        inp.classList.remove('err');
        if (r.cents !== C.paymentIn(S.idx, id, S.month)) { S.store.setPayment(id, S.month, r.cents); commit(); }
        else inp.value = C.formatInput(r.cents, true);
      };
      inp.onchange = apply;
      inp.onkeydown = function (e) { if (e.key === 'Enter') { inp.blur(); } };
      inp.onfocus = function () { setTimeout(function () { try { inp.select(); } catch (e) {} }, 0); };
    });
    $$('[data-item]').forEach(function (r) { r.onclick = function () { editItem(S.idx.itemById[r.getAttribute('data-item')]); }; });
    $$('[data-additem]').forEach(function (b) { b.onclick = function () { editItem(null, b.getAttribute('data-additem')); }; });
    $$('[data-borrow]').forEach(function (b) { b.onclick = function () { borrowDialog(S.idx.debtById[b.getAttribute('data-borrow')]); }; });
    $$('[data-debt]').forEach(function (b) { b.onclick = function () { debtDialog(S.idx.debtById[b.getAttribute('data-debt')]); }; });
    $$('[data-month]').forEach(function (b) { b.onclick = function () { S.month = b.getAttribute('data-month'); S.view = 'month'; render(); $('#main').scrollTop = 0; }; });
    $$('[data-sync]').forEach(function (b) { b.onclick = function () { syncPeer(b.getAttribute('data-sync'), true); }; });
    $$('[data-unpair]').forEach(function (b) {
      b.onclick = function () {
        var id = b.getAttribute('data-unpair'), p = S.peers.filter(function (x) { return x.id === id; })[0];
        confirmBox('Remove ' + (p ? p.name : 'device') + '? Remove MYCASH’s pairing on the other device too.', 'Remove', function () {
          N.call('removePeer', [id]).then(function (l) { S.peers = l || []; render(); });
        });
      };
    });
  }
  function action(a) {
    if (a === 'mprev') { S.month = C.addMonths(S.month, -1); render(); }
    else if (a === 'mnext') { S.month = C.addMonths(S.month, 1); render(); }
    else if (a === 'mtoday') { S.month = C.currentMonth(); render(); }
    else if (a === 'adddebt') debtDialog(null);
    else if (a === 'suite') suiteDialog();
    else if (a === 'close') closeModal();
    else if (a === 'rename') renameDialog();
    else if (a === 'pairshow') pairShow();
    else if (a === 'pairscan') pairScan();
    else if (a === 'pairtext') pairTextDialog();
    else if (a === 'syncall') syncAll(true);
  }

  // ---------- dialogs ----------
  function openModal(html, onClose) {
    closeModal();
    var m = document.createElement('div'); m.id = 'modal';
    m.innerHTML = '<div class="dlg" role="dialog">' + html + '</div>';
    m.onclick = function (e) { if (e.target === m) closeModal(); };
    document.body.appendChild(m);
    S.modal = { onClose: onClose };
    $$('[data-a="close"]', m).forEach(function (b) { b.onclick = closeModal; });
    var f = $('input.txt, input.amt', m); if (f && S.layout === 'desktop') f.focus();
    return m;
  }
  function closeModal() {
    var m = $('#modal'); if (m) m.remove();
    if (S.modal && S.modal.onClose) { var f = S.modal.onClose; S.modal = null; f(); } else S.modal = null;
  }
  function amountField(id, cents, label) {
    return '<label class="f" for="' + id + '">' + esc(label || 'Amount') + '</label><input class="amt txt" style="width:100%;text-align:left" id="' + id + '" inputmode="decimal" placeholder="0,00" value="' + esc(cents ? C.formatInput(cents) : '') + '">';
  }
  function readAmount(id, allowEmpty) {
    var el = $('#' + id), r = C.parseMoney(el.value);
    if (!r.ok || (r.empty && !allowEmpty)) { el.classList.add('err'); toast(r.ok ? 'Enter an amount' : r.error + ' – use e.g. 1.234,56', true); el.focus(); return null; }
    return r.cents;
  }
  function readName(id) {
    var el = $('#' + id), v = el.value.trim();
    if (!v) { el.classList.add('err'); toast('Enter a name', true); el.focus(); return null; }
    return v.slice(0, 80);
  }
  function monthSelect(id, value) {
    var h = '<select class="txt" id="' + id + '">', from = C.addMonths(C.currentMonth(), -36), to = C.addMonths(C.currentMonth(), 24);
    if (value < from) from = value; if (value > to) to = value;
    C.monthsBetween(from, to).forEach(function (m) { h += '<option value="' + m + '"' + (m === value ? ' selected' : '') + '>' + esc(C.monthLabel(m)) + '</option>'; });
    return h + '</select>';
  }

  function editItem(it, kind) {
    kind = it ? it.kind : kind;
    var isNew = !it, title = { income: 'income', cost: 'living cost', sub: 'subscription' }[kind];
    var cur = it ? C.itemAmount(S.idx, it, S.month) : null;
    var h = '<h3>' + (isNew ? 'Add ' : 'Edit ') + title + '<button class="btn ghost icon x" data-a="close">' + ic('x') + '</button></h3>' +
      '<div class="muted small">' + esc(C.monthLabel(S.month)) + '</div>' +
      '<label class="f" for="f-name">Name</label><input class="txt" id="f-name" maxlength="80" value="' + esc(it ? it.name : '') + '" placeholder="' + (kind === 'income' ? 'Salary' : kind === 'sub' ? 'Streaming' : 'Rent') + '">' +
      amountField('f-amt', cur || 0, kind === 'sub' ? 'Amount per charge' : 'Amount');
    if (kind === 'cost') {
      h += '<label class="f">Category</label><div class="seg" id="f-cat">';
      var cat = it ? it.cat : 'Rent';
      C.COST_CATEGORIES.forEach(function (c) { h += '<button type="button" data-v="' + esc(c) + '" class="' + (c === cat ? 'on' : '') + '">' + esc(c) + '</button>'; });
      h += '</div>';
    }
    if (kind === 'sub') {
      var cy = it ? it.cycle : 1;
      h += '<label class="f">Charged</label><div class="seg" id="f-cyc">' + [[1, 'Monthly'], [3, 'Every 3 months'], [6, 'Every 6 months'], [12, 'Yearly']].map(function (x) { return '<button type="button" data-v="' + x[0] + '" class="' + (x[0] === cy ? 'on' : '') + '">' + x[1] + '</button>'; }).join('') + '</div>';
    } else {
      var rec = it ? it.recurring : (kind === 'income' ? true : true);
      h += '<label class="chk"><input type="checkbox" id="f-rec"' + (rec ? ' checked' : '') + (it ? ' disabled' : '') + '>' + (kind === 'income' ? 'Regular income – carries over to the next months' : 'Fixed cost – carries over to the next months') + '</label>';
    }
    if (it && it.recurring) h += '<div class="muted small" style="margin-top:8px">A new amount applies from ' + esc(C.monthLabel(S.month)) + ' on; earlier months keep theirs.</div>';
    h += '<div class="acts">';
    if (it) {
      if (it.recurring && S.month > it.startMonth) h += '<button class="btn danger" id="f-stop">Stop from ' + esc(C.monthLabel(S.month, true)) + '</button>';
      h += '<button class="btn danger" id="f-del">' + ic('trash') + 'Delete</button>';
    }
    h += '<span class="grow"></span><button class="btn" data-a="close">Cancel</button><button class="btn primary" id="f-ok">' + (isNew ? 'Add' : 'Save') + '</button></div>';
    var m = openModal(h);
    $$('.seg', m).forEach(function (sg) { $$('button', sg).forEach(function (b) { b.onclick = function () { $$('button', sg).forEach(function (x) { x.classList.remove('on'); }); b.classList.add('on'); }; }); });
    var segVal = function (id) { var b = $('#' + id + ' button.on'); return b ? b.getAttribute('data-v') : ''; };
    $('#f-ok').onclick = function () {
      var name = readName('f-name'); if (name === null) return;
      var cents = readAmount('f-amt'); if (cents === null) return;
      if (isNew) {
        var rec2 = kind === 'sub' ? true : $('#f-rec').checked;
        S.store.addItem(kind, name, kind === 'cost' ? segVal('f-cat') : '', rec2, S.month, cents, kind === 'sub' ? parseInt(segVal('f-cyc'), 10) : 1);
      } else {
        var patch = {};
        if (name !== it.name) patch.name = name;
        if (kind === 'cost' && segVal('f-cat') !== it.cat) patch.cat = segVal('f-cat');
        if (kind === 'sub' && parseInt(segVal('f-cyc'), 10) !== it.cycle) patch.cycle = parseInt(segVal('f-cyc'), 10);
        if (Object.keys(patch).length) S.store.patch(it.id, patch);
        if (cents !== cur) S.store.setItemAmount(it.id, it.recurring ? (S.month < it.startMonth ? it.startMonth : S.month) : it.startMonth, cents);
      }
      closeModal(); commit();
    };
    if ($('#f-stop')) $('#f-stop').onclick = function () { S.store.stopItem(it.id, S.month); closeModal(); commit(); toast(it.name + ' ends from ' + C.monthLabel(S.month)); };
    if ($('#f-del')) $('#f-del').onclick = function () { confirmBox('Delete ' + it.name + ' in all months?', 'Delete', function () { S.store.removeItem(it.id); commit(); }); };
    enterSubmits(m, '#f-ok');
  }
  function enterSubmits(m, sel) { $$('input', m).forEach(function (i) { i.onkeydown = function (e) { if (e.key === 'Enter') $(sel).click(); }; }); }

  function debtDialog(d) {
    var isNew = !d, h;
    if (isNew) {
      h = '<h3>Add debt<button class="btn ghost icon x" data-a="close">' + ic('x') + '</button></h3>' +
        '<label class="f" for="d-name">Name</label><input class="txt" id="d-name" maxlength="80" placeholder="Bank loan, Max, credit card…">' +
        amountField('d-amt', 0, 'Amount owed now') +
        '<label class="f" for="d-month">From month</label>' + monthSelect('d-month', S.month) +
        '<div class="acts"><span class="grow"></span><button class="btn" data-a="close">Cancel</button><button class="btn primary" id="d-ok">Add</button></div>';
      var m = openModal(h);
      $('#d-ok').onclick = function () {
        var name = readName('d-name'); if (name === null) return;
        var c = readAmount('d-amt'); if (c === null) return;
        S.store.addDebt(name, c, $('#d-month').value); closeModal(); commit(); toast(name + ' added');
      };
      enterSubmits(m, '#d-ok');
      return;
    }
    var t = C.debtTotals(S.idx, d), hist = [];
    (S.idx.pays[d.id] || []).forEach(function (p) { if (p.month >= d.startMonth) hist.push({ m: p.month, kind: 'pay', amount: p.amount }); });
    (S.idx.borrows[d.id] || []).forEach(function (b) { if (b.month >= d.startMonth) hist.push({ m: b.month, kind: 'borrow', amount: b.amount, rec: b }); });
    hist.sort(function (a, b) { return a.m < b.m ? -1 : a.m > b.m ? 1 : 0; });
    h = '<h3>' + esc(d.name) + '<button class="btn ghost icon x" data-a="close">' + ic('x') + '</button></h3>' +
      '<div class="muted small">Owed now (end of ' + esc(C.monthLabel(C.currentMonth())) + '): <b class="num" style="color:var(--ms-text)">' + eur(C.debtBalance(S.idx, d, C.currentMonth() < d.startMonth ? d.startMonth : C.currentMonth())) + '</b></div>' +
      '<label class="f" for="d-name">Name</label><input class="txt" id="d-name" maxlength="80" value="' + esc(d.name) + '">' +
      amountField('d-amt', d.start, 'Start amount') +
      '<label class="f" for="d-month">Start month</label>' + monthSelect('d-month', d.startMonth) +
      '<label class="f">History</label><div class="sumrows">' +
      '<div class="row"><span class="name muted">' + esc(C.monthLabel(d.startMonth, true)) + ' · start</span><span class="num">' + eur(d.start) + '</span></div>';
    hist.forEach(function (x) {
      h += '<div class="row"><span class="name muted">' + esc(C.monthLabel(x.m, true)) + ' · ' + (x.kind === 'pay' ? 'paid' : 'borrowed' + (x.rec.note ? ' (' + esc(x.rec.note) + ')' : '')) + '</span>' +
        '<span class="num ' + (x.kind === 'pay' ? 'good-t' : 'warn-t') + '">' + (x.kind === 'pay' ? '-' : '+') + eur(x.amount) + '</span>' +
        (x.kind === 'borrow' ? '<button class="btn ghost small icon" data-delb="' + esc(x.rec.id) + '" title="Delete">' + ic('trash') + '</button>' : '') + '</div>';
    });
    h += '<div class="row total"><span class="name">After all planned</span><span class="num">' + eur(d.start + t.borrowed - t.paid) + '</span></div></div>' +
      '<div class="acts"><button class="btn danger" id="d-del">' + ic('trash') + 'Delete</button><button class="btn" id="d-borrow">' + ic('up') + 'Borrowed more</button><span class="grow"></span><button class="btn primary" id="d-ok">Save</button></div>';
    var m2 = openModal(h);
    $('#d-ok').onclick = function () {
      var name = readName('d-name'); if (name === null) return;
      var c = readAmount('d-amt'); if (c === null) return;
      var p = {}, mo = $('#d-month').value;
      if (name !== d.name) p.name = name; if (c !== d.start) p.start = c; if (mo !== d.startMonth) p.startMonth = mo;
      if (Object.keys(p).length) S.store.patch(d.id, p);
      closeModal(); commit();
    };
    $('#d-del').onclick = function () { confirmBox('Delete ' + d.name + ' with all its payments?', 'Delete', function () { S.store.removeDebt(d.id); commit(); }); };
    $('#d-borrow').onclick = function () { borrowDialog(d); };
    $$('[data-delb]', m2).forEach(function (b) { b.onclick = function () { S.store.remove(b.getAttribute('data-delb')); commit(); debtDialog(S.idx.debtById[d.id]); }; });
    enterSubmits(m2, '#d-ok');
  }

  function borrowDialog(d) {
    var mo = S.month < d.startMonth ? d.startMonth : S.month;
    var h = '<h3>Borrowed more · ' + esc(d.name) + '<button class="btn ghost icon x" data-a="close">' + ic('x') + '</button></h3>' +
      '<div class="muted small">Raises what you owe ' + esc(d.name) + '.</div>' +
      amountField('b-amt', 0, 'Amount borrowed') +
      '<label class="f" for="b-month">Month</label>' + monthSelect('b-month', mo) +
      '<label class="f" for="b-note">Note (optional)</label><input class="txt" id="b-note" maxlength="120">' +
      '<label class="chk"><input type="checkbox" id="b-cash">I got this as money – add it to that month’s money in</label>' +
      '<div class="acts"><span class="grow"></span><button class="btn" data-a="close">Cancel</button><button class="btn primary" id="b-ok">Add</button></div>';
    var m = openModal(h);
    $('#b-ok').onclick = function () {
      var c = readAmount('b-amt'); if (c === null) return;
      if (!c) { toast('Enter an amount', true); return; }
      var month = $('#b-month').value;
      if (month < d.startMonth) { toast('Month is before the debt starts', true); return; }
      S.store.addBorrow(d.id, month, c, $('#b-note').value.trim(), $('#b-cash').checked); closeModal(); commit();
      toast(d.name + ': +' + eur(c));
    };
    enterSubmits(m, '#b-ok');
  }

  function suiteDialog() {
    var apps = (window.MYSUITE_APPS && window.MYSUITE_APPS.apps) || [];
    var h = '<h3>MYSUITE<button class="btn ghost icon x" data-a="close">' + ic('x') + '</button></h3><div class="muted small">All MY apps</div><div class="applist" style="margin-top:8px">';
    apps.forEach(function (a) {
      h += '<div class="row">' + appIcon(a.letters) + '<span class="name"><b>' + esc(a.name) + '</b>' + (a.paused ? ' <span class="chip">Paused</span>' : '') + '<span class="sub" style="white-space:normal">' + esc(a.description) + '</span></span></div>';
    });
    h += '</div><div class="muted small" style="margin-top:12px">This is ' + tagHTML().replace('<b>MYSUITE</b>', 'MYSUITE') + '. List bundled ' + esc((window.MYSUITE_APPS && window.MYSUITE_APPS.bundled) || '') + '.</div>';
    openModal(h);
  }

  function renameDialog() {
    var m = openModal('<h3>Device name<button class="btn ghost icon x" data-a="close">' + ic('x') + '</button></h3><label class="f" for="r-name">Shown on your other devices</label><input class="txt" id="r-name" maxlength="40" value="' + esc(S.info.name) + '">' +
      '<div class="acts"><span class="grow"></span><button class="btn" data-a="close">Cancel</button><button class="btn primary" id="r-ok">Save</button></div>');
    $('#r-ok').onclick = function () { var n = readName('r-name'); if (n === null) return; N.call('setName', [n]).then(function (i) { S.info = i; closeModal(); render(); }); };
    enterSubmits(m, '#r-ok');
  }

  // ---------- pairing ----------
  function qrSVG(mx) {
    var n = mx.n, q = 2, h = '<svg class="qr" viewBox="0 0 ' + (n + 2 * q) + ' ' + (n + 2 * q) + '" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path fill="#000" d="';
    for (var y = 0; y < n; y++) { var row = mx.rows[y]; for (var x = 0; x < n; x++) if (row.charAt(x) === '1') h += 'M' + (x + q) + ' ' + (y + q) + 'h1v1h-1z'; }
    return h + '"/></svg>';
  }
  var pairPoll = null;
  function stopPoll() { clearInterval(pairPoll); pairPoll = null; }
  function pairShow() {
    N.call('pairStart').then(function (p) {
      var base = '<h3>Pair a device<button class="btn ghost icon x" data-a="close">' + ic('x') + '</button></h3>';
      openModal(base + '<div id="pairbody"></div>', function () { stopPoll(); N.call('pairStatus').then(function (st) { if (st.state !== 'done') N.call('pairCancel'); }); });
      var body = $('#pairbody');
      var showQR = function () {
        body.innerHTML = '<div class="muted small">On your other device open MYCASH → Sync → ' + (N.platform === 'android' ? 'Scan code' : 'Scan code (phone) or Enter pairing text') + '.</div>' + qrSVG(p.matrix) +
          (p.ips && p.ips.length === 0 ? '<div class="warn-t small">' + ic('alert') + ' This device has no network address. Connect to your Wi-Fi first.</div>' : '') +
          '<label class="f">Pairing text (for a PC without camera)</label><div class="pairtext" id="ptext">' + esc(p.qr) + '</div>' +
          '<div class="btns"><button class="btn small" id="pcopy">Copy text</button></div><div class="muted small" style="margin-top:10px">Waiting for the other device… valid for 10 minutes.</div>';
        $('#pcopy').onclick = function () { copyText(p.qr); };
      };
      showQR();
      var last = '';
      stopPoll();
      pairPoll = setInterval(function () {
        N.call('pairStatus').then(function (st) {
          var key = st.state + (st.code || '') + (st.tries || 0);
          if (key === last) return; last = key;
          if (!$('#pairbody')) { stopPoll(); return; }
          if (st.state === 'code') body.innerHTML = '<div class="muted">' + esc(st.peerName || 'A device') + ' wants to pair. Type this code on it:</div><div class="code">' + esc(st.code.slice(0, 3) + ' ' + st.code.slice(3)) + '</div>' + (st.tries ? '<div class="warn-t small" style="text-align:center">Wrong code entered ' + st.tries + 'x</div>' : '') + '<div class="muted small" style="text-align:center">Never type this code anywhere else.</div>';
          else if (st.state === 'done') { stopPoll(); body.innerHTML = '<div class="code" style="font-size:22px;letter-spacing:0">' + ic('check') + ' Paired with ' + esc(st.peerName) + '</div><div class="acts"><span class="grow"></span><button class="btn primary" data-a="close">Done</button></div>'; $$('[data-a="close"]', body).forEach(function (b) { b.onclick = closeModal; }); refreshSync(); }
          else if (st.state === 'failed') { stopPoll(); body.innerHTML = '<div class="bad-t" style="margin:12px 0">' + ic('alert') + ' ' + esc(st.error || 'Pairing failed') + '</div><div class="acts"><span class="grow"></span><button class="btn primary" id="pagain">Try again</button></div>'; $('#pagain').onclick = pairShow; }
        });
      }, 800);
    });
  }
  function copyText(t) {
    var done = function () { toast('Copied'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done, fallback); else fallback();
    function fallback() { var ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); done(); } catch (e) {} ta.remove(); }
  }
  function pairScan() {
    N.call('scan').then(function (r) {
      if (r && r.text) pairJoin(r.text);
      else if (r && r.error) toast(r.error, true);
    });
  }
  function pairTextDialog() {
    var m = openModal('<h3>Enter pairing text<button class="btn ghost icon x" data-a="close">' + ic('x') + '</button></h3><div class="muted small">On the other device tap “Show pairing code” and copy the text under the QR code.</div>' +
      '<label class="f" for="pt-in">Pairing text</label><input class="txt" id="pt-in" placeholder="MYCASH1;…" autocomplete="off" autocapitalize="off" spellcheck="false">' +
      '<div class="acts"><span class="grow"></span><button class="btn" data-a="close">Cancel</button><button class="btn primary" id="pt-ok">Connect</button></div>');
    $('#pt-ok').onclick = function () { var v = $('#pt-in').value.trim(); if (!v) return; pairJoin(v); };
    enterSubmits(m, '#pt-ok');
  }
  function pairJoin(text) {
    openModal('<h3>Pairing…</h3><div class="muted">Connecting to the other device…</div>');
    N.call('pairJoin', [text]).then(function (r) {
      if (!r.ok) { openModal('<h3>Could not connect<button class="btn ghost icon x" data-a="close">' + ic('x') + '</button></h3><div class="bad-t">' + esc(r.error || 'failed') + '</div><div class="muted small" style="margin-top:8px">Both devices must be in the same network and MYCASH must be open on the other one.</div><div class="acts"><span class="grow"></span><button class="btn" data-a="close">Close</button></div>'); return; }
      var m = openModal('<h3>Confirm pairing<button class="btn ghost icon x" data-a="close">' + ic('x') + '</button></h3><div class="muted">Type the 6-digit code shown on <b style="color:var(--ms-text)">' + esc(r.hostName) + '</b>.</div>' +
        '<input class="txt codein" id="pc-in" inputmode="numeric" maxlength="7" autocomplete="off" placeholder="000000" style="margin-top:16px"><div id="pc-err" class="bad-t small" style="margin-top:8px"></div>' +
        '<div class="acts"><span class="grow"></span><button class="btn" data-a="close">Cancel</button><button class="btn primary" id="pc-ok">Pair</button></div>', function () { N.call('pairCancel'); });
      setTimeout(function () { var i = $('#pc-in'); if (i) i.focus(); }, 50);
      $('#pc-ok').onclick = function () {
        var b = $('#pc-ok'); b.disabled = true;
        N.call('pairConfirm', [$('#pc-in').value]).then(function (c) {
          if (!$('#pc-ok')) return;
          b.disabled = false;
          if (!c.ok) { $('#pc-err').textContent = c.error || 'failed'; if ((c.error || '').indexOf('cancelled') >= 0) b.disabled = true; return; }
          S.modal = null; // keep the pairing, don't cancel on close
          openModal('<h3>' + ic('check') + ' Paired with ' + esc(c.peer.name) + '</h3><div class="muted">Syncing now…</div><div class="acts"><span class="grow"></span><button class="btn primary" data-a="close">Done</button></div>');
          refreshSync().then(function () { syncPeer(c.peer.id, true); });
        });
      };
      enterSubmits(m, '#pc-ok');
    });
  }

  // ---------- sync ----------
  function refreshSync() {
    return Promise.all([N.call('info'), N.call('peers')]).then(function (r) { S.info = r[0]; S.peers = r[1] || []; if (!S.modal) render(); });
  }
  function syncPeer(id, loud) {
    if (S.syncing[id]) return Promise.resolve();
    S.syncing[id] = true; if (!S.modal) render();
    return saveNow().then(function () {
      return window.MCSync.syncWithPeer(N, id, function () { return S.store.doc; }, function (d) {
        S.store = new C.Store(d, S.info.deviceId); reindex(); render(); return saveNow();
      });
    }).then(function (r) {
      delete S.syncing[id];
      var p = S.peers.filter(function (x) { return x.id === id; })[0], nm = p ? p.name : 'device';
      if (r.ok) { S.lastSyncMsg = 'synced ' + new Date().toTimeString().slice(0, 5); if (loud) toast('Synced with ' + nm + (r.received ? ' · new data received' : '') + (r.sent ? ' · sent changes' : '')); }
      else if (loud) toast(nm + ': ' + r.error, true);
      return refreshSync();
    }, function (e) { delete S.syncing[id]; if (loud) toast(String(e), true); render(); });
  }
  function syncAll(loud) { return S.peers.reduce(function (p, peer) { return p.then(function () { return syncPeer(peer.id, loud); }); }, Promise.resolve()); }

  // ---------- start ----------
  function pickLayout() { S.layout = N.platform === 'windows' ? 'desktop' : N.platform === 'android' ? 'mobile' : (window.innerWidth >= 900 ? 'desktop' : 'mobile'); }
  function splash() {
    if (N.platform === 'android') return Promise.resolve(); // native start screen there
    var s = document.createElement('div'); s.id = 'splash';
    s.innerHTML = appIcon('C$') + '<div class="tag" style="font-size:14px">' + tagHTML() + '</div>';
    document.body.appendChild(s);
    return new Promise(function (res) { setTimeout(function () { s.style.opacity = '0'; setTimeout(function () { s.remove(); res(); }, 200); }, 1000); });
  }
  function start() {
    pickLayout();
    window.addEventListener('resize', function () { var l = S.layout; pickLayout(); if (l !== S.layout) render(); });
    N.on(function (ev) {
      if (ev === 'change') reloadFromNative().then(refreshSync);
      else if (ev === 'pair') { if (!pairPoll) refreshSync(); }
      else if (ev === 'resume') { refreshSync().then(function () { syncAll(false); }); }
      else if (ev === 'back') { if ($('#modal')) closeModal(); else if (S.view !== 'month') { S.view = 'month'; render(); } else N.call('exit'); }
    });
    var sp = splash();
    Promise.all([N.call('info'), N.call('load'), N.call('peers')]).then(function (r) {
      S.info = r[0]; S.peers = r[2] || [];
      var d = C.parseDoc(r[1]);
      if (!d) { d = C.emptyDoc(); toast('Stored data could not be read – started empty (old file kept as backup)', true); }
      S.store = new C.Store(d, S.info.deviceId);
      reindex(); render();
      if (window.MC_PRESET) window.MC_PRESET(S, C, commit, render);
      return sp.then(function () { setTimeout(function () { syncAll(false); }, 600); });
    });
  }
  window.MCApp = { state: S, render: render, commit: commit, syncAll: syncAll };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
