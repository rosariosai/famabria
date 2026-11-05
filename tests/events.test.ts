import { describe, expect, it } from 'vitest';
import { highlightParts, ensureMembers, planMemberMerges, calendarOf, byDate, cleanEntry, createEvent, mergeEvents, parseCalSettings, parseEvents, restore, searchEntries, softDelete, updateEvent, type CalEvent } from '../src/core/events';

const mk = (id: string, date: string, title: string, o: Partial<CalEvent> = {}): CalEvent => {
  const c = cleanEntry({ date, title });
  if (!c.ok) throw new Error(c.error);
  return { ...createEvent(c.value, id, 1), ...o };
};

describe('members', () => {
  it('a fresh install has exactly one member, name1, and needs the welcome screen', () => {
    const d = parseCalSettings(undefined);
    expect(d.calendars).toEqual([{ id: 'personal', name: 'name1', color: 'blue' }]);
    expect(d.defaultCalendar).toBe('personal');
    expect(d.welcomed).toBe(false);
  });
  it('settings saved before members existed keep Ros / Anna / Athena and skip the welcome', () => {
    const s = parseCalSettings({ saints: true });
    expect(s.calendars.map((c) => c.name)).toEqual(['Ros', 'Anna', 'Athena']);
    expect(s.welcomed).toBe(true);
    const old = parseCalSettings({ calendars: [{ id: 'personal', name: 'Ros', color: 'blue' }, { id: 'wife', name: 'Wife', color: 'pink' }, { id: 'family', name: 'Family', color: 'green' }] });
    expect(old.calendars.map((c) => c.name)).toEqual(['Ros', 'Anna', 'Athena']);
  });
  it('keeps any number of members, applies names and colours, drops junk and duplicates', () => {
    const s = parseCalSettings({ calendars: [{ id: 'wife', name: '  Annie  ', color: 'purple' }, { id: 'm1', name: 'Nonna', color: 'neon' }, { id: 'm1', name: 'dup' }, { id: '', name: 'x' }, 5], hiddenCalendars: ['wife', 5], defaultCalendar: 'm1' });
    expect(s.calendars).toEqual([{ id: 'wife', name: 'Annie', color: 'purple' }, { id: 'm1', name: 'Nonna', color: 'gray' }]);
    expect(s.hiddenCalendars).toEqual(['wife']);
    expect(s.defaultCalendar).toBe('m1');
  });
  it('an empty list falls back to name1', () => {
    expect(parseCalSettings({ calendars: [] }).calendars.map((c) => c.name)).toEqual(['name1']);
  });
  it('ensureMembers adds members that only appear in notes (sync), with the legacy names when known', () => {
    const cals = parseCalSettings(undefined).calendars;
    expect(ensureMembers(cals, [{ calendarId: 'personal' }])).toBe(cals);
    const more = ensureMembers(cals, [{ calendarId: 'wife' }, { calendarId: 'wife' }, { calendarId: 'zzz' }]);
    expect(more.map((c) => `${c.id}:${c.name}:${c.color}`)).toEqual(['personal:name1:blue', 'wife:Anna:pink', 'zzz:Membro:gray']);
  });
  it('unknown calendar ids are shown grey, not lost', () => {
    expect(calendarOf(parseCalSettings(null).calendars, 'future')).toEqual({ id: 'future', name: 'future', color: 'gray' });
  });
  it('keeps who changed a note', () => {
    expect(parseEvents([{ id: 'a', date: '2027-01-05', title: 't', by: 'wife' }]).events[0].by).toBe('wife');
    expect(parseEvents([{ id: 'a', date: '2027-01-05', title: 't' }]).events[0].by).toBeUndefined();
  });
});

describe('cleanEntry', () => {
  it('trims, defaults and limits', () => {
    const r = cleanEntry({ date: '2027-01-05', title: '  Dentist   Rossi ', notes: ' bring card \r\n', time: '09:30' });
    expect(r.ok && r.value).toMatchObject({ title: 'Dentist Rossi', notes: 'bring card', time: '09:30', color: 'blue', calendarId: 'personal' });
  });
  it('a note without title uses its first line as the title', () => {
    const r = cleanEntry({ date: '2027-01-05', title: '', notes: 'Buy milk\nand bread' });
    expect(r.ok && r.value.title).toBe('Buy milk');
  });
  it('rejects empty, bad date and bad time', () => {
    expect(cleanEntry({ date: '2027-01-05', title: ' ', notes: '' }).ok).toBe(false);
    expect(cleanEntry({ date: '2027-13-05', title: 'x' }).ok).toBe(false);
    expect(cleanEntry({ date: '2027-01-05', title: 'x', time: '25:00' }).ok).toBe(false);
    expect(cleanEntry({ date: '2027-01-05', title: 'x', color: 'neon' as never }).ok && true).toBe(true); // unknown colour -> default
  });
});

describe('lifecycle', () => {
  it('soft delete keeps a tombstone and restore brings it back', () => {
    const e = mk('a', '2027-01-05', 'A');
    const d = softDelete(e, 10);
    expect(d.deletedAt).toBe(10);
    expect(byDate([d])).toEqual({});
    expect(byDate([restore(d, 11)])['2027-01-05']).toHaveLength(1);
  });
  it('update bumps updatedAt only', () => {
    const e = mk('a', '2027-01-05', 'A');
    const c = cleanEntry({ date: '2027-01-06', title: 'B' });
    if (!c.ok) throw new Error();
    const u = updateEvent(e, c.value, 99);
    expect(u).toMatchObject({ id: 'a', title: 'B', date: '2027-01-06', createdAt: 1, updatedAt: 99 });
  });
});

describe('ordering, search, merge', () => {
  it('all-day first, then by time', () => {
    const list = byDate([mk('a', '2027-01-05', 'late', { time: '20:00' }), mk('b', '2027-01-05', 'note'), mk('c', '2027-01-05', 'early', { time: '08:15' })]);
    expect(list['2027-01-05'].map((e) => e.title)).toEqual(['note', 'early', 'late']);
  });
  it('search is AND, accent- and case-insensitive, skips deleted, in date order', () => {
    const ev = [mk('a', '2027-03-01', 'Visita dentista', { notes: 'Dott. Rossi' }), mk('b', '2027-02-01', 'Cena da Zoe', { notes: 'porta il Dolce' }), mk('c', '2027-02-02', 'dentista', { deletedAt: 5 })];
    expect(searchEntries(ev, 'DOLCÈ').map((e) => e.id)).toEqual(['b']);
    expect(searchEntries(ev, 'dentista rossi').map((e) => e.id)).toEqual(['a']);
    expect(searchEntries(ev, 'dentista').map((e) => e.id)).toEqual(['a']);
    expect(searchEntries(ev, '  ')).toEqual([]);
  });
  it('merge: newer updatedAt wins, new ids are added', () => {
    const local = [mk('a', '2027-01-05', 'old', { updatedAt: 5 }), mk('b', '2027-01-06', 'keep', { updatedAt: 9 })];
    const merged = mergeEvents(local, [mk('a', '2027-01-05', 'new', { updatedAt: 6 }), mk('b', '2027-01-06', 'stale', { updatedAt: 1 }), mk('c', '2027-01-07', 'added')]);
    expect(Object.fromEntries(merged.map((e) => [e.id, e.title]))).toEqual({ a: 'new', b: 'keep', c: 'added' });
  });
});

describe('parsing untrusted data', () => {
  it('drops broken records, keeps good ones', () => {
    const r = parseEvents([{ id: 'x', date: '2027-01-05', title: 'ok', time: '07:00', color: 'green', updatedAt: 3 }, { id: 'y', date: 'nope', title: 't' }, 'junk', { id: 'z', date: '2027-01-05', title: '', notes: '' }]);
    expect(r.events).toHaveLength(1);
    expect(r.events[0]).toMatchObject({ id: 'x', color: 'green', updatedAt: 3, deletedAt: null });
    expect(r.dropped).toBe(3);
  });
  it('calendar settings fall back to defaults', () => {
    expect(parseCalSettings({ saints: false, localMonth: 99, localName: ' Roma ' })).toMatchObject({ saints: false, moon: true, localMonth: 5, localName: 'Roma' });
    expect(parseCalSettings(null).weeks).toBe(true);
  });
});

describe('sides setting', () => {
  it('is automatic (null) unless saved as a boolean', () => {
    expect(parseCalSettings(null).sides).toBeNull();
    expect(parseCalSettings({ sides: true }).sides).toBe(true);
    expect(parseCalSettings({ sides: false }).sides).toBe(false);
    expect(parseCalSettings({ sides: 'yes' }).sides).toBeNull();
  });
});

describe('colour scheme setting', () => {
  it('defaults to the system theme; accepts only light or dark', () => {
    expect(parseCalSettings({})).toMatchObject({ theme: 'system' });
    expect(parseCalSettings({ theme: 'dark' })).toMatchObject({ theme: 'dark' });
    expect(parseCalSettings({ theme: 'blue' })).toMatchObject({ theme: 'system' });
  });
});

describe('highlightParts', () => {
  it('marks matches ignoring accents and case, keeps the original text', () => {
    expect(highlightParts('Scuola Athena — Festa', 'scuola')).toEqual([{ text: 'Scuola', hit: true }, { text: ' Athena — Festa', hit: false }]);
    expect(highlightParts('Visita pediatrà e pediatra', 'PEDIATRA').map((p) => p.hit)).toEqual([false, true, false, true]);
    expect(highlightParts('abc', '')).toEqual([{ text: 'abc', hit: false }]);
    expect(highlightParts('a b', 'a b').map((p) => p.text).join('')).toBe('a b');
  });

  it('planMemberMerges merges the same name under different ids, smaller id wins, placeholders are left alone', () => {
    const cals = [
      { id: 'personal', name: 'Ros', color: 'blue' as const }, { id: 'wife', name: 'Anna', color: 'pink' as const },
      { id: 'm0a1', name: ' anna ', color: 'green' as const }, { id: 'x1', name: 'Membro', color: 'gray' as const }, { id: 'x2', name: 'Membro', color: 'gray' as const },
    ];
    expect(planMemberMerges(cals)).toEqual([{ from: 'wife', to: 'm0a1' }]);
    expect(planMemberMerges([cals[0], cals[1]])).toEqual([]);
    expect(planMemberMerges([{ id: 'personal', name: 'Anna', color: 'pink' as const }, cals[1]])).toEqual([{ from: 'personal', to: 'wife' }]);
  });
});
