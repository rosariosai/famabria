// Calendar page. NODE_PATH=$(npm root -g) node scripts/e2e-calendar.mjs <shots-dir>
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const { chromium } = createRequire(import.meta.url)('playwright');
const axeSource = readFileSync(resolve('node_modules/axe-core/axe.min.js'), 'utf8');
const ext = resolve(process.env.TN_DIST ?? 'dist/chrome');
const shots = process.argv[2] ?? '.';
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'tn-')), {
  channel: 'chromium', headless: true, viewport: { width: 1200, height: 900 },
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
const errors = [];
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const assert = (c, m) => { if (!c) { console.error('FAIL:', m); process.exitCode = 1; } else console.log('ok  -', m); };

let cal;
const audit = async (label) => {
  await cal.evaluate(axeSource);
  const r = await cal.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] } })).violations.map((v) => `${v.impact} ${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' ; ')}`));
  assert(r.length === 0, `axe: ${label} ${r.join(' || ')}`);
};

await page.goto('chrome://newtab'); await page.waitForSelector('.topbar');
// entry point from the dashboard opens the calendar in a new tab, on the current month
;[cal] = await Promise.all([ctx.waitForEvent('page'), page.getByRole('link', { name: /Calendar/ }).click()]);
cal.on('pageerror', (e) => errors.push(String(e)));
cal.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await cal.waitForSelector('.day');
const now = new Date();
const MONTHS = ['GENNAIO', 'FEBBRAIO', 'MARZO', 'APRILE', 'MAGGIO', 'GIUGNO', 'LUGLIO', 'AGOSTO', 'SETTEMBRE', 'OTTOBRE', 'NOVEMBRE', 'DICEMBRE'];
const title = async () => (await cal.locator('h1').innerText()).replace(/\s+/g, ' ');
assert(await title() === `${MONTHS[now.getMonth()]} ${now.getFullYear()}`, 'opens on the current month: ' + await title());
assert(await cal.locator('.day.today').count() === 1, 'today is highlighted');
assert(await cal.locator('.day.today .day-btn').getAttribute('aria-current') === 'date', 'today has aria-current=date');

// navigate by URL to the printed-calendar month and compare with the photo
const base = cal.url().split('#')[0];
await cal.goto(base + '#2027-01'); await cal.waitForSelector('.day');
assert(await title() === 'GENNAIO 2027', 'hash #2027-01 shows January 2027');
assert((await cal.locator('.cal-main .day.red .day-num').allInnerTexts()).join() === '1,3,6,10,17,24,31', 'red days = 1,3,6,10,17,24,31 as in the printed calendar');
assert((await cal.locator('.cal-main .week').allInnerTexts()).map((t) => t.replace(/\D/g, '')).join() === '1,2,3,4', 'week numbers 1-4 on Mondays');
assert(await cal.locator('.cal-main .moon').count() === 4, 'four moon phases');
const caps = await cal.locator('.cal-main .day-caption').allInnerTexts();
assert(caps.length === 31 && caps[0] === 'SS. Maria Madre di Dio, Capodanno' && caps[5] === 'Epifania di N.S.' && caps[9] === 'S. Aldo Eremita, Battesimo di Gesù' && caps[24] === 'S. Sabino, Convers. di S. Paolo', 'saint captions as printed (checked days 1, 6, 10, 25)');
assert(await cal.locator('.cal-col').first().locator('.day').count() === 16, 'left column has 16 days (as printed)');
assert(await cal.locator('.strip').count() === 2 && (await cal.locator('.strip-head').first().innerText()).includes('DICEMBRE'), 'side strips: previous and next month');
await cal.screenshot({ path: join(shots, 'cal-2027-01.png') });

// buttons
await cal.getByRole('button', { name: 'Next month' }).click();
assert(await title() === 'FEBBRAIO 2027', 'next month');
await cal.getByRole('button', { name: 'Previous month' }).click(); await cal.getByRole('button', { name: 'Previous month' }).click();
assert(await title() === 'DICEMBRE 2026', 'previous month crosses the year');
await cal.locator('.strip-head').last().click();
assert(await title() === 'GENNAIO 2027', 'clicking the side strip header navigates');
// pickers
await cal.getByLabel('Month', { exact: true }).selectOption('2');
assert(await title() === 'MARZO 2027', 'month picker');
assert((await cal.locator('.cal-main .day-caption').allInnerTexts()).filter((t) => /Pasqua|Angelo/.test(t)).join('|') === "S. Castore, Pasqua|S. Secondo, Lunedì dell'Angelo", 'Easter 2027 = 28 March, Easter Monday 29');
await cal.getByLabel('Year', { exact: true }).fill('2030'); await cal.getByLabel('Year', { exact: true }).press('Enter');
assert(await title() === 'MARZO 2030', 'year picker');
await cal.getByLabel('Year', { exact: true }).fill('12'); await cal.getByLabel('Year', { exact: true }).press('Enter');
assert(await title() === 'MARZO 2030' && await cal.getByLabel('Year', { exact: true }).inputValue() === '2030', 'invalid year is rejected');
// leap year
await cal.goto(base + '#2028-02'); await cal.waitForSelector('.day');
assert(await cal.locator('.cal-main .day').count() === 29, 'February 2028 has 29 days');
// keyboard
await cal.locator('body').click({ position: { x: 5, y: 5 } });
await cal.keyboard.press('ArrowRight'); assert(await title() === 'MARZO 2028', 'ArrowRight = next month');
await cal.keyboard.press('PageUp'); assert(await title() === 'FEBBRAIO 2028', 'PageUp = previous month');
await cal.keyboard.press('Shift+ArrowRight'); assert(await title() === 'FEBBRAIO 2029', 'Shift+Arrow = next year');
await cal.keyboard.press('t'); assert(await title() === `${MONTHS[now.getMonth()]} ${now.getFullYear()}`, 'T = today');
await cal.goBack(); assert((await title()) !== '', 'browser back works');
// garbage hash falls back to the current month
await cal.goto(base + '#banana'); await cal.waitForSelector('.day');
assert(await title() === `${MONTHS[now.getMonth()]} ${now.getFullYear()}`, 'bad hash -> current month');


// ---------------- C3: notes and events
await cal.goto(base + '#2027-01'); await cal.waitForSelector('.day');
const row = (n) => cal.locator('.cal-main .day').nth(n - 1);
await row(15).locator('.day-btn').click();
await cal.getByRole('heading', { name: /venerdì 15 gennaio 2027/i }).waitFor();
assert(await cal.locator('dialog').evaluate((d) => d.open), 'day dialog opens (modal)');
// validation
await cal.getByRole('button', { name: 'Add', exact: true }).click();
assert(await cal.getByRole('alert').innerText() === 'Write a title or a note.', 'empty entry is rejected with a friendly message');
await cal.getByLabel('Title').fill('Dentist Rossi');
await cal.getByLabel('Time').fill('09:30');
await cal.locator('dialog').getByLabel('Calendar', { exact: true }).selectOption('family');
assert(await cal.locator('dialog').getByLabel('Calendar', { exact: true }).inputValue() === 'family', 'calendar picker offers Athena');
await cal.getByLabel(/Notes/).fill('Bring the health card');
await cal.getByRole('button', { name: 'Add', exact: true }).click();
await cal.getByLabel('Title').fill('Cake for Zoe');
await cal.getByRole('button', { name: 'Add', exact: true }).click();
assert((await cal.locator('.entries .entry strong').allInnerTexts()).map((t) => t.trim()).join('|') === 'Cake for Zoe|09:30 Dentist Rossi', 'two entries, all-day note first then timed');
await cal.keyboard.press('Escape');
await cal.waitForSelector('dialog', { state: 'detached' });
assert(await cal.evaluate(() => document.activeElement?.classList.contains('day-btn')), 'Esc closes and focus returns to the day');
assert((await row(15).locator('.day-entry').allInnerTexts()).join('|').replace(/\s+/g, ' ').includes('Dentist Rossi'), 'entries show inside the day row');
assert((await row(15).locator('.day-btn').textContent()).includes(', 2 note'), 'screen-reader label mentions the notes');
await cal.screenshot({ path: join(shots, 'cal-with-notes.png') });

// persistence
await cal.reload(); await cal.waitForSelector('.day-entry');
assert(await row(15).locator('.day-entry').count() === 2, 'entries persist after reload');

// C6: calendars. Dentist went to Athena (green), Cake to the default calendar (Ros, blue).
const dotOf = async (txt) => row(15).locator('.day-entry', { hasText: txt }).locator('.dot').evaluate((e) => [...e.classList].find((c) => c.startsWith('dot--')));
assert(await dotOf('Dentist') === 'dot--green' && await dotOf('Cake') === 'dot--blue', 'dots take the colour of their calendar');
await cal.getByRole('button', { name: 'Athena' }).click();
await cal.waitForFunction(() => document.querySelectorAll('.cal-main .day')[14].querySelectorAll('.day-entry').length === 1);
assert((await row(15).locator('.day-entry').allInnerTexts()).join('').includes('Cake') && !(await row(15).locator('.day-entry').allInnerTexts()).join('').includes('Dentist'), 'hiding Athena hides its notes');
await cal.reload(); await cal.waitForSelector('.day');
assert(await cal.getByRole('button', { name: /Athena/ }).getAttribute('aria-pressed') === 'false', 'legend choice is remembered');
await cal.getByRole('button', { name: /Athena/ }).click();
await cal.waitForFunction(() => document.querySelectorAll('.cal-main .day')[14].querySelectorAll('.day-entry').length === 2);
await row(15).locator('.day-btn').click();
assert((await cal.locator('.entry-meta').first().innerText()).includes('last changed'), 'each note shows when it was last changed');
await cal.keyboard.press('Escape');

// edit
await row(15).locator('.day-btn').click();
await cal.getByRole('button', { name: 'Edit Dentist Rossi' }).click();
await cal.getByLabel('Title').fill('Dentist Bianchi');
await cal.getByRole('button', { name: 'Save', exact: true }).click();
assert((await cal.locator('.entries .entry strong').allInnerTexts()).some((t) => t.includes('Dentist Bianchi')), 'edit saves');
assert(await cal.locator('.entries .entry').count() === 2, 'editing does not duplicate');
await audit('entry dialog open');

// delete + undo
await cal.getByRole('button', { name: 'Delete Cake for Zoe' }).click();
assert(await cal.locator('.entries .entry').count() === 1, 'deleted entry disappears');
await cal.getByRole('button', { name: 'Undo' }).click();
assert(await cal.locator('.entries .entry').count() === 2, 'Undo brings it back');
await cal.keyboard.press('Escape');

// search
await cal.getByLabel('Search notes').fill('bianchi');
await cal.waitForSelector('.result-row');
assert(await cal.locator('.result-row').count() === 1, 'search finds the entry');
await audit('search results');
await cal.locator('.result-row').click();
await cal.getByRole('heading', { name: /15 gennaio 2027/i }).waitFor();
assert(true, 'clicking a result opens that day');
await cal.keyboard.press('Escape');
await cal.getByLabel('Search notes').fill('');
await cal.waitForSelector('.cal-sheet');

// settings: hide saints, local holiday
await cal.getByRole('button', { name: /Settings/ }).click();
await cal.getByLabel('Show the saint of the day').uncheck();
const dlg = cal.locator('dialog');
await dlg.locator('#ls-name').fill('Santo Patrono');
await dlg.getByLabel('Month', { exact: true }).selectOption('0');
await dlg.getByLabel('Day', { exact: true }).fill('2');
await audit('calendar settings dialog');
await cal.getByRole('button', { name: 'Done' }).click();
assert(await row(2).evaluate((el) => el.classList.contains('red')), 'local holiday is red');
assert((await row(2).locator('.day-caption').innerText()) === 'Santo Patrono', 'local holiday caption (saints hidden)');
assert(await row(3).locator('.day-caption').count() === 0, 'saints hidden');
await cal.reload(); await cal.waitForSelector('.day');
assert((await row(2).locator('.day-caption').innerText()) === 'Santo Patrono', 'settings persist after reload');

// backup contains the entries; "replace everything" restores them
await cal.goto(base.replace('calendar.html', 'newtab.html')); await cal.waitForSelector('.topbar');
await cal.getByRole('button', { name: '⇅ Import / Export' }).click();
await cal.getByRole('heading', { name: 'Import and export' }).waitFor();
const [dl] = await Promise.all([cal.waitForEvent('download'), cal.getByRole('button', { name: 'Download backup (.json)' }).click()]);
const file = join(tmpdir(), `tn-backup-${Date.now()}.json`);
await dl.saveAs(file);
const backup = JSON.parse(readFileSync(file, 'utf8'));
assert(Array.isArray(backup.events) && backup.events.filter((e) => e.deletedAt === null).length === 2 && backup.calendar.localName === 'Santo Patrono', 'backup JSON includes the notes and calendar settings');
await cal.keyboard.press('Escape');
// wipe the entries in the calendar, then restore
await cal.goto(base + '#2027-01'); await cal.waitForSelector('.day');
await row(15).locator('.day-btn').click();
for (const name of ['Delete Dentist Bianchi', 'Delete Cake for Zoe']) await cal.getByRole('button', { name }).click();
await cal.keyboard.press('Escape');
assert(await cal.locator('.day-entry').count() === 0, 'entries deleted before restore');
await cal.goto(base.replace('calendar.html', 'newtab.html')); await cal.waitForSelector('.topbar');
await cal.getByRole('button', { name: '⇅ Import / Export' }).click();
await cal.locator('dialog input[type=file]').setInputFiles(file);
await cal.getByLabel(/Replace everything/).check();
await cal.getByRole('button', { name: /^Replace|Import/ }).last().click();
await cal.waitForSelector('dialog', { state: 'detached' });
await cal.goto(base + '#2027-01'); await cal.waitForSelector('.day');
assert(await cal.locator('.day-entry').count() === 2, 'restore (replace everything) brings the notes back');

// back to dashboard link
await cal.getByRole('link', { name: /Dashboard/ }).click();
await cal.waitForSelector('.topbar');
assert(true, 'Dashboard link returns to the new-tab page');

// accessibility: light + dark, desktop + narrow
for (const theme of ['light', 'dark']) {
  await cal.goto(base + '#2027-01'); await cal.waitForSelector('.day');
  await cal.emulateMedia({ colorScheme: theme });
  await cal.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
  await audit(`${theme} desktop`);
  if (theme === 'dark') await cal.screenshot({ path: join(shots, 'cal-2027-01-dark.png') });
}
await cal.setViewportSize({ width: 360, height: 740 });
const overflow = await cal.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
assert(overflow <= 0, `no horizontal scroll at 360px (${overflow})`);
await audit('dark 360px');
assert(errors.length === 0, 'no console errors ' + errors.join('|'));
await ctx.close();
