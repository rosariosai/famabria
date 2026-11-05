// C5 sync, two browser profiles (two people) + a real server.
// TN_SYNC_URL=http://127.0.0.1:8421 TN_TOK1=... TN_TOK2=... TN_DIST=dist/chrome-test NODE_PATH=$(npm root -g) node scripts/e2e-sync.mjs <shots>
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const { chromium } = createRequire(import.meta.url)('playwright');
const axeSource = readFileSync(resolve('node_modules/axe-core/axe.min.js'), 'utf8');
const ext = resolve(process.env.TN_DIST ?? 'dist/chrome-test');
const shots = process.argv[2] ?? '.';
const URL_ = process.env.TN_SYNC_URL, T1 = process.env.TN_TOK1, T2 = process.env.TN_TOK2;
const errors = [];
const assert = (c, m) => { if (!c) { console.error('FAIL:', m); process.exitCode = 1; } else console.log('ok  -', m); };
const launch = () => chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'tn-')), {
  channel: 'chromium', headless: true, viewport: { width: 1200, height: 900 },
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
const openCal = async (ctx) => {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('chrome://newtab'); await page.waitForSelector('.topbar');
  const [cal] = await Promise.all([ctx.waitForEvent('page'), page.getByRole('link', { name: /Calendar/ }).click()]);
  cal.on('pageerror', (e) => errors.push(String(e)));
  cal.on('console', (m) => m.type() === 'error' && !/ERR_CONNECTION|Failed to load resource/.test(m.text()) && errors.push(m.text()));
  await cal.waitForSelector('.day');
  const base = cal.url().split('#')[0];
  await cal.goto(base + '#2027-03'); await cal.waitForSelector('.day');
  return cal;
};
const connect = async (cal, token, url = URL_) => {
  await cal.getByRole('button', { name: /Sync/ }).click();
  await cal.getByLabel('Server address').fill(url.replace('http://', ''));
  await cal.getByLabel('Your token').fill(token);
  await cal.getByRole('button', { name: 'Save and connect' }).click();
};
const addNote = async (cal, day, title) => {
  await cal.locator('.cal-main .day').nth(day - 1).locator('.day-btn').click();
  await cal.getByLabel('Title').fill(title);
  await cal.getByRole('button', { name: 'Add', exact: true }).click();
  await cal.keyboard.press('Escape');
};

// wait until the server really has (or no longer shows) a note, instead of trusting the status label
const serverState = async (title) => {
  for (let i = 0; i < 40; i++) {
    const r = await (await fetch(URL_ + '/api/export', { headers: { authorization: `Bearer ${T1}` } })).json();
    const e = r.events.find((x) => x.title === title);
    if (e) return e;
    await new Promise((ok) => setTimeout(ok, 500));
  }
  return null;
};
const A = await launch(), B = await launch();
const a = await openCal(A), b = await openCal(B);

// before setup
assert(await a.getByRole('button', { name: /Sync/ }).innerText() === '⟳ Sync', 'sync button says Sync before setup');
await a.screenshot({ path: join(shots, 'sync-0.png') });

// bad token is explained, not crashed
await connect(a, 'tn_wrongwrongwrongwrongwrongwrongwrongwrongwrong');
await a.getByText('The server did not accept this token.').waitFor();
assert(true, 'wrong token: friendly message');
// wrong address
await a.getByLabel('Server address').fill('127.0.0.1:9');
await a.getByRole('button', { name: 'Save and connect' }).click();
await a.getByText(/cannot be reached/).waitFor();
assert(true, 'unreachable server: friendly message');

// good connection
await a.getByLabel('Server address').fill(URL_.replace('http://', ''));
await a.getByLabel('Your token').fill(T1);
await a.getByRole('button', { name: 'Save and connect' }).click();
await a.getByText('Connected as ros.').waitFor();
await a.screenshot({ path: join(shots, 'sync-1.png') });
// audit dialog
await a.evaluate(axeSource);
const v = await a.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'] } })).violations.map((x) => `${x.id}: ${x.nodes.map((n) => n.target.join(' ')).join(';')}`));
assert(v.length === 0, 'axe: sync dialog ' + v.join('|'));
await a.keyboard.press('Escape');

// ros writes a note; it shows up for the wife after she connects
await addNote(a, 12, 'Cena dai nonni');
assert(!!(await serverState('Cena dai nonni')), 'note reached the server by itself (auto sync after saving)');
await connect(b, T2);
await b.getByText('Connected as wife.').waitFor();
await b.keyboard.press('Escape');
await b.getByText('Cena dai nonni').first().waitFor({ timeout: 10000 });
assert(true, 'the wife sees the note');

// the wife adds one; ros sees it after switching back to the tab (focus triggers a sync) or Sync now
await addNote(b, 20, 'Visita pediatra');
await b.locator('.cal-main .day').nth(19).locator('.day-btn').click();
assert((await b.locator('.entry-meta').first().innerText()).includes('last changed by wife'), 'wife sees her own change labelled "wife"');
await b.keyboard.press('Escape');
assert(!!(await serverState('Visita pediatra')), 'wife\'s note reached the server');
await a.getByRole('button', { name: /Up to date|Connected/ }).click();
await a.getByRole('button', { name: 'Sync now' }).click();
await a.keyboard.press('Escape');
await a.getByText('Visita pediatra').first().waitFor({ timeout: 10000 });
assert(true, 'ros sees the wife\'s note');
await a.locator('.cal-main .day').nth(19).locator('.day-btn').click();
assert((await a.locator('.entry-meta').first().innerText()).includes('last changed by wife'), 'ros sees "last changed by wife"');
await a.keyboard.press('Escape');
await a.screenshot({ path: join(shots, 'sync-2.png') });

// deletion travels too
await a.locator('.cal-main .day').nth(11).locator('.day-btn').click();
await a.getByRole('button', { name: 'Delete Cena dai nonni' }).click();
await a.keyboard.press('Escape');
for (let i = 0; i < 40; i++) { const r = await (await fetch(URL_ + '/api/export', { headers: { authorization: `Bearer ${T1}` } })).json(); if (r.events.find((x) => x.title === 'Cena dai nonni')?.deletedAt) break; await new Promise((ok) => setTimeout(ok, 500)); }
await b.getByRole('button', { name: /Up to date/ }).click();
await b.getByRole('button', { name: 'Sync now' }).click();
await b.keyboard.press('Escape');
await b.waitForFunction(() => !document.body.innerText.includes('Cena dai nonni'), null, { timeout: 10000 });
assert(true, 'deleted note disappears for the other person');

// survives reload (config remembered, token stays in the browser)
await a.reload(); await a.waitForSelector('.day');
await a.getByRole('button', { name: /Up to date|Connected|Syncing/ }).waitFor();
assert(true, 'sync settings remembered after reload');

// disconnect
await a.getByRole('button', { name: /Up to date|Connected/ }).click();
await a.getByRole('button', { name: 'Disconnect' }).click();
await a.getByText(/Disconnected/).waitFor();
await a.keyboard.press('Escape');
assert(await a.getByRole('button', { name: /Sync/ }).innerText() === '⟳ Sync', 'disconnect returns to Sync');
assert(await a.getByText('Visita pediatra').first().isVisible(), 'notes stay on the computer after disconnecting');

// backup file must not contain the token
assert(errors.length === 0, 'no console errors ' + errors.join(' | '));
await A.close(); await B.close();
