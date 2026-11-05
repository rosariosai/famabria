// Reminders for notes. Pure logic: when does a note's reminder fire, which ones are coming up.
import type { CalEvent } from './events';

export const REMIND_KEYS = ['none', 'at', '10m', '1h', '1d'] as const;
export type RemindKey = (typeof REMIND_KEYS)[number];
export const isRemindKey = (x: unknown): x is RemindKey => typeof x === 'string' && (REMIND_KEYS as readonly string[]).includes(x);

/** Labels for the note form. The home server checks once an hour, so "10 minutes before" is no longer offered (old notes that have it still work).  A note with no time reminds at 09:00 of its day, or at 18:00 the day before. */
export function remindOptions(hasTime: boolean): { key: RemindKey; label: string }[] {
  return hasTime
    ? [{ key: 'none', label: 'Nessuno' }, { key: 'at', label: "All'ora della nota" }, { key: '1h', label: '1 ora prima' }, { key: '1d', label: 'Il giorno prima alle 18:00' }]
    : [{ key: 'none', label: 'Nessuno' }, { key: 'at', label: 'Alle 09:00 del giorno' }, { key: '1d', label: 'Il giorno prima alle 18:00' }];
}

const at = (date: string, hh: number, mm: number, dayShift = 0) =>
  new Date(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)) + dayShift, hh, mm, 0, 0).getTime();

/** Moment (ms, local time of the device) when the reminder of this note must fire, or null. */
export function reminderAt(e: Pick<CalEvent, 'date' | 'time' | 'remind' | 'deletedAt'>): number | null {
  const k = e.remind ?? 'none';
  if (k === 'none' || e.deletedAt !== null) return null;
  if (k === '1d') return at(e.date, 18, 0, -1);
  if (!e.time) return k === 'at' ? at(e.date, 9, 0) : null;
  const [h, m] = e.time.split(':').map(Number);
  const base = at(e.date, h, m);
  return k === 'at' ? base : k === '10m' ? base - 10 * 60_000 : base - 60 * 60_000;
}

export interface Upcoming { id: string; at: number; title: string; body: string }

export function whenText(e: Pick<CalEvent, 'date' | 'time'>): string {
  const d = `${e.date.slice(8, 10)}/${e.date.slice(5, 7)}`;
  return e.time ? `${d} alle ${e.time}` : `${d}, tutto il giorno`;
}

/** Reminders that fire after `from` and before `from + horizonMs`, soonest first (at most `max`). */
export function upcomingReminders(events: CalEvent[], from: number, horizonMs: number, max = 200): Upcoming[] {
  const out: Upcoming[] = [];
  for (const e of events) {
    const t = reminderAt(e);
    if (t !== null && t > from && t <= from + horizonMs) out.push({ id: e.id, at: t, title: e.title, body: whenText(e) });
  }
  return out.sort((a, b) => a.at - b.at).slice(0, max);
}

/** Reminders that came due in the window (from, to]. */
export function dueReminders(events: CalEvent[], from: number, to: number): Upcoming[] {
  const out: Upcoming[] = [];
  for (const e of events) {
    const t = reminderAt(e);
    if (t !== null && t > from && t <= to) out.push({ id: e.id, at: t, title: e.title, body: whenText(e) });
  }
  return out.sort((a, b) => a.at - b.at);
}
