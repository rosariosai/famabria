import { useEffect, useRef, useState } from 'react';
import { P2PError } from '../p2p/crypto';
import { inviteLink, joinFamily, normalizeRelayUrl } from '../cloud/family';
import { createInviteV2, isAdminV2, isInviteV2, listDevicesV2, parseInviteV2, removeDeviceV2, type DeviceRow } from '../cloud/v2';
import { DROPBOX_ORIGINS, startDropboxLogin } from '../cloud/dropbox';
import { IS_WEB, requestFixedOrigins, requestOriginAccess } from '../browser/api';
import type { useFamily } from './useFamily';

type Fam = ReturnType<typeof useFamily>;
const WORDS: Record<string, string> = { off: 'Non collegata', idle: 'Collegata', syncing: 'Sincronizzo…', ok: 'Sincronizzata', unreachable: 'Offline', auth: 'Invito non più valido', server: 'Problema del relay' };
export const familyWord = (s: string) => WORDS[s] ?? s;

export function FamilyDialog(props: { fam: Fam; defaultName: string; initialInvite?: string; onClose(): void }) {
  const { fam } = props;
  const ref = useRef<HTMLDialogElement>(null);
  const [mode, setMode] = useState<'join' | 'dropbox' | 'relay'>('join');
  const [appKey, setAppKey] = useState(() => { try { return localStorage.getItem('famcal-dropbox-key') ?? ''; } catch { return ''; } });
  const [invite, setInvite] = useState(props.initialInvite ?? '');
  const [fname, setFname] = useState('Famiglia');
  const [relay, setRelay] = useState(() => (/\.workers\.dev$/.test(location.hostname) ? location.origin : '')); // app served by the relay itself: nothing to type
  const [device, setDevice] = useState(props.defaultName);
  const [busy, setBusy] = useState(false), [err, setErr] = useState(''), [copied, setCopied] = useState(false);
  const [oneTime, setOneTime] = useState(''), [serverInvite, setServerInvite] = useState('');
  const [rows, setRows] = useState<DeviceRow[]>([]);
  const [renaming, setRenaming] = useState(false), [newName, setNewName] = useState('');
  const admin = !!fam.family && isAdminV2(fam.family);
  const loadRows = async () => { if (fam.family && admin) { try { setRows((await listDevicesV2(fam.family)).filter((r) => !r.revoked)); } catch { /* shown by the sync status */ } } };
  useEffect(() => { void loadRows(); }, [fam.family?.id, fam.state.lastSyncAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const nameOf = (id: string) => (id === fam.family?.deviceId ? `${fam.family.deviceName} (questo dispositivo)` : fam.deviceInfo.find((d) => d.id === id)?.name ?? `Dispositivo ${id.slice(0, 4)}…`);
  const removeDevice = async (r: DeviceRow) => {
    if (!fam.family || !confirm(`Rimuovere «${nameOf(r.device)}» dalla famiglia? Non potrà più sincronizzare e il suo file viene cancellato. Le note già salvate su quel dispositivo restano lì.`)) return;
    setErr(''); setBusy(true); try { await removeDeviceV2(fam.family, r.device); await loadRows(); void fam.syncNow(); } catch (e) { fail(e); } finally { setBusy(false); }
  };
  useEffect(() => { ref.current?.showModal(); }, []);
  const fail = (e: unknown) => setErr(e instanceof P2PError || e instanceof Error ? e.message : 'Qualcosa è andato storto.');

  const doCreate = async () => {
    setErr('');
    try {
      const url = normalizeRelayUrl(relay);
      if (!(await requestOriginAccess(url))) { setErr('Il browser non ha dato il permesso per quell\'indirizzo. Riprova e scegli Consenti.'); return; }
      setBusy(true); await fam.create(fname, url, device);
    } catch (e) { fail(e); } finally { setBusy(false); }
  };
  const doDropbox = async () => {
    setErr('');
    try {
      const key = appKey.trim(); if (!/^[a-z0-9]{8,32}$/i.test(key)) { setErr('La «App key» di Dropbox non sembra valida (lettere e numeri).'); return; }
      const redirect = location.origin + location.pathname; setBusy(true);
      const { url, verifier, state } = await startDropboxLogin(key, redirect);
      try { sessionStorage.setItem('famcal-dropbox-pending', JSON.stringify({ appKey: key, verifier, state, redirect, name: fname, device })); localStorage.setItem('famcal-dropbox-key', key); } catch { setErr('Il browser blocca la memoria locale: riprova fuori dalla navigazione privata.'); setBusy(false); return; }
      location.assign(url);
    } catch (e) { fail(e); setBusy(false); }
  };
  const doJoin = async () => {
    setErr('');
    try {
      let url: string | null = null, dropbox = false;
      if (isInviteV2(invite)) { url = parseInviteV2(invite)?.u ?? null; if (!url) throw new P2PError('format', 'Invito non valido.'); }
      else { const f = joinFamily(invite, device, 0); if (f.provider.type === 'dropbox') dropbox = true; else url = f.provider.url; } // only to read which service the invite uses (throws a clear message if it is not an invite)
      const ok = dropbox ? await requestFixedOrigins(DROPBOX_ORIGINS) : await requestOriginAccess(url as string);
      if (!ok) { setErr('Il browser non ha dato il permesso di collegarsi al servizio dell\'invito. Riprova e scegli Consenti.'); return; }
    } catch (e) { fail(e); return; }
    setBusy(true);
    try { await fam.join(invite, device); } catch (e) { fail(e); } finally { setBusy(false); }
  };
  // From the extension the address would be chrome-extension://… which opens nowhere else: invites always point to the web app on the relay.
  const inviteBase = fam.family && (fam.family.provider.type === 'relay' || fam.family.provider.type === 'relay2') && !/^https?:$/.test(location.protocol) ? `${fam.family.provider.url.replace(/\/+$/, '')}/app/app` : location.origin + location.pathname;
  const v2 = fam.family?.provider.type === 'relay2';
  const link = fam.family ? (v2 ? oneTime : inviteLink(inviteBase, fam.family)) : '';
  const makeServerInvite = async () => { if (!fam.family) return; setErr(''); setBusy(true); try { setServerInvite((await createInviteV2(fam.family, inviteBase, fetch, 'bot')).link); } catch (e) { fail(e); } finally { setBusy(false); } };
  const doMigrate = async () => { if (!confirm('Passare alla nuova famiglia sicura? Le tue note restano qui e vengono inviate alla nuova famiglia. Poi dovrai invitare di nuovo i familiari con un link nuovo (il vecchio smette di essere usato).')) return; setErr(''); setBusy(true); try { await fam.migrate(); } catch (e) { fail(e); } finally { setBusy(false); } };
  const makeInvite = async () => { if (!fam.family) return; setErr(''); setBusy(true); try { setOneTime((await createInviteV2(fam.family, inviteBase)).link); } catch (e) { fail(e); } finally { setBusy(false); } };
  const copy = async () => { try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2500); } catch { setErr('Non riesco a copiare: seleziona il testo e copialo a mano.'); } };
  const share = () => { if (navigator.share) void navigator.share({ title: 'Invito a Famabria', text: `Unisciti a "${fam.family?.name}" su Famabria`, url: link }).catch(() => undefined); else void copy(); };

  return (
    <dialog ref={ref} className="cdialog cdialog--family" onClose={props.onClose} aria-labelledby="fm-title" lang="it">
      <div className="cdialog-body">
        <header className="fam-head">
          <button type="button" className="fam-x" aria-label="Chiudi" onClick={() => ref.current?.close()}>✕</button>
          <h2 id="fm-title">Sincronizzazione Famiglia</h2>
        </header>
        {fam.family ? (
          <>
            <section className="fam-card">
              <div className="fam-card-top">
                <span className="fam-kicker">Gruppo domestico</span>
                <span role="status" className={`sync-pill sync-pill--${fam.status}`}>{familyWord(fam.status)}{fam.state.lastSyncAt ? ` · ${new Date(fam.state.lastSyncAt).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}` : ''}</span>
              </div>
              {renaming ? (
                <div className="dialog-actions">
                  <input className="fam-link" value={newName} maxLength={40} aria-label="Nome della famiglia" onChange={(e) => setNewName(e.target.value)} />
                  <button className="cbtn cbtn--primary" disabled={!newName.trim()} onClick={() => { void fam.rename(newName); setRenaming(false); }}>Salva</button>
                  <button className="cbtn" onClick={() => setRenaming(false)}>Annulla</button>
                </div>
              ) : (
                <h3 className="fam-name">{fam.family.name} <button className="cbtn cbtn--sm" aria-label="Cambia il nome della famiglia" title="Cambia nome (solo su questo dispositivo)" onClick={() => { setNewName(fam.family?.name ?? ''); setRenaming(true); }}>✎</button></h3>
              )}
              <p className="fam-devices"><b>Questo dispositivo:</b> {fam.family.deviceName} <button type="button" className="cbtn cbtn--sm" aria-label="Cambia il nome di questo dispositivo" title="Cambia nome di questo dispositivo" onClick={() => { const n = prompt('Nome di questo dispositivo', fam.family?.deviceName ?? ''); if (n && n.trim()) void fam.renameDevice(n); }}>✎</button>{fam.devices.length > 0 && <><br /><b>Collegati anche:</b> {fam.devices.map((id) => fam.deviceInfo.find((d) => d.id === id)?.name ?? 'dispositivo ' + id.slice(0, 4)).join(', ')}</>}</p>
              {fam.message && <p className="muted">{fam.message}</p>}
            </section>
            <section className="fam-card">
              <h3>Invita un familiare</h3>
              {v2 ? (
                <>
                  <p className="muted">Il link vale <b>una sola volta</b> e scade dopo 15 minuti. Mandalo in privato (per esempio su WhatsApp) a chi deve entrare.</p>
                  {link && <input className="fam-link" readOnly value={link} aria-label="Link di invito" onFocus={(e) => e.currentTarget.select()} />}
                  <div className="dialog-actions">
                    <button className="cbtn cbtn--primary" disabled={busy} onClick={() => void makeInvite()}>{link ? 'Crea un nuovo link' : 'Crea link di invito'}</button>
                    {link && <button className="cbtn" onClick={() => void copy()}>{copied ? 'Copiato ✓' : 'Copia il link'}</button>}
                    {link && <button className="cbtn" onClick={share}>Condividi…</button>}
                  </div>
                  <p className="fam-warn">🔑 Dopo l'uso o dopo 15 minuti il link non funziona più.</p>
                </>
              ) : (
                <>
                  <p className="muted">Manda questo link in privato (per esempio su WhatsApp). Chi lo apre entra nella famiglia con un tocco.</p>
                  <input className="fam-link" readOnly value={link} aria-label="Link di invito" onFocus={(e) => e.currentTarget.select()} />
                  <div className="dialog-actions"><button className="cbtn cbtn--primary" onClick={() => void copy()}>{copied ? 'Copiato ✓' : 'Copia il link'}</button><button className="cbtn" onClick={share}>Condividi…</button></div>
                  <p className="fam-warn">🔑 Trattalo come una chiave: chi ha il link può leggere le note.</p>
                </>
              )}
            </section>
            {fam.family.provider.type === 'relay' && (
              <section className="fam-card">
                <h3>Passa alla famiglia sicura</h3>
                <p className="muted">Questa famiglia usa ancora il vecchio link permanente. La nuova usa inviti che valgono una sola volta. Prima fai una copia delle note da Impostazioni → Copia di sicurezza.</p>
                <div className="dialog-actions"><button className="cbtn cbtn--primary" disabled={busy} onClick={() => void doMigrate()}>Passa alla nuova famiglia</button></div>
              </section>
            )}
            {v2 && admin && (
              <section className="fam-card">
                <h3>Dispositivi</h3>
                <p className="muted">Chi ha accesso alla famiglia. Se perdi un telefono, rimuovilo da qui.</p>
                <ul className="fam-devices-list" style={{ listStyle: 'none', padding: 0, margin: '8px 0' }}>
                  {rows.map((r) => (
                    <li key={r.device} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '6px 0' }}>
                      <span><b>{r.role === 'bot' ? 'Server di casa' : nameOf(r.device)}</b>{r.role === 'admin' ? ' · amministratore' : r.role === 'bot' ? ' · sola lettura' : ''}</span>
                      {r.device !== fam.family?.deviceId && <button className="cbtn cbtn--danger" disabled={busy} onClick={() => void removeDevice(r)}>Rimuovi</button>}
                    </li>
                  ))}
                  {rows.length === 0 && <li className="muted">Nessun dispositivo da mostrare.</li>}
                </ul>
              </section>
            )}
            {v2 && (
              <section className="fam-card">
                <h3>Invito per il server di casa</h3>
                <p className="muted">Per i promemoria sul telefono: un invito di sola lettura da incollare nel server di casa (vale una volta e 15 minuti).</p>
                {serverInvite && <input className="fam-link" readOnly value={serverInvite} aria-label="Invito per il server" onFocus={(e) => e.currentTarget.select()} />}
                <div className="dialog-actions"><button className="cbtn" disabled={busy} onClick={() => void makeServerInvite()}>{serverInvite ? 'Crea un nuovo invito' : 'Crea invito per il server'}</button></div>
              </section>
            )}
            <button className="cbtn fam-wide" onClick={() => void fam.syncNow()}>⟳ Sincronizza ora</button>
            <button className="cbtn cbtn--danger fam-wide" onClick={() => { if (confirm('Uscire dalla famiglia? Le note restano su questo dispositivo.')) void fam.leave(); }}>Esci dalla famiglia</button>
          </>
        ) : (
          <>
            <div className="seg fam-tabs" role="radiogroup" aria-label="Cosa vuoi fare">
              <label className={mode === 'join' ? 'on' : ''}><input type="radio" name="fm-mode" checked={mode === 'join'} onChange={() => setMode('join')} />Ho un invito</label>
              <label className={mode === 'dropbox' ? 'on' : ''}><input type="radio" name="fm-mode" checked={mode === 'dropbox'} onChange={() => setMode('dropbox')} />Crea con Dropbox</label>
              <label className={mode === 'relay' ? 'on' : ''}><input type="radio" name="fm-mode" checked={mode === 'relay'} onChange={() => setMode('relay')} />Crea con relay</label>
            </div>
            <p className="fam-intro"><b>{mode === 'join' ? 'Accedi a una famiglia' : mode === 'dropbox' ? 'Spazio familiare su Dropbox' : 'Spazio familiare con relay'}</b><span>{mode === 'join' ? 'Incolla il link ricevuto da un familiare.' : mode === 'dropbox' ? 'Salvataggio sicuro e condiviso sul tuo cloud.' : 'Un piccolo servizio gratuito, creato una volta sola.'}</span></p>
            <div className="field field--stack"><label htmlFor="fm-dev">Nome di questo dispositivo</label><input id="fm-dev" value={device} maxLength={40} onChange={(e) => setDevice(e.target.value)} /></div>
            {mode === 'join' ? (
              <div className="field field--stack"><label htmlFor="fm-inv">Link di invito</label>
                <textarea id="fm-inv" rows={3} value={invite} placeholder="Incolla qui il link ricevuto" spellCheck={false} onChange={(e) => setInvite(e.target.value)} /></div>
            ) : mode === 'dropbox' ? (
              <>
                <p className="muted">Si usa un solo account Dropbox di famiglia (anche nuovo e gratuito): Famabria scrive solo file cifrati nella sua cartella <b>Apps/Famabria</b>. Accedi una volta; i familiari entrano poi con il link, senza accedere. Guida: docs/DROPBOX.md.</p>
                {!IS_WEB && <p className="field-error">La creazione parte dalla versione web di Famabria (si accede a Dropbox da lì); questa estensione può invece entrare con un invito.</p>}
                <div className="field field--stack"><label htmlFor="fm-name">Nome della famiglia</label><input id="fm-name" value={fname} maxLength={40} onChange={(e) => setFname(e.target.value)} /></div>
                <details className="howto"><summary>Come si crea l'App key (5 minuti)</summary>
                  <ol>
                    <li>Accedi all'account Dropbox di famiglia e apri <b>dropbox.com/developers/apps</b> → <b>Create app</b>.</li>
                    <li>Scegli <b>Scoped access</b> → <b>App folder</b> → nome «Famabria».</li>
                    <li>Scheda <b>Permissions</b>: attiva <code>files.content.write</code> e <code>files.content.read</code> → Submit.</li>
                    <li>Scheda <b>Settings</b> → <b>Redirect URIs</b>: aggiungi l'indirizzo di questa pagina ({location.origin + location.pathname}) → Add.</li>
                    <li>Copia la <b>App key</b> (non il secret) e incollala qui sotto.</li>
                  </ol>
                  <p className="muted">Guida completa: docs/DROPBOX.md</p>
                </details>
                <div className="field field--stack"><label htmlFor="fm-key">App key di Dropbox</label><input id="fm-key" value={appKey} autoComplete="off" spellCheck={false} placeholder="la tua app key" onChange={(e) => setAppKey(e.target.value)} /></div>
              </>
            ) : (
              <>
                <p className="muted">Servono tre minuti, una volta sola: scegli il relay (un piccolo servizio gratuito, vedi docs/RELAY.md), poi invii il link ai familiari.</p>
                <div className="field field--stack"><label htmlFor="fm-name">Nome della famiglia</label><input id="fm-name" value={fname} maxLength={40} onChange={(e) => setFname(e.target.value)} /></div>
                <details className="howto"><summary>Come si crea il relay (10 minuti, gratis)</summary>
                  <ol>
                    <li>Crea un account gratuito su <b>dash.cloudflare.com/sign-up</b> e conferma l'email.</li>
                    <li>Installa <b>Node.js</b> (nodejs.org, pulsante «LTS»).</li>
                    <li>Apri un terminale nella cartella di Famabria e scrivi <code>npx wrangler login</code>; nel browser premi <b>Allow</b>.</li>
                    <li>Scrivi <code>npx wrangler deploy -c relay/wrangler.toml</code>. Alla fine compare un indirizzo tipo <code>https://famcal-relay.nome.workers.dev</code>: copialo qui sotto.</li>
                    <li>Controlla aprendo quell'indirizzo seguito da <code>/healthz</code>: deve comparire <code>{'{"ok":true…}'}</code>.</li>
                  </ol>
                  <p className="muted">Guida completa con aiuto per gli errori: docs/RELAY.md</p>
                </details>
                <div className="field field--stack"><label htmlFor="fm-url">Indirizzo del relay</label><input id="fm-url" value={relay} placeholder="https://famcal-relay.tuonome.workers.dev" autoComplete="off" spellCheck={false} onChange={(e) => setRelay(e.target.value)} /></div>
              </>
            )}
            {err && <p className="field-error" role="alert">{err}</p>}
            <div className="dialog-actions"><button className="cbtn cbtn--primary" disabled={busy || (mode === 'join' ? !invite.trim() : mode === 'dropbox' ? !appKey.trim() || !IS_WEB : !relay.trim())} onClick={() => void (mode === 'join' ? doJoin() : mode === 'dropbox' ? doDropbox() : doCreate())}>{busy ? 'Collego…' : mode === 'join' ? 'Entra nella famiglia' : mode === 'dropbox' ? 'Accedi a Dropbox' : 'Crea e collega'}</button></div>
          </>
        )}
        {fam.family && err && <p className="field-error" role="alert">{err}</p>}
        {!fam.family && mode !== 'join' && <p className="fam-note">🛡 {mode === 'dropbox' ? 'Famabria non legge i tuoi file personali: scrive solo file cifrati nella sua cartella dedicata.' : 'Il relay vede solo dati cifrati e illeggibili: la chiave resta nel link di invito.'}</p>}
      </div>
    </dialog>
  );
}
