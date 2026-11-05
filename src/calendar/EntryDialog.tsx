import { useEffect, useRef, useState } from 'react';
import { calendarOf, cleanEntry, type CalEvent, type CalendarDef, type EntryColor } from '../core/events';
import { RemindIcon } from './RemindIcon';
import { remindOptions, type RemindKey } from '../core/reminders';

export interface EntryValue { title: string; notes: string; time: string | null; color: EntryColor; calendarId: string; remind: RemindKey }

export function EntryDialog(props: {
  dateLabel: string;
  entries: CalEvent[];
  calendars: CalendarDef[];
  defaultCalendar: string;
  onSave(v: EntryValue, existing: CalEvent | null): void;
  onDelete(e: CalEvent): void;
  onClose(): void;
  /** Delete confirmation with Undo. Shown inside the dialog because a modal dialog blocks clicks on anything outside it. */
  undo: { message: string; run(): void } | null;
  saveError?: string;
  /** Desktop: the same form shown inside the side panel instead of a modal dialog. */
  inline?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState<CalEvent | null>(null);
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [time, setTime] = useState('');
  const [allDay, setAllDay] = useState(true);
  const [remind, setRemind] = useState<RemindKey>('none');
  const [calId, setCalId] = useState(props.defaultCalendar);
  const [error, setError] = useState('');
  const failed = useRef(false);
  failed.current = !!props.saveError;

  useEffect(() => { if (!props.inline) ref.current?.showModal(); }, [props.inline]);

  const reset = () => { setEditing(null); setAllDay(true); setRemind('none'); setTitle(''); setNotes(''); setTime(''); setCalId(props.defaultCalendar); setError(''); };
  const edit = (e: CalEvent) => { setEditing(e); setTitle(e.title); setNotes(e.notes); setTime(e.time ?? ''); setAllDay(!e.time); setRemind(e.remind ?? 'none'); setCalId(e.calendarId); setError(''); titleRef.current?.focus(); };

  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    // The date is validated by the caller's cleanEntry again; here we check the typed fields for a friendly message.
    const t = allDay ? null : (time || null);
    const rk = remindOptions(!!t).some((o) => o.key === remind) ? remind : 'none';
    const c = cleanEntry({ date: '2000-01-01', title, notes, time: t, remind: rk });
    if (!c.ok) { setError(c.error); return; }
    props.onSave({ title: c.value.title, notes: c.value.notes, time: c.value.time, color: calendarOf(props.calendars, calId).color as EntryColor, calendarId: calId, remind: c.value.remind }, editing);
    reset();
    window.setTimeout(() => { if (failed.current) return; if (props.inline) titleRef.current?.focus(); else ref.current?.close(); }, 250); // saved: close the sheet so it is obvious the note went in; stays open if saving failed
  };

  return (
    <Shell inline={!!props.inline} dref={ref} onClose={props.onClose}>
      <div className={props.inline ? 'entry-inline-body' : 'cdialog-body'}>
        <h2 id="entry-title">{props.dateLabel}</h2>

        {props.entries.length === 0 ? <p className="muted">Ancora nessuna nota per questo giorno.</p> : (
          <ul className="entries" aria-label="Note del giorno">
            {props.entries.map((e) => (
              <li key={e.id} className={`entry${editing?.id === e.id ? ' entry--editing' : ''}`}>
                <span className={`dot dot--${calendarOf(props.calendars, e.calendarId).color}`} aria-hidden />
                <div className="entry-text">
                  <strong>{e.time && <span className="entry-time">{e.time} </span>}{e.title}<RemindIcon e={e} /></strong>
                  {e.notes && e.notes !== e.title && <p>{e.notes}</p>}
                  <p className="entry-meta">{calendarOf(props.calendars, e.calendarId).name} · {e.by ? `modificata da ${e.by}` : 'modificata'} il {new Date(e.updatedAt).toLocaleString('it-IT', { dateStyle: 'medium', timeStyle: 'short' })}</p>
                </div>
                <button className="cbtn cbtn--sm" onClick={() => edit(e)} aria-label={`Modifica ${e.title}`}>Modifica</button>
                <button className="cbtn cbtn--sm cbtn--danger" onClick={() => props.onDelete(e)} aria-label={`Elimina ${e.title}`}>Elimina</button>
              </li>
            ))}
          </ul>
        )}

        {props.undo && (
          <div className="entry-undo" role="status">
            <span>{props.undo.message}</span>
            <button type="button" className="ctoast-btn" onClick={props.undo.run}>Annulla</button>
          </div>
        )}

        <form onSubmit={submit} className="entry-form" noValidate>
          <h3>{editing ? 'Modifica nota' : 'Nuova nota'}</h3>
          <label><span>Titolo</span>
            <input ref={titleRef} id="entry-title-input" autoFocus={!props.inline} value={title} maxLength={120} placeholder="es. Visita pediatra o Cena fuori" aria-invalid={!!(error || props.saveError)} aria-describedby={(error || props.saveError) ? 'entry-err' : undefined} onChange={(e) => { setTitle(e.target.value); setError(''); }} />
          </label>
          {(error || props.saveError) && <p id="entry-err" className="field-error" role="alert">⚠ {error || props.saveError}</p>}
          <div className="row row--wrap">
            <label className="toggle-row"><span>Tutto il giorno <small className="muted">Non vincolato a un orario preciso</small></span>
              <input type="checkbox" role="switch" checked={allDay} onChange={(e) => { setAllDay(e.target.checked); setError(''); }} />
            </label>
            {!allDay && <label><span>Orario</span>
              <input type="time" value={time} onChange={(e) => { setTime(e.target.value); setError(''); }} />
            </label>}
            <label><span>Promemoria <small className="muted">(notifica sul telefono)</small></span>
              <select value={remindOptions(!allDay).some((o) => o.key === remind) ? remind : 'none'} onChange={(e) => setRemind(e.target.value as RemindKey)}>
                {remindOptions(!allDay).map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select>
            </label>
            <div className="field-group" role="group" aria-label="Assegna a">
              <span>Assegna a</span>
              <div className="member-chips">
                {props.calendars.map((c) => (
                  <button type="button" key={c.id} className={`member-chip${c.id === calId ? ' member-chip--on' : ''}`} aria-pressed={c.id === calId} onClick={() => setCalId(c.id)}>
                    <span className={`dot dot--${c.color}`} aria-hidden /> {c.name}{c.id === calId ? ' ✓' : ''}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <label><span>Note <span className="muted">(facoltative)</span></span>
            <textarea rows={4} value={notes} maxLength={4000} onChange={(e) => { setNotes(e.target.value); setError(''); }} />
          </label>
          {editing && <p className="entry-edited">ⓘ Modificata {editing.by ? `da ${editing.by} ` : ''}il {new Date(editing.updatedAt).toLocaleString('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>}
          <div className="dialog-actions">
            {editing && <button type="button" className="cbtn" onClick={reset}>Annulla modifica</button>}
            {editing && <button type="button" className="cbtn cbtn--danger" onClick={() => { props.onDelete(editing); reset(); }}>Elimina nota</button>}
            {!props.inline && <button type="button" className="cbtn" onClick={() => ref.current?.close()}>Chiudi</button>}
            <button type="submit" className="cbtn cbtn--primary">{editing ? 'Salva nota' : 'Salva nota'}</button>
          </div>
        </form>
      </div>
    </Shell>
  );
}

function Shell(props: { inline: boolean; dref: React.RefObject<HTMLDialogElement>; onClose(): void; children: React.ReactNode }) {
  return props.inline
    ? <section className="entry-inline cdialog" aria-labelledby="entry-title">{props.children}</section>
    : <dialog ref={props.dref} className="cdialog" onClose={props.onClose} aria-labelledby="entry-title">{props.children}</dialog>;
}
