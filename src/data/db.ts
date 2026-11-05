// The ONLY module that touches storage. IndexedDB via `idb`. Calendar-only (no bookmarks, groups, tags or images).
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { SyncConfig, SyncState } from '../sync/engine';
import { DEFAULT_CAL_SETTINGS, parseCalSettings, type CalEvent, type CalSettings } from '../core/events';

interface Schema extends DBSchema {
  meta: { key: string; value: unknown };
  events: { key: string; value: CalEvent; indexes: { date: string } };
}

export type Db = IDBPDatabase<Schema>;

export function openDb(name = 'famcal'): Promise<Db> {
  return openDB<Schema>(name, 1, {
    upgrade(db) {
      db.createObjectStore('meta');
      db.createObjectStore('events', { keyPath: 'id' }).createIndex('date', 'date');
    },
  });
}

// ---- calendar entries (notes/events) and calendar settings ----
export const getAllEvents = (db: Db) => db.getAll('events');
export const putEvent = (db: Db, e: CalEvent) => db.put('events', e);
export async function putEvents(db: Db, list: CalEvent[]): Promise<void> {
  const tx = db.transaction('events', 'readwrite');
  for (const e of list) tx.store.put(e);
  await tx.done;
}
/** Used by "replace everything" restore. */
export async function replaceEvents(db: Db, list: CalEvent[]): Promise<void> {
  const tx = db.transaction('events', 'readwrite');
  await tx.store.clear();
  for (const e of list) tx.store.put(e);
  await tx.done;
}
export async function getCalSettings(db: Db): Promise<CalSettings> {
  return { ...DEFAULT_CAL_SETTINGS, ...parseCalSettings(await db.get('meta', 'calendar-settings')) };
}
export const saveCalSettings = (db: Db, s: CalSettings) => db.put('meta', s, 'calendar-settings');

// ---- sync. The token lives only here, in this browser; it is never put in backups. ----
export const getSyncConfig = (db: Db) => db.get('meta', 'sync-config') as Promise<SyncConfig | undefined>;
export const saveSyncConfig = (db: Db, c: SyncConfig) => db.put('meta', c, 'sync-config');
export const clearSyncConfig = async (db: Db) => { await db.delete('meta', 'sync-config'); await db.delete('meta', 'sync-state'); };
export const getSyncState = (db: Db) => db.get('meta', 'sync-state') as Promise<SyncState | undefined>;
export const saveSyncState = (db: Db, s: SyncState) => db.put('meta', s, 'sync-state');
export const resetSyncState = (db: Db) => db.delete('meta', 'sync-state');

// ---- phone-to-phone sharing (no server): this device's identity and the devices it is paired with. Stays in this browser. ----
import type { Identity, Peer } from '../p2p/crypto';
export const getIdentity = (db: Db) => db.get('meta', 'p2p-identity') as Promise<Identity | undefined>;
export const saveIdentity = (db: Db, i: Identity) => db.put('meta', i, 'p2p-identity');
export async function getPeers(db: Db): Promise<Peer[]> { return ((await db.get('meta', 'p2p-peers')) as Peer[] | undefined) ?? []; }
export const savePeers = (db: Db, p: Peer[]) => db.put('meta', p, 'p2p-peers');

// ---- family mailbox (invite-link sync). The key and the relay token live only in this browser. ----
import type { Family, FamilyState } from '../cloud/family';
export const getFamily = (db: Db) => db.get('meta', 'family') as Promise<Family | undefined>;
export const saveFamily = (db: Db, f: Family) => db.put('meta', f, 'family');
export const getFamilyState = (db: Db) => db.get('meta', 'family-state') as Promise<FamilyState | undefined>;
export const saveFamilyState = (db: Db, s: FamilyState) => db.put('meta', s, 'family-state');
export const clearFamily = async (db: Db) => { await db.delete('meta', 'family'); await db.delete('meta', 'family-state'); };
