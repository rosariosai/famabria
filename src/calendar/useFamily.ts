import { useCallback, useEffect, useRef, useState } from 'react';
import { clearFamily, getAllEvents, getFamily, getFamilyState, putEvents, saveFamily, saveFamilyState, type Db } from '../data/db';
import { EMPTY_FAMILY_STATE, joinFamily, mailboxOf, newFamily, newFamilyWith, syncFamily, type Family, type FamilyState, type ProviderConfig } from '../cloud/family';
import { MailboxError } from '../cloud/mailbox';
import { createFamilyV2, isInviteV2, redeemInviteV2, renewTokenIfNeeded } from '../cloud/v2';
import type { CalendarDef } from '../core/events';

export type FamilyStatus = 'off' | 'idle' | 'syncing' | 'ok' | 'unreachable' | 'auth' | 'server';
const EVERY_MS = 5 * 60_000, MIN_GAP_MS = 15_000;

/** Keeps the calendar in step with the family mailbox: on open, when the tab returns, every few minutes, and shortly after an edit. */
export function useFamily(ready: boolean, getDb: () => Db | null, onPulled: () => void, getMembers: () => CalendarDef[] = () => [], onMembers: (m: CalendarDef[]) => void = () => undefined) {
  const [family, setFamily] = useState<Family | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<FamilyStatus>('off');
  const [message, setMessage] = useState('');
  const [devices, setDevices] = useState<string[]>([]);
  const [deviceInfo, setDeviceInfo] = useState<{ id: string; name: string }[]>([]);
  const [state, setState] = useState<FamilyState>(EMPTY_FAMILY_STATE);
  const ref = useRef<Family | null>(null), stRef = useRef<FamilyState>(EMPTY_FAMILY_STATE);
  const last = useRef(0), timer = useRef<number>(), busy = useRef(false);

  const run = useCallback(async (force = false): Promise<boolean> => {
    const db = getDb(), f = ref.current;
    if (!db || !f || busy.current) return false;
    if (!force && Date.now() - last.current < MIN_GAP_MS) return false;
    busy.current = true; last.current = Date.now(); setStatus('syncing'); setMessage('');
    try {
      const fresh = await renewTokenIfNeeded(f, Date.now()); // keeps the device token alive (renewed when < 15 days are left)
      if (fresh) { ref.current = fresh; setFamily(fresh); await saveFamily(db, fresh); }
      const cur = ref.current ?? f;
      const local = await getAllEvents(db);
      const r = await syncFamily(cur, mailboxOf(cur), local, stRef.current, Date.now(), getMembers());
      if (r.members.length) onMembers(r.members);
      if (r.changed.length) await putEvents(db, r.changed);
      stRef.current = r.state; setState(r.state); await saveFamilyState(db, r.state);
      setDevices(r.devices); setDeviceInfo(r.deviceInfo); setStatus('ok');
      setMessage(r.changed.length ? `Ricevute ${r.changed.length} modifiche.` : 'Tutto aggiornato.');
      if (r.changed.length) onPulled();
      return true;
    } catch (e) {
      const k = e instanceof MailboxError ? e.kind : 'server';
      setStatus(k); setMessage(e instanceof MailboxError ? e.message : 'Qualcosa è andato storto durante la sincronizzazione.');
      return false;
    } finally { busy.current = false; }
  }, [getDb, onPulled, getMembers, onMembers]);

  useEffect(() => {
    if (!ready) return;
    const db = getDb(); if (!db) return;
    void (async () => {
      const [f, st] = await Promise.all([getFamily(db), getFamilyState(db)]);
      stRef.current = st ?? EMPTY_FAMILY_STATE; setState(stRef.current);
      ref.current = f ?? null; setFamily(f ?? null); setLoaded(true);
      if (f) { setStatus('idle'); void run(true); }
    })();
  }, [ready, getDb, run]);

  useEffect(() => {
    if (!family) return;
    const onVisible = () => { if (document.visibilityState === 'visible') void run(); };
    document.addEventListener('visibilitychange', onVisible); window.addEventListener('online', onVisible);
    const id = window.setInterval(() => { if (document.visibilityState === 'visible') void run(true); }, EVERY_MS);
    return () => { document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('online', onVisible); window.clearInterval(id); };
  }, [family, run]);

  const changed = useCallback(() => {
    if (!ref.current) return;
    window.clearTimeout(timer.current); timer.current = window.setTimeout(() => void run(true), 2500);
  }, [run]);

  const adopt = useCallback(async (f: Family) => {
    const db = getDb(); if (!db) throw new Error('storage');
    await saveFamily(db, f); await saveFamilyState(db, EMPTY_FAMILY_STATE);
    ref.current = f; stRef.current = EMPTY_FAMILY_STATE; setFamily(f); setState(EMPTY_FAMILY_STATE); setStatus('idle');
    const ok = await run(true);
    if (!ok) { await clearFamily(db); ref.current = null; setFamily(null); setStatus('off'); throw new MailboxError('unreachable', 'Non riesco a raggiungere il servizio scelto: controlla indirizzo e connessione.'); }
  }, [getDb, run]);

  const create = useCallback(async (name: string, relayUrl: string, deviceName: string) => adopt((await createFamilyV2(name, relayUrl, deviceName, Date.now())) ?? newFamily(name, relayUrl, deviceName, Date.now())), [adopt]); // new families use the one-time-invite relay API when the relay has it
  const createWith = useCallback((name: string, provider: ProviderConfig, deviceName: string) => adopt(newFamilyWith(name, provider, deviceName, Date.now())), [adopt]);
  /** Moves this device from an old (permanent-link) family to a new v2 family on the same relay. Notes stay on the device and are sent to the new family. */
  const migrate = useCallback(async () => {
    const f = ref.current;
    if (!f || f.provider.type !== 'relay') throw new MailboxError('server', 'Questa famiglia è già della nuova versione.');
    const v2 = await createFamilyV2(f.name, f.provider.url, f.deviceName, Date.now());
    if (!v2) throw new MailboxError('server', 'Il relay non supporta ancora la nuova versione: pubblica prima il relay aggiornato.');
    await adopt(v2);
  }, [adopt]);
  const join = useCallback(async (text: string, deviceName: string) => adopt(isInviteV2(text) ? await redeemInviteV2(text, deviceName, Date.now()) : joinFamily(text, deviceName, Date.now())), [adopt]);
  const leave = useCallback(async () => {
    const db = getDb(); if (db) await clearFamily(db);
    ref.current = null; setFamily(null); setStatus('off'); setMessage(''); setDevices([]); setState(EMPTY_FAMILY_STATE);
  }, [getDb]);

  /** Changes the family's display name on this device only (the name lives in each device's own copy; new invites carry it). */
  const rename = useCallback(async (name: string) => {
    const db = getDb(), f = ref.current, nm = name.trim().slice(0, 40);
    if (!db || !f || !nm) return;
    const next = { ...f, name: nm }; ref.current = next; setFamily(next); await saveFamily(db, next);
  }, [getDb]);

  /** Changes this device's name (shown to the others in the device list; it travels with the next sync). */
  const renameDevice = useCallback(async (name: string) => {
    const db = getDb(), f = ref.current, nm = name.trim().slice(0, 40);
    if (!db || !f || !nm) return;
    const next = { ...f, deviceName: nm }; ref.current = next; setFamily(next); await saveFamily(db, next);
    last.current = 0; void run(true);
  }, [getDb, run]);

  return { renameDevice, rename, family, loaded, status, message, devices, deviceInfo, state, syncNow: () => run(true), changed, create, createWith, join, migrate, leave };
}
