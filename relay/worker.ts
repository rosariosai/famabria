// Cloudflare Worker entry. One Durable Object per family room: strongly consistent, no list/write quotas to worry about on the free plan.
// Deploy: `npm run deploy:relay` (see docs/RELAY.md). The Worker only routes; the Room object runs the same relay code as the Node server.
import { createRelay, json, type Store } from './core';
import { createV1, edgeGate, newFamily } from './v1';

interface Storage { get<T>(k: string): Promise<T | undefined>; put(k: string, v: unknown): Promise<void>; delete(k: string): Promise<unknown>; list<T>(o: { prefix: string }): Promise<Map<string, T>> }
const b64 = (u: Uint8Array) => { let s = ''; for (const x of u) s += String.fromCharCode(x); return btoa(s); };
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const storeOf = (st: Storage): Store => ({
  get: async (k) => { const v = await st.get<{ rev: string; bytes: Uint8Array }>(k); return v ? { rev: v.rev, data: b64(v.bytes) } : null; },
  put: (k, v) => st.put(k, { rev: v.rev, bytes: unb64(v.data) }),
  list: async (p) => [...(await st.list({ prefix: p })).keys()],
  del: async (k) => { await st.delete(k); },
});

export class Room {
  private legacy: (req: Request) => Promise<Response>;
  private v1: ((req: Request) => Promise<Response>) | null;
  constructor(state: { storage: Storage }, env: Env = {} as Env) {
    const store = storeOf(state.storage);
    this.legacy = createRelay(store);
    this.v1 = env.TOKEN_SECRET ? createV1(store, env.TOKEN_SECRET) : null;
  }
  fetch(req: Request): Promise<Response> {
    if (new URL(req.url).pathname.startsWith('/v1/')) return this.v1 ? this.v1(req) : Promise.resolve(json({ error: 'v1 not configured' }, 503));
    return this.legacy(req);
  }
}

interface Ns { idFromName(n: string): unknown; get(id: unknown): { fetch(r: Request): Promise<Response> } }
interface Env { ROOM: Ns; TOKEN_SECRET?: string }
const handle = createRelay({ get: async () => null, put: async () => undefined, list: async () => [] }); // answers /healthz, CORS and 404 without touching a room

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const path = new URL(req.url).pathname;
    if (req.method === 'OPTIONS') return handle(req);
    if (path.startsWith('/v1/')) {
      if (!env.TOKEN_SECRET) return json({ error: 'v1 not configured' }, 503);
      if (path === '/v1/families') return req.method === 'POST' ? json(await newFamily(env.TOKEN_SECRET), 201) : json({ error: 'method not allowed' }, 405);
      const fam = await edgeGate(req, env.TOKEN_SECRET); // verified BEFORE the Durable Object exists: forged families and big uploads never reach it
      if (fam instanceof Response) return fam;
      return env.ROOM.get(env.ROOM.idFromName(`v1:${fam}`)).fetch(req);
    }
    const m = /^\/r\/([A-Za-z0-9_-]{22})(?:\/|$)/.exec(path);
    if (!m) return handle(req);
    return env.ROOM.get(env.ROOM.idFromName(m[1])).fetch(req);
  },
};
