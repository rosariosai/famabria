// C7 web app on a phone-sized screen, against a real server that serves dist/web.
// TN_WEB_URL=http://127.0.0.1:8431 TN_TOK1=<token ros> TN_TOK2=<token anna> NODE_PATH=$(npm root -g) node scripts/e2e-web.mjs <shots>
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
const { chromium, devices } = createRequire(import.meta.url)('playwright');
const axeSource = readFileSync(resolve('node_modules/axe-core/axe.min.js'), 'utf8');
const BASE = process.env.TN_WEB_URL, T1 = process.env.TN_TOK1, T2 = process.env.TN_TOK2;
const shots = process.argv[2] ?? '.';
const errors = [];
const assert = (c, m) => { if (!c) { console.error('FAIL:', m); process.exitCode = 1; } else console.log('ok  -', m); };
const api = async (path, token, init = {}) => (await fetch(BASE + path, { ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' } })).json();

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'it-IT' });
const watch = (p) => { p.on('pageerror', (e) => errors.push(String(e))); p.on('console', (m) => m.type() === 'error' && errors.push(m.text())); };

// 1. first visit: asks for the token, no server address field
const p = await ctx.newPage(); watch(p);
await p.goto(BASE + '/app/'); await p.waitForSelector('.day');
await p.getByLabel('Your token').waitFor();
assert(await p.getByLabel('Your token').isVisible(), 'first visit shows the token field');
assert((await p.getByLabel('Server address').count()) === 0, 'no server address field on the web app');
assert(await p.locator('link[rel=manifest]').count() === 1 && await p.locator('link[rel=apple-touch-icon]').count() === 1, 'manifest and home-screen icon are linked');
assert((await p.getByRole('link', { name: /Dashboard/ }).count()) === 0, 'no Dashboard link on the web app');
await p.screenshot({ path: join(shots, 'web-1-token.png') });
// wrong token
await p.getByLabel('Your token').fill('tn_' + 'x'.repeat(30));
await p.getByRole('button', { name: 'Save and connect' }).click();
await p.getByText(/did not accept this token/).waitFor();
assert(true, 'a wrong token is explained');

// 2. setup link with the token: connects and removes the token from the address
const q = await ctx.newPage(); watch(q);
await q.goto(`${BASE}/app/#token=${T1}`); await q.waitForSelector('.day');
await q.getByRole('button', { name: /Up to date|Connected/ }).waitFor();
assert(!q.url().includes('token'), 'the token is removed from the address bar');
assert((await q.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)), 'no sideways scrolling on the phone');
await q.goBack().catch(() => undefined);
await q.goto(`${BASE}/app/#2027-03`); await q.waitForSelector('.day');
await q.screenshot({ path: join(shots, 'web-2-month.png') });

// 3. add a note on the phone; it reaches the server
await q.locator('.cal-main .day').nth(9).locator('.day-btn').click();
await q.getByLabel('Title').fill('Dentista Athena');
await q.locator('select[aria-label="Calendar"]').selectOption('family');
await q.screenshot({ path: join(shots, 'web-3-dialog.png') });
await q.getByRole('button', { name: 'Add', exact: true }).click();
await q.keyboard.press('Escape');
let found = null;
for (let i = 0; i < 40 && !found; i++) { found = (await api('/api/export', T1)).events.find((e) => e.title === 'Dentista Athena'); if (!found) await new Promise((r) => setTimeout(r, 400)); }
assert(!!found && found.calendarId === 'family' && found.by === 'ros', 'the note typed on the phone reached the server in Athena, by ros');

// 4. another person adds a note elsewhere; the phone gets it on the next sync
if (T2) {
  const ev = { id: 'web-test-anna-1', calendarId: 'wife', date: '2027-03-12', title: 'Cena con Anna', notes: '', time: '20:30', color: 'pink', createdAt: Date.now(), updatedAt: Date.now(), deletedAt: null };
  await api('/api/changes', T2, { method: 'POST', body: JSON.stringify({ events: [ev] }) });
  await q.getByRole('button', { name: /Up to date|Connected|Syncing/ }).click();
  await q.getByRole('button', { name: 'Sync now' }).click();
  await q.getByText('Cena con Anna').waitFor({ state: 'attached' }).catch(() => undefined);
  await q.keyboard.press('Escape');
  assert(await q.getByText('Cena con Anna').count() > 0, "Anna's note appears on the phone after syncing");
}

// 5. accessibility on the phone layout
// (own context with the page's CSP switched off, only so the test can inject axe; the CSP itself is exercised above)
const ctxB = await browser.newContext({ ...devices['iPhone 13'], locale: 'it-IT', bypassCSP: true });
const ax = await ctxB.newPage();
await ax.goto(`${BASE}/app/#token=${T1}`); await ax.waitForSelector('.day'); await ax.getByRole('button', { name: /Up to date|Connected/ }).waitFor();
assert(await ax.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no sideways scrolling after syncing (toolbar fits the screen)');
await ax.screenshot({ path: join(shots, 'web-4-synced.png') });
await ax.addScriptTag({ content: axeSource });
const res = await ax.evaluate(async () => (await axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa'] })).violations.map((v) => `${v.id}: ${v.nodes.length}`));
assert(res.length === 0, 'axe: no violations on the phone (' + res.join(', ') + ')');

// 6. static files are safe
assert((await fetch(BASE + '/app/%2e%2e/package.json')).status === 404, 'no path traversal');
assert((await fetch(BASE + '/app/.hidden')).status === 404, 'dot files are not served');
assert((await fetch(BASE + '/app/manifest.webmanifest')).headers.get('content-type').includes('manifest'), 'manifest has the right type');

assert(errors.filter((e) => !/401|Failed to load resource/.test(e)).length === 0, 'no unexpected page errors ' + errors.join(' | '));
await browser.close();
