import { useEffect, useRef, useState } from 'react';
import { calendarOf, cleanEntry, type CalEvent, type CalendarDef, type EntryColor } from '../core/events';
import { RemindIcon } from './RemindIcon';
import { remindOptions, type RemindKey } from '../core/reminders';
import { LOCALE, tr } from '../core/i18n';

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

        {props.entries.length === 0 ? <p className="muted">{tr('Ancora nessuna nota per questo giorno.', 'No notes for this day yet.')}</p> : (
          <ul className="entries" aria-label={tr('Note del giorno', 'Notes for the day')}>
            {props.entries.map((e) => (
              <li key={e.id} className={`entry${editing?.id === e.id ? ' entry--editing' : ''}`}>
                <span className={`dot dot--${calendarOf(props.calendars, e.calendarId).color}`} aria-hidden />
                <div className="entry-text">
                  <strong>{e.time && <span className="entry-time">{e.time} </span>}{e.title}<RemindIcon e={e} /></strong>
                  {e.notes && e.notes !== e.title && <p>{e.notes}</p>}
                  <p className="entry-meta">{calendarOf(props.calendars, e.calendarId).name} · {e.by ? tr(`modificata da ${e.by}`, `edited by ${e.by}`) : tr('modificata', 'edited')} {tr('il', 'on')} {new Date(e.updatedAt).toLocaleString(LOCALE, { dateStyle: 'medium', timeStyle: 'short' })}</p>
                </div>
                <button className="cbtn cbtn--sm" onClick={() => edit(e)} aria-label={`${tr('Modifica', 'Edit')} ${e.title}`}>{tr('Modifica', 'Edit')}</button>
                <button className="cbtn cbtn--sm cbtn--danger" onClick={() => props.onDelete(e)} aria-label={`${tr('Elimina', 'Delete')} ${e.title}`}>{tr('Elimina', 'Delete')}</button>
              </li>
            ))}
          </ul>
        )}

        {props.undo && (
          <div className="entry-undo" role="status">
            <span>{props.undo.message}</span>
            <button type="button" className="ctoast-btn" onClick={props.undo.run}>{tr('Annulla', 'Undo')}</button>
          </div>
        )}

        <form onSubmit={submit} className="entry-form" noValidate>
          <h3>{editing ? tr('Modifica nota', 'Edit note') : tr('Nuova nota', 'New note')}</h3>
          <label><span>{tr('Titolo', 'Title')}</span>
            <input ref={titleRef} id="entry-title-input" autoFocus={!props.inline} value={title} maxLength={120} placeholder={tr('es. Visita pediatra o Cena fuori', 'e.g. Dentist or Dinner out')} aria-invalid={!!(error || props.saveError)} aria-describedby={(error || props.saveError) ? 'entry-err' : undefined} onChange={(e) => { setTitle(e.target.value); setError(''); }} />
          </label>
          {(error || props.saveError) && <p id="entry-err" className="field-error" role="alert">⚠ {error || props.saveError}</p>}
          <div className="row row--wrap">
            <label className="toggle-row"><span>{tr('Tutto il giorno', 'All day')} <small className="muted">{tr('Non vincolato a un orario preciso', 'Not tied to a specific time')}</small></span>
              <input type="checkbox" role="switch" checked={allDay} onChange={(e) => { setAllDay(e.target.checked); setError(''); }} />
            </label>
            {!allDay && <label><span>{tr('Orario', 'Time')}</span>
              <input type="time" value={time} onChange={(e) => { setTime(e.target.value); setError(''); }} />
            </label>}
            <label><span>{tr('Promemoria', 'Reminder')} <small className="muted">{tr('(notifica sul telefono)', '(phone notification)')}</small></span>
              <select value={remindOptions(!allDay).some((o) => o.key === remind) ? remind : 'none'} onChange={(e) => setRemind(e.target.value as RemindKey)}>
                {remindOptions(!allDay).map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select>
            </label>
            <div className="field-group" role="group" aria-label={tr('Assegna a', 'Assign to')}>
              <span>{tr('Assegna a', 'Assign to')}</span>
              <div className="member-chips">
                {props.calendars.map((c) => (
                  <button type="button" key={c.id} className={`member-chip${c.id === calId ? ' member-chip--on' : ''}`} aria-pressed={c.id === calId} onClick={() => setCalId(c.id)}>
                    <span className={`dot dot--${c.color}`} aria-hidden /> {c.name}{c.id === calId ? ' ✓' : ''}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <label><span>{tr('Note', 'Notes')} <span className="muted">{tr('(facoltative)', '(optional)')}</span></span>
            <textarea rows={4} value={notes} maxLength={4000} onChange={(e) => { setNotes(e.target.value); setError(''); }} />
          </label>
          {editing && <p className="entry-edited">ⓘ {tr('Modificata', 'Edited')} {editing.by ? `${tr('da', 'by')} ${editing.by} ` : ''}{tr('il', 'on')} {new Date(editing.updatedAt).toLocaleString(LOCALE, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>}
          <div className="dialog-actions">
            {editing && <button type="button" className="cbtn" onClick={reset}>{tr('Annulla modifica', 'Cancel editing')}</button>}
            {editing && <button type="button" className="cbtn cbtn--danger" onClick={() => { props.onDelete(editing); reset(); }}>{tr('Elimina nota', 'Delete note')}</button>}
            {!props.inline && <button type="button" className="cbtn" onClick={() => ref.current?.close()}>{tr('Chiudi', 'Close')}</button>}
            <button type="submit" className="cbtn cbtn--primary">{tr('Salva nota', 'Save note')}</button>
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
