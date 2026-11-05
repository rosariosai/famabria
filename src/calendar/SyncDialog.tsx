import { useEffect, useRef, useState } from 'react';
import { IS_WEB, requestOriginAccess } from '../browser/api';
import { SyncError, normalizeServerUrl } from '../sync/engine';
import type { useSync } from './useSync';

type Sync = ReturnType<typeof useSync>;

const WORDS: Record<string, string> = {
  off: 'Non collegato', idle: 'Collegato', syncing: 'Sincronizzo…', ok: 'Aggiornato', offline: 'Fuori linea (non sei sulla rete di casa?)',
  auth: 'Token non accettato', server: 'Problema del server', clock: 'Problema con l\'orologio', config: 'Non configurato',
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
    if (!clean) { setErr('Scrivi l\'indirizzo del server, per esempio 192.168.0.10:8420'); return; }
    if (!token.trim()) { setErr('Incolla il token ricevuto dal server (inizia con tn_).'); return; }
    setBusy(true);
    try {
      // must be asked right after the click; the browser shows a one-site permission prompt
      const ok = await requestOriginAccess(clean);
      if (!ok) { setErr('Il browser non ha permesso a Famabria di contattare quell\'indirizzo. Premi di nuovo «Salva e collega» e scegli Consenti.'); return; }
      const who = await sync.connect({ url: clean, token: token.trim() });
      setUrl(clean);
      setInfo(`Collegato come ${who}.`);
    } catch (e) {
      setErr(e instanceof SyncError ? e.message : `Non riesco a collegarmi (${(e as Error)?.message ?? 'errore sconosciuto'}).`);
    } finally { setBusy(false); }
  };

  const when = sync.state.lastSyncAt ? new Date(sync.state.lastSyncAt).toLocaleString() : 'mai';
  return (
    <dialog ref={ref} className="cdialog" onClose={props.onClose} aria-labelledby="sy-title">
      <div className="cdialog-body">
        <h2 id="sy-title">Sincronizza con il server di casa</h2>
        <p className="muted">{IS_WEB
          ? 'Incolla il token che ti hanno dato per vedere e modificare i calendari condivisi. Funziona con il Wi-Fi di casa; fuori casa il calendario tiene ciò che ha e si sincronizza la volta dopo.'
          : 'Condivide le note con il server Famabria di casa. Funziona solo sulla rete di casa; fuori casa il calendario continua a funzionare e si sincronizza la volta dopo.'}</p>
        {!IS_WEB && <div className="field field--stack"><label htmlFor="sy-url">Indirizzo del server</label>
          <input id="sy-url" value={url} placeholder="192.168.0.10:8420" autoComplete="off" spellCheck={false} onChange={(e) => setUrl(e.target.value)} /></div>}
        <div className="field field--stack"><label htmlFor="sy-token">Il tuo token</label>
          <input id="sy-token" type="password" value={token} placeholder="tn_…" autoComplete="off" spellCheck={false} onChange={(e) => setToken(e.target.value)} /></div>
        {err && <p className="field-error" role="alert">{err}</p>}
        {info && <p className="muted" role="status">{info}</p>}
        <div className="dialog-actions">
          <button className="cbtn cbtn--primary" disabled={busy} onClick={() => void save()}>{busy ? 'Mi collego…' : 'Salva e collega'}</button>
        </div>
        {sync.config && (
          <section className="sync-status" aria-live="polite">
            <p><strong>Stato:</strong> {statusWord(sync.status)}{sync.user ? ` · come ${sync.user}` : ''}</p>
            {sync.message && <p className="muted">{sync.message}</p>}
            <p className="muted">Ultima sincronizzazione riuscita: {when}</p>
            <div className="dialog-actions">
              <button className="cbtn" disabled={sync.status === 'syncing'} onClick={() => void sync.syncNow()}>Sincronizza ora</button>
              <button className="cbtn" title="Rimanda tutte le note, per esempio dopo aver ripristinato un backup" onClick={() => void sync.resendAll()}>Rimanda tutto</button>
              <button className="cbtn" onClick={() => { void sync.disconnect(); setToken(''); setInfo('Scollegato. Le note restano su questo computer.'); }}>Scollega</button>
            </div>
          </section>
        )}
        <div className="dialog-actions"><button className="cbtn" onClick={() => ref.current?.close()}>Chiudi</button></div>
      </div>
    </dialog>
  );
}
