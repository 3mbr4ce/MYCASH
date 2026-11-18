// Browser smoke test + screenshots of the built UI (mock bridge): node tests/ui-browser.js <outdir>
'use strict';
const path = require('path'), fs = require('fs');
const puppeteer = require('/workspace/mycash-tools/node_modules/puppeteer-core');
const CHROME = process.env.CHROME || '/workspace/myyt-tools/cft/chrome/linux-157.0.8103.78/chrome-linux64/chrome';
const OUT = process.argv[2] || '/workspace/mycash-tools/shots-browser';
const URL = 'file://' + path.join(__dirname, '..', 'build', 'web', 'index.html');
const seedSrc = fs.readFileSync(path.join(__dirname, 'sample-data.js'), 'utf8');
let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log('ok   ' + n); } else { fail++; console.log('FAIL ' + n + (x !== undefined ? ' ' + JSON.stringify(x) : '')); } };
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--allow-file-access-from-files'] });
  for (const [mode, vp] of [['desktop', { width: 1280, height: 820 }], ['mobile', { width: 412, height: 915, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true }]]) {
    const p = await b.newPage(); await p.setViewport(vp);
    const errors = []; p.on('pageerror', e => errors.push(String(e))); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await p.goto(URL); await p.evaluate(() => localStorage.clear()); await p.goto(URL);
    await new Promise(r => setTimeout(r, 1500));
    check(mode + ': empty start renders', await p.$eval('#surplus', e => e.textContent) === '0,00\u00a0€');
    // seed sample data through the real store
    await p.evaluate(seedSrc.replace("if (typeof module !== 'undefined') module.exports = { seed };", '') + ';(function(){var S=MCApp.state;seed(MCCore,S.store,S.month);MCApp.commit();})();');
    await new Promise(r => setTimeout(r, 300));
    const sur = await p.$eval('#surplus', e => e.textContent);
    check(mode + ': surplus with sample data', sur === '718,02\u00a0€', sur);
    await p.screenshot({ path: path.join(OUT, mode + '-1-month.png') });
    await p.screenshot({ path: path.join(OUT, mode + '-1-month-full.png'), fullPage: false });
    // edit a payment in German format
    const setPay = async v => { await p.evaluate(() => { const e = document.querySelector('[data-pay]'); e.focus(); e.value = ''; }); await p.type('[data-pay]', v); await p.keyboard.press('Enter'); await new Promise(r => setTimeout(r, 200)); };
    await setPay('1.000,50');
    await new Promise(r => setTimeout(r, 300));
    const sur2 = await p.$eval('#surplus', e => e.textContent);
    check(mode + ': payment typed as 1.000,50 updates surplus at once (shortfall)', sur2 === '-32,48\u00a0€', sur2);
    await setPay('250');
    await new Promise(r => setTimeout(r, 300));
    // bad input
    await setPay('12,345');
    await new Promise(r => setTimeout(r, 300));
    check(mode + ': invalid amount flagged', await p.$eval('[data-pay]', e => e.classList.contains('err')));
    await setPay('250');
    check(mode + ': back to 250', await p.$eval('#surplus', e => e.textContent) === '718,02\u00a0€');
    // next month: carry-over + shortfall view
    await p.click('[data-a="mnext"]'); await new Promise(r => setTimeout(r, 200));
    const sur3 = await p.$eval('#surplus', e => e.textContent);
    check(mode + ': next month carries income/costs over', sur3 === '698,01\u00a0€', sur3);
    await p.screenshot({ path: path.join(OUT, mode + '-2-next-month.png') });
    await p.click('[data-a="mprev"]');
    for (const [tab, name] of [['debts', '3-debts'], ['overview', '4-overview'], ['sync', '5-sync']]) {
      await p.click(`[data-tab="${tab}"]`); await new Promise(r => setTimeout(r, 300));
      await p.screenshot({ path: path.join(OUT, mode + '-' + name + '.png') });
    }
    await p.click('[data-a="pairshow"]'); await new Promise(r => setTimeout(r, 400));
    check(mode + ': pairing dialog shows QR', !!(await p.$('svg.qr')));
    await p.evaluate(() => { window.MC_MOCK_PAIR_CODE = 1; });
    await new Promise(r => setTimeout(r, 2500));
    await p.screenshot({ path: path.join(OUT, mode + '-6-pair-code.png') });
    await p.evaluate(() => { window.MC_MOCK_PAIR_CODE = 0; });
    await p.keyboard.press('Escape'); await p.evaluate(() => { const m = document.getElementById('modal'); if (m) m.click(); });
    await p.click('[data-a="suite"]'); await new Promise(r => setTimeout(r, 300));
    const apps = await p.$$eval('.applist .row', r => r.length);
    check(mode + ': MYSUITE tag opens app list (9 apps)', apps === 9, apps);
    await p.screenshot({ path: path.join(OUT, mode + '-7-suite.png') });
    await p.evaluate(() => document.getElementById('modal').click());
    // add item dialog
    await p.click('[data-tab="month"]'); await new Promise(r => setTimeout(r, 200));
    await p.click('[data-additem="cost"]'); await new Promise(r => setTimeout(r, 200));
    await p.type('#f-name', 'Insurance'); await p.type('#f-amt', '45,90'); await p.click('#f-cat button[data-v="Insurance"]');
    await p.screenshot({ path: path.join(OUT, mode + '-8-add-cost.png') });
    await p.click('#f-ok'); await new Promise(r => setTimeout(r, 300));
    const sur4 = await p.$eval('#surplus', e => e.textContent);
    check(mode + ': added cost 45,90 lowers surplus', sur4 === '672,12\u00a0€', sur4);
    // data persisted (reload)
    await new Promise(r => setTimeout(r, 400));
    await p.reload(); await new Promise(r => setTimeout(r, 1600));
    check(mode + ': data survives reload', await p.$eval('#surplus', e => e.textContent) === '672,12\u00a0€');
    check(mode + ': no JS errors', errors.length === 0, errors);
    await p.close();
  }
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
