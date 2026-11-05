// Provider C (first part): a Dropbox "app folder" as the family mailbox. One shared family account: its refresh token travels in the invite link,
// so relatives join with one tap and never sign in. Browser-only OAuth (PKCE, no client secret). Notes stay AES-GCM encrypted before they reach Dropbox.
import { b64u, randomSecret, sha256b64u } from '../p2p/crypto';
import { MailboxError, type Mailbox } from './mailbox';

export interface DropboxConfig { appKey: string; refreshToken: string }
const API = 'https://api.dropboxapi.com', CONTENT = 'https://content.dropboxapi.com', AUTH = 'https://www.dropbox.com/oauth2/authorize', TOKEN = 'https://api.dropboxapi.com/oauth2/token';
export const DROPBOX_ORIGINS = ['https://api.dropboxapi.com/', 'https://content.dropboxapi.com/'];

export async function startDropboxLogin(appKey: string, redirectUri: string): Promise<{ url: string; verifier: string; state: string }> {
  const verifier = randomSecret() + randomSecret(), state = randomSecret().slice(0, 22);
  const challenge = await sha256b64u(verifier); // base64url(SHA-256(verifier)) = the S256 PKCE challenge
  const q = new URLSearchParams({ client_id: appKey, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', token_access_type: 'offline', redirect_uri: redirectUri, state });
  return { url: `${AUTH}?${q}`, verifier, state };
}

export async function finishDropboxLogin(appKey: string, code: string, verifier: string, redirectUri: string, fetcher: typeof fetch = fetch): Promise<DropboxConfig> {
  let r: Response;
  try { r = await fetcher(TOKEN, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code, grant_type: 'authorization_code', client_id: appKey, code_verifier: verifier, redirect_uri: redirectUri }) }); }
  catch { throw new MailboxError('unreachable', 'Dropbox non risponde: controlla la connessione.'); }
  const j = (await r.json().catch(() => ({}))) as { refresh_token?: string };
  if (!r.ok || !j.refresh_token) throw new MailboxError('auth', 'Dropbox non ha accettato l\'accesso. Riprova dall\'inizio.');
  return { appKey, refreshToken: j.refresh_token };
}

export function dropboxMailbox(cfg: DropboxConfig, fetcher: typeof fetch = fetch, now: () => number = Date.now): Mailbox {
  let access = '', expires = 0;
  const net = async (url: string, init: RequestInit): Promise<Response> => {
    try { return await fetcher(url, init); } catch { throw new MailboxError('unreachable', 'Dropbox non risponde: controlla la connessione. Le note restano sul telefono e si sincronizzeranno dopo.'); }
  };
  const token = async () => {
    if (access && now() < expires - 60_000) return access;
    const r = await net(TOKEN, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: cfg.refreshToken, client_id: cfg.appKey }) });
    const j = (await r.json().catch(() => ({}))) as { access_token?: string; expires_in?: number };
    if (r.status === 400 || r.status === 401) throw new MailboxError('auth', 'Dropbox non accetta più questo invito: chiedi un nuovo link.');
    if (!r.ok || !j.access_token) throw new MailboxError('server', `Dropbox ha risposto con un errore (${r.status}).`);
    access = j.access_token; expires = now() + (j.expires_in ?? 14_400) * 1000; return access;
  };
  const check = (r: Response) => { if (r.status === 401) { access = ''; throw new MailboxError('auth', 'Dropbox non accetta più questo invito: chiedi un nuovo link.'); } if (!r.ok && r.status !== 409) throw new MailboxError('server', `Dropbox ha risposto con un errore (${r.status}).`); };
  return {
    async list() {
      const out: { name: string; rev: string }[] = []; let cursor = '';
      for (let page = 0; page < 20; page++) {
        const r = await net(`${API}/2/files/list_folder${cursor ? '/continue' : ''}`, { method: 'POST', headers: { authorization: `Bearer ${await token()}`, 'content-type': 'application/json' }, body: JSON.stringify(cursor ? { cursor } : { path: '' }) });
        check(r); if (r.status === 409) return out;
        const j = (await r.json()) as { entries: { '.tag': string; name: string; rev?: string }[]; cursor: string; has_more: boolean };
        for (const e of j.entries) if (e['.tag'] === 'file' && e.rev) out.push({ name: e.name, rev: e.rev });
        if (!j.has_more) break; cursor = j.cursor;
      }
      return out;
    },
    async get(name) {
      const r = await net(`${CONTENT}/2/files/download`, { method: 'POST', headers: { authorization: `Bearer ${await token()}`, 'dropbox-api-arg': JSON.stringify({ path: `/${name}` }) } });
      check(r); return r.status === 409 ? null : new Uint8Array(await r.arrayBuffer());
    },
    async put(name, bytes) {
      const r = await net(`${CONTENT}/2/files/upload`, { method: 'POST', headers: { authorization: `Bearer ${await token()}`, 'content-type': 'application/octet-stream', 'dropbox-api-arg': JSON.stringify({ path: `/${name}`, mode: 'overwrite', mute: true }) }, body: bytes as unknown as BodyInit });
      check(r); if (r.status === 409) throw new MailboxError('server', 'Dropbox non ha accettato il file (spazio esaurito?).');
    },
  };
}
export { b64u };
