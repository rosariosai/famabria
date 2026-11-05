// Calendar entries (notes and events). Pure logic, no storage.
import { isRemindKey, type RemindKey } from './reminders';
// Built "sync-ready": UUID ids, updatedAt, deletedAt tombstone, calendarId. A server can be added later without migrating data.

export const ENTRY_COLORS = ['blue', 'green', 'orange', 'purple', 'pink', 'gray'] as const;
export type EntryColor = (typeof ENTRY_COLORS)[number];
export const DEFAULT_CALENDAR_ID = 'personal';

export interface CalEvent {
  id: string;
  calendarId: string;
  date: string; // YYYY-MM-DD (single day for now)
  title: string;
  notes: string;
  time: string | null; // HH:MM, null = all day / plain note
  color: EntryColor;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null; // tombstone: kept so that a future sync can propagate deletions
  /** Who made the last change (the sync user name). Unknown for notes made before sync was set up. */
  by?: string;
  /** Reminder (sent by the home reminder server through ntfy). Missing = none. */
  remind?: RemindKey;
}

export interface CalSettings {
  saints: boolean;
  moon: boolean;
  weeks: boolean;
  /** Previous/next month strips on the sides. null = automatic (shown on wide screens, hidden on narrow ones). Per device. */
  sides: boolean | null;
  localName: string; // empty = no local holiday
  localMonth: number; // 0-11
  localDay: number;
  /** Names and colours of the calendars (ids are shared between devices, names and colours are per device). */
  calendars: CalendarDef[];
  /** Calendars switched off in the legend (their notes are not shown). Per device. */
  hiddenCalendars: string[];
  /** Calendar preselected when adding a note. */
  defaultCalendar: string;
  /** Colour scheme. Per device. */
  theme: Theme;
  /** The first-run "Come ti chiami?" screen has been dealt with (or the install already had data). */
  welcomed: boolean;
  /** 'solo' = one person, no sharing: family/server/members UI is hidden. 'shared' = everything. Per device; joining a family switches to 'shared'. */
  mode: 'solo' | 'shared';
}
export type Theme = 'system' | 'light' | 'dark';
export interface CalendarDef { id: string; name: string; color: EntryColor }
/** A fresh install has exactly one member. 'personal' is the id every note had before members existed. */
export const DEFAULT_CALENDARS: CalendarDef[] = [{ id: 'personal', name: 'name1', color: 'blue' }];
/** The three calendars of the first family setup. Used to migrate old settings and to name notes that arrive from sync for a member this device does not know yet. */
export const LEGACY_CALENDARS: CalendarDef[] = [
  { id: 'personal', name: 'Ros', color: 'blue' },
  { id: 'wife', name: 'Anna', color: 'pink' },
  { id: 'family', name: 'Athena', color: 'green' },
];
export const MEMBER_LIMIT = 20;
export const MEMBER_NAME_MAX = 30;
export const DEFAULT_CAL_SETTINGS: CalSettings = {
  saints: true, moon: true, weeks: true, sides: null, localName: '', localMonth: 5, localDay: 29,
  calendars: DEFAULT_CALENDARS, hiddenCalendars: [], defaultCalendar: DEFAULT_CALENDAR_ID, theme: 'system', welcomed: false, mode: 'solo',
};

/** Look up a calendar; notes from an unknown calendar id (made by a newer app) are shown grey under their id. */
export function calendarOf(cals: CalendarDef[], id: string): CalendarDef {
  return cals.find((c) => c.id === id) ?? { id, name: id, color: 'gray' };
}

export const TITLE_MAX = 120;
export const NOTES_MAX = 4000;
const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const isDateKey = (s: string) => DATE_RE.test(s);

export interface EntryInput { date: string; title: string; notes?: string; time?: string | null; color?: EntryColor; calendarId?: string; remind?: RemindKey }

/** Returns a cleaned copy or an error message in plain words. */
export function cleanEntry(i: EntryInput): { ok: true; value: Required<EntryInput> } | { ok: false; error: string } {
  const title = i.title.replace(/\s+/g, ' ').trim();
  const notes = (i.notes ?? '').replace(/\r\n/g, '\n').trim();
  const time = i.time ? i.time.trim() : null;
  if (!DATE_RE.test(i.date)) return { ok: false, error: 'The date is not valid.' };
  if (!title && !notes) return { ok: false, error: 'Scrivi un titolo o una nota' };
  if (time !== null && !TIME_RE.test(time)) return { ok: false, error: 'Use a time like 18:30.' };
  return {
    ok: true,
    value: {
      date: i.date, title: (title || notes.split('\n')[0]).slice(0, TITLE_MAX), notes: notes.slice(0, NOTES_MAX), time,
      color: i.color && (ENTRY_COLORS as readonly string[]).includes(i.color) ? i.color : 'blue', calendarId: i.calendarId || DEFAULT_CALENDAR_ID,
      remind: i.remind && isRemindKey(i.remind) ? i.remind : 'none',
    },
  };
}

export function createEvent(v: Required<EntryInput>, id: string, now: number): CalEvent {
  return { id, ...v, createdAt: now, updatedAt: now, deletedAt: null };
}
export function updateEvent(e: CalEvent, v: Required<EntryInput>, now: number): CalEvent {
  return { ...e, ...v, updatedAt: now, deletedAt: null };
}
export const softDelete = (e: CalEvent, now: number): CalEvent => ({ ...e, deletedAt: now, updatedAt: now });
export const restore = (e: CalEvent, now: number): CalEvent => ({ ...e, deletedAt: null, updatedAt: now });

/** All-day notes first, then by time, then by creation. Deleted entries are left out. */
export function compareEntries(a: CalEvent, b: CalEvent): number {
  if (a.time !== b.time) return a.time === null ? -1 : b.time === null ? 1 : a.time < b.time ? -1 : 1;
  return a.createdAt - b.createdAt;
}
export function byDate(events: Iterable<CalEvent>): Record<string, CalEvent[]> {
  const out: Record<string, CalEvent[]> = {};
  for (const e of events) if (e.deletedAt === null) (out[e.date] ??= []).push(e);
  for (const k of Object.keys(out)) out[k].sort(compareEntries);
  return out;
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
/** AND search over title + notes, accent and case insensitive, newest date first... soonest date first. */
export function searchEntries(events: Iterable<CalEvent>, query: string): CalEvent[] {
  const terms = fold(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const hits: CalEvent[] = [];
  for (const e of events) {
    if (e.deletedAt !== null) continue;
    const hay = fold(`${e.title}\n${e.notes}`);
    if (terms.every((t) => hay.includes(t))) hits.push(e);
  }
  return hits.sort((a, b) => (a.date === b.date ? compareEntries(a, b) : a.date < b.date ? -1 : 1));
}

/** Splits text into plain and matching parts for highlighting. Same rules as the search (accent and case insensitive). */
export function highlightParts(text: string, query: string): { text: string; hit: boolean }[] {
  const terms = fold(query).split(/\s+/).filter(Boolean);
  if (!terms.length || !text) return [{ text, hit: false }];
  let folded = '';
  const map: number[] = []; // folded index -> index in the original text
  for (let i = 0; i < text.length; i++) { const f = fold(text[i]); for (let k = 0; k < f.length; k++) map.push(i); folded += f; }
  const mark = new Array<boolean>(text.length).fill(false);
  for (const t of terms) {
    for (let at = folded.indexOf(t); at !== -1; at = folded.indexOf(t, at + t.length)) for (let k = at; k < at + t.length; k++) mark[map[k]] = true;
  }
  const out: { text: string; hit: boolean }[] = [];
  for (let i = 0; i < text.length; i++) {
    const last = out[out.length - 1];
    if (last && last.hit === mark[i]) last.text += text[i]; else out.push({ text: text[i], hit: mark[i] });
  }
  return out;
}

/** Merge two sets (used by backup restore and, later, sync): per id, the newer updatedAt wins. */
export function mergeEvents(local: CalEvent[], incoming: CalEvent[]): CalEvent[] {
  const m = new Map(local.map((e) => [e.id, e]));
  for (const e of incoming) {
    const cur = m.get(e.id);
    if (!cur || e.updatedAt > cur.updatedAt) m.set(e.id, e);
  }
  return [...m.values()];
}

// ---- parsing (backup files and, later, server data are never trusted blindly)
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
export function parseEvents(raw: unknown): { events: CalEvent[]; dropped: number } {
  const events: CalEvent[] = [];
  let dropped = 0;
  if (!Array.isArray(raw)) return { events, dropped };
  for (const r of raw) {
    if (!isObj(r) || typeof r.id !== 'string' || !r.id || typeof r.date !== 'string' || typeof r.title !== 'string') { dropped++; continue; }
    const c = cleanEntry({ date: r.date, title: r.title, notes: typeof r.notes === 'string' ? r.notes : '', time: typeof r.time === 'string' ? r.time : null, color: r.color as EntryColor, calendarId: typeof r.calendarId === 'string' ? r.calendarId : undefined, remind: isRemindKey(r.remind) ? r.remind : 'none' });
    if (!c.ok) { dropped++; continue; }
    const n = (x: unknown, d: number) => (typeof x === 'number' && Number.isFinite(x) ? x : d);
    events.push({ id: r.id, ...c.value, createdAt: n(r.createdAt, 0), updatedAt: n(r.updatedAt, 0), deletedAt: r.deletedAt === null || r.deletedAt === undefined ? null : n(r.deletedAt, 0),
      ...(typeof r.by === 'string' && r.by ? { by: r.by.slice(0, 40) } : {}) });
  }
  return { events, dropped };
}
export function parseCalSettings(raw: unknown): CalSettings {
  const r = isObj(raw) ? raw : {};
  const b = (x: unknown, d: boolean) => (typeof x === 'boolean' ? x : d);
  const int = (x: unknown, lo: number, hi: number, d: number) => (typeof x === 'number' && Number.isInteger(x) && x >= lo && x <= hi ? x : d);
  return {
    saints: b(r.saints, true), moon: b(r.moon, true), weeks: b(r.weeks, true), sides: typeof r.sides === 'boolean' ? r.sides : null,
    localName: typeof r.localName === 'string' ? r.localName.trim().slice(0, 60) : '',
    localMonth: int(r.localMonth, 0, 11, 5), localDay: int(r.localDay, 1, 31, 29),
    calendars: parseCalendars(r.calendars, Object.keys(r).length > 0),
    hiddenCalendars: Array.isArray(r.hiddenCalendars) ? r.hiddenCalendars.filter((x): x is string => typeof x === 'string').slice(0, 20) : [],
    defaultCalendar: typeof r.defaultCalendar === 'string' && r.defaultCalendar ? r.defaultCalendar : DEFAULT_CALENDAR_ID,
    theme: r.theme === 'light' || r.theme === 'dark' ? r.theme : 'system',
    // settings that already existed before members were introduced belong to a set-up install: no welcome screen
    welcomed: typeof r.welcomed === 'boolean' ? r.welcomed : Object.keys(r).length > 0,
    // installs saved before modes existed keep every feature; only a brand-new install starts in 'solo'
    mode: r.mode === 'solo' || r.mode === 'shared' ? r.mode : Object.keys(r).length > 0 ? 'shared' : 'solo',
  };
}

/** Members (calendars). Any number of them; saved names and colours win. Settings saved before members existed keep the three original calendars. */
function parseCalendars(raw: unknown, hasOtherSettings: boolean): CalendarDef[] {
  if (!Array.isArray(raw)) return (hasOtherSettings ? LEGACY_CALENDARS : DEFAULT_CALENDARS).map((c) => ({ ...c }));
  const out: CalendarDef[] = [];
  for (const c of raw) {
    if (!isObj(c) || typeof c.id !== 'string' || !c.id || c.id.length > 64 || out.some((x) => x.id === c.id)) continue;
    const legacy = LEGACY_CALENDARS.find((d) => d.id === c.id);
    const name = typeof c.name === 'string' ? c.name.replace(/\s+/g, ' ').trim().slice(0, MEMBER_NAME_MAX) : '';
    const old = name === 'Wife' || name === 'Family'; // names saved before 0.3.2 follow the new defaults
    const color = (ENTRY_COLORS as readonly string[]).includes(c.color as string) ? (c.color as EntryColor) : legacy?.color ?? 'gray';
    out.push({ id: c.id, name: !name || old ? legacy?.name ?? 'Membro' : name, color });
    if (out.length >= MEMBER_LIMIT) break;
  }
  return out.length ? out : DEFAULT_CALENDARS.map((c) => ({ ...c }));
}

/** Notes can arrive (sync, backup) for a member this device does not list yet: add it so the notes stay visible and editable. Not saved by itself. */
export function ensureMembers(cals: CalendarDef[], events: { calendarId: string; deletedAt?: number | null }[]): CalendarDef[] {
  // deleted notes (tombstones) do not bring a member back: otherwise a removed «Membro» would reappear forever
  const missing = [...new Set(events.filter((e) => !e.deletedAt).map((e) => e.calendarId))].filter((id) => !cals.some((c) => c.id === id));
  if (!missing.length) return cals;
  return [...cals, ...missing.map((id) => LEGACY_CALENDARS.find((d) => d.id === id) ?? { id, name: 'Membro', color: 'gray' as EntryColor })];
}

/** Members as received from another device: only well-formed ones, at most MEMBER_LIMIT. */
export function sanitizeMembers(raw: unknown): CalendarDef[] {
  const out: CalendarDef[] = [];
  if (!Array.isArray(raw)) return out;
  for (const c of raw) {
    if (!isObj(c) || typeof c.id !== 'string' || !c.id || c.id.length > 64 || out.some((x) => x.id === c.id)) continue;
    const name = typeof c.name === 'string' ? c.name.replace(/\s+/g, ' ').trim().slice(0, MEMBER_NAME_MAX) : '';
    if (!name) continue;
    out.push({ id: c.id, name, color: (ENTRY_COLORS as readonly string[]).includes(c.color as string) ? (c.color as EntryColor) : 'gray' });
    if (out.length >= MEMBER_LIMIT) break;
  }
  return out;
}

const PLACEHOLDER_NAMES = ['Membro', 'name1'];

/** Same person listed twice under different ids (e.g. two devices each created «Anna»). Same name (ignoring case/spaces) = same person.
 *  The smaller id always wins ('personal' last), so every device reaches the same answer on its own. Placeholder names are never merged. */
export function planMemberMerges(cals: CalendarDef[]): { from: string; to: string }[] {
  const norm = (n: string) => n.replace(/\s+/g, ' ').trim().toLowerCase();
  const groups = new Map<string, CalendarDef[]>();
  for (const c of cals) { const k = norm(c.name); if (!k || PLACEHOLDER_NAMES.some((p) => norm(p) === k)) continue; groups.set(k, [...(groups.get(k) ?? []), c]); }
  const out: { from: string; to: string }[] = [];
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    // 'personal' is the id every first install used, so it can mean a different person on each device: it never wins
    const to = g.map((c) => c.id).sort((a, b) => Number(a === 'personal') - Number(b === 'personal') || (a < b ? -1 : 1))[0];
    for (const c of g) if (c.id !== to) out.push({ from: c.id, to });
  }
  return out;
}
/** Names and colours stay per device. A device only borrows the family's: for members it does not have yet, and for members still showing a placeholder name.
 *  Returns the same array when nothing changes. */
export function adoptMembers(local: CalendarDef[], incoming: CalendarDef[]): CalendarDef[] {
  let changed = false;
  const out = local.map((c) => {
    const inc = incoming.find((i) => i.id === c.id);
    if (inc && PLACEHOLDER_NAMES.includes(c.name) && inc.name !== c.name) { changed = true; return { ...c, name: inc.name, color: inc.color }; }
    return c;
  });
  for (const i of incoming) {
    if (out.length >= MEMBER_LIMIT) break;
    if (!out.some((c) => c.id === i.id)) { out.push(i); changed = true; }
  }
  return changed ? out : local;
}
