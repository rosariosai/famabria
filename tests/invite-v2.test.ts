import { describe, expect, it } from 'vitest';
import type { Store } from '../relay/core';
import { createV1, edgeGate, newFamily as relayNewFamily } from '../relay/v1';
import { EMPTY_FAMILY_STATE, mailboxOf, syncFamily } from '../src/cloud/family';
import { createFamilyV2, createInviteV2, parseInviteV2, redeemInviteV2 } from '../src/cloud/v2';
import { cleanEntry, createEvent, type CalEvent } from '../src/core/events';

const SECRET = 'test-secret-with-enough-entropy-0123456789';
const BASE = 'https://relay.test';
const note = (id: string, title: string, at: number): CalEvent => { const c = cleanEntry({ date: '2026-11-05', title }); if (!c.ok) throw new Error('x'); return createEvent(c.value, id, at); };

/** A fake Worker: same routing as relay/worker.ts (edge gate, then one in-memory room per family). */
function fakeWorker() {
  const rooms = new Map<string, ReturnType<typeof createV1>>(); let doCreated = 0;
  const mem = (): Store => { const m = new Map<string, { rev: string; data: string }>(); return { get: async (k) => m.get(k) ?? null, put: async (k, v) => void m.set(k, v), list: async (p) => [...m.keys()].filter((k) => k.startsWith(p)), del: async (k) => void m.delete(k) }; };
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(String(input), init);
    const path = new URL(req.url).pathname;
    if (path === '/v1/families') return new Response(JSON.stringify(await relayNewFamily(SECRET)), { status: 201 });
    const fam = await edgeGate(req, SECRET);
    if (fam instanceof Response) return fam;
    if (!rooms.has(fam)) { rooms.set(fam, createV1(mem(), SECRET)); doCreated++; }
    return rooms.get(fam)!(req);
  }) as typeof fetch;
  return { fetcher, created: () => doCreated };
}

describe('v2 family + one-time invite (client against the real relay code)', () => {
  it('create, invite, join, sync both ways; the invite works only once', async () => {
    const w = fakeWorker();
    const ros = (await createFamilyV2('Savoia', BASE, 'PC', 1, w.fetcher))!;
    expect(ros.provider.type).toBe('relay2');
    const { link } = await createInviteV2(ros, `${BASE}/app/app`, w.fetcher);
    expect(link).toContain('#invite=');
    expect(link).not.toContain(ros.key);                       // the family key is not in the link
    expect(atob(link.split('#invite=')[1].replace(/-/g, '+').replace(/_/g, '/'))).not.toContain(ros.key);
    const anna = await redeemInviteV2(link, 'iPhone', 2, w.fetcher);
    expect(anna.key).toBe(ros.key); expect(anna.id).toBe(ros.id); expect(anna.deviceId).not.toBe(ros.deviceId);
    await expect(redeemInviteV2(link, 'Altro', 3, w.fetcher)).rejects.toThrow(/scaduto|già usato/);   // burnt

    const a = await syncFamily(ros, mailboxOf(ros, w.fetcher), [note('n1', 'Dentista', 10)], EMPTY_FAMILY_STATE, 20);
    const b = await syncFamily(anna, mailboxOf(anna, w.fetcher), [], EMPTY_FAMILY_STATE, 30);
    expect(b.events.map((e) => e.title)).toEqual(['Dentista']);
    const b2 = await syncFamily(anna, mailboxOf(anna, w.fetcher), [note('n2', 'Cena', 40), ...b.events], b.state, 40);
    const a2 = await syncFamily(ros, mailboxOf(ros, w.fetcher), a.events, a.state, 50);
    expect(a2.events.map((e) => e.title).sort()).toEqual(['Cena', 'Dentista']); expect(b2.pushed).toBe(true);
  });

  it('a joined device cannot overwrite another device\'s object', async () => {
    const w = fakeWorker();
    const ros = (await createFamilyV2('Casa', BASE, 'PC', 1, w.fetcher))!;
    const anna = await redeemInviteV2((await createInviteV2(ros, BASE, w.fetcher)).link, 'iPhone', 2, w.fetcher);
    await syncFamily(ros, mailboxOf(ros, w.fetcher), [note('n1', 'X', 1)], EMPTY_FAMILY_STATE, 5);
    const p = anna.provider as { url: string; family: string; token: string };
    const r = await w.fetcher(`${p.url}/v1/f/${p.family}/objects/d-${ros.deviceId}.fc`, { method: 'PUT', headers: { authorization: `Bearer ${p.token}` }, body: 'evil' });
    expect(r.status).toBe(403);
  });

  it('bad or tampered links never reach a room, and an old relay falls back', async () => {
    const w = fakeWorker();
    const ros = (await createFamilyV2('Casa', BASE, 'PC', 1, w.fetcher))!;
    const { link } = await createInviteV2(ros, BASE, w.fetcher);
    const before = w.created();
    expect(parseInviteV2('#invite=abc')).toBeNull();
    await expect(redeemInviteV2('#invite=AAAAAAAAAAAAAAAAAAAAAAAA', 'x', 1, w.fetcher)).rejects.toThrow();
    const inv = parseInviteV2(link)!;
    const tampered = { ...inv, t: inv.t.slice(0, -2) + 'AA' }; // signature broken: stopped at the edge
    const bad = `#invite=${btoa(JSON.stringify({ v: 2, ...tampered })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
    await expect(redeemInviteV2(bad, 'x', 1, w.fetcher)).rejects.toThrow(/scaduto|già usato|non valido/);
    expect(w.created()).toBe(before);                                       // no extra room was created
    const old = (async () => new Response('{"error":"not found"}', { status: 404 })) as unknown as typeof fetch;
    expect(await createFamilyV2('Casa', BASE, 'PC', 1, old)).toBeNull();
  });
});

describe('token renewal on the client', () => {
  it('renews only when less than 15 days are left', async () => {
    const { renewTokenIfNeeded } = await import('../src/cloud/v2');
    const w = fakeWorker();
    const ros = (await createFamilyV2('Casa', BASE, 'PC', 1, w.fetcher))!;
    expect(await renewTokenIfNeeded(ros, Date.now(), w.fetcher)).toBeNull();            // fresh token: nothing to do
    const later = Date.now() + 20 * 86_400_000;                                          // 10 days left
    const f2 = await renewTokenIfNeeded(ros, later, w.fetcher);
    expect(f2).not.toBeNull(); // (the fake relay uses the real clock, so the new token equals the old one here; the relay test checks the extended expiry)
    const offline = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    expect(await renewTokenIfNeeded(ros, later, offline)).toBeNull();                    // relay unreachable: try again at the next sync
  });
});

describe('home-server reminder bot on a v2 family', () => {
  it('redeems a bot invite once, keeps its own credentials, and sends the due reminder', async () => {
    // @ts-ignore plain JS module (the home reminder server)
    const { createService } = await import('../server/reminders/famabria-reminders.mjs');
    const w = fakeWorker();
    const ros = (await createFamilyV2('Casa', BASE, 'PC', 1, w.fetcher))!;
    const n = note('n1', 'Dentista', 10); const withRemind = { ...n, remind: 'at', date: '2026-11-05', time: '09:05' } as CalEvent;
    await syncFamily(ros, mailboxOf(ros, w.fetcher), [withRemind], EMPTY_FAMILY_STATE, 20);
    const { link } = await createInviteV2(ros, BASE, w.fetcher, 'bot');
    const sent: string[] = [];
    const fetcher = (async (u: RequestInfo | URL, init?: RequestInit) => { if (String(u).startsWith('http://ntfy')) { sent.push(JSON.parse(String(init!.body)).title); return new Response('{}'); } return w.fetcher(u, init); }) as typeof fetch;
    let saved: Record<string, unknown> = { since: 0, fired: {} }; const at = new Date(2026, 10, 5, 9, 10).getTime();
    const svc = createService({ invite: link, ntfyUrl: 'http://ntfy', topic: 't', fetcher, now: () => at, save: (s: Record<string, unknown>) => { saved = JSON.parse(JSON.stringify(s)); }, load: () => saved, log: () => undefined });
    expect(await svc.tick()).toBe(1); expect(sent).toEqual(['Promemoria: Dentista']);
    expect(saved.v2).toBeTruthy();                                                       // credentials kept; the invite is burnt now
    const again = createService({ invite: link, ntfyUrl: 'http://ntfy', topic: 't', fetcher, now: () => at + 60_000, save: () => undefined, load: () => saved, log: () => undefined });
    await expect(again.tick()).resolves.toBe(0);                                           // works from saved state, already fired
  });
});

describe('admin device list and removal (client)', () => {
  it('admin sees devices and can remove one; the removed device is locked out', async () => {
    const { isAdminV2, listDevicesV2, removeDeviceV2 } = await import('../src/cloud/v2');
    const w = fakeWorker();
    const ros = (await createFamilyV2('Casa', BASE, 'PC', 1, w.fetcher))!;
    const anna = await redeemInviteV2((await createInviteV2(ros, BASE, w.fetcher)).link, 'iPhone', 2, w.fetcher);
    await syncFamily(anna, mailboxOf(anna, w.fetcher), [], EMPTY_FAMILY_STATE, 5);
    expect(isAdminV2(ros)).toBe(true); expect(isAdminV2(anna)).toBe(false);
    const rows = await listDevicesV2(ros, w.fetcher);
    expect(rows.map((r) => r.device).sort()).toEqual([ros.deviceId, anna.deviceId].sort());
    expect(await listDevicesV2(anna, w.fetcher)).toEqual([]);                           // members get nothing
    await removeDeviceV2(ros, anna.deviceId, w.fetcher);
    await expect(syncFamily(anna, mailboxOf(anna, w.fetcher), [], EMPTY_FAMILY_STATE, 9)).rejects.toThrow(/non accetta/);
  });
});
