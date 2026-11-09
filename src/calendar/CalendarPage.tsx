import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MONTHS, WEEKDAYS, WEEKDAYS_SHORT, addKeyDays, formatYearMonth, isoWeek, weekMonday, monthCells, parseYearMonth, shiftMonth, swipeMonthDelta, weekdayOf, type DayCell, type MoonPhase, type YearMonth,
} from '../core/calendar';
import { RemindIcon } from './RemindIcon';
import { LANG, tr } from '../core/i18n';
import { adoptMembers, planMemberMerges, byDate, calendarOf, cleanEntry, createEvent, highlightParts, restore, searchEntries, softDelete, updateEvent, type CalEvent, type CalendarDef, type CalSettings } from '../core/events';
import { newId } from '../core/id';
import { CalSettingsDialog } from './CalSettingsDialog';
import { EntryDialog, type EntryValue } from './EntryDialog';
import { useCalendarData } from './useCalendarData';
import { useSync } from './useSync';
import { IS_WEB } from '../browser/api';
import { SyncDialog, statusWord } from './SyncDialog';
import { WelcomeDialog } from './WelcomeDialog';
import { FamilyDialog, familyWord } from './FamilyDialog';
import { useFamily } from './useFamily';
import { inviteFromText } from '../cloud/family';
import { putEvents } from '../data/db';
import { eventsToRestore } from '../core/backup';
import { finishDropboxLogin } from '../cloud/dropbox';

const MOON: Record<MoonPhase, string> = { new: tr('Luna nuova', 'New moon'), first: tr('Primo quarto', 'First quarter'), full: tr('Luna piena', 'Full moon'), last: tr('Ultimo quarto', 'Last quarter') };

/** Northern-hemisphere look: first quarter is lit on the right, last quarter on the left. */
function MoonIcon({ phase }: { phase: MoonPhase }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden focusable="false">
      <circle cx="8" cy="8" r="6.5" fill={phase === 'new' ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.5" />
      {phase === 'first' && <path d="M8 1.5a6.5 6.5 0 0 1 0 13z" fill="currentColor" />}
      {phase === 'last' && <path d="M8 1.5a6.5 6.5 0 0 0 0 13z" fill="currentColor" />}
    </svg>
  );
}

const nowYm = (): YearMonth => { const d = new Date(); return { year: d.getFullYear(), month: d.getMonth() }; };
const fromHash = (): YearMonth => parseYearMonth(location.hash.replace(/^#/, '')) ?? nowYm();
const keyToParts = (k: string) => ({ y: Number(k.slice(0, 4)), m: Number(k.slice(5, 7)) - 1, d: Number(k.slice(8, 10)) });
const longDate = (k: string) => { const { y, m, d } = keyToParts(k); return `${WEEKDAYS[weekdayOf(y, m, d)]} ${d} ${tr(MONTHS[m].toLowerCase(), MONTHS[m])} ${y}`; };

function Marked({ text, query }: { text: string; query: string }) {
  return <>{highlightParts(text, query).map((p, i) => (p.hit ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>))}</>;
}

function useYearMonth() {
  const [ym, setYm] = useState<YearMonth>(fromHash);
  useEffect(() => {
    const on = () => { const n = fromHash(); setYm((cur) => (cur.year === n.year && cur.month === n.month ? cur : n)); };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  // Update state at once (fast key repeat must not use a stale month), then reflect it in the URL.
  const go = useCallback((next: YearMonth) => { setYm(next); location.hash = formatYearMonth(next); }, []);
  return [ym, go] as const;
}

function Strip(props: { ym: YearMonth; side: 'prev' | 'next'; onGo(): void; local: ReturnType<typeof localOf> }) {
  const cells = useMemo(() => monthCells(props.ym.year, props.ym.month, { local: props.local }), [props.ym, props.local]);
  return (
    <aside className={`strip strip--${props.side}`} aria-label={props.side === 'prev' ? tr('Mese precedente', 'Previous month') : tr('Mese successivo', 'Next month')}>
      <button className="strip-head" onClick={props.onGo} lang={LANG}>
        <span className="full">{MONTHS[props.ym.month].toUpperCase()}</span><span className="abbr" aria-hidden="true">{MONTHS[props.ym.month].slice(0, 3).toUpperCase()}</span><b>{props.ym.year}</b>
      </button>
      <ol className="strip-days">
        {cells.map((c) => (
          <li key={c.key} className={`${c.red ? 'red' : ''}${c.weekday === 0 ? ' wk-end' : ''}`}><span>{c.day}</span><span className="wd">{WEEKDAYS_SHORT[c.weekday]}</span><span className="ini" aria-hidden="true">{WEEKDAYS_SHORT[c.weekday][0]}</span></li>
        ))}
      </ol>
    </aside>
  );
}

const localOf = (s: { localName: string; localMonth: number; localDay: number }) => (s.localName ? { name: s.localName, month: s.localMonth, day: s.localDay } : null);

function DayRow(props: { calendars: CalendarDef[]; c: DayCell; today: boolean; entries: CalEvent[]; showMoon: boolean; showWeeks: boolean; ym: YearMonth; onOpen(key: string): void }) {
  const { c, entries } = props;
  return (
    <li className={`day${c.red ? ' red' : ''}${props.today ? ' today' : ''}${c.weekday === 0 ? ' wk-end' : ''}`}>
      <button className="day-btn" onClick={() => props.onOpen(c.key)} aria-current={props.today ? 'date' : undefined} title={tr('Aggiungi o modifica note', 'Add or edit notes')}>
        <span className="day-num">{c.day}</span>
        <span className="day-main">
          <span className="day-name">{WEEKDAYS[c.weekday]}<span className="sr-only"> {tr(MONTHS[props.ym.month].toLowerCase(), MONTHS[props.ym.month])} {props.ym.year}</span></span>
          {c.caption && <span className="day-caption">{c.caption}</span>}
          {entries.length > 0 && (
            <span className="day-entries">
              {entries.slice(0, 2).map((e) => (
                <span key={e.id} className="day-entry"><i className={`dot dot--${calendarOf(props.calendars, e.calendarId).color}`} aria-hidden />{e.time && <b>{e.time}</b>}<span className="truncate">{e.title}</span><RemindIcon e={e} /></span>
              ))}
              {entries.length > 2 && <span className="day-more">+{entries.length - 2}</span>}
              <span className="sr-only">, {entries.length} {entries.length === 1 ? tr('nota', 'note') : tr('note', 'notes')}</span>
            </span>
          )}
        </span>
        <span className="day-side">
          {props.showWeeks && c.week && <span className="week" title={`${tr('Settimana', 'Week')} ${c.week}`}><span className="sr-only">{tr('Settimana', 'Week')} </span>{c.week}</span>}
          {props.showMoon && c.moon && <span className="moon" title={MOON[c.moon]}><MoonIcon phase={c.moon} /><span className="sr-only">{MOON[c.moon]}</span></span>}
        </span>
      </button>
    </li>
  );
}

export function CalendarPage() {
  const [ym, go] = useYearMonth();
  const { state, events, settings, save: saveLocal, saveSettings, reload, getDb } = useCalendarData();
  const restoreBackup = useCallback(async (incoming: CalEvent[], st: CalSettings): Promise<number> => {
    const db = getDb(); if (!db) return 0;
    const todo = eventsToRestore(events, incoming);
    if (todo.length) await putEvents(db, todo);
    await saveSettings(st); await reload(); return todo.length;
  }, [events, getDb, saveSettings, reload]);
  /** Moves every live note of member `from` to member `to` (fresh updatedAt, so the move syncs to the family). The caller then removes `from`. */
  const mergeMember = useCallback(async (from: string, to: string): Promise<number> => {
    const db = getDb(); if (!db) return 0;
    const now = Date.now();
    const moved = events.filter((e) => e.calendarId === from && e.deletedAt === null).map((e) => ({ ...e, calendarId: to, updatedAt: now }));
    if (moved.length) await putEvents(db, moved);
    await reload(); return moved.length;
  }, [events, getDb, reload]);
  // The same person listed twice (two devices each made «Anna»): merge into one, notes included. Runs by itself on every device with the same result.
  const merging = useRef(false);
  const sync = useSync(state === 'ready', getDb, reload);
  const settingsRef = useRef(settings); settingsRef.current = settings;
  const getMembers = useCallback(() => settingsRef.current.calendars, []);
  const onMembers = useCallback((incoming: CalendarDef[]) => { // names and colours stay per device: only missing / placeholder members are filled in from the family
    const next = adoptMembers(settingsRef.current.calendars, incoming);
    if (next !== settingsRef.current.calendars) void saveSettings({ ...settingsRef.current, calendars: next });
  }, [saveSettings]);
  useEffect(() => {
    if (state !== 'ready' || merging.current) return;
    const plan = planMemberMerges(settings.calendars); if (!plan.length) return;
    merging.current = true;
    void (async () => {
      try {
        for (const m of plan) await mergeMember(m.from, m.to);
        const cur = settingsRef.current, gone = new Set(plan.map((m) => m.from)), to = (id: string) => plan.find((m) => m.from === id)?.to ?? id;
        await saveSettings({ ...cur, calendars: cur.calendars.filter((c) => !gone.has(c.id)), hiddenCalendars: cur.hiddenCalendars.filter((x) => !gone.has(x)), defaultCalendar: to(cur.defaultCalendar) });
        changed();
      } finally { merging.current = false; }
    })();
  }, [state, settings.calendars]); // eslint-disable-line react-hooks/exhaustive-deps
  const fam = useFamily(state === 'ready', getDb, reload, getMembers, onMembers);
  const changed = useCallback(() => { sync.changed(); fam.changed(); }, [sync.changed, fam.changed]); // eslint-disable-line react-hooks/exhaustive-deps
  const me = sync.config?.user;
  const save = useCallback(async (e: CalEvent) => { await saveLocal({ ...e, by: me }); changed(); }, [saveLocal, changed, me]);
  const local = useMemo(() => localOf(settings), [settings]);
  const cells = useMemo(() => monthCells(ym.year, ym.month, { saints: settings.saints, local }), [ym, settings.saints, local]);
  const visibleEvents = useMemo(() => events.filter((e) => !settings.hiddenCalendars.includes(e.calendarId)), [events, settings.hiddenCalendars]);
  const entriesByDate = useMemo(() => byDate(visibleEvents), [visibleEvents]);
  const half = Math.ceil(cells.length / 2);
  const t = new Date();
  const todayKey = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  const [yearText, setYearText] = useState(String(ym.year));
  const [openDate, setOpenDate] = useState<string | null>(null);
  const [selDate, setSelDate] = useState(todayKey);
  const [view, setViewState] = useState<'month' | 'week'>(() => { try { return localStorage.getItem('famcal-view') === 'week' ? 'week' : 'month'; } catch { return 'month'; } });
  const [weekDay, setWeekDay] = useState(todayKey); // any day of the week on screen
  const setView = (v: 'month' | 'week') => {
    setViewState(v); try { localStorage.setItem('famcal-view', v); } catch { /* no memory in private windows */ }
    if (v === 'week') setWeekDay(selDate.slice(0, 7) === formatYearMonth(ym) ? selDate : `${formatYearMonth(ym)}-01`);
    else { const p = keyToParts(weekDay); go({ year: p.y, month: p.m }); }
  };
  const step = (d: number) => { if (view === 'week') setWeekDay((w) => addKeyDays(w, 7 * d)); else go(shiftMonth(ym, d)); };
  const goToday = () => { if (view === 'week') setWeekDay(todayKey); go(nowYm()); };
  const weekCells = useMemo(() => {
    const out: DayCell[] = []; const cache = new Map<string, DayCell[]>(); const mon = weekMonday(weekDay);
    for (let i = 0; i < 7; i++) {
      const k = addKeyDays(mon, i); const p = keyToParts(k); const ck = `${p.y}-${p.m}`;
      let cs = cache.get(ck); if (!cs) { cs = monthCells(p.y, p.m, { saints: settings.saints, local }); cache.set(ck, cs); }
      const c = cs.find((x) => x.key === k); if (c) out.push(c);
    }
    return out;
  }, [weekDay, settings.saints, local]);
  const weekLabel = (() => {
    if (weekCells.length < 7) return '';
    const a = keyToParts(weekCells[0].key), b = keyToParts(weekCells[6].key);
    const from = a.m === b.m ? `${a.d}` : `${a.d} ${tr(MONTHS[a.m].toLowerCase(), MONTHS[a.m])}`;
    return `${from} – ${b.d} ${tr(MONTHS[b.m].toLowerCase(), MONTHS[b.m])} ${b.y}`;
  })();
  const [desktop, setDesktop] = useState(() => window.matchMedia('(min-width: 1000px)').matches);
  useEffect(() => { const mq = window.matchMedia('(min-width: 1000px)'); const f = () => setDesktop(mq.matches); mq.addEventListener('change', f); return () => mq.removeEventListener('change', f); }, []);
  const [showSettings, setShowSettings] = useState(false);
  const [showSync, setShowSync] = useState(false);
  const [showFamily, setShowFamily] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [inviteText, setInviteText] = useState('');
  const [query, setQuery] = useState('');
  const [toast, setToast] = useState<{ message: string; run(): void } | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  // First run: a brand-new install (no settings, no notes) asks "Come ti chiami?". Installs that already hold notes are marked as welcomed.
  // SOLO = one person, one device: all sharing UI stays hidden. Joining a family or a home server switches to shared by itself.
  const solo = settings.mode === 'solo' && !fam.family && !sync.config;
  useEffect(() => { if (state === 'ready' && settings.mode === 'solo' && (fam.family || sync.config)) void saveSettings({ ...settings, mode: 'shared' }); }, [state, settings, fam.family, sync.config, saveSettings]);
  const showWelcome = state === 'ready' && !settings.welcomed && events.length === 0 && !showSync && !showFamily && !fam.family;
  useEffect(() => { if (state === 'ready' && !settings.welcomed && events.length > 0) void saveSettings({ ...settings, welcomed: true }); }, [state, settings, events.length, saveSettings]);
  const dialogOpen = openDate !== null || showSettings || showSync || showWelcome || showFamily;

  // Web app only: a setup link ends in #token=tn_… (the part after # never reaches the server); connect with it and clear it from the address.
  // Without a saved server, open the sync dialog so the token can be pasted.
  const booted = useRef(false);
  useEffect(() => {
    if (!IS_WEB || !sync.loaded || !fam.loaded || state !== 'ready' || booted.current) return;
    booted.current = true;
    const q = new URLSearchParams(location.search);
    if (q.get('code') && q.get('state')) { // back from Dropbox sign-in (PKCE): finish it, create the family, show its invite link
      let pending: { appKey: string; verifier: string; state: string; redirect: string; name: string; device: string } | null = null;
      try { pending = JSON.parse(sessionStorage.getItem('famcal-dropbox-pending') ?? 'null'); sessionStorage.removeItem('famcal-dropbox-pending'); } catch { /* none */ }
      const code = q.get('code')!; const okState = pending && pending.state === q.get('state');
      history.replaceState(null, '', location.pathname + location.hash);
      if (pending && okState) {
        const p = pending;
        void finishDropboxLogin(p.appKey, code, p.verifier, p.redirect)
          .then((cfg) => fam.createWith(p.name, { type: 'dropbox', ...cfg }, p.device)).catch(() => undefined).finally(() => setShowFamily(true));
        return;
      }
    }
    if (inviteFromText(location.hash)) { setInviteText(location.href); history.replaceState(null, '', location.pathname + location.search); setShowFamily(true); return; }
    const m = /^#token=(tn_[A-Za-z0-9_-]{20,80})$/.exec(location.hash);
    if (m) {
      history.replaceState(null, '', location.pathname + location.search);
      void sync.connect({ url: location.origin, token: m[1] }).catch(() => setShowSync(true));
    } else if (!sync.config && !fam.family && settings.mode !== 'solo' && (settings.welcomed || events.length > 0)) setShowFamily(true); // a brand-new install is asked its name first (see onDone below)
  }, [sync, fam.loaded, fam.family, state, settings.welcomed, settings.mode, events.length]);
  useEffect(() => setYearText(String(ym.year)), [ym.year]);
  // Colour scheme: applied on <html> (so dialogs follow too) and remembered in localStorage so the next page load paints right away (theme-boot.js).
  useEffect(() => {
    const root = document.documentElement;
    if (settings.theme === 'system') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', settings.theme);
    try { localStorage.setItem('famcal-theme', settings.theme); } catch { /* private window: no memory, still works */ }
  }, [settings.theme]);
  useEffect(() => { document.title = `${MONTHS[ym.month]} ${ym.year} — Famabria`; }, [ym]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA')) return;
      if (dialogOpen || e.ctrlKey || e.metaKey || e.altKey) return;
      let delta = 0;
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') delta = e.shiftKey ? -12 : -1;
      else if (e.key === 'ArrowRight' || e.key === 'PageDown') delta = e.shiftKey ? 12 : 1;
      else if (e.key.toLowerCase() === 't' && !e.shiftKey) { e.preventDefault(); goToday(); return; }
      else if (e.key === '/') { e.preventDefault(); document.getElementById('cal-search')?.focus(); return; }
      if (delta) { e.preventDefault(); step(delta); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ym, go, dialogOpen, view, weekDay]);

  // Phones: swipe left/right on the calendar to go to the next/previous month.
  useEffect(() => {
    if (dialogOpen) return;
    let start: { x: number; y: number; t: number } | null = null;
    const skip = (t: EventTarget | null) => (t as HTMLElement | null)?.closest?.('input, select, textarea, dialog, .ctoast') != null;
    const onStart = (e: TouchEvent) => { start = e.touches.length === 1 && !skip(e.target) ? { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() } : null; };
    const onEnd = (e: TouchEvent) => {
      const s = start; start = null;
      if (!s || e.changedTouches.length !== 1) return;
      const d = swipeMonthDelta(e.changedTouches[0].clientX - s.x, e.changedTouches[0].clientY - s.y, Date.now() - s.t);
      if (d) step(d);
    };
    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchend', onEnd, { passive: true });
    return () => { window.removeEventListener('touchstart', onStart); window.removeEventListener('touchend', onEnd); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ym, go, dialogOpen, view, weekDay]);

  const commitYear = () => {
    const y = Number(yearText);
    if (Number.isInteger(y) && y >= 1583 && y <= 9999) go({ year: y, month: ym.month });
    else setYearText(String(ym.year));
  };
  const isNow = nowYm().year === ym.year && nowYm().month === ym.month;

  const open = useCallback((key: string) => {
    setSelDate(key);
    if (window.matchMedia('(min-width: 1000px)').matches) { setSaveError(''); window.setTimeout(() => document.getElementById('entry-title-input')?.focus(), 60); return; } // desktop: the side panel has the form
    opener.current = document.activeElement as HTMLElement | null; setOpenDate(key);
  }, []);
  const closeDialog = () => { setOpenDate(null); setShowSettings(false); setShowSync(false); setShowFamily(false); setInviteText(''); setSaveError(''); window.setTimeout(() => opener.current?.focus?.(), 0); };

  const showToast = (message: string, undo: () => void) => {
    window.clearTimeout(toastTimer.current);
    setToast({ message, run: undo });
    toastTimer.current = window.setTimeout(() => setToast(null), 8000);
  };
  const onSave = (v: EntryValue, existing: CalEvent | null) => {
    const date = openDate ?? (desktop ? selDate : null);
    if (!date) return;
    const c = cleanEntry({ date, title: v.title, notes: v.notes, time: v.time, color: v.color, calendarId: v.calendarId, remind: v.remind });
    if (!c.ok) { setSaveError(c.error); return; }
    setSaveError('');
    if (settings.hiddenCalendars.includes(c.value.calendarId)) void saveSettings({ ...settings, hiddenCalendars: settings.hiddenCalendars.filter((x) => x !== c.value.calendarId) }); // a note for a hidden member must not vanish
    save(existing ? updateEvent(existing, c.value, Date.now()) : createEvent(c.value, newId(), Date.now()))
      .catch((e: unknown) => setSaveError(tr(`Non riesco a salvare la nota: ${(e as Error)?.message ?? 'errore sconosciuto'}. Prova a ricaricare la pagina.`, `Could not save the note: ${(e as Error)?.message ?? 'unknown error'}. Try reloading the page.`)));
  };
  const onDelete = (e: CalEvent) => {
    void save(softDelete(e, Date.now()));
    showToast(tr('Nota eliminata', 'Note deleted'), () => { void save(restore(e, Date.now())); setToast(null); });
  };

  const results = useMemo(() => searchEntries(visibleEvents, query), [visibleEvents, query]);
  const searching = query.trim().length > 0;
  const [memberFilter, setMemberFilter] = useState<string | null>(null);
  const counts = useMemo(() => { const m: Record<string, number> = {}; for (const e of results) m[e.calendarId] = (m[e.calendarId] ?? 0) + 1; return m; }, [results]);
  const shown = useMemo(() => (memberFilter ? results.filter((e) => e.calendarId === memberFilter) : results), [results, memberFilter]);
  const months = useMemo(() => {
    const g: { key: string; items: CalEvent[] }[] = [];
    for (const e of shown) { const k = e.date.slice(0, 7); const last = g[g.length - 1]; if (last && last.key === k) last.items.push(e); else g.push({ key: k, items: [e] }); }
    return g;
  }, [shown]);
  const clearSearch = () => { setQuery(''); setMemberFilter(null); };
  const jumpTo = (e: CalEvent) => { const { y, m } = keyToParts(e.date); go({ year: y, month: m }); open(e.date); };

  if (state === 'error') return <p className="cal-error">{tr("Non riesco ad aprire l'archivio locale. Le finestre private o ospite possono bloccarlo.", 'Cannot open local storage. Private or guest windows can block it.')}</p>;

  return (
    <div className="cal">
      <a className="skip-link" href="#cal-days">{tr('Salta ai giorni', 'Skip to days')}</a>
      <nav className="cal-toolbar" aria-label={tr('Navigazione calendario', 'Calendar navigation')}>
        <span className="sp" />
        <label className="sr-only" htmlFor="cal-search">{tr('Cerca nelle note', 'Search notes')}</label>
        <input id="cal-search" className="cbtn cal-search" type="search" placeholder={tr('Cerca nelle note…  ( / )', 'Search notes…  ( / )')} value={query} autoComplete="off"
          onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') { setQuery(''); e.currentTarget.blur(); } }} />
        <div className="view-toggle" role="group" aria-label={tr('Vista', 'View')}>
          <button className="cbtn" aria-pressed={view === 'month'} onClick={() => setView('month')}>{tr('Mese', 'Month')}</button>
          <button className="cbtn" aria-pressed={view === 'week'} onClick={() => setView('week')}>{tr('Settimana', 'Week')}</button>
        </div>
        <button className="cbtn" onClick={() => step(-1)} aria-label={view === 'week' ? tr('Settimana precedente', 'Previous week') : tr('Mese precedente', 'Previous month')} title={tr('Precedente (←)', 'Previous (←)')}>‹</button>
        <button className="cbtn" onClick={goToday} disabled={view === 'week' ? weekMonday(weekDay) === weekMonday(todayKey) : isNow} title={tr('Vai a oggi (T)', 'Go to today (T)')}>{tr('Oggi', 'Today')}</button>
        <button className="cbtn" onClick={() => step(1)} aria-label={view === 'week' ? tr('Settimana successiva', 'Next week') : tr('Mese successivo', 'Next month')} title={tr('Successivo (→)', 'Next (→)')}>›</button>
        <label className="sr-only" htmlFor="cal-month">{tr('Mese', 'Month')}</label>
        <select id="cal-month" className="cbtn" hidden={view === 'week'} value={ym.month} onChange={(e) => go({ year: ym.year, month: Number(e.target.value) })}>
          {MONTHS.map((m, i) => <option key={m} value={i}>{m}</option>)}
        </select>
        <label className="sr-only" htmlFor="cal-year">{tr('Anno', 'Year')}</label>
        <input id="cal-year" className="cbtn cal-year" hidden={view === 'week'} inputMode="numeric" value={yearText} maxLength={4}
          onChange={(e) => setYearText(e.target.value.replace(/\D/g, ''))} onBlur={commitYear}
          onKeyDown={(e) => { if (e.key === 'Enter') commitYear(); if (e.key === 'ArrowUp') { e.preventDefault(); go({ year: ym.year + 1, month: ym.month }); } if (e.key === 'ArrowDown') { e.preventDefault(); go({ year: ym.year - 1, month: ym.month }); } }} />
        {!solo && <button className={`cbtn sync-btn sync-btn--${fam.status === 'unreachable' || fam.status === 'auth' || fam.status === 'server' ? 'offline' : fam.status}`} onClick={() => { opener.current = document.activeElement as HTMLElement; setShowFamily(true); }} aria-haspopup="dialog" title={tr('Condividi le note con la famiglia', 'Share notes with your family')}>
          👪 {fam.family ? familyWord(fam.status) : tr('Famiglia', 'Family')}
        </button>}
        {sync.config && <button className={`cbtn sync-btn sync-btn--${sync.status}`} onClick={() => { opener.current = document.activeElement as HTMLElement; setShowSync(true); }} aria-haspopup="dialog"
          title={sync.config ? `${tr('Server di casa', 'Home server')}: ${statusWord(sync.status)}` : tr('Condividi le note con il server di casa', 'Share notes with the home server')}>
          ⟳ {sync.config ? statusWord(sync.status).split(' (')[0] : 'Sync'}
        </button>}
        <button className="cbtn" onClick={() => { opener.current = document.activeElement as HTMLElement; setShowSettings(true); }} aria-haspopup="dialog" aria-label={tr('Impostazioni', 'Settings')} title={tr('Impostazioni', 'Settings')}>⚙</button>
      </nav>

      {!(solo && settings.calendars.length < 2) && <section className="cal-legend" aria-label={tr('Membri mostrati', 'Members shown')}>
        {settings.calendars.map((c) => {
          const on = !settings.hiddenCalendars.includes(c.id);
          return (
            <button key={c.id} className="cbtn cbtn--sm legend-btn" aria-pressed={on}
              onClick={() => void saveSettings({ ...settings, hiddenCalendars: on ? [...settings.hiddenCalendars, c.id] : settings.hiddenCalendars.filter((x) => x !== c.id) })}>
              <i className={`dot dot--${c.color}`} aria-hidden />{c.name}{!on && <span className="sr-only"> {tr('(nascosto)', '(hidden)')}</span>}
            </button>
          );
        })}
      </section>}

      {searching ? (
        <main className="cal-results" id="cal-days" tabIndex={-1} aria-label={tr('Risultati della ricerca', 'Search results')} lang={LANG}>
          <h1 className="sr-only">{tr('Risultati della ricerca', 'Search results')}</h1>
          <div className="res-head">
            <div>
              <strong className="res-query">“{query.trim()}”</strong>
              <p className="muted" role="status">{shown.length === 0 ? tr('Nessuna nota trovata', 'No notes found') : tr(`${shown.length} ${shown.length === 1 ? 'risultato' : 'risultati'} in ${months.length} ${months.length === 1 ? 'mese' : 'mesi'}`, `${shown.length} ${shown.length === 1 ? 'result' : 'results'} in ${months.length} ${months.length === 1 ? 'month' : 'months'}`)}</p>
            </div>
            <button className="cbtn cbtn--sm" onClick={clearSearch}>{tr('Azzera', 'Clear')} ✕</button>
          </div>
          {results.length > 0 && (
            <div className="res-chips" role="group" aria-label={tr('Filtra per membro', 'Filter by member')}>
              <button className="res-chip" aria-pressed={memberFilter === null} onClick={() => setMemberFilter(null)}>{tr('Tutti', 'All')} <span>{results.length}</span></button>
              {settings.calendars.filter((c) => counts[c.id]).map((c) => (
                <button key={c.id} className="res-chip" aria-pressed={memberFilter === c.id} onClick={() => setMemberFilter(memberFilter === c.id ? null : c.id)}>
                  <i className={`avatar avatar--xs dot--${c.color}`} aria-hidden>{c.name.slice(0, 1).toUpperCase()}</i>{c.name} <span>{counts[c.id]}</span>
                </button>
              ))}
            </div>
          )}
          {months.length === 0 && <p className="res-empty">{tr("Nessuna nota trovata. Prova con un'altra parola.", 'No notes found. Try another word.')}</p>}
          {months.map((m) => {
            const y = Number(m.key.slice(0, 4)); const mo = Number(m.key.slice(5, 7)) - 1;
            return (
              <section key={m.key} className="res-month" aria-label={`${MONTHS[mo]} ${y}`}>
                <h2><span>{MONTHS[mo].toUpperCase()}</span> <b>{y}</b><em>{m.items.length} {m.items.length === 1 ? tr('nota', 'note') : tr('note', 'notes')}</em></h2>
                <ul>
                  {m.items.map((e) => {
                    const { y: yy, m: mm, d } = keyToParts(e.date); const wd = weekdayOf(yy, mm, d); const cal = calendarOf(settings.calendars, e.calendarId);
                    const first = e.notes && e.notes !== e.title ? e.notes.split('\n')[0] : '';
                    return (
                      <li key={e.id}>
                        <button className="res-card" onClick={() => jumpTo(e)}>
                          <span className={`res-date${wd === 0 ? ' red' : ''}`}><b>{d}</b><small>{WEEKDAYS_SHORT[wd]}</small></span>
                          <span className="res-body">
                            <span className="res-title"><Marked text={e.title} query={query} /><RemindIcon e={e} /></span>
                            <span className="res-meta">{e.time && <b>{e.time}</b>}{first && <span className="truncate"><Marked text={first} query={query} /></span>}</span>
                          </span>
                          <span className={`res-badge dot--${cal.color}`}>{cal.name}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </main>
      ) : view === 'week' ? (
        <div className="cal-sheet cal-sheet--week" lang={LANG}>
          <main className="cal-main" id="cal-days" tabIndex={-1} aria-label={`${tr('Settimana', 'Week')} ${weekLabel}`}>
            <h1 className="cal-title week-title"><span>{weekLabel}</span> <b>{tr('Sett.', 'Wk')} {weekCells[0] ? isoWeek(keyToParts(weekCells[0].key).y, keyToParts(weekCells[0].key).m, keyToParts(weekCells[0].key).d) : ''}</b></h1>
            <ol className="week-grid">
              {weekCells.map((c) => {
                const es = entriesByDate[c.key] ?? [];
                return (
                  <li key={c.key} className={`week-day${c.red ? ' red' : ''}${c.key === todayKey ? ' today' : ''}${c.key === selDate ? ' selected' : ''}`}>
                    <button className="week-btn" onClick={() => open(c.key)} aria-current={c.key === todayKey ? 'date' : undefined}>
                      <span className="week-head"><span className="week-wd">{WEEKDAYS[c.weekday]}</span><span className="week-num">{c.day}</span></span>
                      {c.caption && <span className="week-cap">{c.caption}</span>}
                      {es.map((e) => (
                        <span key={e.id} className="week-note"><i className={`dot dot--${calendarOf(settings.calendars, e.calendarId).color}`} aria-hidden />{e.time && <b>{e.time}</b>}<span>{e.title}</span><RemindIcon e={e} /></span>
                      ))}
                      {es.length === 0 && <span className="week-empty">＋</span>}
                    </button>
                  </li>
                );
              })}
            </ol>
          </main>
        </div>
      ) : (
        <div className={`cal-sheet${settings.sides === false ? ' cal-sheet--sides-off' : ' cal-sheet--sides-on'}`} lang={LANG}>
          <Strip ym={shiftMonth(ym, -1)} side="prev" local={local} onGo={() => go(shiftMonth(ym, -1))} />
          <main className="cal-main" id="cal-days" tabIndex={-1} aria-label={`${MONTHS[ym.month]} ${ym.year}`}>
            <h1 className="cal-title"><span>{MONTHS[ym.month].toUpperCase()}</span> <b>{ym.year}</b></h1>
            <div className="cal-cols" style={{ ['--rows' as string]: half }}>
              {[cells.slice(0, half), cells.slice(half)].map((col, i) => (
                <ol className="cal-col" key={i}>
                  {col.map((c) => (
                    <DayRow key={c.key} calendars={settings.calendars} c={c} ym={ym} today={c.key === todayKey} entries={entriesByDate[c.key] ?? []} showMoon={settings.moon} showWeeks={settings.weeks} onOpen={open} />
                  ))}
                </ol>
              ))}
            </div>
          </main>
          <Strip ym={shiftMonth(ym, 1)} side="next" local={local} onGo={() => go(shiftMonth(ym, 1))} />
        </div>
      )}

      <aside className="cal-day" aria-label={tr('Giorno selezionato', 'Selected day')}>
        <p className="cal-day-kicker">{tr('Giorno selezionato', 'Selected day')}{selDate === todayKey ? tr(' · oggi', ' · today') : ''}</p>
        {desktop && (
          <EntryDialog key={selDate} inline calendars={settings.calendars} defaultCalendar={settings.defaultCalendar} dateLabel={longDate(selDate)} entries={entriesByDate[selDate] ?? []} onSave={onSave} onDelete={onDelete} onClose={() => undefined} undo={toast} saveError={saveError} />
        )}
      </aside>
      <footer className="cal-hint">{tr('← → mese · Maiusc+← → anno · T oggi · / cerca · clicca un giorno per aggiungere una nota', '← → month · Shift+← → year · T today · / search · click a day to add a note')}</footer>

      {openDate && (
        <EntryDialog calendars={settings.calendars} defaultCalendar={settings.defaultCalendar} dateLabel={longDate(openDate)} entries={entriesByDate[openDate] ?? []} onSave={onSave} onDelete={onDelete} onClose={closeDialog} undo={toast} saveError={saveError} />
      )}
      {showWelcome && (
        <WelcomeDialog
          onDone={(name, color, mode) => { const myId = 'm' + Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(36).padStart(2, '0')).join(''); /* a unique id, so two devices never both call their first member «personal» */ void saveSettings({ ...settings, welcomed: true, mode, calendars: settings.calendars.map((c) => (c.id === 'personal' ? { ...c, id: myId, name, color } : c)), defaultCalendar: settings.defaultCalendar === 'personal' ? myId : settings.defaultCalendar }); if (mode === 'shared') { opener.current = null; setShowFamily(true); } }}
          onSync={() => { opener.current = null; setShowFamily(true); }} syncLabel={tr('Con la famiglia (o ho un invito)', 'With my family (or I have an invite)')} />
      )}
      {showFamily && <FamilyDialog fam={fam} defaultName={tr(`${__TARGET__ === 'web' ? 'Telefono' : 'PC'} di ${calendarOf(settings.calendars, settings.defaultCalendar).name}`, `${calendarOf(settings.calendars, settings.defaultCalendar).name}'s ${__TARGET__ === 'web' ? 'phone' : 'PC'}`)} initialInvite={inviteText} onClose={closeDialog} />}
      {showSync && <SyncDialog sync={sync} onClose={closeDialog} />}
      {showSettings && <CalSettingsDialog onMerge={async (a, b) => { const n = await mergeMember(a, b); changed(); return n; }} solo={solo} onShare={() => { setShowSettings(false); void saveSettings({ ...settings, mode: 'shared' }); opener.current = null; setShowFamily(true); }} hasFamily={!!fam.family || !!sync.config} events={events} onRestore={restoreBackup} onOpenSync={() => { setShowSettings(false); setShowSync(true); }} settings={settings} usedCalendarIds={[...new Set(events.filter((e) => e.deletedAt === null).map((e) => e.calendarId))]} onSave={(s) => void saveSettings(s)} onClose={closeDialog} />}

      {toast && !openDate && !desktop && (
        <div className="ctoast" role="status" aria-live="polite">
          <span>{toast.message}</span>
          <button className="ctoast-btn" onClick={toast.run}>{tr('Annulla', 'Undo')}</button>
        </div>
      )}
    </div>
  );
}
