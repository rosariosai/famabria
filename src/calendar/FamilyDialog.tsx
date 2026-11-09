import { useEffect, useRef, useState } from 'react';
import { P2PError } from '../p2p/crypto';
import { inviteLink, joinFamily, normalizeRelayUrl } from '../cloud/family';
import { createInviteV2, isAdminV2, isInviteV2, listDevicesV2, parseInviteV2, removeDeviceV2, type DeviceRow } from '../cloud/v2';
import { DROPBOX_ORIGINS, startDropboxLogin } from '../cloud/dropbox';
import { IS_WEB, requestFixedOrigins, requestOriginAccess } from '../browser/api';
import type { useFamily } from './useFamily';
import { LANG, LOCALE, isEn, tm, tr } from '../core/i18n';

type Fam = ReturnType<typeof useFamily>;
const WORDS: Record<string, string> = { off: tr('Non collegata', 'Not connected'), idle: tr('Collegata', 'Connected'), syncing: tr('Sincronizzo…', 'Syncing…'), ok: tr('Sincronizzata', 'Synced'), unreachable: 'Offline', auth: tr('Invito non più valido', 'Invite no longer valid'), server: tr('Problema del relay', 'Relay problem') };
export const familyWord = (s: string) => WORDS[s] ?? s;

export function FamilyDialog(props: { fam: Fam; defaultName: string; initialInvite?: string; onClose(): void }) {
  const { fam } = props;
  const ref = useRef<HTMLDialogElement>(null);
  const [mode, setMode] = useState<'join' | 'dropbox' | 'relay'>('join');
  const [appKey, setAppKey] = useState(() => { try { return localStorage.getItem('famcal-dropbox-key') ?? ''; } catch { return ''; } });
  const [invite, setInvite] = useState(props.initialInvite ?? '');
  const [fname, setFname] = useState(tr('Famiglia', 'Family'));
  const [relay, setRelay] = useState(() => (/\.workers\.dev$/.test(location.hostname) ? location.origin : '')); // app served by the relay itself: nothing to type
  const [device, setDevice] = useState(props.defaultName);
  const [busy, setBusy] = useState(false), [err, setErr] = useState(''), [copied, setCopied] = useState(false);
  const [oneTime, setOneTime] = useState(''), [serverInvite, setServerInvite] = useState('');
  const [rows, setRows] = useState<DeviceRow[]>([]);
  const [renaming, setRenaming] = useState(false), [newName, setNewName] = useState('');
  const admin = !!fam.family && isAdminV2(fam.family);
  const loadRows = async () => { if (fam.family && admin) { try { setRows((await listDevicesV2(fam.family)).filter((r) => !r.revoked)); } catch { /* shown by the sync status */ } } };
  useEffect(() => { void loadRows(); }, [fam.family?.id, fam.state.lastSyncAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const nameOf = (id: string) => (id === fam.family?.deviceId ? `${fam.family.deviceName} (${tr('questo dispositivo', 'this device')})` : fam.deviceInfo.find((d) => d.id === id)?.name ?? `${tr('Dispositivo', 'Device')} ${id.slice(0, 4)}…`);
  const removeDevice = async (r: DeviceRow) => {
    if (!fam.family || !confirm(tr(`Rimuovere «${nameOf(r.device)}» dalla famiglia? Non potrà più sincronizzare e il suo file viene cancellato. Le note già salvate su quel dispositivo restano lì.`, `Remove “${nameOf(r.device)}” from the family? It will no longer be able to sync and its file is deleted. Notes already saved on that device stay there.`))) return;
    setErr(''); setBusy(true); try { await removeDeviceV2(fam.family, r.device); await loadRows(); void fam.syncNow(); } catch (e) { fail(e); } finally { setBusy(false); }
  };
  useEffect(() => { ref.current?.showModal(); }, []);
  const fail = (e: unknown) => setErr(e instanceof P2PError || e instanceof Error ? tm(e.message) : tm('Qualcosa è andato storto.'));

  const doCreate = async () => {
    setErr('');
    try {
      const url = normalizeRelayUrl(relay);
      if (!(await requestOriginAccess(url))) { setErr(tr('Il browser non ha dato il permesso per quell\'indirizzo. Riprova e scegli Consenti.', 'The browser did not give permission for that address. Try again and choose Allow.')); return; }
      setBusy(true); await fam.create(fname, url, device);
    } catch (e) { fail(e); } finally { setBusy(false); }
  };
  const doDropbox = async () => {
    setErr('');
    try {
      const key = appKey.trim(); if (!/^[a-z0-9]{8,32}$/i.test(key)) { setErr(tr('La «App key» di Dropbox non sembra valida (lettere e numeri).', 'The Dropbox “App key” does not look valid (letters and numbers).')); return; }
      const redirect = location.origin + location.pathname; setBusy(true);
      const { url, verifier, state } = await startDropboxLogin(key, redirect);
      try { sessionStorage.setItem('famcal-dropbox-pending', JSON.stringify({ appKey: key, verifier, state, redirect, name: fname, device })); localStorage.setItem('famcal-dropbox-key', key); } catch { setErr(tr('Il browser blocca la memoria locale: riprova fuori dalla navigazione privata.', 'The browser blocks local storage: try outside private browsing.')); setBusy(false); return; }
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
      if (!ok) { setErr(tr('Il browser non ha dato il permesso di collegarsi al servizio dell\'invito. Riprova e scegli Consenti.', 'The browser did not give permission to connect to the invite’s service. Try again and choose Allow.')); return; }
    } catch (e) { fail(e); return; }
    setBusy(true);
    try { await fam.join(invite, device); } catch (e) { fail(e); } finally { setBusy(false); }
  };
  // From the extension the address would be chrome-extension://… which opens nowhere else: invites always point to the web app on the relay.
  const inviteBase = fam.family && (fam.family.provider.type === 'relay' || fam.family.provider.type === 'relay2') && !/^https?:$/.test(location.protocol) ? `${fam.family.provider.url.replace(/\/+$/, '')}/app/app` : location.origin + location.pathname;
  const v2 = fam.family?.provider.type === 'relay2';
  const link = fam.family ? (v2 ? oneTime : inviteLink(inviteBase, fam.family)) : '';
  const makeServerInvite = async () => { if (!fam.family) return; setErr(''); setBusy(true); try { setServerInvite((await createInviteV2(fam.family, inviteBase, fetch, 'bot')).link); } catch (e) { fail(e); } finally { setBusy(false); } };
  const doMigrate = async () => { if (!confirm(tr('Passare alla nuova famiglia sicura? Le tue note restano qui e vengono inviate alla nuova famiglia. Poi dovrai invitare di nuovo i familiari con un link nuovo (il vecchio smette di essere usato).', 'Switch to the new secure family? Your notes stay here and are sent to the new family. Then you will need to invite your family again with a new link (the old one stops being used).'))) return; setErr(''); setBusy(true); try { await fam.migrate(); } catch (e) { fail(e); } finally { setBusy(false); } };
  const makeInvite = async () => { if (!fam.family) return; setErr(''); setBusy(true); try { setOneTime((await createInviteV2(fam.family, inviteBase)).link); } catch (e) { fail(e); } finally { setBusy(false); } };
  const copy = async () => { try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2500); } catch { setErr(tr('Non riesco a copiare: seleziona il testo e copialo a mano.', 'Cannot copy: select the text and copy it by hand.')); } };
  const share = () => { if (navigator.share) void navigator.share({ title: tr('Invito a Famabria', 'Invitation to Famabria'), text: tr(`Unisciti a "${fam.family?.name}" su Famabria`, `Join "${fam.family?.name}" on Famabria`), url: link }).catch(() => undefined); else void copy(); };

  return (
    <dialog ref={ref} className="cdialog cdialog--family" onClose={props.onClose} aria-labelledby="fm-title" lang={LANG}>
      <div className="cdialog-body">
        <header className="fam-head">
          <button type="button" className="fam-x" aria-label={tr('Chiudi', 'Close')} onClick={() => ref.current?.close()}>✕</button>
          <h2 id="fm-title">{tr('Sincronizzazione Famiglia', 'Family sync')}</h2>
        </header>
        {fam.family ? (
          <>
            <section className="fam-card">
              <div className="fam-card-top">
                <span className="fam-kicker">{tr('Gruppo domestico', 'Household')}</span>
                <span role="status" className={`sync-pill sync-pill--${fam.status}`}>{familyWord(fam.status)}{fam.state.lastSyncAt ? ` · ${new Date(fam.state.lastSyncAt).toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' })}` : ''}</span>
              </div>
              {renaming ? (
                <div className="dialog-actions">
                  <input className="fam-link" value={newName} maxLength={40} aria-label={tr('Nome della famiglia', 'Family name')} onChange={(e) => setNewName(e.target.value)} />
                  <button className="cbtn cbtn--primary" disabled={!newName.trim()} onClick={() => { void fam.rename(newName); setRenaming(false); }}>{tr('Salva', 'Save')}</button>
                  <button className="cbtn" onClick={() => setRenaming(false)}>{tr('Annulla', 'Cancel')}</button>
                </div>
              ) : (
                <h3 className="fam-name">{fam.family.name} <button className="cbtn cbtn--sm" aria-label={tr('Cambia il nome della famiglia', 'Rename the family')} title={tr('Cambia nome (solo su questo dispositivo)', 'Rename (this device only)')} onClick={() => { setNewName(fam.family?.name ?? ''); setRenaming(true); }}>✎</button></h3>
              )}
              <p className="fam-devices"><b>{tr('Questo dispositivo', 'This device')}:</b> {fam.family.deviceName} <button type="button" className="cbtn cbtn--sm" aria-label={tr('Cambia il nome di questo dispositivo', 'Rename this device')} title={tr('Cambia nome di questo dispositivo', 'Rename this device')} onClick={() => { const n = prompt(tr('Nome di questo dispositivo', 'Name of this device'), fam.family?.deviceName ?? ''); if (n && n.trim()) void fam.renameDevice(n); }}>✎</button>{fam.devices.length > 0 && <><br /><b>{tr('Collegati anche', 'Also connected')}:</b> {fam.devices.map((id) => fam.deviceInfo.find((d) => d.id === id)?.name ?? tr('dispositivo ', 'device ') + id.slice(0, 4)).join(', ')}</>}</p>
              {fam.message && <p className="muted">{fam.message}</p>}
            </section>
            <section className="fam-card">
              <h3>{tr('Invita un familiare', 'Invite a family member')}</h3>
              {v2 ? (
                <>
                  <p className="muted">{isEn ? <>The link works <b>only once</b> and expires after 15 minutes. Send it privately (for example on WhatsApp) to the person who needs to join.</> : <>Il link vale <b>una sola volta</b> e scade dopo 15 minuti. Mandalo in privato (per esempio su WhatsApp) a chi deve entrare.</>}</p>
                  {link && <input className="fam-link" readOnly value={link} aria-label={tr('Link di invito', 'Invite link')} onFocus={(e) => e.currentTarget.select()} />}
                  <div className="dialog-actions">
                    <button className="cbtn cbtn--primary" disabled={busy} onClick={() => void makeInvite()}>{link ? tr('Crea un nuovo link', 'Create a new link') : tr('Crea link di invito', 'Create invite link')}</button>
                    {link && <button className="cbtn" onClick={() => void copy()}>{copied ? tr('Copiato ✓', 'Copied ✓') : tr('Copia il link', 'Copy the link')}</button>}
                    {link && <button className="cbtn" onClick={share}>{tr('Condividi…', 'Share…')}</button>}
                  </div>
                  <p className="fam-warn">🔑 {tr("Dopo l'uso o dopo 15 minuti il link non funziona più.", 'After use, or after 15 minutes, the link stops working.')}</p>
                </>
              ) : (
                <>
                  <p className="muted">{tr('Manda questo link in privato (per esempio su WhatsApp). Chi lo apre entra nella famiglia con un tocco.', 'Send this link privately (for example on WhatsApp). Whoever opens it joins the family with one tap.')}</p>
                  <input className="fam-link" readOnly value={link} aria-label={tr('Link di invito', 'Invite link')} onFocus={(e) => e.currentTarget.select()} />
                  <div className="dialog-actions"><button className="cbtn cbtn--primary" onClick={() => void copy()}>{copied ? tr('Copiato ✓', 'Copied ✓') : tr('Copia il link', 'Copy the link')}</button><button className="cbtn" onClick={share}>{tr('Condividi…', 'Share…')}</button></div>
                  <p className="fam-warn">🔑 {tr('Trattalo come una chiave: chi ha il link può leggere le note.', 'Treat it like a key: anyone with the link can read the notes.')}</p>
                </>
              )}
            </section>
            {fam.family.provider.type === 'relay' && (
              <section className="fam-card">
                <h3>{tr('Passa alla famiglia sicura', 'Switch to the secure family')}</h3>
                <p className="muted">{tr('Questa famiglia usa ancora il vecchio link permanente. La nuova usa inviti che valgono una sola volta. Prima fai una copia delle note da Impostazioni → Copia di sicurezza.', 'This family still uses the old permanent link. The new one uses invites that work only once. First make a copy of your notes from Settings → Backup.')}</p>
                <div className="dialog-actions"><button className="cbtn cbtn--primary" disabled={busy} onClick={() => void doMigrate()}>{tr('Passa alla nuova famiglia', 'Switch to the new family')}</button></div>
              </section>
            )}
            {v2 && admin && (
              <section className="fam-card">
                <h3>{tr('Dispositivi', 'Devices')}</h3>
                <p className="muted">{tr('Chi ha accesso alla famiglia. Se perdi un telefono, rimuovilo da qui.', 'Who has access to the family. If you lose a phone, remove it here.')}</p>
                <ul className="fam-devices-list" style={{ listStyle: 'none', padding: 0, margin: '8px 0' }}>
                  {rows.map((r) => (
                    <li key={r.device} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '6px 0' }}>
                      <span><b>{r.role === 'bot' ? tr('Server di casa', 'Home server') : nameOf(r.device)}</b>{r.role === 'admin' ? tr(' · amministratore', ' · admin') : r.role === 'bot' ? tr(' · sola lettura', ' · read-only') : ''}</span>
                      {r.device !== fam.family?.deviceId && <button className="cbtn cbtn--danger" disabled={busy} onClick={() => void removeDevice(r)}>{tr('Rimuovi', 'Remove')}</button>}
                    </li>
                  ))}
                  {rows.length === 0 && <li className="muted">{tr('Nessun dispositivo da mostrare.', 'No devices to show.')}</li>}
                </ul>
              </section>
            )}
            {v2 && (
              <section className="fam-card">
                <h3>{tr('Invito per il server di casa', 'Invite for the home server')}</h3>
                <p className="muted">{tr('Per i promemoria sul telefono: un invito di sola lettura da incollare nel server di casa (vale una volta e 15 minuti).', 'For phone reminders: a read-only invite to paste into the home server (works once, for 15 minutes).')}</p>
                {serverInvite && <input className="fam-link" readOnly value={serverInvite} aria-label={tr('Invito per il server', 'Invite for the server')} onFocus={(e) => e.currentTarget.select()} />}
                <div className="dialog-actions"><button className="cbtn" disabled={busy} onClick={() => void makeServerInvite()}>{serverInvite ? tr('Crea un nuovo invito', 'Create a new invite') : tr('Crea invito per il server', 'Create invite for the server')}</button></div>
              </section>
            )}
            <button className="cbtn fam-wide" onClick={() => void fam.syncNow()}>⟳ {tr('Sincronizza ora', 'Sync now')}</button>
            <button className="cbtn cbtn--danger fam-wide" onClick={() => { if (confirm(tr('Uscire dalla famiglia? Le note restano su questo dispositivo.', 'Leave the family? Your notes stay on this device.'))) void fam.leave(); }}>{tr('Esci dalla famiglia', 'Leave the family')}</button>
          </>
        ) : (
          <>
            <div className="seg fam-tabs" role="radiogroup" aria-label={tr('Cosa vuoi fare', 'What do you want to do')}>
              <label className={mode === 'join' ? 'on' : ''}><input type="radio" name="fm-mode" checked={mode === 'join'} onChange={() => setMode('join')} />{tr('Ho un invito', 'I have an invite')}</label>
              <label className={mode === 'dropbox' ? 'on' : ''}><input type="radio" name="fm-mode" checked={mode === 'dropbox'} onChange={() => setMode('dropbox')} />{tr('Crea con Dropbox', 'Create with Dropbox')}</label>
              <label className={mode === 'relay' ? 'on' : ''}><input type="radio" name="fm-mode" checked={mode === 'relay'} onChange={() => setMode('relay')} />{tr('Crea con relay', 'Create with a relay')}</label>
            </div>
            <p className="fam-intro"><b>{mode === 'join' ? tr('Accedi a una famiglia', 'Join a family') : mode === 'dropbox' ? tr('Spazio familiare su Dropbox', 'Family space on Dropbox') : tr('Spazio familiare con relay', 'Family space with a relay')}</b><span>{mode === 'join' ? tr('Incolla il link ricevuto da un familiare.', 'Paste the link you got from a family member.') : mode === 'dropbox' ? tr('Salvataggio sicuro e condiviso sul tuo cloud.', 'Safe, shared storage on your own cloud.') : tr('Un piccolo servizio gratuito, creato una volta sola.', 'A small free service, set up once.')}</span></p>
            <div className="field field--stack"><label htmlFor="fm-dev">{tr('Nome di questo dispositivo', 'Name of this device')}</label><input id="fm-dev" value={device} maxLength={40} onChange={(e) => setDevice(e.target.value)} /></div>
            {mode === 'join' ? (
              <div className="field field--stack"><label htmlFor="fm-inv">{tr('Link di invito', 'Invite link')}</label>
                <textarea id="fm-inv" rows={3} value={invite} placeholder={tr('Incolla qui il link ricevuto', 'Paste the link you received here')} spellCheck={false} onChange={(e) => setInvite(e.target.value)} /></div>
            ) : mode === 'dropbox' ? (
              <>
                <p className="muted">{isEn ? <>One shared family Dropbox account is used (a new free one is fine): Famabria only writes encrypted files in its own <b>Apps/Famabria</b> folder. Sign in once; family members then join with the link, without signing in. Guide: docs/DROPBOX.md.</> : <>Si usa un solo account Dropbox di famiglia (anche nuovo e gratuito): Famabria scrive solo file cifrati nella sua cartella <b>Apps/Famabria</b>. Accedi una volta; i familiari entrano poi con il link, senza accedere. Guida: docs/DROPBOX.md.</>}</p>
                {!IS_WEB && <p className="field-error">{tr('La creazione parte dalla versione web di Famabria (si accede a Dropbox da lì); questa estensione può invece entrare con un invito.', 'Creating a family starts from the web version of Famabria (you sign in to Dropbox there); this extension can join with an invite instead.')}</p>}
                <div className="field field--stack"><label htmlFor="fm-name">{tr('Nome della famiglia', 'Family name')}</label><input id="fm-name" value={fname} maxLength={40} onChange={(e) => setFname(e.target.value)} /></div>
                <details className="howto"><summary>{tr("Come si crea l'App key (5 minuti)", 'How to create the App key (5 minutes)')}</summary>
                  <ol>
                    {isEn ? <>
                    <li>Sign in to the family Dropbox account and open <b>dropbox.com/developers/apps</b> → <b>Create app</b>.</li>
                    <li>Choose <b>Scoped access</b> → <b>App folder</b> → name it “Famabria”.</li>
                    <li><b>Permissions</b> tab: turn on <code>files.content.write</code> and <code>files.content.read</code> → Submit.</li>
                    <li><b>Settings</b> tab → <b>Redirect URIs</b>: add this page’s address ({location.origin + location.pathname}) → Add.</li>
                    <li>Copy the <b>App key</b> (not the secret) and paste it below.</li></> : <>
                    <li>Accedi all'account Dropbox di famiglia e apri <b>dropbox.com/developers/apps</b> → <b>Create app</b>.</li>
                    <li>Scegli <b>Scoped access</b> → <b>App folder</b> → nome «Famabria».</li>
                    <li>Scheda <b>Permissions</b>: attiva <code>files.content.write</code> e <code>files.content.read</code> → Submit.</li>
                    <li>Scheda <b>Settings</b> → <b>Redirect URIs</b>: aggiungi l'indirizzo di questa pagina ({location.origin + location.pathname}) → Add.</li>
                    <li>Copia la <b>App key</b> (non il secret) e incollala qui sotto.</li></>}
                  </ol>
                  <p className="muted">{tr('Guida completa: docs/DROPBOX.md', 'Full guide: docs/DROPBOX.md')}</p>
                </details>
                <div className="field field--stack"><label htmlFor="fm-key">{tr('App key di Dropbox', 'Dropbox App key')}</label><input id="fm-key" value={appKey} autoComplete="off" spellCheck={false} placeholder={tr('la tua app key', 'your app key')} onChange={(e) => setAppKey(e.target.value)} /></div>
              </>
            ) : (
              <>
                <p className="muted">{tr('Servono tre minuti, una volta sola: scegli il relay (un piccolo servizio gratuito, vedi docs/RELAY.md), poi invii il link ai familiari.', 'It takes three minutes, once: choose the relay (a small free service, see docs/RELAY.md), then send the link to your family.')}</p>
                <div className="field field--stack"><label htmlFor="fm-name">{tr('Nome della famiglia', 'Family name')}</label><input id="fm-name" value={fname} maxLength={40} onChange={(e) => setFname(e.target.value)} /></div>
                <details className="howto"><summary>{tr('Come si crea il relay (10 minuti, gratis)', 'How to create the relay (10 minutes, free)')}</summary>
                  <ol>
                    {isEn ? <>
                    <li>Create a free account at <b>dash.cloudflare.com/sign-up</b> and confirm your email.</li>
                    <li>Install <b>Node.js</b> (nodejs.org, “LTS” button).</li>
                    <li>Open a terminal in the Famabria folder and type <code>npx wrangler login</code>; press <b>Allow</b> in the browser.</li>
                    <li>Type <code>npx wrangler deploy -c relay/wrangler.toml</code>. At the end an address like <code>https://famcal-relay.name.workers.dev</code> appears: copy it below.</li>
                    <li>Check by opening that address followed by <code>/healthz</code>: you should see <code>{'{"ok":true…}'}</code>.</li></> : <>
                    <li>Crea un account gratuito su <b>dash.cloudflare.com/sign-up</b> e conferma l'email.</li>
                    <li>Installa <b>Node.js</b> (nodejs.org, pulsante «LTS»).</li>
                    <li>Apri un terminale nella cartella di Famabria e scrivi <code>npx wrangler login</code>; nel browser premi <b>Allow</b>.</li>
                    <li>Scrivi <code>npx wrangler deploy -c relay/wrangler.toml</code>. Alla fine compare un indirizzo tipo <code>https://famcal-relay.nome.workers.dev</code>: copialo qui sotto.</li>
                    <li>Controlla aprendo quell'indirizzo seguito da <code>/healthz</code>: deve comparire <code>{'{"ok":true…}'}</code>.</li></>}
                  </ol>
                  <p className="muted">{tr('Guida completa con aiuto per gli errori: docs/RELAY.md', 'Full guide with help for errors: docs/RELAY.md')}</p>
                </details>
                <div className="field field--stack"><label htmlFor="fm-url">{tr('Indirizzo del relay', 'Relay address')}</label><input id="fm-url" value={relay} placeholder="https://famcal-relay.tuonome.workers.dev" autoComplete="off" spellCheck={false} onChange={(e) => setRelay(e.target.value)} /></div>
              </>
            )}
            {err && <p className="field-error" role="alert">{err}</p>}
            <div className="dialog-actions"><button className="cbtn cbtn--primary" disabled={busy || (mode === 'join' ? !invite.trim() : mode === 'dropbox' ? !appKey.trim() || !IS_WEB : !relay.trim())} onClick={() => void (mode === 'join' ? doJoin() : mode === 'dropbox' ? doDropbox() : doCreate())}>{busy ? tr('Collego…', 'Connecting…') : mode === 'join' ? tr('Entra nella famiglia', 'Join the family') : mode === 'dropbox' ? tr('Accedi a Dropbox', 'Sign in to Dropbox') : tr('Crea e collega', 'Create and connect')}</button></div>
          </>
        )}
        {fam.family && err && <p className="field-error" role="alert">{err}</p>}
        {!fam.family && mode !== 'join' && <p className="fam-note">🛡 {mode === 'dropbox' ? tr('Famabria non legge i tuoi file personali: scrive solo file cifrati nella sua cartella dedicata.', 'Famabria does not read your personal files: it only writes encrypted files in its own folder.') : tr('Il relay vede solo dati cifrati e illeggibili: la chiave resta nel link di invito.', 'The relay only sees encrypted, unreadable data: the key stays in the invite link.')}</p>}
      </div>
    </dialog>
  );
}
