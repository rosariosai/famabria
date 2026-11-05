// Famabria relay: a dumb mailbox that stores ENCRYPTED objects for a family. It never sees notes, names or keys.
// Same code runs as a Cloudflare Worker (KV) and as a small Node server (home server, VPS, Raspberry Pi).
//   GET  /healthz                      -> {"ok":true}
//   GET  /r/<room>                     -> [{name, rev}]
//   GET  /r/<room>/<name>              -> the object (bytes)
//   PUT  /r/<room>/<name>              -> store the object (<= 1 MB), returns {rev}
// Auth: "Authorization: Bearer <token>"; the room id must be the first 22 chars of base64url(SHA-256(token)), so the token is the only secret
// and rooms need no registration. A room holds at most 20 objects.
export interface Store {
  get(key: string): Promise<{ rev: string; data: string } | null>;
  put(key: string, value: { rev: string; data: string }): Promise<void>;
  list(prefix: string): Promise<string[]>;
  del?(key: string): Promise<void>;
}
export const MAX_OBJECT_BYTES = 1024 * 1024;
export const MAX_OBJECTS = 20;
const NAME_RE = /^d-[A-Za-z0-9_-]{6,32}\.fc$/;
const ROOM_RE = /^[A-Za-z0-9_-]{22}$/;
export const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, PUT, POST, DELETE, OPTIONS', 'access-control-max-age': '86400' };

export const json = (o: unknown, status = 200, extra: Record<string, string> = {}) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS, ...extra } });
export const b64 = (u: Uint8Array) => { let s = ''; for (const x of u) s += String.fromCharCode(x); return btoa(s); };
export const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function roomOf(token: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));
  return b64(h).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '').slice(0, 22);
}

export function createRelay(store: Store): (req: Request) => Promise<Response> {
  return async (req) => {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (url.pathname === '/healthz') return json({ ok: true, relay: 'famabria', v: 1 });
    const m = /^\/r\/([^/]+)(?:\/([^/]+))?$/.exec(url.pathname);
    if (!m) return json({ error: 'not found' }, 404);
    const [, room, name] = m;
    const token = /^Bearer (\S{20,200})$/.exec(req.headers.get('authorization') ?? '')?.[1];
    if (!token || !ROOM_RE.test(room) || (await roomOf(token)) !== room) return json({ error: 'unauthorized' }, 401);
    if (!name) {
      if (req.method !== 'GET') return json({ error: 'method not allowed' }, 405);
      const keys = await store.list(`r:${room}:`);
      const out: { name: string; rev: string }[] = [];
      for (const k of keys) { const v = await store.get(k); if (v) out.push({ name: k.slice(`r:${room}:`.length), rev: v.rev }); }
      return json(out);
    }
    if (!NAME_RE.test(name)) return json({ error: 'bad name' }, 400);
    const key = `r:${room}:${name}`;
    if (req.method === 'GET') {
      const v = await store.get(key);
      return v ? new Response(unb64(v.data), { headers: { 'content-type': 'application/octet-stream', etag: v.rev, 'cache-control': 'no-store', ...CORS } }) : json({ error: 'not found' }, 404);
    }
    if (req.method === 'PUT') {
      const body = new Uint8Array(await req.arrayBuffer());
      if (body.length > MAX_OBJECT_BYTES) return json({ error: 'too large' }, 413);
      if (!(await store.get(key)) && (await store.list(`r:${room}:`)).length >= MAX_OBJECTS) return json({ error: 'too many objects' }, 409);
      const rev = `${Date.now().toString(36)}${crypto.getRandomValues(new Uint8Array(4)).reduce((a, x) => a + x.toString(16).padStart(2, '0'), '')}`;
      await store.put(key, { rev, data: b64(body) });
      return json({ rev });
    }
    return json({ error: 'method not allowed' }, 405);
  };
}
