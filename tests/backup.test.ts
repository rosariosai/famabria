import { describe, expect, it } from 'vitest';
import { backupName, eventsToRestore, makeBackup, parseBackup } from '../src/core/backup';
import { cleanEntry, createEvent, DEFAULT_CAL_SETTINGS, softDelete, type CalEvent } from '../src/core/events';

const note = (id: string, title: string, at: number): CalEvent => { const c = cleanEntry({ date: '2026-11-05', title }); if (!c.ok) throw new Error('x'); return createEvent(c.value, id, at); };

describe('backup', () => {
  it('round-trips notes (deleted ones too) and settings, and contains no family secrets', () => {
    const events = [note('a', 'Dentista', 1), softDelete(note('b', 'Cena', 2), 3)];
    const text = makeBackup(events, { ...DEFAULT_CAL_SETTINGS, calendars: [{ id: 'personal', name: 'Rosario', color: 'blue' }] }, 1_800_000_000_000);
    const b = parseBackup(text)!;
    expect(b.events.map((e) => e.id).sort()).toEqual(['a', 'b']); expect(b.events.find((e) => e.id === 'b')!.deletedAt).toBe(3);
    expect(b.settings.calendars[0].name).toBe('Rosario'); expect(b.dropped).toBe(0);
    expect(text).not.toMatch(/token|"key"|invite/i);
    expect(backupName(1_800_000_000_000)).toMatch(/^famabria-copia-\d{4}-\d{2}-\d{2}\.json$/);
  });
  it('rejects other files and restores only what is missing or newer', () => {
    expect(parseBackup('{"hello":1}')).toBeNull(); expect(parseBackup('not json')).toBeNull();
    const local = [note('a', 'Nuova versione', 10), note('c', 'Solo qui', 5)];
    const back = [note('a', 'Vecchia versione', 4), note('b', 'Mancante', 3)];
    const r = eventsToRestore(local, back);
    expect(r.map((e) => e.id)).toEqual(['b']);                                  // 'a' on this device is newer: kept
  });
});
