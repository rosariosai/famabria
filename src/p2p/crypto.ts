// Peer-to-peer pairing and encrypted sync bundles. Pure logic on top of WebCrypto: no storage, no DOM, no network.
//
// Pairing (two QR codes, both phones in the same room):
//   A shows an INVITE  (A's public key + a random nonce)
//   B scans it, derives the shared secret with ECDH, shows an ACCEPT (B's public key + a proof only the right secret can make)
//   A scans the ACCEPT, checks the proof. Both phones show the same 6-digit code: the people compare it, then confirm.
// After that each phone keeps the other as a "peer" with a shared secret, and bundles of notes are encrypted with it (AES-GCM).
import { mergeEvents, parseEvents, type CalEvent } from '../core/events';

export type P2PErrorKind = 'unsupported' | 'format' | 'auth' | 'unknown-peer';
export class P2PError extends Error {
  constructor(readonly kind: P2PErrorKind, message: string) { super(message); }
}

const enc = new TextEncoder();
const dec = new TextDecoder();
const subtle = (): SubtleCrypto => {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new P2PError('unsupported', 'Questo browser non permette la crittografia qui: usa l\'indirizzo HTTPS o l\'estensione.');
  return s;
};

export const b64u = {
  enc(b: Uint8Array): string { let s = ''; for (const x of b) s += String.fromCharCode(x); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); },
  dec(s: string): Uint8Array {
    if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new P2PError('format', 'Codice non valido.');
    const t = s.replace(/-/g, '+').replace(/_/g, '/'); const bin = atob(t + '='.repeat((4 - (t.length % 4)) % 4));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  },
};
const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));
const buf = (u: Uint8Array): ArrayBuffer => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;

export interface Identity { id: string; name: string; createdAt: number; pub: string; priv: JsonWebKey }
/** A device we are paired with. `secret` is the shared key material (base64url), never shown or exported. */
export interface Peer { id: string; name: string; pub: string; secret: string; pairedAt: number; lastSyncAt: number | null; confirmed: boolean }

const idOf = async (pubRaw: Uint8Array) => b64u.enc(new Uint8Array(await subtle().digest('SHA-256', buf(pubRaw)))).slice(0, 12);

export async function createIdentity(name: string, now: number): Promise<Identity> {
  const k = await subtle().generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const pub = new Uint8Array(await subtle().exportKey('raw', k.publicKey));
  return { id: await idOf(pub), name: name.trim().slice(0, 40) || 'Telefono', createdAt: now, pub: b64u.enc(pub), priv: await subtle().exportKey('jwk', k.privateKey) };
}

async function hkdf(secret: Uint8Array, salt: Uint8Array, info: string): Promise<Uint8Array> {
  const key = await subtle().importKey('raw', buf(secret), 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await subtle().deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: buf(salt), info: buf(enc.encode(info)) }, key, 256));
}
async function sharedSecret(me: Identity, peerPub: string, salt: Uint8Array): Promise<Uint8Array> {
  const priv = await subtle().importKey('jwk', me.priv, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  const pub = await subtle().importKey('raw', buf(b64u.dec(peerPub)), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const bits = new Uint8Array(await subtle().deriveBits({ name: 'ECDH', public: pub }, priv, 256));
  return hkdf(bits, salt, 'famcal-pair-v1');
}
async function hmac(secret: Uint8Array, info: string, data: string): Promise<Uint8Array> {
  const key = await subtle().importKey('raw', buf(await hkdf(secret, new Uint8Array(0), info)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await subtle().sign('HMAC', key, buf(enc.encode(data))));
}
const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

/** 6 digits both phones show; the two people check that they are equal. */
export async function sasCode(secret: string, idA: string, idB: string): Promise<string> {
  const m = await hmac(b64u.dec(secret), 'sas', [idA, idB].sort().join('|'));
  const n = ((m[0] << 24) | (m[1] << 16) | (m[2] << 8) | m[3]) >>> 0;
  const s = String(n % 1_000_000).padStart(6, '0');
  return `${s.slice(0, 3)} ${s.slice(3)}`;
}

// ---- QR texts ----
interface Invite { v: 1; t: 'inv'; id: string; n: string; k: string; z: string }
interface Accept { v: 1; t: 'acc'; id: string; n: string; k: string; p: string }
const PREFIX = 'famcal:';
const pack = (o: Invite | Accept) => PREFIX + b64u.enc(enc.encode(JSON.stringify(o)));
function unpack(text: string): Invite | Accept {
  const t = text.trim();
  if (!t.startsWith(PREFIX)) throw new P2PError('format', 'Questo non è un codice Famabria.');
  let o: unknown;
  try { o = JSON.parse(dec.decode(b64u.dec(t.slice(PREFIX.length)))); } catch { throw new P2PError('format', 'Codice danneggiato o incompleto.'); }
  const r = (typeof o === 'object' && o !== null ? o : {}) as Record<string, unknown>;
  const str = (x: unknown, max: number) => typeof x === 'string' && x.length > 0 && x.length <= max;
  if (r.v !== 1 || !str(r.id, 20) || !str(r.n, 60) || !str(r.k, 120)) throw new P2PError('format', 'Codice non valido.');
  if (r.t === 'inv' && str(r.z, 40)) return r as unknown as Invite;
  if (r.t === 'acc' && str(r.p, 80)) return r as unknown as Accept;
  throw new P2PError('format', 'Codice non valido.');
}
async function checkId(o: { id: string; k: string }) {
  if ((await idOf(b64u.dec(o.k))) !== o.id) throw new P2PError('auth', 'Il codice non corrisponde al dispositivo.');
}

/** Phone A: step 1. `nonce` must be kept by A until it has read B's answer. */
export function createInvite(me: Identity): { text: string; nonce: string } {
  const nonce = b64u.enc(random(16));
  return { text: pack({ v: 1, t: 'inv', id: me.id, n: me.name, k: me.pub, z: nonce }), nonce };
}

/** Phone B: reads A's invite. Returns the answer to show to A, the new peer (not confirmed yet) and the code to compare. */
export async function acceptInvite(me: Identity, inviteText: string, now: number): Promise<{ text: string; peer: Peer; sas: string }> {
  const inv = unpack(inviteText);
  if (inv.t !== 'inv') throw new P2PError('format', 'Questo è un codice di risposta: qui serve il codice di invito dell\'altro telefono.');
  await checkId(inv);
  if (inv.id === me.id) throw new P2PError('format', 'Questo è il codice di questo stesso telefono.');
  const secret = await sharedSecret(me, inv.k, b64u.dec(inv.z));
  const proof = b64u.enc(await hmac(secret, 'proof', `accept|${inv.z}|${me.id}`));
  const sec = b64u.enc(secret);
  return {
    text: pack({ v: 1, t: 'acc', id: me.id, n: me.name, k: me.pub, p: proof }),
    peer: { id: inv.id, name: inv.n, pub: inv.k, secret: sec, pairedAt: now, lastSyncAt: null, confirmed: false },
    sas: await sasCode(sec, me.id, inv.id),
  };
}

/** Phone A: reads B's answer, checks the proof. Returns the peer (not confirmed yet) and the code to compare. */
export async function finishPairing(me: Identity, nonce: string, answerText: string, now: number): Promise<{ peer: Peer; sas: string }> {
  const acc = unpack(answerText);
  if (acc.t !== 'acc') throw new P2PError('format', 'Questo è un codice di invito: qui serve il codice di risposta.');
  await checkId(acc);
  const secret = await sharedSecret(me, acc.k, b64u.dec(nonce));
  const expected = await hmac(secret, 'proof', `accept|${nonce}|${acc.id}`);
  if (!sameBytes(expected, b64u.dec(acc.p))) throw new P2PError('auth', 'La risposta non è per questo invito. Ricomincia dall\'inizio.');
  const sec = b64u.enc(secret);
  return { peer: { id: acc.id, name: acc.n, pub: acc.k, secret: sec, pairedAt: now, lastSyncAt: null, confirmed: false }, sas: await sasCode(sec, me.id, acc.id) };
}

// ---- encrypted bundles of notes ----
async function gzip(data: Uint8Array): Promise<Uint8Array> {
  const s = new Blob([buf(data)]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
async function gunzip(data: Uint8Array): Promise<Uint8Array> {
  const s = new Blob([buf(data)]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
const aesKey = async (secret: string, usage: KeyUsage, info = 'famcal-bundle-v1') => subtle().importKey('raw', buf(await hkdf(b64u.dec(secret), new Uint8Array(0), info)), 'AES-GCM', false, [usage]);

/** Small authenticated, compressed, encrypted envelope (signalling texts, family mailbox objects). `info` keeps the keys for different uses apart. */
export async function sealWith(secret: string, info: string, aad: string, obj: unknown): Promise<{ iv: string; data: string }> {
  const iv = random(12);
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv: buf(iv), additionalData: buf(enc.encode(aad)) }, await aesKey(secret, 'encrypt', info), buf(await gzip(enc.encode(JSON.stringify(obj))))));
  return { iv: b64u.enc(iv), data: b64u.enc(ct) };
}
export async function openWith(secret: string, info: string, aad: string, iv: string, data: string): Promise<unknown> {
  try {
    const plain = await gunzip(new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: buf(b64u.dec(iv)), additionalData: buf(enc.encode(aad)) }, await aesKey(secret, 'decrypt', info), buf(b64u.dec(data)))));
    return JSON.parse(dec.decode(plain));
  } catch { throw new P2PError('auth', 'Il contenuto non è autentico o è danneggiato.'); }
}
export const sealJson = (secret: string, aad: string, obj: unknown) => sealWith(secret, 'famcal-signal-v1', aad, obj);
export const openJson = (secret: string, aad: string, iv: string, data: string) => openWith(secret, 'famcal-signal-v1', aad, iv, data);
/** 32 random bytes as base64url: a family key or a relay token. */
export const randomSecret = () => b64u.enc(random(32));
export const sha256b64u = async (text: string) => b64u.enc(new Uint8Array(await subtle().digest('SHA-256', buf(enc.encode(text)))));

export const BUNDLE_MAX_BYTES = 8 * 1024 * 1024;

/** A text file (JSON) holding all notes, readable only by `peer`. Safe to send through any channel (share sheet, e-mail, chat, USB). */
export async function encryptBundle(me: Identity, peer: Peer, events: CalEvent[], now: number): Promise<string> {
  const iv = random(12);
  const plain = await gzip(enc.encode(JSON.stringify({ sentAt: now, events })));
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv: buf(iv), additionalData: buf(enc.encode(`${me.id}>${peer.id}`)) }, await aesKey(peer.secret, 'encrypt'), buf(plain)));
  return JSON.stringify({ famcal: 1, from: me.id, to: peer.id, iv: b64u.enc(iv), data: b64u.enc(ct) });
}

export async function decryptBundle(me: Identity, peers: Peer[], fileText: string): Promise<{ peer: Peer; events: CalEvent[]; dropped: number; sentAt: number }> {
  if (fileText.length > BUNDLE_MAX_BYTES) throw new P2PError('format', 'Il file è troppo grande.');
  let h: { famcal?: unknown; from?: unknown; to?: unknown; iv?: unknown; data?: unknown };
  try { h = JSON.parse(fileText); } catch { throw new P2PError('format', 'Questo non è un file di sincronizzazione Famabria.'); }
  if (h.famcal !== 1 || typeof h.from !== 'string' || typeof h.to !== 'string' || typeof h.iv !== 'string' || typeof h.data !== 'string') throw new P2PError('format', 'Questo non è un file di sincronizzazione Famabria.');
  if (h.to !== me.id) throw new P2PError('unknown-peer', 'Questo file è per un altro telefono.');
  const peer = peers.find((p) => p.id === h.from);
  if (!peer) throw new P2PError('unknown-peer', 'Questo file viene da un telefono con cui non sei collegato.');
  let plain: Uint8Array;
  try {
    plain = await gunzip(new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: buf(b64u.dec(h.iv)), additionalData: buf(enc.encode(`${peer.id}>${me.id}`)) }, await aesKey(peer.secret, 'decrypt'), buf(b64u.dec(h.data)))));
  } catch { throw new P2PError('auth', 'Il file è danneggiato o non è autentico.'); }
  const o = JSON.parse(dec.decode(plain)) as { sentAt?: unknown; events?: unknown };
  const { events, dropped } = parseEvents(o.events);
  return { peer, events, dropped, sentAt: typeof o.sentAt === 'number' ? o.sentAt : 0 };
}

/** Same merge rule as server sync: per note, the newest edit wins; deletions travel as tombstones. */
export const applyBundle = (local: CalEvent[], incoming: CalEvent[]) => mergeEvents(local, incoming);

// ---- QR matrix <-> text (generation uses qrcode-generator; reading uses jsQR in the scanner component) ----
import qrcode from 'qrcode-generator';
/** Black/white modules of a QR code for `text` (true = dark). Error correction L keeps the code small enough to scan from a phone screen. */
export function qrMatrix(text: string): boolean[][] {
  const q = qrcode(0, 'L'); q.addData(text, 'Byte'); q.make();
  const n = q.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => q.isDark(r, c)));
}
