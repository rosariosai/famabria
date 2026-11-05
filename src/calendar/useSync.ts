import { useCallback, useEffect, useRef, useState } from 'react';
import { clearSyncConfig, getSyncConfig, getSyncState, resetSyncState, saveSyncConfig, type Db } from '../data/db';
import { EMPTY_SYNC_STATE, SyncError, syncOnce, testConnection, type SyncConfig, type SyncErrorKind, type SyncState } from '../sync/engine';

export type SyncStatus = 'off' | 'idle' | 'syncing' | 'ok' | SyncErrorKind;

const EVERY_MS = 5 * 60_000;
const MIN_GAP_MS = 20_000;

/** Keeps the calendar in step with the home server. Never shows an error popup: away from home it just says "offline". */
export function useSync(ready: boolean, getDb: () => Db | null, onPulled: () => void) {
  const [config, setConfig] = useState<SyncConfig | null>(null);
  const [loaded, setLoaded] = useState(false); // saved server read from storage (config may still be null)
  const [status, setStatus] = useState<SyncStatus>('off');
  const [message, setMessage] = useState('');
  const [user, setUser] = useState('');
  const [state, setState] = useState<SyncState>(EMPTY_SYNC_STATE);
  const last = useRef(0);
  const cfgRef = useRef<SyncConfig | null>(null);
  const timer = useRef<number>();

  const run = useCallback(async (force = false): Promise<boolean> => {
    const db = getDb(), cfg = cfgRef.current;
    if (!db || !cfg) return false;
    if (!force && Date.now() - last.current < MIN_GAP_MS) return false;
    last.current = Date.now();
    setStatus('syncing'); setMessage('');
    try {
      const r = await syncOnce(db, cfg);
      setUser(r.user); setStatus('ok'); setMessage(r.pulled || r.pushed ? `Received ${r.pulled}, sent ${r.pushed}.` : 'Everything is up to date.');
      if (r.pulled) onPulled();
      return true;
    } catch (e) {
      const err = e instanceof SyncError ? e : new SyncError('server', 'Something went wrong while syncing.');
      setStatus(err.kind); setMessage(err.message);
      return false;
    } finally {
      const st = await getSyncState(db); if (st) setState(st);
    }
  }, [getDb, onPulled]);

  // load the saved server, then sync once
  useEffect(() => {
    if (!ready) return;
    const db = getDb();
    if (!db) return;
    void (async () => {
      const [c, st] = await Promise.all([getSyncConfig(db), getSyncState(db)]);
      if (st) setState(st);
      cfgRef.current = c ?? null; setConfig(c ?? null); setLoaded(true);
      if (c) { setStatus('idle'); void run(true); }
    })();
  }, [ready, getDb, run]);

  // keep syncing: when the tab comes back, and every few minutes while it is open
  useEffect(() => {
    if (!config) return;
    const onVisible = () => { if (document.visibilityState === 'visible') void run(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onVisible);
    const id = window.setInterval(() => { if (document.visibilityState === 'visible') void run(true); }, EVERY_MS);
    return () => { document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('online', onVisible); window.clearInterval(id); };
  }, [config, run]);

  /** Call after the user saves/deletes a note: sync a moment later so quick edits go out together. */
  const changed = useCallback(() => {
    if (!cfgRef.current) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void run(true), 2500);
  }, [run]);

  const connect = useCallback(async (cfg: SyncConfig): Promise<string> => {
    const db = getDb();
    if (!db) throw new SyncError('config', 'Storage is not ready yet.');
    const who = await testConnection(cfg);
    const old = cfgRef.current;
    if (!old || old.url !== cfg.url) await resetSyncState(db); // a different server: start from scratch
    const full = { ...cfg, user: who };
    await saveSyncConfig(db, full);
    cfgRef.current = full; setConfig(full); setUser(who); setStatus('idle');
    void run(true);
    return who;
  }, [getDb, run]);

  const disconnect = useCallback(async () => {
    const db = getDb();
    if (db) await clearSyncConfig(db);
    cfgRef.current = null; setConfig(null); setStatus('off'); setMessage(''); setUser(''); setState(EMPTY_SYNC_STATE);
  }, [getDb]);

  /** Forget what was already sent and send everything again (useful after restoring a backup). */
  const resendAll = useCallback(async () => {
    const db = getDb();
    if (db) await resetSyncState(db);
    setState(EMPTY_SYNC_STATE);
    return run(true);
  }, [getDb, run]);

  return { config, loaded, status, message, user, state, syncNow: () => run(true), changed, connect, disconnect, resendAll };
}
