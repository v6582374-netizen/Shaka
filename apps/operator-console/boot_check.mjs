import { chromium } from '@playwright/test';
const url = process.argv[2] || 'http://127.0.0.1:1420/';
const b = await chromium.launch();
const p = await b.newPage();
const errs = [];
p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 300)); });
p.on('pageerror', e => errs.push('pageerror: ' + String(e).slice(0, 300)));
const resp = await p.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
await p.waitForTimeout(2500);
const info = await p.evaluate(() => {
  const root = document.getElementById('root');
  return {
    status: 'ok',
    rootChildren: root ? root.children.length : -1,
    bodyTextLen: (document.body.innerText || '').trim().length,
    firstText: (document.body.innerText || '').trim().slice(0, 200),
  };
});
console.log('HTTP', resp.status(), url);
console.log(JSON.stringify(info, null, 2));
console.log('errors:', errs.length);
for (const e of errs.slice(0, 12)) console.log('  ', e);
await b.close();
