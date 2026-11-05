import { mergeEvents, parseEvents, type CalEvent } from '../core/events';
import { getAllEvents, getSyncState, putEvents, saveSyncState, type Db } from '../data/db';

export interface SyncConfig { url: string; token: string; /** name the server knows this token by */ user?: string }
export interface SyncState { cursor: number; pushedAt: number; lastSyncAt: number | null }
export const EMPTY_SYNC_STATE: SyncState = { cursor: 0, pushedAt: 0, lastSyncAt: null };

export type SyncErrorKind = 'config' | 'offline' | 'auth' | 'server' | 'clock';
export class SyncError extends Error {
  constructor(public kind: SyncErrorKind, message: string) { super(message); }
}

export interface SyncResult { pulled: number; pushed: number; user: string }
export interface SyncOptions { fetch?: typeof fetch; timeoutMs?: number }

/** Accepts "192.168.0.10:8420" or "http://zc2.lan:8420/" and returns "http://192.168.0.10:8420" (no path), or null. */
export function normalizeServerUrl(input: string): string | null {
  let t = input.trim();
  if (!t) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) t = `http://${t}`;
  try {
    const u = new URL(t);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (!u.hostname) return null;
    return u.origin;
  } catch { return null; }
}

const PAGE = 500;
const BATCH = 200;

async function call(cfg: SyncConfig, path: string, init: RequestInit, o: SyncOptions): Promise<unknown> {
  const f = o.fetch ?? fetch.bind(globalThis);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), o.timeoutMs ?? 6000);
  let res: Response;
  try {
    res = await f(cfg.url + path, { ...init, signal: ctl.signal, headers: { ...(init.headers ?? {}), authorization: `Bearer ${cfg.token}` } });
  } catch (e) {
    const why = ctl.signal.aborted ? 'no answer within a few seconds' : `${(e as Error)?.name ?? 'Error'}: ${(e as Error)?.message ?? 'blocked'}`;
    throw new SyncError('offline', `The server cannot be reached (${why}). You are probably not on the home network, or the browser blocked the connection.`);
  } finally { clearTimeout(timer); }
  if (res.status === 401 || res.status === 403) throw new SyncError('auth', 'The server did not accept this token.');
  if (res.status === 429) throw new SyncError('auth', 'Too many wrong attempts. Wait a minute and check the token.');
  if (!res.ok) throw new SyncError('server', `The server answered ${res.status}.`);
  try { return await res.json(); } catch { throw new SyncError('server', 'The server sent something unexpected. Is the address right?'); }
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null;

/** Check address + token. Returns the user name the token belongs to. */
export async function testConnection(cfg: SyncConfig, o: SyncOptions = {}): Promise<string> {
  const r = await call(cfg, '/api/me', { method: 'GET' }, o);
  if (!isObj(r) || typeof r.user !== 'string') throw new SyncError('server', 'That address answered, but it is not a Famabria server.');
  return r.user;
}

let running: Promise<SyncResult> | null = null;

/** Pull what others changed, then push what we changed. Safe to call repeatedly; overlapping calls share one run. */
export function syncOnce(db: Db, cfg: SyncConfig, o: SyncOptions = {}): Promise<SyncResult> {
  if (running) return running;
  running = run(db, cfg, o).finally(() => { running = null; });
  return running;
}

async function run(db: Db, cfg: SyncConfig, o: SyncOptions): Promise<SyncResult> {
  const user = await testConnection(cfg, o);
  const state = { ...EMPTY_SYNC_STATE, ...(await getSyncState(db)) };
  let pulled = 0, pushed = 0;

  // ---- pull
  for (;;) {
    const r = await call(cfg, `/api/changes?since=${state.cursor}&limit=${PAGE}`, { method: 'GET' }, o);
    if (!isObj(r) || !Array.isArray(r.events) || typeof r.cursor !== 'number') throw new SyncError('server', 'The server sent something unexpected.');
    const { events: incoming } = parseEvents(r.events);
    if (incoming.length) {
      const local = await getAllEvents(db);
      const have = new Map(local.map((e) => [e.id, e]));
      const merged = mergeEvents(local, incoming);
      const changed = merged.filter((e) => have.get(e.id) !== e);
      if (changed.length) { await putEvents(db, changed); pulled += changed.length; }
    }
    state.cursor = r.cursor;
    await saveSyncState(db, state);
    if (r.more !== true) break;
  }

  // ---- push
  const todo = (await getAllEvents(db)).filter((e) => e.updatedAt > state.pushedAt).sort((a, b) => a.updatedAt - b.updatedAt);
  let clockProblem = false;
  for (let i = 0; i < todo.length && !clockProblem; i += BATCH) {
    const batch: CalEvent[] = todo.slice(i, i + BATCH);
    const r = await call(cfg, '/api/changes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ events: batch }) }, o);
    if (!isObj(r) || !Array.isArray(r.applied)) throw new SyncError('server', 'The server sent something unexpected.');
    pushed += r.applied.length;
    const rejected = Array.isArray(r.rejected) ? (r.rejected as { id?: unknown }[]) : [];
    const bad = batch.filter((e) => rejected.some((x) => x.id === e.id));
    if (bad.length) { clockProblem = true; state.pushedAt = Math.min(...bad.map((e) => e.updatedAt)) - 1; }
    else state.pushedAt = batch[batch.length - 1].updatedAt;
    await saveSyncState(db, state);
  }
  state.lastSyncAt = Date.now();
  await saveSyncState(db, state);
  if (clockProblem) throw new SyncError('clock', 'Some notes were refused because this computer’s clock is ahead of the server. Fix the clock and sync again.');
  return { pulled, pushed, user };
}
