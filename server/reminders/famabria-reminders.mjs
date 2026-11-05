#!/usr/bin/env node
// Famabria reminders for the home server: reads the family's encrypted notes from the relay (Cloudflare or home) and sends the
// reminders to a ntfy server. It joins the family as a READ-ONLY device: it never writes anything to the relay.
// No dependencies, Node 18+.   Settings come from environment variables (see docs/REMINDERS.md):
//   FAMABRIA_INVITE (or the older name FAMCAL_INVITE)  the invite link. New (v2) families: "Famiglia > Invito per il server di casa" (one-time link: the script uses it once, then keeps its own
//                  read-only credentials in STATE_FILE, so keep that file). Old families: the permanent link from "Famiglia > Invita".
//   NTFY_URL       e.g. http://192.168.0.10:7200      NTFY_TOPIC  long random name      NTFY_TOKEN  optional (if ntfy needs a login)
//   CHECK_MINUTES  how often it reads the notes and sends what is due, default 60      STATE_FILE  default ./famcal-reminders-state.json      TZ  e.g. Europe/Rome (time of the notes)
//   node famabria-reminders.mjs --test   sends one test notification and exits
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const INFO = 'famcal-family-v1';
const enc = new TextEncoder();
const unb64u = (s) => { const t = s.replace(/-/g, '+').replace(/_/g, '/'); return Uint8Array.from(atob(t + '='.repeat((4 - (t.length % 4)) % 4)), (c) => c.charCodeAt(0)); };
const b64u = (u) => btoa(String.fromCharCode(...u)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function parseInvite(text) {
  const m = /join=([A-Za-z0-9_-]{20,4000})/.exec(text) ?? /^([A-Za-z0-9_-]{20,4000})$/.exec(text.trim());
  if (!m) throw new Error('FAMABRIA_INVITE non è un invito Famabria (deve contenere #join=...)');
  const o = JSON.parse(new TextDecoder().decode(unb64u(m[1])));
  if (o.v !== 1 || typeof o.id !== 'string' || typeof o.k !== 'string' || o.p?.type !== 'relay') throw new Error('Invito non valido o non basato su relay (Dropbox non è supportato da questo script)');
  return { id: o.id, name: o.n, key: o.k, url: String(o.p.url).replace(/\/+$/, ''), token: o.p.token };
}

const hkdfBits = async (secret, info) => crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: enc.encode(info) }, await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveBits']), 256);
async function openSealed(secretB64u, info, aad, iv, data) {
  const key = await crypto.subtle.importKey('raw', await hkdfBits(unb64u(secretB64u), info), 'AES-GCM', false, ['decrypt']);
  const gz = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64u(iv), additionalData: enc.encode(aad) }, key, unb64u(data));
  const plain = await new Response(new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  return JSON.parse(new TextDecoder().decode(plain));
}
async function openObject(fam, name, bytes) {
  const h = JSON.parse(new TextDecoder().decode(bytes));
  return (await openSealed(fam.key, INFO, `${fam.id}|${name}`, h.iv, h.data)).events ?? [];
}

// ---- v2 families: one-time invite -> this script's own read-only device (see src/cloud/v2.ts) ----
export const isInviteV2 = (text) => /invite=[A-Za-z0-9_-]{20,}/.test(text);
export async function redeemInviteV2(text, fetcher = fetch) {
  const m = /invite=([A-Za-z0-9_-]{20,4000})/.exec(text);
  const o = JSON.parse(new TextDecoder().decode(unb64u(m[1])));
  if (o.v !== 2 || typeof o.u !== 'string' || typeof o.f !== 'string' || typeof o.t !== 'string' || typeof o.s !== 'string') throw new Error('Invito non valido');
  const url = o.u.replace(/\/+$/, '');
  const auth = b64u(new Uint8Array(await hkdfBits(unb64u(o.s), 'famcal-invite-auth-v2')));
  const r = await fetcher(`${url}/v1/f/${o.f}/invites/${o.t}/redeem`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ auth }) });
  if (r.status === 403) throw new Error('Invito scaduto, già usato o non valido: creane uno nuovo (Famiglia > Invito per il server di casa)');
  if (!r.ok) throw new Error(`Il relay ha risposto ${r.status}`);
  const j = await r.json(); const w = JSON.parse(j.blob);
  const k = await openSealed(o.s, 'famcal-invite-wrap-v2', `invite|${o.f}`, w.iv, w.data);
  return { id: k.id, name: k.n, key: k.k, url, family: o.f, device: j.device, token: j.token };
}
const tokenExp = (t) => { try { return JSON.parse(new TextDecoder().decode(unb64u(t.split('.')[1]))).e * 1000; } catch { return 0; } };

// ---- when does a reminder fire (same rules as the app: src/core/reminders.ts) ----
const at = (date, hh, mm, shift = 0) => new Date(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)) + shift, hh, mm, 0, 0).getTime();
export function reminderAt(e) {
  const k = e.remind ?? 'none';
  if (k === 'none' || (e.deletedAt ?? null) !== null || typeof e.date !== 'string') return null;
  if (k === '1d') return at(e.date, 18, 0, -1);
  if (!e.time) return k === 'at' ? at(e.date, 9, 0) : null;
  const [h, m] = e.time.split(':').map(Number);
  const base = at(e.date, h, m);
  return k === 'at' ? base : k === '10m' ? base - 600_000 : k === '1h' ? base - 3_600_000 : null;
}
const whenText = (e) => { const d = `${e.date.slice(8, 10)}/${e.date.slice(5, 7)}`; return e.time ? `${d} alle ${e.time}` : `${d}, tutto il giorno`; };

export function createService({ invite, ntfyUrl, topic, ntfyToken = '', fetcher = fetch, now = Date.now, load = () => ({}), save = () => {}, log = console.log }) {
  const state = { since: now() - 120_000, fired: {}, ...load() };
  let fam = null; // { id, key, url, token, family? }  (family set = v2)
  const cache = new Map(); // object name -> { rev, events }

  async function family() {
    if (fam) return fam;
    if (state.v2) fam = state.v2;                                           // already redeemed: use the saved read-only device
    else if (isInviteV2(invite)) { fam = state.v2 = await redeemInviteV2(invite, fetcher); save(state); log('Invito monouso usato: credenziali di sola lettura salvate nel file di stato.'); }
    else if (!invite) throw new Error('Manca FAMABRIA_INVITE (e nel file di stato non ci sono credenziali salvate)');
    else fam = parseInvite(invite);
    return fam;
  }
  async function renewIfNeeded(f) {
    if (!f.family || tokenExp(f.token) - now() > 30 * 86_400_000) return;
    try {
      const r = await fetcher(`${f.url}/v1/f/${f.family}/token/refresh`, { method: 'POST', headers: { authorization: `Bearer ${f.token}` } });
      if (r.ok) { f.token = (await r.json()).token; save(state); log('Token rinnovato.'); }
    } catch { /* retry next round */ }
  }
  let room = null;
  const call = async (path) => {
    const f = await family();
    await renewIfNeeded(f);
    let url, headers;
    if (f.family) { url = `${f.url}/v1/f/${f.family}/objects${path}`; headers = { authorization: `Bearer ${f.token}` }; }
    else { room ??= b64u(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(f.token)))).slice(0, 22); url = `${f.url}/r/${room}${path}`; headers = { authorization: `Bearer ${f.token}` }; }
    const r = await fetcher(url, { headers, cache: 'no-store' });
    if (r.status === 401) throw new Error('Il relay non accetta questo invito');
    if (!r.ok && r.status !== 404) throw new Error(`Il relay ha risposto ${r.status}`);
    return r;
  };

  async function readEvents() {
    const listing = await (await call('')).json();
    const names = new Set();
    for (const o of listing) {
      if (!/^d-[A-Za-z0-9_-]+\.fc$/.test(o.name)) continue;
      names.add(o.name);
      if (cache.get(o.name)?.rev === o.rev) continue;
      try {
        const r = await call(`/${o.name}`); if (r.status === 404) continue;
        cache.set(o.name, { rev: o.rev, events: await openObject(await family(), o.name, new Uint8Array(await r.arrayBuffer())) });
      } catch (e) { log(`oggetto ${o.name} ignorato: ${e.message}`); }
    }
    for (const k of [...cache.keys()]) if (!names.has(k)) cache.delete(k);
    const merged = new Map(); // newest edit of each note wins, same as the app
    for (const { events } of cache.values()) for (const e of events) { const c = merged.get(e.id); if (!c || (e.updatedAt ?? 0) > (c.updatedAt ?? 0)) merged.set(e.id, e); }
    return [...merged.values()];
  }

  async function notify(title, message) {
    const r = await fetcher(ntfyUrl.replace(/\/+$/, ''), {
      method: 'POST', headers: { 'content-type': 'application/json', ...(ntfyToken ? { authorization: `Bearer ${ntfyToken}` } : {}) },
      body: JSON.stringify({ topic, title, message, priority: 4, tags: ['alarm_clock'] }),
    });
    if (!r.ok) throw new Error(`ntfy ha risposto ${r.status}`);
  }

  /** One round: read the notes, send what is due. Returns how many reminders were sent. */
  let events = []; let loaded = false;
  async function tick(refresh = true) {
    const t = now();
    if (refresh || !loaded) { events = await readEvents(); loaded = true; log(`note lette: ${events.length}, con promemoria: ${events.filter((e) => (e.remind ?? "none") !== "none").length} ${JSON.stringify(events.filter((e) => (e.remind ?? "none") !== "none").map((e) => [e.date, e.time, e.remind, e.deletedAt, reminderAt(e)]))}`); }
    let sent = 0;
    for (const e of events) {
      const when = reminderAt(e);
      if (when === null || when > t || when <= Math.max(state.since, t - 6 * 3_600_000)) continue;
      const id = `${e.id}@${when}`;
      if (state.fired[id]) continue;
      try { await notify(`Promemoria: ${e.title}`, whenText(e)); } catch (err) { log(`invio fallito (riprovo): ${err.message}`); continue; }
      state.fired[id] = t; sent++; log(`inviato: ${e.title} (${whenText(e)})`);
    }
    for (const k of Object.keys(state.fired)) if (t - state.fired[k] > 3 * 86_400_000) delete state.fired[k];
    save(state);
    return sent;
  }
  return { tick, notify, state };
}

// ---- command line ----
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const env = process.env;
  const need = (k) => env[k] || (console.error(`Manca la variabile ${k}`), process.exit(2));
  const file = env.STATE_FILE || './famabria-reminders-state.json';
  const svc = createService({
    invite: env.FAMABRIA_INVITE || env.FAMCAL_INVITE || '', ntfyUrl: need('NTFY_URL'), topic: need('NTFY_TOPIC'), ntfyToken: env.NTFY_TOKEN || '',
    log: (m) => console.log(`${new Date().toISOString()} ${m}`),
    load: () => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return {}; } },
    save: (s) => { try { writeFileSync(`${file}.tmp`, JSON.stringify(s)); renameSync(`${file}.tmp`, file); } catch (e) { console.error(`stato non salvato: ${e.message}`); } },
  });
  if (process.argv.includes('--test')) { await svc.notify('Famabria', 'Prova: i promemoria arriveranno così.'); console.log('Notifica di prova inviata.'); process.exit(0); }
  const every = Math.max(5, Number(env.CHECK_MINUTES) || 60) * 60_000;
  console.log(`Famabria promemoria attivo (controllo ogni ${every / 60_000} min, fuso ${Intl.DateTimeFormat().resolvedOptions().timeZone}).`);
  for (;;) {
    try { await svc.tick(); } catch (e) { console.error(`${new Date().toISOString()} errore: ${e.message}`); }
    await new Promise((r) => setTimeout(r, every));
  }
}
