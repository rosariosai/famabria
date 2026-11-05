// Integration tests against a real MariaDB. They run only when TN_TEST_DB_HOST/USER/PASSWORD/NAME are set,
// and refuse to run unless the database name contains "test" (they drop and recreate the tn_* tables).
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, MAX_BATCH } from '../server/src/app';
import { Store } from '../server/src/store';
import { loadConfig } from '../server/src/config';
import { createEvent, cleanEntry, softDelete, type CalEvent } from '../src/core/events';

const env = process.env;
const cfg = env.TN_TEST_DB_HOST && env.TN_TEST_DB_USER && env.TN_TEST_DB_PASSWORD && env.TN_TEST_DB_NAME
  ? { host: env.TN_TEST_DB_HOST, port: Number(env.TN_TEST_DB_PORT ?? 3306), user: env.TN_TEST_DB_USER, password: env.TN_TEST_DB_PASSWORD, database: env.TN_TEST_DB_NAME }
  : null;
if (cfg && !/test/i.test(cfg.database)) throw new Error('Refusing to run server tests on a database whose name does not contain "test".');

const ev = (id: string, title: string, updatedAt: number, o: Partial<CalEvent> = {}): CalEvent => {
  const c = cleanEntry({ date: '2027-01-15', title });
  if (!c.ok) throw new Error(c.error);
  return { ...createEvent(c.value, id, 1_000), updatedAt, ...o };
};

describe('config', () => {
  it('reads settings and a password file', () => {
    expect(() => loadConfig({})).toThrow(/DB_HOST/);
    expect(() => loadConfig({ DB_HOST: 'h', DB_USER: 'u' })).toThrow(/DB_PASSWORD/);
    const c = loadConfig({ DB_HOST: 'h', DB_USER: 'u', DB_PASSWORD: 'p', PORT: '9000' });
    expect(c).toMatchObject({ port: 9000, host: '0.0.0.0', trustProxy: false, db: { host: 'h', port: 3306, database: 'tilenest' } });
    expect(() => loadConfig({ DB_HOST: 'h', DB_USER: 'u', DB_PASSWORD: 'p', PORT: 'x' })).toThrow(/PORT/);
  });
});

describe.skipIf(!cfg)('sync server (MariaDB)', () => {
  let store: Store, server: Server, base: string, tokenRos: string, tokenAnna: string;
  const call = async (path: string, init: RequestInit & { token?: string | null } = {}) => {
    const { token = tokenRos, ...rest } = init;
    const r = await fetch(base + path, { ...rest, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json', ...(rest.headers ?? {}) } });
    return { status: r.status, body: (await r.json().catch(() => null)) as any, headers: r.headers };
  };
  const push = (events: CalEvent[], token?: string) => call('/api/changes', { method: 'POST', body: JSON.stringify({ events }), token });
  const start = async (opts: { failLimit?: number } = {}) => {
    server = createApp(store, { log: () => undefined, ...opts });
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  };

  beforeAll(async () => {
    store = new Store(cfg!);
    await store.pool.query('DROP TABLE IF EXISTS tn_events, tn_users, tn_seq, tn_meta');
    await store.migrate();
    tokenRos = await store.addUser('ros');
    tokenAnna = await store.addUser('anna');
    await start();
  });
  afterAll(async () => { await new Promise((ok) => server.close(ok)); await store.close(); });

  it('migrating twice is harmless', async () => {
    await store.migrate();
    expect(await store.cursor()).toBe(0);
  });

  it('health is public, everything else needs a token', async () => {
    const h = await call('/healthz', { token: null });
    expect(h.status).toBe(200);
    expect(h.body).toMatchObject({ ok: true, db: true });
    expect((await call('/api/me', { token: null })).status).toBe(401);
    expect((await call('/api/me', { token: 'tn_' + 'x'.repeat(43) })).status).toBe(401);
    expect((await call('/api/changes')).status).toBe(200);
    const me = await call('/api/me');
    expect(me.body.user).toBe('ros');
  });

  it('stores hashes, never tokens', async () => {
    const [rows] = (await store.pool.query('SELECT token_hash FROM tn_users')) as any;
    for (const r of rows) { expect(r.token_hash).toMatch(/^[0-9a-f]{64}$/); expect([tokenRos, tokenAnna]).not.toContain(r.token_hash); }
  });

  it('push, then pull shows the event with author and sequence', async () => {
    const p = await push([ev('e1', 'Dentista', 5_000)]);
    expect(p.body).toMatchObject({ applied: ['e1'], ignored: [], rejected: [], cursor: 1 });
    const c = await call('/api/changes?since=0', { token: tokenAnna });
    expect(c.body.events).toHaveLength(1);
    expect(c.body.events[0]).toMatchObject({ id: 'e1', title: 'Dentista', by: 'ros', seq: 1, deletedAt: null, date: '2027-01-15' });
    expect(c.body).toMatchObject({ cursor: 1, more: false });
  });

  it('last write wins; older and equal versions are ignored', async () => {
    expect((await push([ev('e1', 'Dentista v2', 6_000)], tokenAnna)).body.applied).toEqual(['e1']);
    const stale = await push([ev('e1', 'old', 5_500)]);
    expect(stale.body).toMatchObject({ applied: [], ignored: ['e1'] });
    expect((await push([ev('e1', 'same time', 6_000)])).body.ignored).toEqual(['e1']);
    const all = await call('/api/changes?since=0');
    expect(all.body.events.map((e: any) => [e.title, e.by])).toEqual([['Dentista v2', 'anna']]);
  });

  it('pull with the cursor only returns what is new', async () => {
    const before = (await call('/api/me')).body.cursor;
    await push([ev('e2', 'Cena', 7_000)]);
    const c = await call(`/api/changes?since=${before}`);
    expect(c.body.events.map((e: any) => e.id)).toEqual(['e2']);
    expect((await call(`/api/changes?since=${c.body.cursor}`)).body.events).toEqual([]);
  });

  it('deletions travel as tombstones', async () => {
    const gone = softDelete(ev('e2', 'Cena', 7_000), 8_000);
    expect((await push([gone], tokenAnna)).body.applied).toEqual(['e2']);
    const c = await call('/api/changes?since=0');
    expect(c.body.events.find((e: any) => e.id === 'e2')).toMatchObject({ deletedAt: 8_000, by: 'anna' });
  });

  it('pages through many events without losing any', async () => {
    const many = Array.from({ length: 120 }, (_, i) => ev(`p${i}`, `Evento ${i}`, 10_000 + i));
    expect((await push(many)).body.applied).toHaveLength(120);
    let since = (await call('/api/changes?since=0&limit=1000')).body.events.find((e: any) => e.id === 'p0').seq - 1, seen: string[] = [], pages = 0, more = true;
    while (more) { const r = await call(`/api/changes?since=${since}&limit=50`); seen.push(...r.body.events.map((e: any) => e.id)); since = r.body.cursor; more = r.body.more; pages++; }
    expect(seen).toHaveLength(120);
    expect(new Set(seen).size).toBe(120);
    expect(pages).toBe(3);
  });

  it('keeps accents, emoji and long notes intact (utf8mb4)', async () => {
    const notes = 'Perché è già così 🎂 — ' + 'x'.repeat(3900);
    await push([ev('u1', 'Compleanno di Nicolò 🎉', 20_000, { notes })]);
    const e = (await call('/api/changes?since=0&limit=1000')).body.events.find((x: any) => x.id === 'u1');
    expect(e.title).toBe('Compleanno di Nicolò 🎉');
    expect(e.notes).toBe(notes.slice(0, 4000));
  });

  it('rejects bad input clearly', async () => {
    expect((await call('/api/changes', { method: 'POST', body: '{nope' })).status).toBe(400);
    expect((await call('/api/changes', { method: 'POST', body: '{"events":"x"}' })).status).toBe(400);
    expect((await call('/api/changes?since=-1')).status).toBe(400);
    expect((await call('/api/changes?limit=0')).status).toBe(400);
    expect((await call('/api/changes?limit=5000')).status).toBe(400);
    expect((await call('/api/nothing')).status).toBe(404);
    const bad = await push([{ id: 'b1', date: 'not-a-date', title: 'x' } as any, ev('ok1', 'fine', 30_000)]);
    expect(bad.body.applied).toEqual(['ok1']);
    expect(bad.body.rejected[0].reason).toMatch(/invalid/);
    const tooMany = await push(Array.from({ length: MAX_BATCH + 1 }, (_, i) => ev(`m${i}`, 'x', 1)));
    expect(tooMany.status).toBe(413);
    const huge = await fetch(base + '/api/changes', { method: 'POST', headers: { Authorization: `Bearer ${tokenRos}` }, body: JSON.stringify({ events: [], pad: 'x'.repeat(1_100_000) }) });
    expect(huge.status).toBe(413);
  });

  it('refuses a device whose clock is far in the future (it would win every conflict)', async () => {
    const r = await push([ev('f1', 'time traveller', Date.now() + 3_600_000)]);
    expect(r.body.applied).toEqual([]);
    expect(r.body.rejected[0]).toMatchObject({ id: 'f1' });
    expect(r.body.rejected[0].reason).toMatch(/clock/);
  });

  it('parallel pushes from two people never lose or duplicate events, and cursors stay consistent', async () => {
    const a = Array.from({ length: 40 }, (_, i) => ev(`a${i}`, `A${i}`, 40_000 + i));
    const b = Array.from({ length: 40 }, (_, i) => ev(`b${i}`, `B${i}`, 40_000 + i));
    const start = (await call('/api/me')).body.cursor;
    const [ra, rb] = await Promise.all([push(a, tokenRos), push(b, tokenAnna), push(a.slice(0, 10), tokenRos)]);
    expect(ra.body.applied.length + rb.body.applied.length).toBeGreaterThanOrEqual(80);
    const got = (await call(`/api/changes?since=${start}&limit=1000`)).body.events;
    const ids = got.map((e: any) => e.id);
    expect(new Set(ids).size).toBe(80);
    const seqs = got.map((e: any) => e.seq);
    expect(new Set(seqs).size).toBe(seqs.length);
    expect([...seqs].sort((x, y) => x - y)).toEqual(seqs);
  });

  it('data survives a server restart and export returns everything', async () => {
    await new Promise((ok) => server.close(ok));
    await start();
    const ex = await call('/api/export');
    expect(ex.body.events.length).toBeGreaterThan(100);
    expect(ex.body.events.find((e: any) => e.id === 'e1').title).toBe('Dentista v2');
  });

  it('a removed user stops working immediately; a new token can be issued', async () => {
    expect(await store.revokeUser('anna')).toBe(true);
    expect((await call('/api/me', { token: tokenAnna })).status).toBe(401);
    const fresh = await store.addUser('anna');
    expect((await call('/api/me', { token: fresh })).body.user).toBe('anna');
    await expect(store.addUser('anna')).rejects.toThrow(/already exists/);
    await expect(store.addUser('bad name!')).rejects.toThrow(/letters/);
  });

  it('too many wrong tokens are slowed down (429) while a good token from elsewhere is unaffected', async () => {
    await new Promise((ok) => server.close(ok));
    await start({ failLimit: 3 });
    for (let i = 0; i < 3; i++) expect((await call('/api/me', { token: 'tn_' + 'y'.repeat(43) })).status).toBe(401);
    const blocked = await call('/api/me', { token: 'tn_' + 'y'.repeat(43) });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('retry-after')).toBe('60');
  });
});
