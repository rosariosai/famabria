// Famabria v2 families (security step 3): the relay issues a device token, and an invite is a ONE-TIME, 15-minute capability.
// The link carries only a ticket + a one-time secret `s`. The family key travels wrapped (AES-GCM) with a key derived from `s`; the relay never sees it.
import { b64u, openWith, P2PError, randomSecret, sealWith } from '../p2p/crypto';
import { MailboxError } from './mailbox';
import { normalizeRelayUrl, type Family } from './family';

const enc = new TextEncoder();
const AUTH_INFO = 'famcal-invite-auth-v2', WRAP_INFO = 'famcal-invite-wrap-v2';
const bs = (u: Uint8Array) => u as unknown as BufferSource;
async function hkdf32(secret: Uint8Array, info: string): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', bs(secret), 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: bs(new Uint8Array(0)), info: bs(enc.encode(info)) }, k, 256));
}
const sha256 = async (u: Uint8Array) => new Uint8Array(await crypto.subtle.digest('SHA-256', bs(u)));
const unreachable = () => new MailboxError('unreachable', 'Il relay non risponde: controlla la connessione.');

export type RelayV2 = { type: 'relay2'; url: string; family: string; token: string };

/** Creates a family on a relay that supports /v1. Returns null when the relay is an older one (the caller then falls back to the classic family). */
export async function createFamilyV2(name: string, relayUrl: string, deviceName: string, now: number, fetcher: typeof fetch = fetch): Promise<Family | null> {
  const url = normalizeRelayUrl(relayUrl);
  let r: Response;
  try { r = await fetcher(`${url}/v1/families`, { method: 'POST', cache: 'no-store' }); } catch { throw unreachable(); }
  if (r.status === 404 || r.status === 503 || r.status === 405) return null;
  if (!r.ok) throw new MailboxError('server', `Il relay ha risposto con un errore (${r.status}).`);
  const j = (await r.json()) as { family?: unknown; device?: unknown; token?: unknown };
  if (typeof j.family !== 'string' || typeof j.device !== 'string' || typeof j.token !== 'string') throw new MailboxError('server', 'Risposta del relay non valida.');
  return { id: b64u.enc(crypto.getRandomValues(new Uint8Array(9))), name: name.trim().slice(0, 40) || 'Famiglia', key: randomSecret(), provider: { type: 'relay2', url, family: j.family, token: j.token }, deviceId: j.device, deviceName: deviceName.trim().slice(0, 40) || 'Telefono', createdAt: now };
}

/** Admin only: makes a one-time invite link (valid 15 minutes). `base` is the address of the web app. */
export async function createInviteV2(f: Family, base: string, fetcher: typeof fetch = fetch, role: 'member' | 'bot' = 'member'): Promise<{ link: string; expiresIn: number }> {
  if (f.provider.type !== 'relay2') throw new P2PError('format', 'Questa famiglia usa ancora il vecchio tipo di invito.');
  const p = f.provider;
  const s = crypto.getRandomValues(new Uint8Array(16));
  const authHash = b64u.enc(await sha256(await hkdf32(s, AUTH_INFO)));
  const blob = JSON.stringify(await sealWith(b64u.enc(s), WRAP_INFO, `invite|${p.family}`, { id: f.id, n: f.name, k: f.key }));
  let r: Response;
  try { r = await fetcher(`${p.url}/v1/f/${p.family}/invites`, { method: 'POST', headers: { authorization: `Bearer ${p.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ authHash, role, ttl: 900, blob }) }); } catch { throw unreachable(); }
  if (r.status === 401) throw new MailboxError('auth', 'Il relay non accetta più questo dispositivo.');
  if (r.status === 403) throw new P2PError('auth', 'Solo chi ha creato la famiglia può invitare.');
  if (r.status === 429) throw new P2PError('format', 'Ci sono già 3 inviti aperti: aspetta che scadano (15 minuti) o usa uno già creato.');
  if (!r.ok) throw new MailboxError('server', `Il relay ha risposto con un errore (${r.status}).`);
  const j = (await r.json()) as { invite?: string; expiresIn?: number };
  if (typeof j.invite !== 'string') throw new MailboxError('server', 'Risposta del relay non valida.');
  const payload = { v: 2, u: p.url, f: p.family, t: j.invite, s: b64u.enc(s) };
  return { link: `${base.split('#')[0]}#invite=${b64u.enc(enc.encode(JSON.stringify(payload)))}`, expiresIn: j.expiresIn ?? 900 };
}

export interface ParsedInviteV2 { u: string; f: string; t: string; s: string }
export function parseInviteV2(text: string): ParsedInviteV2 | null {
  const m = /invite=([A-Za-z0-9_-]{20,4000})/.exec(text); if (!m) return null;
  try {
    const o = JSON.parse(new TextDecoder().decode(b64u.dec(m[1]))) as { v?: unknown; u?: unknown; f?: unknown; t?: unknown; s?: unknown };
    if (o.v !== 2 || typeof o.u !== 'string' || typeof o.f !== 'string' || typeof o.t !== 'string' || typeof o.s !== 'string') return null;
    if (!/^[A-Za-z0-9_-]{22}$/.test(o.f) || !/^fci\.[A-Za-z0-9_.-]{20,400}$/.test(o.t) || !/^[A-Za-z0-9_-]{22}$/.test(o.s)) return null;
    return { u: normalizeRelayUrl(o.u), f: o.f, t: o.t, s: o.s };
  } catch { return null; }
}
export const isInviteV2 = (text: string) => /invite=[A-Za-z0-9_-]{20,}/.test(text);

/** Uses the invite (works once): returns the family for this device. */
export async function redeemInviteV2(text: string, deviceName: string, now: number, fetcher: typeof fetch = fetch): Promise<Family> {
  const inv = parseInviteV2(text);
  if (!inv) throw new P2PError('format', 'Questo non è un invito Famabria valido.');
  const auth = b64u.enc(await hkdf32(b64u.dec(inv.s), AUTH_INFO));
  let r: Response;
  try { r = await fetcher(`${inv.u}/v1/f/${inv.f}/invites/${inv.t}/redeem`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ auth }) }); } catch { throw unreachable(); }
  if (r.status === 403 || r.status === 413) throw new P2PError('auth', 'Invito scaduto, già usato o non valido. Chiedi un nuovo link a chi ti ha invitato.');
  if (!r.ok) throw new MailboxError('server', `Il relay ha risposto con un errore (${r.status}).`);
  const j = (await r.json()) as { device?: unknown; token?: unknown; blob?: unknown };
  if (typeof j.device !== 'string' || typeof j.token !== 'string' || typeof j.blob !== 'string') throw new MailboxError('server', 'Risposta del relay non valida.');
  const w = JSON.parse(j.blob) as { iv?: unknown; data?: unknown };
  if (typeof w.iv !== 'string' || typeof w.data !== 'string') throw new P2PError('format', 'Invito danneggiato.');
  const k = (await openWith(inv.s, WRAP_INFO, `invite|${inv.f}`, w.iv, w.data)) as { id?: unknown; n?: unknown; k?: unknown };
  if (typeof k.id !== 'string' || typeof k.n !== 'string' || typeof k.k !== 'string' || k.k.length < 40) throw new P2PError('format', 'Invito non valido.');
  return { id: k.id, name: k.n.slice(0, 40), key: k.k, provider: { type: 'relay2', url: inv.u, family: inv.f, token: j.token }, deviceId: j.device, deviceName: deviceName.trim().slice(0, 40) || 'Telefono', createdAt: now };
}

/** When the device token has less than 15 days left, asks the relay for a fresh one. Returns the updated family, or null if nothing changed (or the relay could not be asked: the next sync tries again). */
export async function renewTokenIfNeeded(f: Family, now: number, fetcher: typeof fetch = fetch): Promise<Family | null> {
  if (f.provider.type !== 'relay2') return null;
  const p = f.provider;
  let exp = 0;
  try { exp = (JSON.parse(new TextDecoder().decode(b64u.dec(p.token.split('.')[1]))) as { e?: number }).e ?? 0; } catch { return null; }
  if (exp * 1000 - now > 15 * 86_400_000) return null;
  try {
    const r = await fetcher(`${p.url}/v1/f/${p.family}/token/refresh`, { method: 'POST', headers: { authorization: `Bearer ${p.token}` }, cache: 'no-store' });
    if (!r.ok) return null;
    const j = (await r.json()) as { token?: unknown };
    return typeof j.token === 'string' ? { ...f, provider: { ...p, token: j.token } } : null;
  } catch { return null; }
}

const tokenClaims = (token: string): { r?: string; d?: string } => { try { return JSON.parse(new TextDecoder().decode(b64u.dec(token.split('.')[1]))); } catch { return {}; } };
/** True when this device is the family's admin (the one that created it). */
export const isAdminV2 = (f: Family) => f.provider.type === 'relay2' && tokenClaims(f.provider.token).r === 'admin';

export interface DeviceRow { device: string; role: string; first: number | null; revoked: boolean }
export async function listDevicesV2(f: Family, fetcher: typeof fetch = fetch): Promise<DeviceRow[]> {
  if (f.provider.type !== 'relay2') return [];
  const p = f.provider;
  let r: Response;
  try { r = await fetcher(`${p.url}/v1/f/${p.family}/devices`, { headers: { authorization: `Bearer ${p.token}` }, cache: 'no-store' }); } catch { throw unreachable(); }
  if (r.status === 401) throw new MailboxError('auth', 'Il relay non accetta più questo dispositivo.');
  if (r.status === 403) return [];
  if (!r.ok) throw new MailboxError('server', `Il relay ha risposto con un errore (${r.status}).`);
  return (await r.json()) as DeviceRow[];
}
/** Admin only: the device loses access at once and its object is deleted. */
export async function removeDeviceV2(f: Family, deviceId: string, fetcher: typeof fetch = fetch): Promise<void> {
  if (f.provider.type !== 'relay2') return;
  const p = f.provider;
  let r: Response;
  try { r = await fetcher(`${p.url}/v1/f/${p.family}/devices/${encodeURIComponent(deviceId)}`, { method: 'DELETE', headers: { authorization: `Bearer ${p.token}` } }); } catch { throw unreachable(); }
  if (r.status === 403) throw new P2PError('auth', 'Solo chi ha creato la famiglia può rimuovere dispositivi.');
  if (!r.ok) throw new MailboxError('server', `Il relay ha risposto con un errore (${r.status}).`);
}
