import { useEffect, useRef, useState } from 'react';
import { ENTRY_COLORS, MEMBER_NAME_MAX, type EntryColor } from '../core/events';
import { tr } from '../core/i18n';
import { WEEKDAYS } from '../core/calendar';

const COLOR_NAMES: Record<EntryColor, string> = { blue: tr('Blu', 'Blue'), green: tr('Verde', 'Green'), orange: tr('Arancio', 'Orange'), purple: tr('Viola', 'Purple'), pink: tr('Rosa', 'Pink'), gray: tr('Grigio', 'Grey') };

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
        <h2 id="wl-title">{tr('Come ti chiami?', 'What is your name?')}</h2>
        <p className="muted">{tr("Il tuo calendario si chiama come te. Se lo usi solo tu, scegli «Solo io»: l'app resta semplicissima. Potrai condividerlo con la famiglia più avanti, da Impostazioni.", 'Your calendar is named after you. If you are the only user, choose “Just me”: the app stays very simple. You can share it with your family later, from Settings.')}</p>
        <div className="field field--stack"><label htmlFor="wl-name">{tr('Il tuo nome', 'Your name')}</label>
          <input id="wl-name" value={name} maxLength={MEMBER_NAME_MAX} autoFocus onFocus={(e) => e.currentTarget.select()} onChange={(e) => setName(e.target.value)} /></div>
        <fieldset className="colors-pick">
          <legend>{tr('Scegli il tuo colore', 'Choose your colour')} ({COLOR_NAMES[color]})</legend>
          <div role="radiogroup" aria-label={tr('Colore', 'Colour')}>
            {ENTRY_COLORS.map((c) => (
              <label key={c} className={`pick${c === color ? ' on' : ''}`}>
                <input type="radio" name="wl-color" value={c} checked={c === color} onChange={() => setColor(c)} />
                <i className={`avatar dot--${c}`} aria-hidden>{clean.slice(0, 1).toUpperCase()}</i>
                <span className="sr-only">{COLOR_NAMES[c]}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="welcome-preview" aria-label={tr('Anteprima sul calendario', 'Calendar preview')}>
          <span className="muted">{tr('Anteprima', 'Preview')}</span>
          <div><b>{t.getDate()}</b> <span>{WEEKDAYS[t.getDay()].toUpperCase()}</span></div>
          <span className={`day-entry`}><i className={`dot dot--${color}`} aria-hidden /><b>09:00</b><span className="truncate">{clean}: {tr('la mia prima nota', 'my first note')}</span></span>
        </div>
        <div className="dialog-actions">
          <button type="button" className="cbtn" onClick={() => props.onDone(clean, color, 'shared')}>{props.syncLabel ?? tr('Con la famiglia', 'With my family')}</button>
          <button type="submit" className="cbtn cbtn--primary">{tr('Solo io', 'Just me')}</button>
        </div>
      </form>
    </dialog>
  );
}
