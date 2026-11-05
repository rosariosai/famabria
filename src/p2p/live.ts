// Live phone-to-phone sync: a WebRTC data channel set up with two QR codes (no server), then both phones exchange their notes.
// Signalling texts are encrypted with the secret of the pairing, so only the paired phone can read them and nobody can forge them.
import { mergeEvents, parseEvents, type CalEvent } from '../core/events';
import { b64u, openJson, P2PError, sealJson, type Identity, type Peer } from './crypto';

const LIVE_PREFIX = 'famcal-live:';
const SIGNAL_MAX_AGE_MS = 10 * 60 * 1000;
const enc = new TextEncoder(); const dec = new TextDecoder();

export type SignalKind = 'offer' | 'answer';

export async function sealSignal(me: Identity, peer: Peer, kind: SignalKind, sdp: string, now: number): Promise<string> {
  const sealed = await sealJson(peer.secret, `${me.id}>${peer.id}|${kind}`, { kind, sdp, at: now });
  return LIVE_PREFIX + b64u.enc(enc.encode(JSON.stringify({ v: 1, k: kind, from: me.id, to: peer.id, ...sealed })));
}

export async function openSignal(me: Identity, peers: Peer[], text: string, now: number): Promise<{ peer: Peer; kind: SignalKind; sdp: string }> {
  const t = text.trim();
  if (t.startsWith('famcal:')) throw new P2PError('format', 'Questo è un codice di collegamento, non di sincronizzazione. Qui serve il codice «live» dell\'altro telefono.');
  if (!t.startsWith(LIVE_PREFIX)) throw new P2PError('format', 'Questo non è un codice di sincronizzazione Famabria.');
  let h: { v?: unknown; k?: unknown; from?: unknown; to?: unknown; iv?: unknown; data?: unknown };
  try { h = JSON.parse(dec.decode(b64u.dec(t.slice(LIVE_PREFIX.length)))); } catch { throw new P2PError('format', 'Codice danneggiato o incompleto.'); }
  if (h.v !== 1 || (h.k !== 'offer' && h.k !== 'answer') || typeof h.from !== 'string' || typeof h.to !== 'string' || typeof h.iv !== 'string' || typeof h.data !== 'string') throw new P2PError('format', 'Codice non valido.');
  if (h.to !== me.id) throw new P2PError('unknown-peer', 'Questo codice è per un altro telefono.');
  const peer = peers.find((p) => p.id === h.from);
  if (!peer) throw new P2PError('unknown-peer', 'Questo codice viene da un telefono con cui non sei collegato.');
  const o = (await openJson(peer.secret, `${peer.id}>${me.id}|${h.k}`, h.iv, h.data)) as { kind?: unknown; sdp?: unknown; at?: unknown };
  if (o.kind !== h.k || typeof o.sdp !== 'string' || typeof o.at !== 'number' || o.sdp.length > 20000) throw new P2PError('format', 'Codice non valido.');
  if (now - o.at > SIGNAL_MAX_AGE_MS || o.at - now > 2 * 60 * 1000) throw new P2PError('auth', 'Il codice è scaduto. Ricominciate: i codici valgono 10 minuti.');
  return { peer, kind: h.k, sdp: o.sdp };
}

// ---- exchanging notes over any message channel (a WebRTC data channel in the app, a fake pair in tests) ----
export interface Channel { send(s: string): void; onMessage(cb: (s: string) => void): void; onClose(cb: () => void): void; close(): void }
const CHUNK = 12_000;
const MAX_RECEIVE = 8 * 1024 * 1024;

/** Both phones call this when the channel is open: each sends all its notes and receives the other's. */
export function exchangeNotes(ch: Channel, local: CalEvent[], timeoutMs = 30_000): Promise<{ events: CalEvent[]; dropped: number }> {
  return new Promise((resolve, reject) => {
    let got = ''; let finished = false;
    const timer = setTimeout(() => fail(new P2PError('format', 'Tempo scaduto: l\'altro telefono non ha risposto.')), timeoutMs);
    const fail = (e: Error) => { if (finished) return; finished = true; clearTimeout(timer); reject(e); };
    ch.onClose(() => { if (!finished) fail(new P2PError('format', 'Il collegamento si è interrotto.')); });
    ch.onMessage((raw) => {
      try {
        const m = JSON.parse(raw) as { k?: string; d?: string };
        if (m.k === 'c' && typeof m.d === 'string') { got += m.d; if (got.length > MAX_RECEIVE) throw new Error('too big'); }
        else if (m.k === 'e') {
          const p = parseEvents((JSON.parse(got) as { events?: unknown }).events);
          finished = true; clearTimeout(timer); resolve(p);
        }
      } catch { fail(new P2PError('format', 'Dati non validi dall\'altro telefono.')); }
    });
    const payload = JSON.stringify({ events: local });
    for (let i = 0; i < payload.length; i += CHUNK) ch.send(JSON.stringify({ k: 'c', d: payload.slice(i, i + CHUNK) }));
    ch.send(JSON.stringify({ k: 'e' }));
  });
}

export const mergeLive = (local: CalEvent[], incoming: CalEvent[]) => mergeEvents(local, incoming);

// ---- WebRTC (browser only) ----
export interface LiveOptions { stun: boolean }
export interface LiveHandle { cancel(): void }

const rtcConfig = (o: LiveOptions): RTCConfiguration => ({ iceServers: o.stun ? [{ urls: 'stun:stun.l.google.com:19302' }] : [] });
async function gathered(pc: RTCPeerConnection): Promise<string> {
  if (pc.iceGatheringState !== 'complete') {
    await new Promise<void>((res) => {
      const check = () => { if (pc.iceGatheringState === 'complete') { pc.removeEventListener('icegatheringstatechange', check); res(); } };
      pc.addEventListener('icegatheringstatechange', check);
      setTimeout(() => { pc.removeEventListener('icegatheringstatechange', check); res(); }, 4000);
    });
  }
  return pc.localDescription!.sdp;
}
function wrap(dc: RTCDataChannel): Channel {
  return { send: (s) => dc.send(s), onMessage: (cb) => { dc.onmessage = (e) => cb(String(e.data)); }, onClose: (cb) => { dc.onclose = cb; }, close: () => dc.close() };
}
const opened = (dc: RTCDataChannel, ms = 25_000) => new Promise<void>((res, rej) => {
  if (dc.readyState === 'open') return res();
  const t = setTimeout(() => rej(new P2PError('format', 'Non riesco a collegarmi all\'altro telefono. Controllate che siano sulla stessa rete Wi-Fi (non «ospiti») oppure attivate l\'opzione STUN.')), ms);
  dc.onopen = () => { clearTimeout(t); res(); };
});

/** Phone A. `offerText` goes into a QR; `finish(answerText)` takes B's answer and runs the exchange. */
export async function startLive(me: Identity, peer: Peer, local: () => Promise<CalEvent[]>, opts: LiveOptions, now = () => Date.now()) {
  const pc = new RTCPeerConnection(rtcConfig(opts));
  const dc = pc.createDataChannel('famcal');
  await pc.setLocalDescription(await pc.createOffer());
  const offerText = await sealSignal(me, peer, 'offer', await gathered(pc), now());
  const handle: LiveHandle = { cancel: () => { try { dc.close(); pc.close(); } catch { /* already closed */ } } };
  const finish = async (answerText: string) => {
    try {
      const a = await openSignal(me, [peer], answerText, now());
      if (a.kind !== 'answer') throw new P2PError('format', 'Questo è un codice di invito: qui serve la risposta dell\'altro telefono.');
      await pc.setRemoteDescription({ type: 'answer', sdp: a.sdp });
      await opened(dc);
      return await exchangeNotes(wrap(dc), await local());
    } finally { setTimeout(handle.cancel, 1500); }
  };
  return { offerText, finish, handle };
}

/** Phone B. Reads A's offer and returns the answer QR text; `result` resolves after the exchange. */
export async function answerLive(me: Identity, peers: Peer[], offerText: string, local: () => Promise<CalEvent[]>, opts: LiveOptions, now = () => Date.now()) {
  const o = await openSignal(me, peers, offerText, now());
  if (o.kind !== 'offer') throw new P2PError('format', 'Questo è una risposta: qui serve il codice dell\'altro telefono.');
  const pc = new RTCPeerConnection(rtcConfig(opts));
  const dcReady = new Promise<RTCDataChannel>((res) => { pc.ondatachannel = (e) => res(e.channel); });
  await pc.setRemoteDescription({ type: 'offer', sdp: o.sdp });
  await pc.setLocalDescription(await pc.createAnswer());
  const answerText = await sealSignal(me, o.peer, 'answer', await gathered(pc), now());
  const handle: LiveHandle = { cancel: () => { try { pc.close(); } catch { /* already closed */ } } };
  const result = (async () => {
    try { const dc = await dcReady; await opened(dc); return await exchangeNotes(wrap(dc), await local()); }
    finally { setTimeout(handle.cancel, 1500); }
  })();
  result.catch(() => undefined);
  return { peer: o.peer, answerText, result, handle };
}
