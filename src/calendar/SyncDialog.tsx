import { useEffect, useRef, useState } from 'react';
import { IS_WEB, requestOriginAccess } from '../browser/api';
import { SyncError, normalizeServerUrl } from '../sync/engine';
import type { useSync } from './useSync';
import { tr } from '../core/i18n';

type Sync = ReturnType<typeof useSync>;

const WORDS: Record<string, string> = {
  off: tr('Non collegato', 'Not connected'), idle: tr('Collegato', 'Connected'), syncing: tr('Sincronizzo…', 'Syncing…'), ok: tr('Aggiornato', 'Up to date'), offline: tr('Fuori linea (non sei sulla rete di casa?)', 'Offline (not on the home network?)'),
  auth: tr('Token non accettato', 'Token not accepted'), server: tr('Problema del server', 'Server problem'), clock: tr('Problema con l\'orologio', 'Clock problem'), config: tr('Non configurato', 'Not configured'),
};
export const statusWord = (s: string) => WORDS[s] ?? s;

export function SyncDialog(props: { sync: Sync; onClose(): void }) {
  const { sync } = props;
  const ref = useRef<HTMLDialogElement>(null);
  const [url, setUrl] = useState(IS_WEB ? location.origin : (sync.config?.url ?? ''));
  const [token, setToken] = useState(sync.config?.token ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [info, setInfo] = useState('');
  useEffect(() => { ref.current?.showModal(); }, []);

  const save = async () => {
    setErr(''); setInfo('');
    const clean = normalizeServerUrl(url);
    if (!clean) { setErr(tr('Scrivi l\'indirizzo del server, per esempio 192.168.0.10:8420', 'Type the server address, for example 192.168.0.10:8420')); return; }
    if (!token.trim()) { setErr(tr('Incolla il token ricevuto dal server (inizia con tn_).', 'Paste the token you got from the server (it starts with tn_).')); return; }
    setBusy(true);
    try {
      // must be asked right after the click; the browser shows a one-site permission prompt
      const ok = await requestOriginAccess(clean);
      if (!ok) { setErr(tr('Il browser non ha permesso a Famabria di contattare quell\'indirizzo. Premi di nuovo «Salva e collega» e scegli Consenti.', 'The browser did not allow Famabria to contact that address. Press “Save and connect” again and choose Allow.')); return; }
      const who = await sync.connect({ url: clean, token: token.trim() });
      setUrl(clean);
      setInfo(tr(`Collegato come ${who}.`, `Connected as ${who}.`));
    } catch (e) {
      setErr(e instanceof SyncError ? e.message : tr(`Non riesco a collegarmi (${(e as Error)?.message ?? 'errore sconosciuto'}).`, `Cannot connect (${(e as Error)?.message ?? 'unknown error'}).`));
    } finally { setBusy(false); }
  };

  const when = sync.state.lastSyncAt ? new Date(sync.state.lastSyncAt).toLocaleString() : tr('mai', 'never');
  return (
    <dialog ref={ref} className="cdialog" onClose={props.onClose} aria-labelledby="sy-title">
      <div className="cdialog-body">
        <h2 id="sy-title">{tr('Sincronizza con il server di casa', 'Sync with the home server')}</h2>
        <p className="muted">{IS_WEB
          ? tr('Incolla il token che ti hanno dato per vedere e modificare i calendari condivisi. Funziona con il Wi-Fi di casa; fuori casa il calendario tiene ciò che ha e si sincronizza la volta dopo.', 'Paste the token you were given to see and edit the shared calendars. It works on your home Wi-Fi; away from home the calendar keeps what it has and syncs next time.')
          : tr('Condivide le note con il server Famabria di casa. Funziona solo sulla rete di casa; fuori casa il calendario continua a funzionare e si sincronizza la volta dopo.', 'Shares your notes with your home Famabria server. It only works on the home network; away from home the calendar keeps working and syncs next time.')}</p>
        {!IS_WEB && <div className="field field--stack"><label htmlFor="sy-url">{tr('Indirizzo del server', 'Server address')}</label>
          <input id="sy-url" value={url} placeholder="192.168.0.10:8420" autoComplete="off" spellCheck={false} onChange={(e) => setUrl(e.target.value)} /></div>}
        <div className="field field--stack"><label htmlFor="sy-token">{tr('Il tuo token', 'Your token')}</label>
          <input id="sy-token" type="password" value={token} placeholder="tn_…" autoComplete="off" spellCheck={false} onChange={(e) => setToken(e.target.value)} /></div>
        {err && <p className="field-error" role="alert">{err}</p>}
        {info && <p className="muted" role="status">{info}</p>}
        <div className="dialog-actions">
          <button className="cbtn cbtn--primary" disabled={busy} onClick={() => void save()}>{busy ? tr('Mi collego…', 'Connecting…') : tr('Salva e collega', 'Save and connect')}</button>
        </div>
        {sync.config && (
          <section className="sync-status" aria-live="polite">
            <p><strong>{tr('Stato', 'Status')}:</strong> {statusWord(sync.status)}{sync.user ? ` · ${tr('come', 'as')} ${sync.user}` : ''}</p>
            {sync.message && <p className="muted">{sync.message}</p>}
            <p className="muted">{tr('Ultima sincronizzazione riuscita', 'Last successful sync')}: {when}</p>
            <div className="dialog-actions">
              <button className="cbtn" disabled={sync.status === 'syncing'} onClick={() => void sync.syncNow()}>{tr('Sincronizza ora', 'Sync now')}</button>
              <button className="cbtn" title={tr('Rimanda tutte le note, per esempio dopo aver ripristinato un backup', 'Send all notes again, for example after restoring a backup')} onClick={() => void sync.resendAll()}>{tr('Rimanda tutto', 'Resend all')}</button>
              <button className="cbtn" onClick={() => { void sync.disconnect(); setToken(''); setInfo(tr('Scollegato. Le note restano su questo computer.', 'Disconnected. Your notes stay on this computer.')); }}>{tr('Scollega', 'Disconnect')}</button>
            </div>
          </section>
        )}
        <div className="dialog-actions"><button className="cbtn" onClick={() => ref.current?.close()}>{tr('Chiudi', 'Close')}</button></div>
      </div>
    </dialog>
  );
}
