// A "family" = a shared encrypted mailbox. Everyone who has the invite link can read and write it; nobody else can (the relay only sees ciphertext).
import { b64u, openWith, P2PError, randomSecret, sealWith, sha256b64u } from '../p2p/crypto';
import { mergeEvents, parseEvents, sanitizeMembers, type CalEvent, type CalendarDef } from '../core/events';
import { httpMailbox, v1Mailbox, type Mailbox } from './mailbox';
import { dropboxMailbox } from './dropbox';

/** Where the encrypted objects live. Only `relay` exists today; `dropbox` and others plug in here without changing anything else. */
export type ProviderConfig = { type: 'relay'; url: string; token: string } | { type: 'relay2'; url: string; family: string; token: string } | { type: 'dropbox'; appKey: string; refreshToken: string };
export interface Family { id: string; name: string; key: string; provider: ProviderConfig; deviceId: string; deviceName: string; createdAt: number }
export interface FamilyState { revs: Record<string, string>; pushedDigest: string; lastSyncAt: number | null; names?: Record<string, string> }
export const EMPTY_FAMILY_STATE: FamilyState = { revs: {}, pushedDigest: '', lastSyncAt: null };

const enc = new TextEncoder(); const dec = new TextDecoder();
const INFO = 'famcal-family-v1';

export function normalizeRelayUrl(input: string): string {
  let t = input.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(t)) t = `https://${t}`;
  let u: URL; try { u = new URL(t); } catch { throw new P2PError('format', 'L\'indirizzo del relay non è valido.'); }
  if (u.protocol === 'http:' && !/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[::1\])/.test(u.hostname)) throw new P2PError('format', 'Fuori dalla rete di casa serve un indirizzo https://.');
  return u.origin + u.pathname.replace(/\/+$/, '');
}

export function newFamily(name: string, relayUrl: string, deviceName: string, now: number): Family & { provider: { type: 'relay'; url: string; token: string } } {
  return newFamilyWith(name, { type: 'relay', url: normalizeRelayUrl(relayUrl), token: randomSecret() }, deviceName, now) as Family & { provider: { type: 'relay'; url: string; token: string } };
}
export function newFamilyWith(name: string, provider: ProviderConfig, deviceName: string, now: number): Family {
  return {
    id: b64u.enc(crypto.getRandomValues(new Uint8Array(9))), name: name.trim().slice(0, 40) || 'Famiglia', key: randomSecret(), provider,
    deviceId: b64u.enc(crypto.getRandomValues(new Uint8Array(9))), deviceName: deviceName.trim().slice(0, 40) || 'Telefono', createdAt: now,
  };
}

/** The invite carries everything a new device needs: treat the link like a key (send it privately). The part after # never reaches any server. */
export function inviteLink(baseUrl: string, f: Family): string {
  const payload = { v: 1, id: f.id, n: f.name, k: f.key, p: f.provider };
  return `${baseUrl.split('#')[0]}#join=${b64u.enc(enc.encode(JSON.stringify(payload)))}`;
}
export function inviteFromText(text: string): string | null { const m = /(?:join|invite)=([A-Za-z0-9_-]{20,4000})/.exec(text); return m ? m[1] : null; }
export function joinFamily(text: string, deviceName: string, now: number): Family {
  const code = /join=([A-Za-z0-9_-]{20,4000})/.exec(text)?.[1];
  if (!code) throw new P2PError('format', 'Questo non è un invito Famabria.');
  let o: { v?: unknown; id?: unknown; n?: unknown; k?: unknown; p?: { type?: unknown; url?: unknown; token?: unknown; appKey?: unknown; refreshToken?: unknown } };
  try { o = JSON.parse(dec.decode(b64u.dec(code))); } catch { throw new P2PError('format', 'Invito danneggiato o incompleto.'); }
  if (o.v !== 1 || typeof o.id !== 'string' || typeof o.n !== 'string' || typeof o.k !== 'string' || o.k.length < 40 || !o.p) throw new P2PError('format', 'Invito non valido.');
  let provider: ProviderConfig;
  if (o.p.type === 'relay' && typeof o.p.url === 'string' && typeof o.p.token === 'string') provider = { type: 'relay', url: normalizeRelayUrl(o.p.url), token: o.p.token };
  else if (o.p.type === 'dropbox' && typeof o.p.appKey === 'string' && typeof o.p.refreshToken === 'string' && o.p.appKey.length < 64 && o.p.refreshToken.length < 200) provider = { type: 'dropbox', appKey: o.p.appKey, refreshToken: o.p.refreshToken };
  else throw new P2PError('format', 'Invito non valido (servizio sconosciuto).');
  return {
    id: o.id, name: o.n.slice(0, 40), key: o.k, provider,
    deviceId: b64u.enc(crypto.getRandomValues(new Uint8Array(9))), deviceName: deviceName.trim().slice(0, 40) || 'Telefono', createdAt: now,
  };
}

export const mailboxOf = (f: Family, fetcher: typeof fetch = (...a) => fetch(...a)): Mailbox => (f.provider.type === 'dropbox' ? dropboxMailbox(f.provider) : f.provider.type === 'relay2' ? v1Mailbox(f.provider.url, f.provider.family, f.provider.token, fetcher) : httpMailbox(f.provider.url, f.provider.token, fetcher));

// ---- the sync itself: every device writes ONLY its own object, so there are never write conflicts, on any storage ----
const objectName = (deviceId: string) => `d-${deviceId}.fc`;
const digestOf = (events: CalEvent[], members: CalendarDef[]) => sha256b64u(events.map((e) => `${e.id}:${e.updatedAt}:${e.deletedAt ?? ''}`).sort().join('|') + '#' + members.map((m) => `${m.id}:${m.name}:${m.color}`).join('|'));

export interface FamilySyncResult { events: CalEvent[]; changed: CalEvent[]; state: FamilyState; pulled: number; pushed: boolean; devices: string[]; deviceInfo: { id: string; name: string }[]; skipped: number; members: CalendarDef[] }

export async function syncFamily(f: Family, mb: Mailbox, local: CalEvent[], st: FamilyState, now: number, members: CalendarDef[] = []): Promise<FamilySyncResult> {
  const own = objectName(f.deviceId);
  const listing = await mb.list();
  const revs = { ...st.revs }; const names: Record<string, string> = { ...(st.names ?? {}) }; let merged = local; let skipped = 0; const devices: string[] = []; const deviceInfo: { id: string; name: string }[] = []; let theirs: CalendarDef[] = [];
  for (const o of listing) {
    if (!/^d-[A-Za-z0-9_-]+\.fc$/.test(o.name) || o.name === own) continue;
    try {
      if (revs[o.name] === o.rev) { devices.push(o.name); deviceInfo.push({ id: o.name.slice(2, -3), name: st.names?.[o.name] ?? o.name }); continue; }
      const bytes = await mb.get(o.name); if (!bytes) continue;
      const h = JSON.parse(dec.decode(bytes)) as { v?: unknown; iv?: unknown; data?: unknown };
      if (h.v !== 1 || typeof h.iv !== 'string' || typeof h.data !== 'string') throw new Error('format');
      const body = (await openWith(f.key, INFO, `${f.id}|${o.name}`, h.iv, h.data)) as { device?: { name?: unknown }; events?: unknown; members?: unknown };
      merged = mergeEvents(merged, parseEvents(body.events).events);
      for (const m of sanitizeMembers(body.members)) if (!theirs.some((t) => t.id === m.id)) theirs.push(m);
      revs[o.name] = o.rev; const nm = typeof body.device?.name === 'string' ? body.device.name : o.name; devices.push(nm); deviceInfo.push({ id: o.name.slice(2, -3), name: nm }); names[o.name] = nm;
    } catch { skipped++; } // an object that is not ours (wrong key, damaged) is ignored, never trusted
  }
  const known = new Map(local.map((e) => [e.id, e.updatedAt]));
  const changed = merged.filter((e) => known.get(e.id) !== e.updatedAt);
  const digest = await digestOf(merged, members); let pushed = false;
  if (digest !== st.pushedDigest || !listing.some((o) => o.name === own)) {
    const sealed = await sealWith(f.key, INFO, `${f.id}|${own}`, { device: { id: f.deviceId, name: f.deviceName }, sentAt: now, events: merged, members });
    await mb.put(own, enc.encode(JSON.stringify({ v: 1, ...sealed }))); pushed = true;
  }
  return { events: merged, changed, deviceInfo, state: { revs, pushedDigest: digest, lastSyncAt: now, names }, pulled: changed.length, pushed, devices, skipped, members: theirs };
}
