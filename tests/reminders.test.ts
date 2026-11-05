import { describe, expect, it } from 'vitest';
import { dueReminders, reminderAt, upcomingReminders } from '../src/core/reminders';
import type { CalEvent } from '../src/core/events';

const ev = (o: Partial<CalEvent>): CalEvent => ({ id: 'a', calendarId: 'personal', date: '2026-11-10', title: 'Dentista', notes: '', time: '15:30', color: 'blue', createdAt: 1, updatedAt: 1, deletedAt: null, remind: 'none', ...o });
const t = (d: string, h: number, m: number) => { const [y, mo, da] = d.split('-').map(Number); return new Date(y, mo - 1, da, h, m).getTime(); };

describe('reminders', () => {
  it('has none by default', () => { expect(reminderAt(ev({}))).toBeNull(); expect(reminderAt(ev({ remind: undefined }))).toBeNull(); });
  it('timed note: at the time, 10 minutes and 1 hour before', () => {
    expect(reminderAt(ev({ remind: 'at' }))).toBe(t('2026-11-10', 15, 30));
    expect(reminderAt(ev({ remind: '10m' }))).toBe(t('2026-11-10', 15, 20));
    expect(reminderAt(ev({ remind: '1h' }))).toBe(t('2026-11-10', 14, 30));
  });
  it('the evening before is 18:00 of the previous day, also across a month end', () => {
    expect(reminderAt(ev({ remind: '1d' }))).toBe(t('2026-11-09', 18, 0));
    expect(reminderAt(ev({ date: '2026-12-01', time: null, remind: '1d' }))).toBe(t('2026-11-30', 18, 0));
  });
  it('all-day note: 09:00 of the day; "before" options do not apply', () => {
    expect(reminderAt(ev({ time: null, remind: 'at' }))).toBe(t('2026-11-10', 9, 0));
    expect(reminderAt(ev({ time: null, remind: '10m' }))).toBeNull();
  });
  it('deleted notes never remind', () => { expect(reminderAt(ev({ remind: 'at', deletedAt: 5 }))).toBeNull(); });
  it('lists coming and just-due reminders', () => {
    const list = [ev({ id: '1', remind: '1h' }), ev({ id: '2', remind: 'at', date: '2026-11-20' }), ev({ id: '3' })];
    const now = t('2026-11-10', 12, 0);
    expect(upcomingReminders(list, now, 2 * 86_400_000).map((x) => x.id)).toEqual(['1']);
    expect(dueReminders(list, t('2026-11-10', 14, 0), t('2026-11-10', 14, 31)).map((x) => x.id)).toEqual(['1']);
  });
});
