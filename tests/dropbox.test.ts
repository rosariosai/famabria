import { describe, expect, it } from 'vitest';
import { dropboxMailbox, finishDropboxLogin, startDropboxLogin } from '../src/cloud/dropbox';
import { EMPTY_FAMILY_STATE, inviteLink, joinFamily, mailboxOf, newFamilyWith, syncFamily } from '../src/cloud/family';
import { MailboxError } from '../src/cloud/mailbox';
import { cleanEntry, createEvent, type CalEvent } from '../src/core/events';

const note = (id: string, title: string, at: number): CalEvent => { const c = cleanEntry({ date: '2026-11-05', title }); if (!c.ok) throw new Error('x'); return createEvent(c.value, id, at); };

/** A tiny fake of the Dropbox endpoints we use (app folder at path ''), with real behaviour for rev changes, 409 on missing files and token refresh. */
function fakeDropbox(opts: { refreshOk?: boolean } = {}) {
  const files = new Map<string, { rev: string; bytes: Uint8Array }>(); let n = 0; let tokens = 0; const calls: string[] = [];
  const fetcher = (async (url: string | URL, init: RequestInit = {}) => {
    const u = String(url); const h = (init.headers ?? {}) as Record<string, string>; calls.push(u.replace('https://', ''));
    const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status });
    if (u.endsWith('/oauth2/token')) {
      const p = new URLSearchParams(String(init.body));
      if (p.get('grant_type') === 'authorization_code') return p.get('code_verifier') && p.get('code') === 'good' ? json({ refresh_token: 'RT-1', access_token: 'a' }) : json({ error: 'invalid_grant' }, 400);
      if (opts.refreshOk === false || p.get('refresh_token') !== 'RT-1') return json({ error: 'invalid_grant' }, 400);
      return json({ access_token: `AT-${++tokens}`, expires_in: 14400 });
    }
    if (!/^Bearer AT-\d+$/.test(h.authorization ?? '')) return json({}, 401);
    const arg = h['dropbox-api-arg'] ? JSON.parse(h['dropbox-api-arg']) : {};
    if (u.endsWith('/files/list_folder')) return json({ entries: [...files].map(([name, f]) => ({ '.tag': 'file', name, rev: f.rev })), cursor: 'c', has_more: false });
    if (u.endsWith('/files/download')) { const f = files.get(String(arg.path).slice(1)); return f ? new Response(f.bytes as unknown as BodyInit) : json({ error: 'path/not_found' }, 409); }
    if (u.endsWith('/files/upload')) { files.set(String(arg.path).slice(1), { rev: `r${++n}`, bytes: new Uint8Array(init.body as Uint8Array) }); return json({}); }
    return json({}, 404);
  }) as typeof fetch;
  return { fetcher, files, calls, tokens: () => tokens };
}

describe('dropbox provider', () => {
  it('PKCE login: builds a S256 authorize URL and exchanges the code for a refresh token', async () => {
    const { url, verifier, state } = await startDropboxLogin('appkey123', 'https://example.org/app/');
    const q = new URL(url).searchParams;
    expect(q.get('code_challenge_method')).toBe('S256'); expect(q.get('token_access_type')).toBe('offline'); expect(q.get('client_id')).toBe('appkey123'); expect(q.get('state')).toBe(state);
    expect(q.get('code_challenge')).not.toBe(verifier);
    const d = fakeDropbox();
    expect(await finishDropboxLogin('appkey123', 'good', verifier, 'https://example.org/app/', d.fetcher)).toEqual({ appKey: 'appkey123', refreshToken: 'RT-1' });
    await expect(finishDropboxLogin('appkey123', 'bad', verifier, 'https://example.org/app/', d.fetcher)).rejects.toMatchObject({ kind: 'auth' });
  });
  it('mailbox: list/get/put, missing file is null, access token reused until it expires', async () => {
    const d = fakeDropbox(); let t = 0; const mb = dropboxMailbox({ appKey: 'k', refreshToken: 'RT-1' }, d.fetcher, () => t);
    expect(await mb.list()).toEqual([]);
    await mb.put('d-abcdef12.fc', new Uint8Array([1, 2, 3]));
    expect((await mb.list()).map((o) => o.name)).toEqual(['d-abcdef12.fc']);
    expect(Array.from((await mb.get('d-abcdef12.fc'))!)).toEqual([1, 2, 3]);
    expect(await mb.get('d-nothere99.fc')).toBeNull();
    expect(d.tokens()).toBe(1); t += 5 * 3600_000; await mb.list(); expect(d.tokens()).toBe(2);
  });
  it('a revoked refresh token is reported as auth, an unreachable network as unreachable', async () => {
    await expect(dropboxMailbox({ appKey: 'k', refreshToken: 'RT-1' }, fakeDropbox({ refreshOk: false }).fetcher).list()).rejects.toMatchObject({ kind: 'auth' });
    const down = (async () => { throw new TypeError('offline'); }) as unknown as typeof fetch;
    await expect(dropboxMailbox({ appKey: 'k', refreshToken: 'RT-1' }, down).list()).rejects.toBeInstanceOf(MailboxError);
  });
  it('invite link carries the Dropbox access; two phones converge through it; Dropbox sees only ciphertext', async () => {
    const A = newFamilyWith('Casa', { type: 'dropbox', appKey: 'k', refreshToken: 'RT-1' }, 'Telefono A', 1);
    const B = joinFamily(inviteLink('https://example.org/app/', A), 'Telefono B', 2);
    expect(B.provider).toEqual(A.provider); expect(B.key).toBe(A.key); expect(B.deviceId).not.toBe(A.deviceId);
    expect(() => joinFamily(inviteLink('https://x/', { ...A, provider: { type: 'dropbox', appKey: 'k', refreshToken: 'x'.repeat(300) } }), 'C', 3)).toThrow();
    const d = fakeDropbox(); const mb = dropboxMailbox(A.provider as never, d.fetcher);
    void mailboxOf; // mailboxOf(A) uses the real fetch; the fake is injected directly below
    let ea = [note('n1', 'Dentista', 10)], eb: CalEvent[] = [];
    let sa = EMPTY_FAMILY_STATE, sb = EMPTY_FAMILY_STATE;
    let r = await syncFamily(A, mb, ea, sa, 100); ea = r.events; sa = r.state;
    r = await syncFamily(B, mb, eb, sb, 101); eb = r.events; sb = r.state;
    expect(eb.map((e) => e.title)).toEqual(['Dentista']);
    eb = [...eb, note('n2', 'Nonna', 200)];
    r = await syncFamily(B, mb, eb, sb, 201); eb = r.events; sb = r.state;
    r = await syncFamily(A, mb, ea, sa, 202); ea = r.events;
    expect(ea.map((e) => e.title).sort()).toEqual(['Dentista', 'Nonna']);
    const raw = [...d.files.values()].map((f) => new TextDecoder().decode(f.bytes)).join('');
    expect(raw).not.toContain('Dentista'); expect(raw).not.toContain('Nonna');
  });
});
