import { describe, expect, it } from 'vitest';
import type { Store } from '../relay/core';
import { createV1, edgeGate, issueToken, newFamily, verifyToken } from '../relay/v1';

const SECRET = 'test-secret-with-enough-entropy-0123456789';
const memStore = (): Store => {
  const m = new Map<string, { rev: string; data: string }>();
  return { get: async (k) => m.get(k) ?? null, put: async (k, v) => void m.set(k, v), list: async (p) => [...m.keys()].filter((k) => k.startsWith(p)), del: async (k) => void m.delete(k) };
};
const req = (path: string, token: string | null, init: RequestInit = {}) =>
  new Request(`https://x.test${path}`, { ...init, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init.headers as Record<string, string>) } });

async function setup() {
  const store = memStore(); let t = 1_800_000_000_000;
  const relay = createV1(store, SECRET, () => t);
  const fam = await newFamily(SECRET, t);
  const add = async (role: string) => (await (await relay(req(`/v1/f/${fam.family}/devices`, fam.token, { method: 'POST', body: JSON.stringify({ role }) }))).json()) as { device: string; token: string };
  return { store, relay, fam, add, tick: (ms: number) => (t += ms), now: () => t };
}

describe('relay v1 tokens', () => {
  it('accepts its own tokens and rejects forged, tampered, other-secret and expired ones', async () => {
    const { family, token } = await newFamily(SECRET, 1_000_000);
    expect((await verifyToken(`Bearer ${token}`, SECRET, 1_000_000))?.f).toBe(family);
    expect(await verifyToken(`Bearer ${token}`, 'another-secret-another-secret-12345', 1_000_000)).toBeNull();
    expect(await verifyToken(`Bearer ${token.slice(0, -2)}AA`, SECRET, 1_000_000)).toBeNull();
    expect(await verifyToken(`Bearer ${token}`, SECRET, 1_000_000 + 91 * 86_400_000)).toBeNull();
    expect(await verifyToken(null, SECRET, 0)).toBeNull();
    const bad = await issueToken({ f: 'short', d: 'abcdef', r: 'admin', e: 9e9 }, SECRET);
    expect(await verifyToken(`Bearer ${bad}`, SECRET, 0)).toBeNull();
  });
});

describe('edge gate (before any Durable Object)', () => {
  it('rejects missing/forged tokens, other-family tokens and oversized uploads', async () => {
    const a = await newFamily(SECRET), b = await newFamily(SECRET);
    const url = (f: string) => `/v1/f/${f}/objects/d-${a.device}.fc`;
    expect((await edgeGate(req(url(a.family), null), SECRET) as Response).status).toBe(401);
    expect((await edgeGate(req(url(a.family), 'fc1.AAAAAAAAAAAA.' + 'A'.repeat(43)), SECRET) as Response).status).toBe(401);
    expect((await edgeGate(req(url(b.family), a.token), SECRET) as Response).status).toBe(401);
    expect((await edgeGate(req(url(a.family), a.token, { method: 'PUT', headers: { 'content-length': String(2 * 1024 * 1024) }, body: 'x' }), SECRET) as Response).status).toBe(413);
    expect(await edgeGate(req(url(a.family), a.token), SECRET)).toBe(a.family);
  });
});

describe('relay v1 objects', () => {
  it('a device can write only its own object; others can read it', async () => {
    const { relay, fam, add } = await setup();
    const phone = await add('member');
    const put = (token: string, name: string, body = 'hello') => relay(req(`/v1/f/${fam.family}/objects/${name}`, token, { method: 'PUT', body }));
    expect((await put(fam.token, `d-${fam.device}.fc`)).status).toBe(200);
    expect((await put(phone.token, `d-${fam.device}.fc`, 'evil')).status).toBe(403); // cannot overwrite someone else's object
    expect((await put(phone.token, `d-${phone.device}.fc`)).status).toBe(200);
    const list = (await (await relay(req(`/v1/f/${fam.family}/objects`, phone.token))).json()) as { name: string }[];
    expect(list.map((o) => o.name).sort()).toEqual([`d-${fam.device}.fc`, `d-${phone.device}.fc`].sort());
    const got = await relay(req(`/v1/f/${fam.family}/objects/d-${fam.device}.fc`, phone.token));
    expect(await got.text()).toBe('hello'); // the rejected write did not change it
  });

  it('bots are read-only, other families are invisible, oversized bodies are refused', async () => {
    const { relay, fam, add } = await setup();
    const bot = await add('bot');
    expect((await relay(req(`/v1/f/${fam.family}/objects/d-${bot.device}.fc`, bot.token, { method: 'PUT', body: 'x' }))).status).toBe(403);
    expect((await relay(req(`/v1/f/${fam.family}/objects`, bot.token))).status).toBe(200);
    const other = await newFamily(SECRET);
    expect((await relay(req(`/v1/f/${fam.family}/objects`, other.token))).status).toBe(401);
    const big = new Uint8Array(1024 * 1024 + 1);
    expect((await relay(req(`/v1/f/${fam.family}/objects/d-${fam.device}.fc`, fam.token, { method: 'PUT', body: big }))).status).toBe(413);
  });

  it('only admins manage devices; a revoked device loses access and its object', async () => {
    const { relay, fam, add } = await setup();
    const phone = await add('member');
    expect((await relay(req(`/v1/f/${fam.family}/devices`, phone.token, { method: 'POST', body: '{}' }))).status).toBe(403);
    await relay(req(`/v1/f/${fam.family}/objects/d-${phone.device}.fc`, phone.token, { method: 'PUT', body: 'mine' }));
    expect((await relay(req(`/v1/f/${fam.family}/devices/${phone.device}`, fam.token, { method: 'DELETE' }))).status).toBe(200);
    expect((await relay(req(`/v1/f/${fam.family}/objects`, phone.token))).status).toBe(401);
    expect((await relay(req(`/v1/f/${fam.family}/objects/d-${phone.device}.fc`, fam.token))).status).toBe(404);
    expect((await relay(req(`/v1/f/${fam.family}/devices/${fam.device}`, fam.token, { method: 'DELETE' }))).status).toBe(400); // an admin cannot lock itself out
  });

  it('rate-limits a device after 120 requests per minute and recovers in the next minute', async () => {
    const { relay, fam, tick } = await setup();
    let last = 200;
    for (let i = 0; i < 121; i++) last = (await relay(req(`/v1/f/${fam.family}/objects`, fam.token))).status;
    expect(last).toBe(429);
    tick(61_000);
    expect((await relay(req(`/v1/f/${fam.family}/objects`, fam.token))).status).toBe(200);
  });
});

describe('relay v1 one-time invites', () => {
  const authKey = 'A'.repeat(43);
  const hashOf = async (k: string) => { const b = new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(atob(k.replace(/-/g, '+').replace(/_/g, '/') + '='), (c) => c.charCodeAt(0)))); return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
  async function inv(relay: (r: Request) => Promise<Response>, fam: { family: string; token: string }, over: Record<string, unknown> = {}) {
    const r = await relay(req(`/v1/f/${fam.family}/invites`, fam.token, { method: 'POST', body: JSON.stringify({ authHash: await hashOf(authKey), role: 'member', ttl: 600, blob: 'wrapped-key', ...over }) }));
    return { status: r.status, ticket: ((await r.json()) as { invite?: string }).invite ?? '' };
  }
  const redeem = (relay: (r: Request) => Promise<Response>, fam: string, ticket: string, auth: string) => relay(req(`/v1/f/${fam}/invites/${ticket}/redeem`, null, { method: 'POST', body: JSON.stringify({ auth, pub: 'pubkey' }) }));

  it('works once, hands out a device token + the blob, then is burnt', async () => {
    const { relay, fam } = await setup();
    const { status, ticket } = await inv(relay, fam); expect(status).toBe(201);
    expect((await edgeGate(req(`/v1/f/${fam.family}/invites/${ticket}/redeem`, null, { method: 'POST', body: '{}' }), SECRET, 1_800_000_000_000)) as string).toBe(fam.family);
    const ok = await redeem(relay, fam.family, ticket, authKey); expect(ok.status).toBe(200);
    const j = (await ok.json()) as { device: string; token: string; blob: string; role: string };
    expect(j.blob).toBe('wrapped-key'); expect(j.role).toBe('member');
    expect((await relay(req(`/v1/f/${fam.family}/objects`, j.token))).status).toBe(200); // the new device can sync
    expect((await redeem(relay, fam.family, ticket, authKey)).status).toBe(403); // second use fails
  });

  it('wrong secret, forged/other-family ticket and expiry give the same generic 403; 5 wrong tries burn the invite', async () => {
    const { relay, fam, tick } = await setup();
    const { ticket } = await inv(relay, fam);
    for (let i = 0; i < 4; i++) { const r = await redeem(relay, fam.family, ticket, 'B'.repeat(43)); expect(r.status).toBe(403); expect(await r.json()).toEqual({ error: 'invalid invite' }); }
    expect((await redeem(relay, fam.family, ticket, 'B'.repeat(43))).status).toBe(403);
    expect((await redeem(relay, fam.family, ticket, authKey)).status).toBe(403); // burnt after 5 failures, even with the right secret
    const other = await newFamily(SECRET);
    const t2 = (await inv(relay, fam)).ticket;
    expect((await redeem(relay, other.family, t2, authKey)).status).toBe(403);
    expect((await edgeGate(req(`/v1/f/${fam.family}/invites/${t2.slice(0, -2)}AA/redeem`, null, { method: 'POST', body: '{}' }), SECRET, 1_800_000_000_000) as Response).status).toBe(403);
    tick(601_000);
    expect((await redeem(relay, fam.family, t2, authKey)).status).toBe(403); // expired
  });

  it('only admins create invites; at most 3 open at a time; bad shapes are refused', async () => {
    const { relay, fam, add } = await setup();
    const phone = await add('member');
    expect((await inv(relay, { family: fam.family, token: phone.token })).status).toBe(403);
    expect((await inv(relay, fam, { role: 'admin' })).status).toBe(400); // invites cannot make admins
    expect((await inv(relay, fam, { authHash: 'short' })).status).toBe(400);
    for (let i = 0; i < 3; i++) expect((await inv(relay, fam)).status).toBe(201);
    expect((await inv(relay, fam)).status).toBe(429);
  });
});

describe('relay v1 token refresh', () => {
  it('gives members/admins a fresh token for the same device; a 90-day bot token renews too', async () => {
    const { relay, fam, add, tick } = await setup();
    const phone = await add('member'), bot = await add('bot');
    tick(20 * 86_400_000); // 20 days later the 30-day token is still valid, the new one lasts longer
    const r = await relay(req(`/v1/f/${fam.family}/token/refresh`, phone.token, { method: 'POST' }));
    expect(r.status).toBe(200);
    const { token } = (await r.json()) as { token: string };
    tick(15 * 86_400_000); // 35 days after the start: the old token is dead, the renewed one lives
    expect((await relay(req(`/v1/f/${fam.family}/objects`, phone.token))).status).toBe(401);
    expect((await relay(req(`/v1/f/${fam.family}/objects`, token))).status).toBe(200);
    expect((await relay(req(`/v1/f/${fam.family}/token/refresh`, bot.token, { method: 'POST' }))).status).toBe(200); // the bot renews too (its token lasts 90 days)
    expect((await relay(req(`/v1/f/${fam.family}/devices/${bot.device}`, fam.token, { method: 'DELETE' }))).status).toBe(401); // admin token itself expired by now
  });
});

describe('relay v1 device list', () => {
  it('lists devices for the admin only, including revoked ones flagged', async () => {
    const { relay, fam, add } = await setup();
    const phone = await add('member'); await relay(req(`/v1/f/${fam.family}/objects`, phone.token)); // phone seen
    await relay(req(`/v1/f/${fam.family}/objects`, fam.token));
    const rows = (await (await relay(req(`/v1/f/${fam.family}/devices`, fam.token))).json()) as { device: string; role: string; revoked: boolean }[];
    expect(rows.map((r) => r.device).sort()).toEqual([fam.device, phone.device].sort());
    expect(rows.find((r) => r.device === fam.device)!.role).toBe('admin');
    expect((await relay(req(`/v1/f/${fam.family}/devices`, phone.token))).status).toBe(403);
    await relay(req(`/v1/f/${fam.family}/devices/${phone.device}`, fam.token, { method: 'DELETE' }));
    const after = (await (await relay(req(`/v1/f/${fam.family}/devices`, fam.token))).json()) as { device: string; revoked: boolean }[];
    expect(after.find((r) => r.device === phone.device)!.revoked).toBe(true);
  });
});
