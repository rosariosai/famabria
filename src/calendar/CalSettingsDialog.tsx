import { useEffect, useRef, useState } from 'react';
import { MONTHS, daysInMonth } from '../core/calendar';
import { LANG, getLangChoice, isEn, setLangChoice, tr, type LangChoice } from '../core/i18n';
import { ENTRY_COLORS, MEMBER_LIMIT, MEMBER_NAME_MAX, type CalSettings, type EntryColor } from '../core/events';
import { newId } from '../core/id';
import { backupName, makeBackup, parseBackup } from '../core/backup';
import type { CalEvent } from '../core/events';

const COLOR_NAMES: Record<EntryColor, string> = { blue: tr('Blu', 'Blue'), green: tr('Verde', 'Green'), orange: tr('Arancio', 'Orange'), purple: tr('Viola', 'Purple'), pink: tr('Rosa', 'Pink'), gray: tr('Grigio', 'Grey') };
const THEMES: { v: CalSettings['theme']; label: string }[] = [{ v: 'system', label: tr('Sistema', 'System') }, { v: 'light', label: tr('Chiaro', 'Light') }, { v: 'dark', label: tr('Scuro', 'Dark') }];

function Switch(props: { id: string; label: string; hint: string; checked: boolean; onChange(v: boolean): void }) {
  return (
    <label className="switch-row" htmlFor={props.id}>
      <span className="switch-text"><b>{props.label}</b><small>{props.hint}</small></span>
      <input id={props.id} className="switch" type="checkbox" role="switch" checked={props.checked} onChange={(e) => props.onChange(e.target.checked)} />
    </label>
  );
}

export function CalSettingsDialog(props: { onMerge(from: string, to: string): Promise<number>; solo: boolean; hasFamily: boolean; onShare(): void; settings: CalSettings; events: CalEvent[]; usedCalendarIds: string[]; onSave(s: CalSettings): void; onRestore(events: CalEvent[], settings: CalSettings): Promise<number>; onOpenSync(): void; onClose(): void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [s, setS] = useState(props.settings);
  useEffect(() => { ref.current?.showModal(); }, []);
  const set = <K extends keyof CalSettings>(k: K, v: CalSettings[K]) => { const n = { ...s, [k]: v }; setS(n); props.onSave(n); };
  const maxDay = daysInMonth(2028, s.localMonth);
  const nextColor = ENTRY_COLORS.find((c) => !s.calendars.some((x) => x.color === c)) ?? ENTRY_COLORS[s.calendars.length % ENTRY_COLORS.length];
  const [newName, setNewName] = useState('');
  const [bmsg, setBmsg] = useState('');
  const [moving, setMoving] = useState<string | null>(null), [target, setTarget] = useState('');
  const saveCopy = () => {
    const now = Date.now(); const url = URL.createObjectURL(new Blob([makeBackup(props.events, s, now)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = backupName(now); document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
    setBmsg(tr(`Copia salvata (${props.events.length} note): controlla la cartella Download.`, `Backup saved (${props.events.length} notes): check your Downloads folder.`));
  };
  const restoreCopy = async (file: File | undefined) => {
    if (!file) return;
    const b = parseBackup(await file.text());
    if (!b) { setBmsg(tr('Questo file non è una copia di Famabria.', 'This file is not a Famabria backup.')); return; }
    if (!confirm(tr(`Ripristinare ${b.events.length} note e le impostazioni (nomi e colori dei familiari) dal file? Le note più recenti su questo dispositivo restano com'erano.`, `Restore ${b.events.length} notes and the settings (family names and colours) from the file? Newer notes on this device stay as they are.`))) return;
    const n = await props.onRestore(b.events, b.settings); setS(b.settings);
    setBmsg(n ? tr(`Ripristinate ${n} note.`, `Restored ${n} notes.`) : tr('Nessuna nota da ripristinare: è già tutto qui.', 'Nothing to restore: everything is already here.'));
  };
  const [newColor, setNewColor] = useState<EntryColor>(nextColor);
  const addMember = () => {
    const name = newName.replace(/\s+/g, ' ').trim().slice(0, MEMBER_NAME_MAX);
    if (!name || s.calendars.length >= MEMBER_LIMIT) return;
    set('calendars', [...s.calendars, { id: `m${newId().replace(/-/g, '').slice(0, 12)}`, name, color: newColor }]);
    setNewName(''); setNewColor(ENTRY_COLORS[(ENTRY_COLORS.indexOf(newColor) + 1) % ENTRY_COLORS.length]);
  };
  const mergeInto = async (from: string, to: string) => {
    const a = s.calendars.find((c) => c.id === from), b = s.calendars.find((c) => c.id === to);
    if (!a || !b) return;
    const n = await props.onMerge(from, to); removeMember(from); setBmsg(tr(`Spostate ${n} note in «${b.name}».`, `Moved ${n} notes to “${b.name}”.`));
  };
  const removeMember = (id: string) => {
    const calendars = s.calendars.filter((c) => c.id !== id);
    const n = { ...s, calendars, hiddenCalendars: s.hiddenCalendars.filter((x) => x !== id), defaultCalendar: s.defaultCalendar === id ? calendars[0].id : s.defaultCalendar };
    setS(n); props.onSave(n);
  };
  const sidesOn = s.sides ?? !window.matchMedia('(max-width: 900px)').matches;

  return (
    <dialog ref={ref} className="cdialog cdialog--settings" onClose={props.onClose} aria-labelledby="cs-title" lang={LANG}>
      <div className="cdialog-body">
        <h2 id="cs-title">{tr('Impostazioni', 'Settings')}</h2>

        <section className="set-card" aria-labelledby="cs-vis">
          <h3 id="cs-vis">{tr('Visualizzazione del calendario', 'Calendar display')}</h3>
          {!isEn && <Switch id="cs-saints" label="Mostra il santo del giorno" hint="Come sul calendario stampato" checked={s.saints} onChange={(v) => set('saints', v)} />}
          <Switch id="cs-moon" label={tr('Mostra le fasi lunari', 'Show moon phases')} hint={tr('Luna nuova, quarti e luna piena', 'New moon, quarters and full moon')} checked={s.moon} onChange={(v) => set('moon', v)} />
          <Switch id="cs-weeks" label={tr('Mostra il numero di settimana', 'Show the week number')} hint={tr('Es. «Sett. 41» sul lunedì', 'E.g. “Wk 41” on Mondays')} checked={s.weeks} onChange={(v) => set('weeks', v)} />
          <Switch id="cs-sides" label={tr('Mese precedente e successivo ai lati', 'Previous and next month on the sides')} hint={tr('Strisce sottili; di solito spente sugli smartphone', 'Thin strips; usually off on smartphones')} checked={sidesOn} onChange={(v) => set('sides', v)} />
          <div className="field field--stack"><span className="field-label" id="cs-theme-l">{tr("Tema dell'interfaccia", 'Colour theme')}</span>
            <div className="seg" role="radiogroup" aria-labelledby="cs-theme-l">
              {THEMES.map((t) => (
                <label key={t.v} className={s.theme === t.v ? 'on' : ''}>
                  <input type="radio" name="cs-theme" value={t.v} checked={s.theme === t.v} onChange={() => set('theme', t.v)} />{t.label}
                </label>
              ))}
            </div>
          </div>
        </section>

        <section className="set-card" aria-labelledby="cs-mode">
          <h3 id="cs-mode">{tr('Modalità', 'Mode')}</h3>
          {props.solo ? (
            <>
              <p className="muted">{isEn ? <>You are using Famabria <b>on your own</b>: no sharing, simple interface.</> : <>Ora usi Famabria <b>da solo</b>: nessuna condivisione, interfaccia semplice.</>}</p>
              <button type="button" className="cbtn" onClick={props.onShare}>{tr('Condividi con la famiglia…', 'Share with your family…')}</button>
            </>
          ) : props.hasFamily ? (
            <p className="muted">{isEn ? <>Famabria is <b>shared</b>. To go back to “Just me”, leave the family first (Family → Leave the family): your notes stay on this device.</> : <>Famabria è <b>condiviso</b>. Per tornare a «Solo» esci prima dalla famiglia (Famiglia → Esci dalla famiglia): le note restano su questo dispositivo.</>}</p>
          ) : (
            <>
              <p className="muted">{isEn ? <>Famabria is in <b>shared</b> mode but nobody is connected yet.</> : <>Famabria è in modalità <b>condivisa</b> ma non hai ancora collegato nessuno.</>}</p>
              <button type="button" className="cbtn" onClick={() => set('mode', 'solo')}>{tr('Passa a «Solo io»', 'Switch to “Just me”')}</button>
            </>
          )}
        </section>

        {!props.solo && <section className="set-card" aria-labelledby="cs-mem">
          <h3 id="cs-mem">{tr('Membri della famiglia', 'Family members')} <small>{s.calendars.length} {s.calendars.length === 1 ? tr('membro', 'member') : tr('membri', 'members')}</small></h3>
          {s.calendars.map((c, i) => {
            const used = props.usedCalendarIds.includes(c.id);
            const canRemove = s.calendars.length > 1;
            const hint = s.calendars.length < 2 ? tr('Serve almeno un membro', 'At least one member is needed') : used ? tr('Ha delle note: le puoi spostare su un altro membro', 'Has notes: you can move them to another member') : '';
            return (
              <div className="member-row" key={c.id}>
                <i className={`avatar dot--${c.color}`} aria-hidden>{(c.name || '?').slice(0, 1).toUpperCase()}</i>
                <div className="field"><label htmlFor={`cn-${c.id}`}>{tr('Nome', 'Name')}</label>
                  <input id={`cn-${c.id}`} value={c.name} maxLength={MEMBER_NAME_MAX} onChange={(e) => set('calendars', s.calendars.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} /></div>
                <div className="field"><label htmlFor={`cc-${c.id}`}>{tr('Colore', 'Colour')}</label>
                  <select id={`cc-${c.id}`} value={c.color} onChange={(e) => set('calendars', s.calendars.map((x, j) => (j === i ? { ...x, color: e.target.value as EntryColor } : x)))}>
                    {ENTRY_COLORS.map((col) => <option key={col} value={col}>{COLOR_NAMES[col]}</option>)}
                  </select></div>
                <button type="button" className="cbtn cbtn--sm cbtn--danger" disabled={!canRemove} onClick={() => { if (used) { setTarget(s.calendars.find((x) => x.id !== c.id)?.id ?? ''); setMoving(c.id); } else removeMember(c.id); }} title={hint || tr('Rimuovi membro', 'Remove member')} aria-label={`${tr('Rimuovi', 'Remove')} ${c.name}`}>{tr('Rimuovi', 'Remove')}</button>
                {moving === c.id && (
                  <div className="field member-move"><label htmlFor={`cm-${c.id}`}>{tr('Sposta le sue note in', 'Move their notes to')}</label>
                    <select id={`cm-${c.id}`} value={target} onChange={(e) => setTarget(e.target.value)}>
                      {s.calendars.filter((x) => x.id !== c.id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                    </select>
                    <div className="dialog-actions"><button type="button" className="cbtn cbtn--sm cbtn--danger" onClick={() => { setMoving(null); void mergeInto(c.id, target); }}>{tr('Sposta e rimuovi', 'Move and remove')}</button>
                      <button type="button" className="cbtn cbtn--sm" onClick={() => setMoving(null)}>{tr('Annulla', 'Cancel')}</button></div>
                  </div>
                )}
                {hint && <p className="member-hint muted">{hint}</p>}
              </div>
            );
          })}
          {s.calendars.length < MEMBER_LIMIT && (
            <div className="member-row member-row--new">
              <i className={`avatar dot--${newColor}`} aria-hidden>{(newName || '+').slice(0, 1).toUpperCase()}</i>
              <div className="field"><label htmlFor="nm-name">{tr('Nuovo membro', 'New member')}</label>
                <input id="nm-name" value={newName} maxLength={MEMBER_NAME_MAX} placeholder={tr('Nome', 'Name')} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addMember(); } }} /></div>
              <div className="field"><label htmlFor="nm-color">{tr('Colore', 'Colour')}</label>
                <select id="nm-color" value={newColor} onChange={(e) => setNewColor(e.target.value as EntryColor)}>
                  {ENTRY_COLORS.map((col) => <option key={col} value={col}>{COLOR_NAMES[col]}</option>)}
                </select></div>
              <button type="button" className="cbtn cbtn--sm cbtn--primary" disabled={!newName.trim()} onClick={addMember}>+ {tr('Aggiungi', 'Add')}</button>
            </div>
          )}
          <div className="field field--stack"><label htmlFor="cd-default">{tr('Le nuove note vanno a', 'New notes go to')}</label>
            <select id="cd-default" value={s.defaultCalendar} onChange={(e) => set('defaultCalendar', e.target.value)}>
              {s.calendars.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select></div>
          <p className="muted">{tr('Un membro con delle note non si può rimuovere. Nomi e colori valgono per questo dispositivo; le note si condividono con la sincronizzazione e un membro nuovo appare negli altri dispositivi appena arriva una sua nota.', 'A member with notes cannot simply be removed (move the notes first). Names and colours are per device; notes are shared by syncing, and a new member appears on the other devices as soon as one of their notes arrives.')}</p>
        </section>}

        <section className="set-card" aria-labelledby="cs-loc">
          <h3 id="cs-loc">{tr('Festività locale e patrono', 'Local holiday')}</h3>
          <p className="muted">{tr('Appare in rosso come una festa nazionale (per esempio il patrono della tua città).', 'Shown in red like a public holiday (for example your town’s patron saint day).')}</p>
          <div className="field field--stack"><label htmlFor="ls-name">{tr('Nome della festività', 'Holiday name')}</label>
            <input id="ls-name" value={s.localName} maxLength={60} placeholder={tr('Vuoto = nessuna', 'Empty = none')} onChange={(e) => set('localName', e.target.value)} /></div>
          <div className="row">
            <div className="field"><label htmlFor="ls-month">{tr('Mese', 'Month')}</label>
              <select id="ls-month" value={s.localMonth} onChange={(e) => set('localMonth', Number(e.target.value))}>
                {MONTHS.map((m, i) => <option key={m} value={i}>{m}</option>)}
              </select></div>
            <div className="field"><label htmlFor="ls-day">{tr('Giorno', 'Day')}</label>
              <input id="ls-day" type="number" min={1} max={maxDay} value={s.localDay} onChange={(e) => { const d = Math.max(1, Math.min(maxDay, Math.round(Number(e.target.value) || 1))); set('localDay', d); }} /></div>
          </div>
        </section>

        {!props.solo && <details className="set-card" aria-label={tr('Server di casa', 'Home server')}>
          <summary><b>{tr('Server di casa (avanzato)', 'Home server (advanced)')}</b></summary>
          <p className="muted">{isEn ? <>Only if you run your own Famabria server at home. To share notes with your family use the <b>Family</b> button at the top: no server needed.</> : <>Solo se hai un server Famabria tuo, in casa. Per condividere le note con la famiglia usa il pulsante <b>Famiglia</b> in alto: non serve nessun server.</>}</p>
          <button className="cbtn" onClick={props.onOpenSync}>{tr('Collega un server di casa…', 'Connect a home server…')}</button>
        </details>}


        {!isEn && <p className="muted small">L'elenco dei santi è una prima bozza: gennaio è controllato su un calendario stampato, gli altri mesi non ancora.</p>}
        <section className="set-card" aria-labelledby="cs-lang">
          <h3 id="cs-lang">{tr('Lingua', 'Language')}</h3>
          <div className="field field--stack"><label htmlFor="cs-langsel">{tr('Lingua dell\'interfaccia', 'Interface language')}</label>
            <select id="cs-langsel" defaultValue={getLangChoice()} onChange={(e) => { setLangChoice(e.target.value as LangChoice); location.reload(); }}>
              <option value="auto">{tr('Automatica (come il browser)', 'Automatic (same as the browser)')}</option><option value="it">Italiano</option><option value="en">English</option>
            </select></div>
        </section>
        <details className="howto"><summary>{tr('Copia di sicurezza delle note', 'Backup of your notes')}</summary>
          <p className="muted small">{tr('Salva un file con tutte le tue note e i nomi dei familiari (senza chiavi o link di invito). Conservalo: serve per ripristinare tutto, per esempio dopo un cambio di telefono.', 'Saves a file with all your notes and the family member names (no keys or invite links). Keep it: you need it to restore everything, for example after changing phone.')}</p>
          <div className="dialog-actions"><button type="button" className="cbtn" onClick={saveCopy}>{tr('Salva una copia', 'Save a copy')}</button>
            <label className="cbtn" style={{ cursor: 'pointer' }}>{tr('Ripristina da copia', 'Restore from a copy')}<input type="file" accept="application/json,.json" hidden onChange={(e) => { void restoreCopy(e.target.files?.[0]); e.target.value = ''; }} /></label></div>
          {bmsg && <p role="status" className="muted small">{bmsg}</p>}
        </details>
        <div className="about" style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '8px 0' }}>
          <img src={__TARGET__ === 'web' ? '/app/icons/icon-192.png' : 'icons/128.png'} alt={tr('Logo Famabria', 'Famabria logo')} width={56} height={56} />
                  <p className="muted small" style={{ margin: 0 }} data-testid="app-version">Famabria {tr('versione', 'version')} {typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '?'} · {__TARGET__ === 'web' ? tr('app web', 'web app') : tr('estensione', 'extension')}</p>
        </div>
        <div className="dialog-actions"><button className="cbtn cbtn--primary" onClick={() => ref.current?.close()}>{tr('Fatto', 'Done')}</button></div>
      </div>
    </dialog>
  );
}
