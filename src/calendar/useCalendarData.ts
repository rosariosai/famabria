import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_CAL_SETTINGS, ensureMembers, type CalEvent, type CalSettings } from '../core/events';
import { upcomingReminders } from '../core/reminders';
import { getAllEvents, getCalSettings, openDb, putEvent, saveCalSettings, type Db } from '../data/db';

/** Loads calendar entries + settings from IndexedDB and writes changes straight back. Reloads when the tab regains focus
 *  (sync, may have changed the data meanwhile). */
export function useCalendarData() {
  const db = useRef<Db | null>(null);
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [stored, setSettings] = useState<CalSettings>(DEFAULT_CAL_SETTINGS);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  const reload = useCallback(async () => {
    if (!db.current) return;
    const [e, s] = await Promise.all([getAllEvents(db.current), getCalSettings(db.current)]);
    setEvents(e); setSettings(s);
  }, []);

  useEffect(() => {
    let alive = true;
    openDb().then(async (d) => { db.current = d; await reload(); if (alive) setState('ready'); }).catch((e) => { console.error(e); if (alive) setState('error'); });
    const onVisible = () => { if (document.visibilityState === 'visible') void reload().catch(() => undefined); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => { alive = false; document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('focus', onVisible); };
  }, [reload]);

  const save = useCallback(async (e: CalEvent) => {
    const put = (cur: CalEvent[]) => (cur.some((x) => x.id === e.id) ? cur.map((x) => (x.id === e.id ? e : x)) : [...cur, e]);
    setEvents(put);
    if (!db.current) throw new Error('il database locale non è pronto');
    await putEvent(db.current, e);
    // A reload (tab focus, sync) that read the database before this write finished would have dropped the note from the screen: put it back.
    setEvents((cur) => (cur.some((x) => x.id === e.id && x.updatedAt >= e.updatedAt) ? cur : put(cur)));
  }, []);
  const saveSettings = useCallback(async (s: CalSettings) => {
    setSettings(s);
    if (db.current) await saveCalSettings(db.current, s);
  }, []);

  // Members that appear only in notes (sync) are added to the list on the fly; the default member must exist.
  const settings = useMemo<CalSettings>(() => {
    const calendars = ensureMembers(stored.calendars, events);
    const defaultCalendar = calendars.some((c) => c.id === stored.defaultCalendar) ? stored.defaultCalendar : calendars[0].id;
    return calendars === stored.calendars && defaultCalendar === stored.defaultCalendar ? stored : { ...stored, calendars, defaultCalendar };
  }, [stored, events]);

  // Android app: hand the upcoming reminders to the native side (alarms + notifications that work with the app closed).
  useEffect(() => {
    const native = (window as unknown as { FamabriaNative?: { setReminders(json: string): void } }).FamabriaNative;
    if (!native || state !== 'ready') return;
    try { native.setReminders(JSON.stringify(upcomingReminders(events, Date.now(), 45 * 86_400_000, 100))); } catch { /* not running in the Android app */ }
  }, [events, state]);

  const getDb = useCallback(() => db.current, []);
  return { state, events, settings, save, saveSettings, reload, getDb };
}
