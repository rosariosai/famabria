import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createRelayServer, memoryStore } from '../relay/node';
import { EMPTY_FAMILY_STATE, inviteLink, joinFamily, mailboxOf, newFamily, normalizeRelayUrl, syncFamily, type Family, type FamilyState } from '../src/cloud/family';
import { httpMailbox, memoryMailbox, MailboxError } from '../src/cloud/mailbox';
import { cleanEntry, createEvent, softDelete, type CalEvent } from '../src/core/events';

const note = (id: string, title: string, at: number): CalEvent => { const c = cleanEntry({ date: '2026-11-05', title }); if (!c.ok) throw new Error('x'); return createEvent(c.value, id, at); };
let srv: Server; let base = '';
beforeAll(async () => { srv = createRelayServer(memoryStore()); await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r)); base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`; });
afterAll(() => { srv.close(); });

describe('relay', () => {
  it('stores objects per room, only for the right token, with limits', async () => {
    const f = newFamily('Casa', base, 'A', 1); const mb = httpMailbox(base, f.provider.token);
    expect(await mb.list()).toEqual([]);
    await mb.put('d-abcdef12.fc', new Uint8Array([1, 2, 3]));
    expect((await mb.list()).map((o) => o.name)).toEqual(['d-abcdef12.fc']);
    expect(Array.from((await mb.get('d-abcdef12.fc'))!)).toEqual([1, 2, 3]);
    expect(await mb.get('d-zzzzzz99.fc')).toBeNull();
    const other = httpMailbox(base, newFamily('X', base, 'B', 1).provider.token);
    expect(await other.list()).toEqual([]);                                       // a different token is a different room
    const wrong = httpMailbox(base, f.provider.token + 'x'); await expect(wrong.list()).resolves.toEqual([]);
    const forged = await fetch(`${base}/r/${'A'.repeat(22)}`, { headers: { authorization: `Bearer ${f.provider.token}` } });
    expect(forged.status).toBe(401);                                              // room id must match the token
    expect((await fetch(`${base}/healthz`)).status).toBe(200);
    expect((await fetch(`${base}/r/${'A'.repeat(22)}`)).status).toBe(401);
    expect((await fetch(`${base}/r/${'A'.repeat(22)}/..%2Fx`, { headers: { authorization: `Bearer ${f.provider.token}` } })).status).toBe(401);
    await expect(httpMailbox('http://127.0.0.1:1', f.provider.token).list()).rejects.toBeInstanceOf(MailboxError);
  });
  it('limits object count and size', async () => {
    const f = newFamily('Casa', base, 'A', 1); const mb = httpMailbox(base, f.provider.token);
    for (let i = 0; i < 20; i++) await mb.put(`d-device${String(i).padStart(2, '0')}.fc`, new Uint8Array([i]));
    await expect(mb.put('d-device99.fc', new Uint8Array([1]))).rejects.toBeInstanceOf(MailboxError);
    await mb.put('d-device00.fc', new Uint8Array([9]));                            // overwriting is fine
    await expect(mb.put('d-device01.fc', new Uint8Array(1024 * 1024 + 10))).rejects.toBeInstanceOf(MailboxError);
  });
});

describe('invites', () => {
  it('a link carries everything a new device needs and rejects junk', () => {
    const f = newFamily('Casa Rossi', 'calendario.example.org', 'Telefono di Ros', 5);
    expect(f.provider.url).toBe('https://calendario.example.org');
    const link = inviteLink('https://calendario.example.org/app/#old', f);
    expect(link.startsWith('https://calendario.example.org/app/#join=')).toBe(true);
    const g = joinFamily(link, 'Telefono di Anna', 6);
    expect(g).toMatchObject({ id: f.id, name: 'Casa Rossi', key: f.key, provider: f.provider, deviceName: 'Telefono di Anna' });
    expect(g.deviceId).not.toBe(f.deviceId);
    expect(() => joinFamily('hello', 'x', 1)).toThrow(/invito/); expect(() => joinFamily('#join=AAAAAAAAAAAAAAAAAAAAAAAA', 'x', 1)).toThrow();
    expect(() => normalizeRelayUrl('http://example.org')).toThrow(/https/); expect(normalizeRelayUrl('http://192.168.0.10:8430/')).toBe('http://192.168.0.10:8430');
  });
});

describe('family sync through a relay', () => {
  const run = async (f: Family, local: CalEvent[], st: FamilyState, now: number) => syncFamily(f, mailboxOf(f), local, st, now);
  it('three phones converge without ever talking to each other; edits and deletions travel', async () => {
    const A = newFamily('Casa', base, 'Telefono di Ros', 1);
    const B = joinFamily(inviteLink('https://x/app/', A), 'Telefono di Anna', 1);
    const C = joinFamily(inviteLink('https://x/app/', A), 'Tablet cucina', 1);
    let a: CalEvent[] = [note('n1', 'Dentista', 100), note('n2', 'Scuola', 100)], b: CalEvent[] = [], c: CalEvent[] = [];
    let sa = EMPTY_FAMILY_STATE, sb = EMPTY_FAMILY_STATE, sc = EMPTY_FAMILY_STATE;
    let r = await run(A, a, sa, 10); a = r.events; sa = r.state; expect(r.pushed).toBe(true);
    r = await run(B, b, sb, 11); b = r.events; sb = r.state; expect(b.map((e) => e.id).sort()).toEqual(['n1', 'n2']); expect(r.devices).toContain('Telefono di Ros');
    b = [...b.filter((e) => e.id !== 'n1'), { ...b.find((e) => e.id === 'n1')!, title: 'Dentista 16:30', updatedAt: 200 }, note('n3', 'Compleanno', 200)];
    r = await run(B, b, sb, 12); sb = r.state; expect(r.pushed).toBe(true);
    r = await run(C, c, sc, 13); c = r.events; sc = r.state; expect(c).toHaveLength(3);          // C gets A's and B's notes (through B's object, which carries all)
    c = c.map((e) => (e.id === 'n2' ? softDelete(e, 300) : e));
    r = await run(C, c, sc, 14); sc = r.state;
    r = await run(A, a, sa, 15); a = r.events; sa = r.state;
    expect(a.find((e) => e.id === 'n1')!.title).toBe('Dentista 16:30'); expect(a.find((e) => e.id === 'n2')!.deletedAt).not.toBeNull(); expect(a.map((e) => e.id)).toContain('n3');
    r = await run(A, a, sa, 16); expect(r.pushed).toBe(false); expect(r.pulled).toBe(0);           // nothing new: no upload, no changes
  });
  it('ignores objects it cannot trust and objects from another family key', async () => {
    const A = newFamily('Casa', base, 'A', 1); const mb = mailboxOf(A);
    await mb.put('d-garbage01.fc', new TextEncoder().encode('not json'));
    const intruder = { ...newFamily('X', base, 'E', 1), provider: A.provider, id: A.id };         // knows the room token but not the family key
    await syncFamily(intruder, mb, [note('evil', 'Falso', 5)], EMPTY_FAMILY_STATE, 5);
    const r = await syncFamily(A, mb, [note('n1', 'Vero', 1)], EMPTY_FAMILY_STATE, 6);
    expect(r.events.map((e) => e.id)).toEqual(['n1']); expect(r.skipped).toBe(2);
  });
  it('works with any mailbox (in-memory) and keeps plaintext out of it', async () => {
    const f = newFamily('Casa', base, 'A', 1); const mb = memoryMailbox();
    await syncFamily(f, mb, [note('n1', 'Segretissimo', 1)], EMPTY_FAMILY_STATE, 2);
    const stored = new TextDecoder().decode([...mb.objects.values()][0].bytes);
    expect(stored).not.toContain('Segretissimo');
  });
});
