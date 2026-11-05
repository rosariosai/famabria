import { saintFor } from './saints-it';

// Pure calendar logic (no DOM, no browser APIs): Italian holidays, ISO weeks, moon phases, month layout.

export const MONTHS_IT = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];
export const WEEKDAYS_IT = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'];
export const WEEKDAYS_IT_SHORT = ['DOM', 'LUN', 'MAR', 'MER', 'GIO', 'VEN', 'SAB'];

/** Finger swipe on the calendar: -1 = previous month (swipe right), 1 = next month (swipe left), 0 = not a month swipe. */
export function swipeMonthDelta(dx: number, dy: number, ms: number): -1 | 0 | 1 {
  if (ms > 900 || Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 2) return 0;
  return dx < 0 ? 1 : -1;
}

export interface YearMonth { year: number; month: number } // month 0-11

export const pad2 = (n: number) => String(n).padStart(2, '0');
export const dateKey = (y: number, m: number, d: number) => `${y}-${pad2(m + 1)}-${pad2(d)}`;
export const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
/** 0 = Sunday … 6 = Saturday (timezone independent). */
export const weekdayOf = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d)).getUTCDay();

export function shiftMonth(ym: YearMonth, delta: number): YearMonth {
  const n = ym.year * 12 + ym.month + delta;
  return { year: Math.floor(n / 12), month: ((n % 12) + 12) % 12 };
}

/** "2027-01" -> {2027, 0}; null when malformed or out of range. */
export function parseYearMonth(s: string): YearMonth | null {
  const m = /^(\d{4})-(\d{1,2})$/.exec(s.trim());
  if (!m) return null;
  const year = Number(m[1]); const month = Number(m[2]) - 1;
  return year >= 1583 && year <= 9999 && month >= 0 && month <= 11 ? { year, month } : null;
}
export const formatYearMonth = (ym: YearMonth) => `${ym.year}-${pad2(ym.month + 1)}`;

/** Western (Gregorian) Easter Sunday: Meeus/Jones/Butcher algorithm. Returns [month 0-11, day]. */
export function easter(year: number): [number, number] {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31) - 1;
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return [month, day];
}

/** Italian national public holidays for a year, keyed by YYYY-MM-DD. */
export function italianHolidays(year: number): Record<string, string> {
  const fixed: [number, number, string][] = [
    [0, 1, 'Capodanno'], [0, 6, 'Epifania del Signore'], [3, 25, 'Festa della Liberazione'], [4, 1, 'Festa del Lavoro'],
    [5, 2, 'Festa della Repubblica'], [7, 15, 'Assunzione di Maria (Ferragosto)'], [10, 1, 'Ognissanti'],
    [11, 8, 'Immacolata Concezione'], [11, 25, 'Natale'], [11, 26, 'Santo Stefano'],
  ];
  const out: Record<string, string> = {};
  for (const [m, d, name] of fixed) out[dateKey(year, m, d)] = name;
  const [em, ed] = easter(year);
  out[dateKey(year, em, ed)] = 'Pasqua';
  const mon = new Date(Date.UTC(year, em, ed + 1));
  out[dateKey(year, mon.getUTCMonth(), mon.getUTCDate())] = "Lunedì dell'Angelo";
  return out;
}

/** ISO 8601 week number (weeks start on Monday; week 1 contains the first Thursday). */
export function isoWeek(y: number, m: number, d: number): number {
  const t = new Date(Date.UTC(y, m, d));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1);
  return Math.ceil(((t.getTime() - yearStart) / 86400000 + 1) / 7);
}

// ---------------------------------------------------------------- moon phases (Meeus, "Astronomical Algorithms", ch. 49)
export type MoonPhase = 'new' | 'first' | 'full' | 'last';
const RAD = Math.PI / 180;
const sin = (deg: number) => Math.sin(deg * RAD);
const cos = (deg: number) => Math.cos(deg * RAD);

/** Julian Ephemeris Day (TT) of a phase; k is an integer (new), +.25 first quarter, +.5 full, +.75 last quarter. */
function phaseJde(k: number): number {
  const T = k / 1236.85;
  const jde = 2451550.09766 + 29.530588861 * k + 0.00015437 * T * T - 0.00000015 * T ** 3 + 0.00000000073 * T ** 4;
  const E = 1 - 0.002516 * T - 0.0000074 * T * T;
  const M = 2.5534 + 29.1053567 * k - 0.0000014 * T * T - 0.00000011 * T ** 3;
  const Mp = 201.5643 + 385.81693528 * k + 0.0107582 * T * T + 0.00001238 * T ** 3 - 0.000000058 * T ** 4;
  const F = 160.7108 + 390.67050284 * k - 0.0016118 * T * T - 0.00000227 * T ** 3 + 0.000000011 * T ** 4;
  const O = 124.7746 - 1.56375588 * k + 0.0020672 * T * T + 0.00000215 * T ** 3;
  const frac = Math.round((k - Math.floor(k)) * 4) / 4;
  let c: number;
  if (frac === 0 || frac === 0.5) {
    const nm = frac === 0;
    c = (nm ? -0.4072 : -0.40614) * sin(Mp) + (nm ? 0.17241 : 0.17302) * E * sin(M) + (nm ? 0.01608 : 0.01614) * sin(2 * Mp)
      + (nm ? 0.01039 : 0.01043) * sin(2 * F) + (nm ? 0.00739 : 0.00734) * E * sin(Mp - M) - (nm ? 0.00514 : 0.00515) * E * sin(Mp + M)
      + (nm ? 0.00208 : 0.00209) * E * E * sin(2 * M) - 0.00111 * sin(Mp - 2 * F) - 0.00057 * sin(Mp + 2 * F)
      + 0.00056 * E * sin(2 * Mp + M) - 0.00042 * sin(3 * Mp) + 0.00042 * E * sin(M + 2 * F) + 0.00038 * E * sin(M - 2 * F)
      - 0.00024 * E * sin(2 * Mp - M) - 0.00017 * sin(O) - 0.00007 * sin(Mp + 2 * M) + 0.00004 * sin(2 * Mp - 2 * F)
      + 0.00004 * sin(3 * M) + 0.00003 * sin(Mp + M - 2 * F) + 0.00003 * sin(2 * Mp + 2 * F) - 0.00003 * sin(Mp + M + 2 * F)
      + 0.00003 * sin(Mp - M + 2 * F) - 0.00002 * sin(Mp - M - 2 * F) - 0.00002 * sin(3 * Mp + M) + 0.00002 * sin(4 * Mp);
  } else {
    c = -0.62801 * sin(Mp) + 0.17172 * E * sin(M) - 0.01183 * E * sin(Mp + M) + 0.00862 * sin(2 * Mp) + 0.00804 * sin(2 * F)
      + 0.00454 * E * sin(Mp - M) + 0.00204 * E * E * sin(2 * M) - 0.0018 * sin(Mp - 2 * F) - 0.0007 * sin(Mp + 2 * F)
      - 0.0004 * sin(3 * Mp) - 0.00034 * E * sin(2 * Mp - M) + 0.00032 * E * sin(M + 2 * F) + 0.00032 * E * sin(M - 2 * F)
      - 0.00028 * E * E * sin(Mp + 2 * M) + 0.00027 * E * sin(2 * Mp + M) - 0.00017 * sin(O) - 0.00005 * sin(Mp - M - 2 * F)
      + 0.00004 * sin(2 * Mp + 2 * F) - 0.00004 * sin(Mp + M + 2 * F) + 0.00004 * sin(Mp - 2 * M) + 0.00003 * sin(Mp + M - 2 * F)
      + 0.00003 * sin(3 * M) + 0.00002 * sin(2 * Mp - 2 * F) + 0.00002 * sin(Mp - M + 2 * F) - 0.00002 * sin(3 * Mp + M);
    const W = 0.00306 - 0.00038 * E * cos(M) + 0.00026 * cos(Mp) - 0.00002 * cos(Mp - M) + 0.00002 * cos(Mp + M) + 0.00002 * cos(2 * F);
    c += frac === 0.25 ? W : -W;
  }
  return jde + c;
}

const ROME_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' });
/** Calendar date (Rome time) of a Julian Ephemeris Day. TT→UT correction ≈ 69 s (good for 2000-2100). */
function romeDateOfJde(jde: number): string {
  const ms = (jde - 2440587.5) * 86400000 - 69000;
  return ROME_DAY.format(new Date(ms));
}

const PHASES: MoonPhase[] = ['new', 'first', 'full', 'last'];
/** Moon quarters falling in the given month, keyed by YYYY-MM-DD (Rome time). */
export function moonPhases(year: number, month: number): Record<string, MoonPhase> {
  const approxK = (year + (month + 0.5) / 12 - 2000) * 12.3685;
  const out: Record<string, MoonPhase> = {};
  const prefix = `${year}-${pad2(month + 1)}-`;
  for (let n = Math.floor(approxK) - 2; n <= Math.floor(approxK) + 2; n++) {
    PHASES.forEach((p, i) => {
      const key = romeDateOfJde(phaseJde(n + i * 0.25));
      if (key.startsWith(prefix)) out[key] = p;
    });
  }
  return out;
}

// ---------------------------------------------------------------- movable feasts (named, but not days off)
function addDays(y: number, m: number, d: number, n: number): [number, number] {
  const t = new Date(Date.UTC(y, m, d + n));
  return [t.getUTCMonth(), t.getUTCDate()];
}
export function movableFeasts(year: number): Record<string, string> {
  const out: Record<string, string> = {};
  const [em, ed] = easter(year);
  const rel: [number, string][] = [[-46, 'Mercoledì delle Ceneri'], [-7, 'Domenica delle Palme'], [-3, 'Giovedì Santo'], [-2, 'Venerdì Santo'], [-1, 'Sabato Santo'],
    [42, 'Ascensione del Signore'], [49, 'Pentecoste'], [56, 'Santissima Trinità'], [63, 'Corpus Domini']];
  for (const [n, name] of rel) { const [m, d] = addDays(year, em, ed, n); out[dateKey(year, m, d)] = name; }
  // Baptism of the Lord: the Sunday after Epiphany (Italy). Holy Family: the Sunday within the Christmas octave, else 30 Dec.
  const [bm, bd] = addDays(year, 0, 6, 7 - weekdayOf(year, 0, 6));
  out[dateKey(year, bm, bd)] = 'Battesimo di Gesù';
  const sunday = [26, 27, 28, 29, 30, 31].find((d) => weekdayOf(year, 11, d) === 0);
  out[dateKey(year, 11, sunday ?? 30)] = 'Sacra Famiglia';
  return out;
}

// ---------------------------------------------------------------- month layout
export interface LocalHoliday { name: string; month: number; day: number } // month 0-11

export interface CalendarOptions {
  saints?: boolean; // show the saint of the day (default true)
  local?: LocalHoliday | null; // e.g. the town's patron-saint day, treated as a day off
}

export interface DayCell {
  day: number;
  key: string;
  weekday: number;
  holiday: string | null;
  red: boolean; // Sunday or public holiday
  week: number | null; // ISO week number, shown on Mondays only
  moon: MoonPhase | null;
  caption: string; // saint of the day + holiday / feast names, as on the printed calendar
}

const tokens = (s: string) => s.toLowerCase().split(/[^a-zàèéìòù']+/).filter((t) => t.length >= 5);

/** "S. Aldo Eremita" + ["Battesimo di Gesù"] -> "S. Aldo Eremita, Battesimo di Gesù". Skips names the saint text already says. */
export function composeCaption(saint: string, extras: (string | null)[]): string {
  const parts: string[] = saint ? [saint] : [];
  for (const e of extras) {
    if (!e) continue;
    const have = new Set(tokens(parts.join(' ')));
    if (parts.length && tokens(e).some((t) => have.has(t))) continue;
    parts.push(e);
  }
  return parts.join(', ');
}

export function monthCells(year: number, month: number, opts: CalendarOptions = {}): DayCell[] {
  const holidays = { ...italianHolidays(year) };
  const local = opts.local && opts.local.name.trim() ? opts.local : null;
  if (local && local.month >= 0 && local.month <= 11 && local.day >= 1 && local.day <= daysInMonth(year, local.month)) {
    const k = dateKey(year, local.month, local.day);
    holidays[k] = holidays[k] ? `${holidays[k]}, ${local.name.trim()}` : local.name.trim();
  }
  const feasts = movableFeasts(year);
  const moon = moonPhases(year, month);
  const showSaints = opts.saints !== false;
  return Array.from({ length: daysInMonth(year, month) }, (_, i) => {
    const day = i + 1;
    const key = dateKey(year, month, day);
    const weekday = weekdayOf(year, month, day);
    const holiday = holidays[key] ?? null;
    const caption = composeCaption(showSaints ? saintFor(month, day) : '', [holiday, feasts[key] ?? null]);
    return { day, key, weekday, holiday, red: weekday === 0 || holiday !== null, week: weekday === 1 ? isoWeek(year, month, day) : null, moon: moon[key] ?? null, caption };
  });
}

/** "2026-11-05" plus n days (calendar arithmetic in UTC, no daylight-saving surprises). */
export function addKeyDays(key: string, n: number): string {
  const t = new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10)) + n));
  return dateKey(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate());
}
/** The Monday of the week that contains the given day (weeks start on Monday). */
export function weekMonday(key: string): string {
  const wd = new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10)))).getUTCDay();
  return addKeyDays(key, wd === 0 ? -6 : 1 - wd);
}
