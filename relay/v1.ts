// Famabria relay API v1 (security steps 1-2). Lives next to the legacy /r/<room> API, which keeps working for existing clients.
//   POST   /v1/families                              -> {family, device, token}      new family, you are its admin
//   GET    /v1/f/<family>/objects                    -> [{name, rev}]
//   GET    /v1/f/<family>/objects/<name>             -> the object (bytes)
//   PUT    /v1/f/<family>/objects/d-<device>.fc      -> only the device that owns the name (member/admin tokens), <= 1 MB
//   POST   /v1/f/<family>/devices   {role}           -> admin only: {device, token} for another device (member | bot)
//   POST   /v1/f/<family>/token/refresh              -> {token}: a fresh 30-day token for the same device (any role)
//   GET    /v1/f/<family>/devices                    -> admin only: [{device, role, first, revoked}]
//   DELETE /v1/f/<family>/devices/<device>           -> admin only: revoke the device and drop its object
//   POST   /v1/f/<family>/invites {authHash, role, ttl, blob}  -> admin only: one-time invite, returns {invite: <ticket>}
//   POST   /v1/f/<family>/invites/<ticket>/redeem {auth, pub?}  -> NO token: {device, role, token, blob}; the invite is burnt
// Auth: "Authorization: Bearer fc1.<payload>.<mac>", a device token signed (HMAC-SHA256) with the Worker secret TOKEN_SECRET.
// The Worker checks the token BEFORE a Durable Object is created or woken, so unknown families and anonymous floods cost nothing.
import { b64, json, MAX_OBJECTS, MAX_OBJECT_BYTES, unb64, type Store } from './core';

export type Role = 'admin' | 'member' | 'bot';
export interface Claims { f: string; d: string; r: Role; e: number }
export const TOKEN_LIFE_S = 30 * 86400;      // member/admin: renewed by the app well before it ends
export const BOT_LIFE_S = 90 * 86400;        // the home-server bot renews itself too (it cannot be re-invited by hand every 3 months)
const lifeOf = (r: Role) => (r === 'bot' ? BOT_LIFE_S : TOKEN_LIFE_S);
const FAM_RE = /^[A-Za-z0-9_-]{22}$/;
const DEV_RE = /^[A-Za-z0-9_-]{6,32}$/;
const ROLES: Role[] = ['admin', 'member', 'bot'];
const RATE_PER_MIN = 120;
const enc = new TextEncoder();

const b64u = (u: Uint8Array) => b64(u).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s: string) => { const t = s.replace(/-/g, '+').replace(/_/g, '/'); return unb64(t + '='.repeat((4 - (t.length % 4)) % 4)); };
const rnd = (n: number) => b64u(crypto.getRandomValues(new Uint8Array(n)));
const hmacKey = (secret: string, use: 'sign' | 'verify') => crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [use]);

export async function issueToken(c: Claims, secret: string): Promise<string> {
  const payload = b64u(enc.encode(JSON.stringify(c)));
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret, 'sign'), enc.encode(`fc1.${payload}`)));
  return `fc1.${payload}.${b64u(mac)}`;
}

export async function verifyToken(header: string | null, secret: string, nowMs: number): Promise<Claims | null> {
  const m = /^Bearer (fc1\.[A-Za-z0-9_-]{10,300}\.[A-Za-z0-9_-]{40,50})$/.exec(header ?? '');
  if (!m || !secret) return null;
  const [, payload, mac] = m[1].split('.');
  try {
    if (!(await crypto.subtle.verify('HMAC', await hmacKey(secret, 'verify'), unb64u(mac), enc.encode(`fc1.${payload}`)))) return null;
    const c = JSON.parse(new TextDecoder().decode(unb64u(payload))) as Claims;
    if (!FAM_RE.test(c.f) || !DEV_RE.test(c.d) || !ROLES.includes(c.r) || typeof c.e !== 'number' || c.e * 1000 <= nowMs) return null;
    return c;
  } catch { return null; }
}

export interface Ticket { f: string; i: string; e: number }
const INVITE_MAX_TTL_S = 900, INVITE_MAX_ACTIVE = 3, INVITE_MAX_TRIES = 5, BLOB_MAX = 2048;
export async function issueTicket(t: Ticket, secret: string): Promise<string> {
  const payload = b64u(enc.encode(JSON.stringify(t)));
  return `fci.${payload}.${b64u(new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret, 'sign'), enc.encode(`fci.${payload}`))))}`;
}
export async function verifyTicket(ticket: string, secret: string, nowMs: number): Promise<Ticket | null> {
  const m = /^fci\.([A-Za-z0-9_-]{10,200})\.([A-Za-z0-9_-]{40,50})$/.exec(ticket);
  if (!m || !secret) return null;
  try {
    if (!(await crypto.subtle.verify('HMAC', await hmacKey(secret, 'verify'), unb64u(m[2]), enc.encode(`fci.${m[1]}`)))) return null;
    const t = JSON.parse(new TextDecoder().decode(unb64u(m[1]))) as Ticket;
    return FAM_RE.test(t.f) && /^[A-Za-z0-9_-]{16,32}$/.test(t.i) && typeof t.e === 'number' && t.e * 1000 > nowMs ? t : null;
  } catch { return null; }
}
const sameBytes = (a: Uint8Array, b: Uint8Array) => { let d = a.length ^ b.length; for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a[i] ?? 0) ^ (b[i] ?? 0); return d === 0; };

export async function newFamily(secret: string, nowMs = Date.now()) {
  const c: Claims = { f: rnd(16), d: rnd(12), r: 'admin', e: Math.floor(nowMs / 1000) + TOKEN_LIFE_S };
  return { family: c.f, device: c.d, token: await issueToken(c, secret) };
}

/** Edge check, run in the Worker before any Durable Object is touched. Returns the family id, or the error response to send. */
export async function edgeGate(req: Request, secret: string, nowMs = Date.now()): Promise<string | Response> {
  const path = new URL(req.url).pathname;
  const len = Number(req.headers.get('content-length') ?? 0);
  const red = /^\/v1\/f\/([A-Za-z0-9_-]{22})\/invites\/([^/]+)\/redeem$/.exec(path);
  if (red) { // redeeming an invite has no bearer token: the signed ticket in the path is checked here instead
    const t = await verifyTicket(red[2], secret, nowMs);
    if (!t || t.f !== red[1] || req.method !== 'POST') return json({ error: 'invalid invite' }, 403);
    if (len > 2048) return json({ error: 'too large' }, 413);
    return red[1];
  }
  const m = /^\/v1\/f\/([A-Za-z0-9_-]{22})\//.exec(path);
  if (!m) return json({ error: 'not found' }, 404);
  const c = await verifyToken(req.headers.get('authorization'), secret, nowMs);
  if (!c || c.f !== m[1]) return json({ error: 'unauthorized' }, 401);
  if (len > MAX_OBJECT_BYTES + 1024) return json({ error: 'too large' }, 413);
  return m[1];
}

/** Reads the body but stops as soon as it is bigger than `max` (no buffering of oversized uploads). */
async function readCapped(req: Request, max: number): Promise<Uint8Array | null> {
  if (!req.body) return new Uint8Array(0);
  const parts: Uint8Array[] = []; let n = 0;
  const reader = req.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > max) { await reader.cancel(); return null; }
    parts.push(value);
  }
  const out = new Uint8Array(n); let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export function createV1(store: Store, secret: string, now: () => number = Date.now): (req: Request) => Promise<Response> {
  const hits = new Map<string, { t: number; n: number }>(); // fixed window per device, in memory (resets if the object restarts)
  const limited = (d: string) => {
    const t = Math.floor(now() / 60_000); const h = hits.get(d);
    if (!h || h.t !== t) { hits.set(d, { t, n: 1 }); if (hits.size > 500) for (const k of hits.keys()) if (hits.get(k)!.t !== t) hits.delete(k); return false; }
    return ++h.n > RATE_PER_MIN;
  };
  const seen = new Set<string>();
  const devKey = (f: string, d: string) => `m:${f}:dev:${d}`;
  const objKey = (f: string, name: string) => `o:${f}:${name}`;
  const revKey = (f: string, d: string) => `m:${f}:revoked:${d}`;

  const invKey = (f: string, i: string) => `i:${f}:${i}`;
  const redeem = async (req: Request, fam: string, ticket: string): Promise<Response> => {
    const bad = () => json({ error: 'invalid invite' }, 403); // same answer for every failure
    const t = await verifyTicket(ticket, secret, now());
    if (!t || t.f !== fam) return bad();
    const raw = await store.get(invKey(fam, t.i));
    if (!raw) return bad();
    const inv = JSON.parse(new TextDecoder().decode(unb64(raw.data))) as { authHash: string; role: Role; blob: string; tries: number };
    const drop = async () => { if (store.del) await store.del(invKey(fam, t.i)); };
    const body = await readCapped(req, 2048);
    let auth = '', pub: string | undefined;
    try { const o = JSON.parse(new TextDecoder().decode(body ?? new Uint8Array(0))); auth = String(o.auth ?? ''); if (typeof o.pub === 'string' && o.pub.length <= 200) pub = o.pub; } catch { return bad(); }
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', unb64u(auth.slice(0, 100))));
    if (!sameBytes(hash, unb64u(inv.authHash))) {
      inv.tries++;
      if (inv.tries >= INVITE_MAX_TRIES) await drop(); else await store.put(invKey(fam, t.i), { rev: raw.rev, data: b64(enc.encode(JSON.stringify(inv))) });
      return bad();
    }
    await drop(); // one use only
    const d = rnd(12);
    await store.put(`m:${fam}:dev:${d}`, { rev: now().toString(36), data: b64(enc.encode(JSON.stringify({ role: inv.role, pub: pub ?? null }))) });
    return json({ device: d, role: inv.role, blob: inv.blob, token: await issueToken({ f: fam, d, r: inv.role, e: Math.floor(now() / 1000) + lifeOf(inv.role) }, secret) });
  };

  return async (req) => {
    const red = /^\/v1\/f\/([A-Za-z0-9_-]{22})\/invites\/([^/]+)\/redeem$/.exec(new URL(req.url).pathname);
    if (red) return req.method === 'POST' ? redeem(req, red[1], red[2]) : json({ error: 'method not allowed' }, 405);
    const m = /^\/v1\/f\/([A-Za-z0-9_-]{22})\/(objects|devices|invites|token)(?:\/([^/]+))?$/.exec(new URL(req.url).pathname);
    if (!m) return json({ error: 'not found' }, 404);
    const [, fam, kind, name] = m;
    const c = await verifyToken(req.headers.get('authorization'), secret, now());
    if (!c || c.f !== fam) return json({ error: 'unauthorized' }, 401);
    if (await store.get(revKey(fam, c.d))) return json({ error: 'device revoked' }, 401);
    if (limited(c.d)) return json({ error: 'slow down' }, 429, { 'retry-after': '60' });
    if (!seen.has(c.d)) { // keep a small registry of the family's devices (for the admin's list); written once per device per object lifetime
      seen.add(c.d);
      if (!(await store.get(devKey(fam, c.d)))) await store.put(devKey(fam, c.d), { rev: now().toString(36), data: b64(enc.encode(JSON.stringify({ role: c.r, pub: null, first: now() }))) });
    }

    if (kind === 'objects') {
      if (!name) {
        if (req.method !== 'GET') return json({ error: 'method not allowed' }, 405);
        const out: { name: string; rev: string }[] = [];
        for (const k of await store.list(objKey(fam, ''))) { const v = await store.get(k); if (v) out.push({ name: k.slice(objKey(fam, '').length), rev: v.rev }); }
        return json(out);
      }
      if (!/^d-[A-Za-z0-9_-]{6,32}\.fc$/.test(name)) return json({ error: 'bad name' }, 400);
      const key = objKey(fam, name);
      if (req.method === 'GET') {
        const v = await store.get(key);
        return v ? new Response(unb64(v.data), { headers: { 'content-type': 'application/octet-stream', etag: v.rev, 'cache-control': 'no-store', 'access-control-allow-origin': '*' } }) : json({ error: 'not found' }, 404);
      }
      if (req.method === 'PUT') {
        if (c.r === 'bot') return json({ error: 'read-only device' }, 403);
        if (name !== `d-${c.d}.fc`) return json({ error: 'a device can only write its own object' }, 403);
        const body = await readCapped(req, MAX_OBJECT_BYTES);
        if (!body) return json({ error: 'too large' }, 413);
        if (!(await store.get(key)) && (await store.list(objKey(fam, ''))).length >= MAX_OBJECTS) return json({ error: 'too many objects' }, 409);
        const rev = `${now().toString(36)}${rnd(4)}`;
        await store.put(key, { rev, data: b64(body) });
        return json({ rev });
      }
      return json({ error: 'method not allowed' }, 405);
    }

    if (kind === 'token') { // POST /token/refresh: a fresh token for the same device (admin/member only; the old one keeps working until it expires)
      if (req.method !== 'POST' || name !== 'refresh') return json({ error: 'method not allowed' }, 405);
      return json({ token: await issueToken({ ...c, e: Math.floor(now() / 1000) + lifeOf(c.r) }, secret), expiresIn: lifeOf(c.r) });
    }
    if (kind === 'invites') {
      if (c.r !== 'admin') return json({ error: 'admin only' }, 403);
      if (req.method !== 'POST' || name) return json({ error: 'method not allowed' }, 405);
      const ttlNow = Math.floor(now() / 1000);
      let o: { authHash?: unknown; role?: unknown; ttl?: unknown; blob?: unknown };
      try { o = JSON.parse(new TextDecoder().decode((await readCapped(req, 4096)) ?? new Uint8Array(0))); } catch { return json({ error: 'bad body' }, 400); }
      const role = o.role === 'bot' ? 'bot' : o.role === 'member' ? 'member' : null;
      const ttl = Math.min(Number(o.ttl) || INVITE_MAX_TTL_S, INVITE_MAX_TTL_S);
      if (!role || typeof o.authHash !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(o.authHash) || typeof o.blob !== 'string' || o.blob.length < 1 || o.blob.length > BLOB_MAX || ttl < 30) return json({ error: 'bad invite' }, 400);
      let open = 0;
      for (const k of await store.list(`i:${fam}:`)) { // forget invites that already expired
        const v = await store.get(k); const e = v ? (JSON.parse(new TextDecoder().decode(unb64(v.data))) as { exp?: number }).exp ?? 0 : 0;
        if (e <= ttlNow) { if (store.del) await store.del(k); } else open++;
      }
      if (open >= INVITE_MAX_ACTIVE) return json({ error: 'too many open invites' }, 429);
      const id = rnd(16);
      await store.put(invKey(fam, id), { rev: now().toString(36), data: b64(enc.encode(JSON.stringify({ authHash: o.authHash, role, blob: o.blob, tries: 0, exp: ttlNow + ttl }))) });
      return json({ invite: await issueTicket({ f: fam, i: id, e: ttlNow + ttl }, secret), expiresIn: ttl }, 201);
    }

    // devices: admin only
    if (c.r !== 'admin') return json({ error: 'admin only' }, 403);
    if (req.method === 'GET' && !name) {
      const out: { device: string; role: Role; first: number | null; revoked: boolean }[] = [];
      for (const k of await store.list(`m:${fam}:dev:`)) {
        const v = await store.get(k); if (!v) continue; const id = k.slice(`m:${fam}:dev:`.length);
        const rec = JSON.parse(new TextDecoder().decode(unb64(v.data))) as { role?: Role; first?: number };
        out.push({ device: id, role: rec.role ?? 'member', first: rec.first ?? null, revoked: !!(await store.get(revKey(fam, id))) });
      }
      return json(out);
    }
    if (req.method === 'POST' && !name) {
      const body = await readCapped(req, 1024);
      let role: Role = 'member';
      try { const r = JSON.parse(new TextDecoder().decode(body ?? new Uint8Array(0)) || '{}').role; if (r === 'bot' || r === 'member') role = r; else if (r !== undefined) return json({ error: 'bad role' }, 400); } catch { return json({ error: 'bad body' }, 400); }
      const d = rnd(12);
      return json({ device: d, role, token: await issueToken({ f: fam, d, r: role, e: Math.floor(now() / 1000) + lifeOf(role) }, secret) });
    }
    if (req.method === 'DELETE' && name) {
      if (!DEV_RE.test(name) || name === c.d) return json({ error: 'bad device' }, 400);
      await store.put(revKey(fam, name), { rev: now().toString(36), data: '' });
      const k = objKey(fam, `d-${name}.fc`);
      if (store.del) await store.del(k);
      return json({ ok: true });
    }
    return json({ error: 'method not allowed' }, 405);
  };
}
