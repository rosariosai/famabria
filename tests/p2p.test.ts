import { describe, expect, it } from 'vitest';
import jsQR from 'jsqr';
import { acceptInvite, applyBundle, createIdentity, createInvite, decryptBundle, encryptBundle, finishPairing, P2PError, qrMatrix, sasCode } from '../src/p2p/crypto';
import { cleanEntry, createEvent, softDelete, type CalEvent } from '../src/core/events';

const note = (id: string, title: string, at: number): CalEvent => {
  const c = cleanEntry({ date: '2026-11-05', title });
  if (!c.ok) throw new Error('bad');
  return createEvent(c.value, id, at);
};
async function pair() {
  const a = await createIdentity('Telefono di Ros', 1);
  const b = await createIdentity('Telefono di Anna', 1);
  const inv = createInvite(a);
  const acc = await acceptInvite(b, inv.text, 10);
  const fin = await finishPairing(a, inv.nonce, acc.text, 11);
  return { a, b, inv, acc, fin };
}

describe('pairing', () => {
  it('both phones end with the same secret and the same 6-digit code', async () => {
    const { a, b, acc, fin } = await pair();
    expect(acc.peer.secret).toBe(fin.peer.secret);
    expect(acc.sas).toBe(fin.sas);
    expect(acc.sas).toMatch(/^\d{3} \d{3}$/);
    expect(await sasCode(acc.peer.secret, b.id, a.id)).toBe(acc.sas);
    expect(fin.peer.id).toBe(b.id); expect(acc.peer.id).toBe(a.id);
    expect(fin.peer.confirmed).toBe(false);
  });
  it('ids are derived from the public key, so a swapped key is refused', async () => {
    const a = await createIdentity('A', 1); const evil = await createIdentity('Evil', 1);
    const inv = createInvite(a);
    const tampered = 'famcal:' + Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(inv.text.slice(7), 'base64url').toString()), k: evil.pub })).toString('base64url');
    await expect(acceptInvite(await createIdentity('B', 1), tampered, 1)).rejects.toMatchObject({ kind: 'auth' });
  });
  it('an answer made for another invite is refused', async () => {
    const a = await createIdentity('A', 1); const b = await createIdentity('B', 1);
    const inv1 = createInvite(a); const inv2 = createInvite(a);
    const acc = await acceptInvite(b, inv1.text, 1);
    await expect(finishPairing(a, inv2.nonce, acc.text, 2)).rejects.toMatchObject({ kind: 'auth' });
  });
  it('reports clear errors for wrong codes', async () => {
    const a = await createIdentity('A', 1); const b = await createIdentity('B', 1);
    await expect(acceptInvite(b, 'hello', 1)).rejects.toBeInstanceOf(P2PError);
    await expect(acceptInvite(b, 'famcal:!!!', 1)).rejects.toMatchObject({ kind: 'format' });
    const inv = createInvite(a);
    await expect(acceptInvite(a, inv.text, 1)).rejects.toMatchObject({ kind: 'format' }); // own code
    const acc = await acceptInvite(b, inv.text, 1);
    await expect(acceptInvite(b, acc.text, 1)).rejects.toMatchObject({ kind: 'format' }); // an answer where an invite is expected
    await expect(finishPairing(a, inv.nonce, inv.text, 1)).rejects.toMatchObject({ kind: 'format' });
  });
});

describe('encrypted bundles', () => {
  it('A sends notes to B; B merges them; edits and deletions travel', async () => {
    const { a, b, acc, fin } = await pair();
    const n1 = note('n1', 'Dentista', 100); const n2 = note('n2', 'Scuola', 100);
    const file = await encryptBundle(a, fin.peer, [n1, n2], 200);
    expect(file).not.toContain('Dentista');
    const got = await decryptBundle(b, [acc.peer], file);
    expect(got.peer.id).toBe(a.id); expect(got.events.map((e) => e.title).sort()).toEqual(['Dentista', 'Scuola']);
    let bState = applyBundle([], got.events);
    // B edits n1 later and deletes n2; A merges B's bundle back
    const edited = { ...n1, title: 'Dentista 16:30', updatedAt: 300 };
    bState = applyBundle(bState, [edited, softDelete(n2, 300)]);
    const back = await decryptBundle(a, [fin.peer], await encryptBundle(b, acc.peer, bState, 400));
    const aState = applyBundle([n1, n2], back.events);
    expect(aState.find((e) => e.id === 'n1')!.title).toBe('Dentista 16:30');
    expect(aState.find((e) => e.id === 'n2')!.deletedAt).not.toBeNull();
  });
  it('merging is order independent and never loses the newer edit', () => {
    const older = note('x', 'old', 100); const newer = { ...older, title: 'new', updatedAt: 200 };
    expect(applyBundle([newer], [older])[0].title).toBe('new');
    expect(applyBundle([older], [newer])[0].title).toBe('new');
  });
  it('refuses files for another phone, from strangers, or tampered with', async () => {
    const { a, b, acc, fin } = await pair();
    const c = await createIdentity('C', 1);
    const file = await encryptBundle(a, fin.peer, [note('n1', 'x', 1)], 2);
    await expect(decryptBundle(c, [acc.peer], file)).rejects.toMatchObject({ kind: 'unknown-peer' }); // not addressed to C
    await expect(decryptBundle(b, [], file)).rejects.toMatchObject({ kind: 'unknown-peer' }); // B does not know A
    const o = JSON.parse(file); o.data = o.data.slice(0, -4) + (o.data.endsWith('AAAA') ? 'BBBB' : 'AAAA');
    await expect(decryptBundle(b, [acc.peer], JSON.stringify(o))).rejects.toMatchObject({ kind: 'auth' });
    const swapped = JSON.stringify({ ...JSON.parse(file), from: 'someoneelse1' });
    await expect(decryptBundle(b, [acc.peer], swapped)).rejects.toMatchObject({ kind: 'unknown-peer' });
    await expect(decryptBundle(b, [acc.peer], 'not json')).rejects.toMatchObject({ kind: 'format' });
  });
});

describe('QR codes', () => {
  it('an invite becomes a QR that a scanner can read back exactly', async () => {
    const a = await createIdentity('Telefono di Ros', 1);
    const { text } = createInvite(a);
    const m = qrMatrix(text); const scale = 4; const quiet = 4; const size = (m.length + quiet * 2) * scale;
    const px = new Uint8ClampedArray(size * size * 4).fill(255);
    m.forEach((row, r) => row.forEach((dark, c) => { if (!dark) return; for (let y = 0; y < scale; y++) for (let x = 0; x < scale; x++) { const i = (((r + quiet) * scale + y) * size + (c + quiet) * scale + x) * 4; px[i] = px[i + 1] = px[i + 2] = 0; } }));
    const read = jsQR(px, size, size);
    expect(read?.data).toBe(text);
    expect(m.length).toBeLessThanOrEqual(73); // version 12 or smaller: easy to scan from a phone screen
  });
});
