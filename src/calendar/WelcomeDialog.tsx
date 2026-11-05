import { useEffect, useRef, useState } from 'react';
import { ENTRY_COLORS, MEMBER_NAME_MAX, type EntryColor } from '../core/events';

const COLOR_NAMES: Record<EntryColor, string> = { blue: 'Blu', green: 'Verde', orange: 'Arancio', purple: 'Viola', pink: 'Rosa', gray: 'Grigio' };

/** First start: one member only, called name1 until the person types their own name; the colour can be chosen too.
 *  More members come later (Impostazioni > Membri). */
export function WelcomeDialog(props: { onDone(name: string, color: EntryColor, mode: 'solo' | 'shared'): void; onSync(): void; syncLabel?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState('name1');
  const [color, setColor] = useState<EntryColor>('blue');
  useEffect(() => { ref.current?.showModal(); }, []);
  const clean = name.replace(/\s+/g, ' ').trim().slice(0, MEMBER_NAME_MAX) || 'name1';
  const t = new Date();
  return (
    <dialog ref={ref} className="cdialog" aria-labelledby="wl-title" onCancel={(e) => e.preventDefault()}>
      <form className="cdialog-body" onSubmit={(e) => { e.preventDefault(); props.onDone(clean, color, 'solo'); }}>
        <h2 id="wl-title">Come ti chiami?</h2>
        <p className="muted">Il tuo calendario si chiama come te. Se lo usi solo tu, scegli «Solo io»: l'app resta semplicissima. Potrai condividerlo con la famiglia più avanti, da Impostazioni.</p>
        <div className="field field--stack"><label htmlFor="wl-name">Il tuo nome</label>
          <input id="wl-name" value={name} maxLength={MEMBER_NAME_MAX} autoFocus onFocus={(e) => e.currentTarget.select()} onChange={(e) => setName(e.target.value)} /></div>
        <fieldset className="colors-pick">
          <legend>Scegli il tuo colore ({COLOR_NAMES[color]})</legend>
          <div role="radiogroup" aria-label="Colore">
            {ENTRY_COLORS.map((c) => (
              <label key={c} className={`pick${c === color ? ' on' : ''}`}>
                <input type="radio" name="wl-color" value={c} checked={c === color} onChange={() => setColor(c)} />
                <i className={`avatar dot--${c}`} aria-hidden>{clean.slice(0, 1).toUpperCase()}</i>
                <span className="sr-only">{COLOR_NAMES[c]}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="welcome-preview" aria-label="Anteprima sul calendario">
          <span className="muted">Anteprima</span>
          <div><b>{t.getDate()}</b> <span>{['DOMENICA', 'LUNEDÌ', 'MARTEDÌ', 'MERCOLEDÌ', 'GIOVEDÌ', 'VENERDÌ', 'SABATO'][t.getDay()]}</span></div>
          <span className={`day-entry`}><i className={`dot dot--${color}`} aria-hidden /><b>09:00</b><span className="truncate">{clean}: la mia prima nota</span></span>
        </div>
        <div className="dialog-actions">
          <button type="button" className="cbtn" onClick={() => props.onDone(clean, color, 'shared')}>{props.syncLabel ?? 'Con la famiglia'}</button>
          <button type="submit" className="cbtn cbtn--primary">Solo io</button>
        </div>
      </form>
    </dialog>
  );
}
