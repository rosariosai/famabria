// Two simulated devices (two IndexedDB databases) syncing through the real server and MariaDB.
// Runs only when TN_TEST_DB_* is set (see server.test.ts).
import 'fake-indexeddb/auto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../server/src/app';
import { Store } from '../server/src/store';
import { cleanEntry, createEvent, softDelete, type CalEvent } from '../src/core/events';
import { getAllEvents, openDb, putEvent, getSyncState, type Db } from '../src/data/db';
import { normalizeServerUrl, syncOnce, testConnection, SyncError, type SyncConfig } from '../src/sync/engine';

const env = process.env;
const cfg = env.TN_TEST_DB_HOST && env.TN_TEST_DB_USER && env.TN_TEST_DB_PASSWORD && env.TN_TEST_DB_NAME
  ? { host: env.TN_TEST_DB_HOST, port: Number(env.TN_TEST_DB_PORT ?? 3306), user: env.TN_TEST_DB_USER, password: env.TN_TEST_DB_PASSWORD, database: env.TN_TEST_DB_NAME }
  : null;
if (cfg && !/test/i.test(cfg.database)) throw new Error('Refusing to run on a database whose name does not contain "test".');

const mk = (id: string, title: string, date = '2027-01-15'): CalEvent => {
  const c = cleanEntry({ date, title });
  if (!c.ok) throw new Error(c.error);
  return createEvent(c.value, id, Date.now());
};
const titles = async (db: Db) => (await getAllEvents(db)).filter((e) => !e.deletedAt).map((e) => e.title).sort();

describe('normalizeServerUrl', () => {
  it('adds http, strips paths, rejects junk', () => {
    expect(normalizeServerUrl('192.168.0.10:8420')).toBe('http://192.168.0.10:8420');
    expect(normalizeServerUrl(' https://zc2.lan/some/path ')).toBe('https://zc2.lan');
    expect(normalizeServerUrl('')).toBeNull();
    expect(normalizeServerUrl('ftp://x')).toBeNull();
  });
});

describe.skipIf(!cfg)('calendar sync (real server)', () => {
  let store: Store, server: Server, url: string, ros: SyncConfig, anna: SyncConfig;
  let a: Db, b: Db;
  beforeAll(async () => {
    store = new Store(cfg!);
    await store.pool.query('DROP TABLE IF EXISTS tn_events, tn_users, tn_seq, tn_meta');
    await store.migrate();
    server = createApp(store, { log: () => undefined, failLimit: 100 });
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    ros = { url, token: await store.addUser('ros') };
    anna = { url, token: await store.addUser('anna') };
    a = await openDb('sync-a'); b = await openDb('sync-b');
  });
  afterAll(async () => { await new Promise((ok) => server.close(ok)); await store.close(); });

  it('tests a connection and names the user', async () => {
    expect(await testConnection(ros)).toBe('ros');
    await expect(testConnection({ url, token: 'tn_wrong' })).rejects.toMatchObject({ kind: 'auth' });
    await expect(testConnection({ url: 'http://127.0.0.1:1', token: 'x' }, { timeoutMs: 1500 })).rejects.toMatchObject({ kind: 'offline' });
  });

  it('a note made on one device appears on the other', async () => {
    await putEvent(a, mk('e1', 'Dentist'));
    await putEvent(a, mk('e2', 'Birthday'));
    const r1 = await syncOnce(a, ros);
    expect(r1.pushed).toBe(2);
    const r2 = await syncOnce(b, anna);
    expect(r2.pulled).toBe(2);
    expect(await titles(b)).toEqual(['Birthday', 'Dentist']);
  });

  it('the other device learns who changed a note', async () => {
    const e = (await getAllEvents(b)).find((x) => x.id === 'e1')!;
    expect(e.by).toBe('ros');
  });

  it('edits and deletions travel both ways, newest edit wins', async () => {
    const [d] = (await getAllEvents(b)).filter((e) => e.id === 'e1');
    await putEvent(b, { ...d, title: 'Dentist 15:30', updatedAt: Date.now() + 5 });
    await syncOnce(b, anna);
    await syncOnce(a, ros);
    expect((await getAllEvents(a)).find((e) => e.id === 'e1')!.title).toBe('Dentist 15:30');
    const e2 = (await getAllEvents(a)).find((e) => e.id === 'e2')!;
    await putEvent(a, softDelete(e2, Date.now() + 10));
    await syncOnce(a, ros);
    await syncOnce(b, anna);
    expect(await titles(b)).toEqual(['Dentist 15:30']);
  });

  it('a second sync with nothing new does nothing', async () => {
    const r = await syncOnce(a, ros);
    expect(r).toMatchObject({ pulled: 0, pushed: 0 });
  });

  it('offline edits on both devices merge without losing either', async () => {
    await putEvent(a, mk('e3', 'From A'));
    await putEvent(b, mk('e4', 'From B'));
    await syncOnce(a, ros); await syncOnce(b, anna); await syncOnce(a, ros);
    expect(await titles(a)).toEqual(await titles(b));
    expect(await titles(a)).toEqual(['Dentist 15:30', 'From A', 'From B']);
  });

  it('a device clock far in the future is refused and reported, and recovers later', async () => {
    await putEvent(a, { ...mk('e5', 'Future'), updatedAt: Date.now() + 3600_000 });
    await expect(syncOnce(a, ros)).rejects.toMatchObject({ kind: 'clock' });
    expect(await titles(b)).not.toContain('Future');
    const st = await getSyncState(a);
    expect(st!.pushedAt).toBeLessThan(Date.now() + 3600_000);
  });

  it('pushes more than one batch', async () => {
    const c = await openDb('sync-c');
    for (let i = 0; i < 450; i++) await putEvent(c, mk(`bulk${i}`, `Bulk ${i}`, '2027-02-01'));
    const r = await syncOnce(c, ros);
    expect(r.pushed).toBe(450);
    const d = await openDb('sync-d');
    expect((await syncOnce(d, anna)).pulled).toBeGreaterThanOrEqual(450);
  });

  it('wrong token is reported as an auth problem', async () => {
    await expect(syncOnce(await openDb('sync-e'), { url, token: 'tn_nope' })).rejects.toBeInstanceOf(SyncError);
  });
});
