// A backup file = all notes (including deleted ones) + the calendar settings (member names/colours, theme). Never the family key or any token.
import { mergeEvents, parseCalSettings, parseEvents, type CalEvent, type CalSettings } from './events';

export const BACKUP_APP = 'famabria';
export const BACKUP_MAX_BYTES = 20 * 1024 * 1024;

export function makeBackup(events: CalEvent[], settings: CalSettings, now: number): string {
  return JSON.stringify({ app: BACKUP_APP, v: 1, exportedAt: now, events, settings }, null, 1);
}
export const backupName = (now: number) => `famabria-copia-${new Date(now).toISOString().slice(0, 10)}.json`;

export function parseBackup(text: string): { events: CalEvent[]; settings: CalSettings; dropped: number } | null {
  if (text.length > BACKUP_MAX_BYTES) return null;
  try {
    const o = JSON.parse(text) as { app?: unknown; v?: unknown; events?: unknown; settings?: unknown };
    if ((o.app !== BACKUP_APP && o.app !== 'famcal') || o.v !== 1) return null;
    const { events, dropped } = parseEvents(o.events);
    return { events, settings: parseCalSettings(o.settings), dropped };
  } catch { return null; }
}
/** Notes of the backup that are missing or newer than ours (nothing newer on this device is ever overwritten). */
export const eventsToRestore = (local: CalEvent[], backup: CalEvent[]): CalEvent[] => {
  const merged = mergeEvents(local, backup); const known = new Map(local.map((e) => [e.id, e.updatedAt]));
  return merged.filter((e) => known.get(e.id) !== e.updatedAt);
};
