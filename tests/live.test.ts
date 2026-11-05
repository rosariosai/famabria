import { describe, expect, it } from 'vitest';
import { acceptInvite, createIdentity, createInvite, finishPairing } from '../src/p2p/crypto';
import { exchangeNotes, mergeLive, openSignal, sealSignal, type Channel } from '../src/p2p/live';
import { cleanEntry, createEvent, type CalEvent } from '../src/core/events';

const note = (id: string, title: string, at: number, notes = ''): CalEvent => { const c = cleanEntry({ date: '2026-11-05', title, notes }); if (!c.ok) throw new Error('x'); return createEvent(c.value, id, at); };
async function paired() {
  const a = await createIdentity('A', 1); const b = await createIdentity('B', 1);
  const inv = createInvite(a); const acc = await acceptInvite(b, inv.text, 1); const fin = await finishPairing(a, inv.nonce, acc.text, 1);
  return { a, b, pa: fin.peer, pb: acc.peer };
}
function link(): [Channel, Channel] {
  const mk = () => { let cb: (s: string) => void = () => undefined; let close: () => void = () => undefined; return { get cb() { return cb; }, set: (f: (s: string) => void) => { cb = f; }, setClose: (f: () => void) => { close = f; }, get close() { return close; } }; };
  const x = mk(); const y = mk();
  const ch = (me: typeof x, other: typeof x): Channel => ({ send: (s) => { setTimeout(() => other.cb(s), 0); }, onMessage: (f) => me.set(f), onClose: (f) => me.setClose(f), close: () => { setTimeout(() => other.close(), 0); } });
  return [ch(x, y), ch(y, x)];
}

describe('signalling texts', () => {
  it('only the paired phone can read an offer, and it round-trips', async () => {
    const { a, b, pa, pb } = await paired(); const stranger = await createIdentity('S', 1);
    const text = await sealSignal(a, pa, 'offer', 'v=0\r\na=fingerprint:sha-256 AA', 1000);
    expect(text).not.toContain('fingerprint');
    const got = await openSignal(b, [pb], text, 2000);
    expect(got).toMatchObject({ kind: 'offer', sdp: 'v=0\r\na=fingerprint:sha-256 AA' }); expect(got.peer.id).toBe(a.id);
    await expect(openSignal(stranger, [pb], text, 2000)).rejects.toMatchObject({ kind: 'unknown-peer' });
    await expect(openSignal(b, [], text, 2000)).rejects.toMatchObject({ kind: 'unknown-peer' });
  });
  it('refuses old, tampered and pairing codes', async () => {
    const { a, b, pa, pb } = await paired();
    const text = await sealSignal(a, pa, 'answer', 'sdp', 1000);
    await expect(openSignal(b, [pb], text, 1000 + 11 * 60 * 1000)).rejects.toMatchObject({ kind: 'auth' });
    const h = JSON.parse(Buffer.from(text.slice(12), 'base64url').toString()); h.data = h.data.slice(0, -3) + 'AAA';
    await expect(openSignal(b, [pb], 'famcal-live:' + Buffer.from(JSON.stringify(h)).toString('base64url'), 1000)).rejects.toMatchObject({ kind: 'auth' });
    const asOffer = JSON.parse(Buffer.from(text.slice(12), 'base64url').toString()); asOffer.k = 'offer'; // answer relabelled as offer
    await expect(openSignal(b, [pb], 'famcal-live:' + Buffer.from(JSON.stringify(asOffer)).toString('base64url'), 1000)).rejects.toMatchObject({ kind: 'auth' });
    await expect(openSignal(b, [pb], 'famcal:abc', 1000)).rejects.toMatchObject({ kind: 'format' });
    await expect(openSignal(b, [pb], 'hello', 1000)).rejects.toMatchObject({ kind: 'format' });
  });
  it('a signalling text fits a scannable QR', async () => {
    const { a, pa } = await paired();
    const sdp = ['v=0', 'o=- 4611731400430051336 2 IN IP4 127.0.0.1', 's=-', 't=0 0', 'a=group:BUNDLE 0', 'a=extmap-allow-mixed', 'a=msid-semantic: WMS', 'm=application 9 UDP/DTLS/SCTP webrtc-datachannel', 'c=IN IP4 0.0.0.0',
      'a=candidate:1 1 udp 2113937151 1b2c3d4e-aaaa-bbbb-cccc-0123456789ab.local 51234 typ host generation 0 ufrag abcd', 'a=candidate:2 1 udp 2113937151 7f6e5d4c-aaaa-bbbb-cccc-0123456789ab.local 51235 typ host generation 0 ufrag abcd',
      'a=ice-ufrag:abcd', 'a=ice-pwd:0123456789012345678901', 'a=ice-options:trickle', 'a=fingerprint:sha-256 ' + Array.from({ length: 32 }, (_, i) => (i * 7 % 256).toString(16).padStart(2, '0').toUpperCase()).join(':'),
      'a=setup:actpass', 'a=mid:0', 'a=sctp-port:5000', 'a=max-message-size:262144', ''].join('\r\n');
    expect((await sealSignal(a, pa, 'offer', sdp, 1)).length).toBeLessThan(1100);
  });
});

describe('exchanging notes over a channel', () => {
  it('both sides end up with both sets, large data is chunked', async () => {
    const [x, y] = link();
    const big = Array.from({ length: 300 }, (_, i) => note('a' + i, 'Nota ' + i, 100, 'x'.repeat(400)));
    const small = [note('b1', 'Dentista', 100), { ...big[0], title: 'Modificata', updatedAt: 500 }];
    const [rx, ry] = await Promise.all([exchangeNotes(x, big), exchangeNotes(y, small)]);
    expect(ry.events).toHaveLength(300); expect(rx.events.map((e) => e.id).sort()).toEqual(['a0', 'b1']);
    const merged = mergeLive(big, rx.events);
    expect(merged.find((e) => e.id === 'a0')!.title).toBe('Modificata'); expect(merged).toHaveLength(301);
  });
  it('fails clearly on garbage, a dropped link and a silent peer', async () => {
    const [x, y] = link();
    const p = exchangeNotes(x, [], 500); y.send('not json'); await expect(p).rejects.toMatchObject({ kind: 'format' });
    const [x2, y2] = link(); const p2 = exchangeNotes(x2, [], 500); y2.close(); await expect(p2).rejects.toThrow(/interrotto/);
    const [x3] = link(); await expect(exchangeNotes(x3, [], 100)).rejects.toThrow(/Tempo scaduto/);
  });
});
