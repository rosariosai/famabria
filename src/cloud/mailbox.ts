/** A dumb storage of named byte objects. Anything that can do these three things can carry a family: relay, Dropbox, WebDAV, a folder… */
export interface Mailbox {
  list(): Promise<{ name: string; rev: string }[]>;
  get(name: string): Promise<Uint8Array | null>;
  put(name: string, bytes: Uint8Array): Promise<void>;
}

export class MailboxError extends Error { constructor(readonly kind: 'unreachable' | 'auth' | 'server', message: string) { super(message); } }

import { sha256b64u } from '../p2p/crypto';

/** Mailbox on a Famabria relay (Cloudflare Worker or small Node server). */
export function httpMailbox(baseUrl: string, token: string, fetcher: typeof fetch = fetch): Mailbox {
  let room: string | null = null;
  const roomId = async () => (room ??= (await sha256b64u(token)).slice(0, 22));
  const call = async (path: string, init: RequestInit = {}) => {
    let r: Response;
    try { r = await fetcher(`${baseUrl}/r/${await roomId()}${path}`, { ...init, headers: { authorization: `Bearer ${token}`, ...(init.headers ?? {}) }, cache: 'no-store' }); }
    catch { throw new MailboxError('unreachable', 'Il relay non risponde: controlla la connessione. Le note restano sul telefono e si sincronizzeranno dopo.'); }
    if (r.status === 401) throw new MailboxError('auth', 'Il relay non accetta più questo invito.');
    if (!r.ok && r.status !== 404) throw new MailboxError('server', `Il relay ha risposto con un errore (${r.status}).`);
    return r;
  };
  return {
    async list() { return (await (await call('')).json()) as { name: string; rev: string }[]; },
    async get(name) { const r = await call(`/${name}`); return r.status === 404 ? null : new Uint8Array(await r.arrayBuffer()); },
    async put(name, bytes) { await call(`/${name}`, { method: 'PUT', body: bytes as unknown as BodyInit, headers: { 'content-type': 'application/octet-stream' } }); },
  };
}

/** Mailbox on the relay's /v1 API (device token, one object per device). */
export function v1Mailbox(baseUrl: string, family: string, token: string, fetcher: typeof fetch = fetch): Mailbox {
  const call = async (path: string, init: RequestInit = {}) => {
    let r: Response;
    try { r = await fetcher(`${baseUrl}/v1/f/${family}/objects${path}`, { ...init, headers: { authorization: `Bearer ${token}`, ...(init.headers ?? {}) }, cache: 'no-store' }); }
    catch { throw new MailboxError('unreachable', 'Il relay non risponde: controlla la connessione. Le note restano sul telefono e si sincronizzeranno dopo.'); }
    if (r.status === 401) throw new MailboxError('auth', 'Il relay non accetta più questo dispositivo (rimosso o scaduto).');
    if (r.status === 429) throw new MailboxError('server', 'Troppe richieste: riprovo tra poco.');
    if (!r.ok && r.status !== 404) throw new MailboxError('server', `Il relay ha risposto con un errore (${r.status}).`);
    return r;
  };
  return {
    async list() { return (await (await call('')).json()) as { name: string; rev: string }[]; },
    async get(name) { const r = await call(`/${name}`); return r.status === 404 ? null : new Uint8Array(await r.arrayBuffer()); },
    async put(name, bytes) { await call(`/${name}`, { method: 'PUT', body: bytes as unknown as BodyInit, headers: { 'content-type': 'application/octet-stream' } }); },
  };
}

/** For tests. */
export function memoryMailbox(): Mailbox & { objects: Map<string, { rev: number; bytes: Uint8Array }> } {
  const objects = new Map<string, { rev: number; bytes: Uint8Array }>(); let n = 0;
  return {
    objects,
    async list() { return [...objects].map(([name, o]) => ({ name, rev: String(o.rev) })); },
    async get(name) { return objects.get(name)?.bytes ?? null; },
    async put(name, bytes) { objects.set(name, { rev: ++n, bytes }); },
  };
}
