import { describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { createApp } from '../server/src/app';
import type { Store } from '../server/src/store';

describe('server CORS', () => {
  it('answers preflight and adds CORS headers (needed by Firefox extension pages)', async () => {
    const fake = { ping: async () => true } as unknown as Store;
    const srv = createApp(fake, { log: () => undefined });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    try {
      const pre = await fetch(`${base}/api/changes`, { method: 'OPTIONS', headers: { Origin: 'moz-extension://x', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization' } });
      expect(pre.status).toBe(204);
      expect(pre.headers.get('access-control-allow-origin')).toBe('*');
      expect(pre.headers.get('access-control-allow-headers')).toContain('authorization');
      const h = await fetch(`${base}/healthz`);
      expect(h.status).toBe(200);
      expect(h.headers.get('access-control-allow-origin')).toBe('*');
      const no = await fetch(`${base}/api/me`);
      expect(no.status).toBe(401);
      expect(no.headers.get('access-control-allow-origin')).toBe('*');
    } finally { srv.close(); }
  });
});
