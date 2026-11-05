import { useEffect, useRef, useState } from 'react';
import { MONTHS_IT, daysInMonth } from '../core/calendar';
import { ENTRY_COLORS, MEMBER_LIMIT, MEMBER_NAME_MAX, type CalSettings, type EntryColor } from '../core/events';
import { newId } from '../core/id';
import { backupName, makeBackup, parseBackup } from '../core/backup';
import type { CalEvent } from '../core/events';

const COLOR_NAMES: Record<EntryColor, string> = { blue: 'Blu', green: 'Verde', orange: 'Arancio', purple: 'Viola', pink: 'Rosa', gray: 'Grigio' };
const THEMES: { v: CalSettings['theme']; label: string }[] = [{ v: 'system', label: 'Sistema' }, { v: 'light', label: 'Chiaro' }, { v: 'dark', label: 'Scuro' }];

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
    setBmsg(`Copia salvata (${props.events.length} note): controlla la cartella Download.`);
  };
  const restoreCopy = async (file: File | undefined) => {
    if (!file) return;
    const b = parseBackup(await file.text());
    if (!b) { setBmsg('Questo file non è una copia di Famabria.'); return; }
    if (!confirm(`Ripristinare ${b.events.length} note e le impostazioni (nomi e colori dei familiari) dal file? Le note più recenti su questo dispositivo restano com'erano.`)) return;
    const n = await props.onRestore(b.events, b.settings); setS(b.settings);
    setBmsg(n ? `Ripristinate ${n} note.` : 'Nessuna nota da ripristinare: è già tutto qui.');
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
    const n = await props.onMerge(from, to); removeMember(from); setBmsg(`Spostate ${n} note in «${b.name}».`);
  };
  const removeMember = (id: string) => {
    const calendars = s.calendars.filter((c) => c.id !== id);
    const n = { ...s, calendars, hiddenCalendars: s.hiddenCalendars.filter((x) => x !== id), defaultCalendar: s.defaultCalendar === id ? calendars[0].id : s.defaultCalendar };
    setS(n); props.onSave(n);
  };
  const sidesOn = s.sides ?? !window.matchMedia('(max-width: 900px)').matches;

  return (
    <dialog ref={ref} className="cdialog cdialog--settings" onClose={props.onClose} aria-labelledby="cs-title" lang="it">
      <div className="cdialog-body">
        <h2 id="cs-title">Impostazioni</h2>

        <section className="set-card" aria-labelledby="cs-vis">
          <h3 id="cs-vis">Visualizzazione del calendario</h3>
          <Switch id="cs-saints" label="Mostra il santo del giorno" hint="Come sul calendario stampato" checked={s.saints} onChange={(v) => set('saints', v)} />
          <Switch id="cs-moon" label="Mostra le fasi lunari" hint="Luna nuova, quarti e luna piena" checked={s.moon} onChange={(v) => set('moon', v)} />
          <Switch id="cs-weeks" label="Mostra il numero di settimana" hint="Es. «Sett. 41» sul lunedì" checked={s.weeks} onChange={(v) => set('weeks', v)} />
          <Switch id="cs-sides" label="Mese precedente e successivo ai lati" hint="Strisce sottili; di solito spente sugli smartphone" checked={sidesOn} onChange={(v) => set('sides', v)} />
          <div className="field field--stack"><span className="field-label" id="cs-theme-l">Tema dell'interfaccia</span>
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
          <h3 id="cs-mode">Modalità</h3>
          {props.solo ? (
            <>
              <p className="muted">Ora usi Famabria <b>da solo</b>: nessuna condivisione, interfaccia semplice.</p>
              <button type="button" className="cbtn" onClick={props.onShare}>Condividi con la famiglia…</button>
            </>
          ) : props.hasFamily ? (
            <p className="muted">Famabria è <b>condiviso</b>. Per tornare a «Solo» esci prima dalla famiglia (Famiglia → Esci dalla famiglia): le note restano su questo dispositivo.</p>
          ) : (
            <>
              <p className="muted">Famabria è in modalità <b>condivisa</b> ma non hai ancora collegato nessuno.</p>
              <button type="button" className="cbtn" onClick={() => set('mode', 'solo')}>Passa a «Solo io»</button>
            </>
          )}
        </section>

        {!props.solo && <section className="set-card" aria-labelledby="cs-mem">
          <h3 id="cs-mem">Membri della famiglia <small>{s.calendars.length} {s.calendars.length === 1 ? 'membro' : 'membri'}</small></h3>
          {s.calendars.map((c, i) => {
            const used = props.usedCalendarIds.includes(c.id);
            const canRemove = s.calendars.length > 1;
            const hint = s.calendars.length < 2 ? 'Serve almeno un membro' : used ? 'Ha delle note: le puoi spostare su un altro membro' : '';
            return (
              <div className="member-row" key={c.id}>
                <i className={`avatar dot--${c.color}`} aria-hidden>{(c.name || '?').slice(0, 1).toUpperCase()}</i>
                <div className="field"><label htmlFor={`cn-${c.id}`}>Nome</label>
                  <input id={`cn-${c.id}`} value={c.name} maxLength={MEMBER_NAME_MAX} onChange={(e) => set('calendars', s.calendars.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} /></div>
                <div className="field"><label htmlFor={`cc-${c.id}`}>Colore</label>
                  <select id={`cc-${c.id}`} value={c.color} onChange={(e) => set('calendars', s.calendars.map((x, j) => (j === i ? { ...x, color: e.target.value as EntryColor } : x)))}>
                    {ENTRY_COLORS.map((col) => <option key={col} value={col}>{COLOR_NAMES[col]}</option>)}
                  </select></div>
                <button type="button" className="cbtn cbtn--sm cbtn--danger" disabled={!canRemove} onClick={() => { if (used) { setTarget(s.calendars.find((x) => x.id !== c.id)?.id ?? ''); setMoving(c.id); } else removeMember(c.id); }} title={hint || 'Rimuovi membro'} aria-label={`Rimuovi ${c.name}`}>Rimuovi</button>
                {moving === c.id && (
                  <div className="field member-move"><label htmlFor={`cm-${c.id}`}>Sposta le sue note in</label>
                    <select id={`cm-${c.id}`} value={target} onChange={(e) => setTarget(e.target.value)}>
                      {s.calendars.filter((x) => x.id !== c.id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                    </select>
                    <div className="dialog-actions"><button type="button" className="cbtn cbtn--sm cbtn--danger" onClick={() => { setMoving(null); void mergeInto(c.id, target); }}>Sposta e rimuovi</button>
                      <button type="button" className="cbtn cbtn--sm" onClick={() => setMoving(null)}>Annulla</button></div>
                  </div>
                )}
                {hint && <p className="member-hint muted">{hint}</p>}
              </div>
            );
          })}
          {s.calendars.length < MEMBER_LIMIT && (
            <div className="member-row member-row--new">
              <i className={`avatar dot--${newColor}`} aria-hidden>{(newName || '+').slice(0, 1).toUpperCase()}</i>
              <div className="field"><label htmlFor="nm-name">Nuovo membro</label>
                <input id="nm-name" value={newName} maxLength={MEMBER_NAME_MAX} placeholder="Nome" onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addMember(); } }} /></div>
              <div className="field"><label htmlFor="nm-color">Colore</label>
                <select id="nm-color" value={newColor} onChange={(e) => setNewColor(e.target.value as EntryColor)}>
                  {ENTRY_COLORS.map((col) => <option key={col} value={col}>{COLOR_NAMES[col]}</option>)}
                </select></div>
              <button type="button" className="cbtn cbtn--sm cbtn--primary" disabled={!newName.trim()} onClick={addMember}>+ Aggiungi</button>
            </div>
          )}
          <div className="field field--stack"><label htmlFor="cd-default">Le nuove note vanno a</label>
            <select id="cd-default" value={s.defaultCalendar} onChange={(e) => set('defaultCalendar', e.target.value)}>
              {s.calendars.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select></div>
          <p className="muted">Un membro con delle note non si può rimuovere. Nomi e colori valgono per questo dispositivo; le note si condividono con la sincronizzazione e un membro nuovo appare negli altri dispositivi appena arriva una sua nota.</p>
        </section>}

        <section className="set-card" aria-labelledby="cs-loc">
          <h3 id="cs-loc">Festività locale e patrono</h3>
          <p className="muted">Appare in rosso come una festa nazionale (per esempio il patrono della tua città).</p>
          <div className="field field--stack"><label htmlFor="ls-name">Nome della festività</label>
            <input id="ls-name" value={s.localName} maxLength={60} placeholder="Vuoto = nessuna" onChange={(e) => set('localName', e.target.value)} /></div>
          <div className="row">
            <div className="field"><label htmlFor="ls-month">Mese</label>
              <select id="ls-month" value={s.localMonth} onChange={(e) => set('localMonth', Number(e.target.value))}>
                {MONTHS_IT.map((m, i) => <option key={m} value={i}>{m}</option>)}
              </select></div>
            <div className="field"><label htmlFor="ls-day">Giorno</label>
              <input id="ls-day" type="number" min={1} max={maxDay} value={s.localDay} onChange={(e) => { const d = Math.max(1, Math.min(maxDay, Math.round(Number(e.target.value) || 1))); set('localDay', d); }} /></div>
          </div>
        </section>

        {!props.solo && <details className="set-card" aria-label="Server di casa">
          <summary><b>Server di casa (avanzato)</b></summary>
          <p className="muted">Solo se hai un server Famabria tuo, in casa. Per condividere le note con la famiglia usa il pulsante <b>Famiglia</b> in alto: non serve nessun server.</p>
          <button className="cbtn" onClick={props.onOpenSync}>Collega un server di casa…</button>
        </details>}


        <p className="muted small">L'elenco dei santi è una prima bozza: gennaio è controllato su un calendario stampato, gli altri mesi non ancora.</p>
        <details className="howto"><summary>Copia di sicurezza delle note</summary>
          <p className="muted small">Salva un file con tutte le tue note e i nomi dei familiari (senza chiavi o link di invito). Conservalo: serve per ripristinare tutto, per esempio dopo un cambio di telefono.</p>
          <div className="dialog-actions"><button type="button" className="cbtn" onClick={saveCopy}>Salva una copia</button>
            <label className="cbtn" style={{ cursor: 'pointer' }}>Ripristina da copia<input type="file" accept="application/json,.json" hidden onChange={(e) => { void restoreCopy(e.target.files?.[0]); e.target.value = ''; }} /></label></div>
          {bmsg && <p role="status" className="muted small">{bmsg}</p>}
        </details>
        <div className="about" style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '8px 0' }}>
          <img src={__TARGET__ === 'web' ? '/app/icons/icon-192.png' : 'icons/128.png'} alt="Logo Famabria" width={56} height={56} />
                  <p className="muted small" style={{ margin: 0 }} data-testid="app-version">Famabria versione {typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '?'} · {__TARGET__ === 'web' ? 'app web' : 'estensione'}</p>
        </div>
        <div className="dialog-actions"><button className="cbtn cbtn--primary" onClick={() => ref.current?.close()}>Fatto</button></div>
      </div>
    </dialog>
  );
}
