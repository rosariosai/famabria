import { describe, expect, it } from 'vitest';
// @ts-ignore plain JS module (the home reminder server)
import { createService } from '../server/reminders/famabria-reminders.mjs';
import { inviteLink, newFamily } from '../src/cloud/family';
import { sealWith, sha256b64u } from '../src/p2p/crypto';

const ev = (id: string, o: Record<string, unknown>) => ({ id, calendarId: 'personal', date: '2026-11-05', title: 'Dentista', notes: '', time: '09:05', color: 'blue', createdAt: 1, updatedAt: 1, deletedAt: null, ...o });

async function setup(events: unknown[]) {
  const fam = newFamily('Test', 'https://relay.example', 'Tel', 0);
  const name = 'd-abcdef123.fc';
  const sealed = await sealWith(fam.key, 'famcal-family-v1', `${fam.id}|${name}`, { device: { id: 'abcdef123', name: 'Tel' }, sentAt: 1, events });
  const bytes = new TextEncoder().encode(JSON.stringify({ v: 1, ...sealed }));
  const room = (await sha256b64u(fam.provider.token)).slice(0, 22);
  const sent: { topic: string; title: string; message: string }[] = [];
  const fetcher = async (url: string, init?: RequestInit) => {
    if (url === 'http://ntfy.local:7200') { sent.push(JSON.parse(String(init?.body))); return new Response('{}'); }
    expect((init?.headers as Record<string, string>).authorization).toBe(`Bearer ${fam.provider.token}`);
    if (url === `https://relay.example/r/${room}`) return new Response(JSON.stringify([{ name, rev: 'r1' }]));
    if (url === `https://relay.example/r/${room}/${name}`) return new Response(bytes);
    return new Response('nope', { status: 404 });
  };
  const t = new Date(2026, 10, 5, 8, 55).getTime();
  const svc = createService({ invite: inviteLink('https://x/app', fam), ntfyUrl: 'http://ntfy.local:7200', topic: 'famcal-x', fetcher, now: () => t, log: () => {} });
  return { svc, sent };
}

describe('home reminder server', () => {
  it('sends a due reminder once, with title and time', async () => {
    const { svc, sent } = await setup([ev('a', { remind: '10m' }), ev('b', { remind: 'none' }), ev('c', { remind: '1h' }), ev('d', { remind: '10m', deletedAt: 5 })]);
    expect(await svc.tick()).toBe(1);
    expect(await svc.tick()).toBe(0);
    expect(sent).toEqual([{ topic: 'famcal-x', title: 'Promemoria: Dentista', message: '05/11 alle 09:05', priority: 4, tags: ['alarm_clock'] }]);
  });
  it('ignores objects it cannot decrypt', async () => {
    const { svc } = await setup([]);
    expect(await svc.tick()).toBe(0);
  });
});
