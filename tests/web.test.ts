import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { createApp } from '../server/src/app';
import type { Store } from '../server/src/store';

describe('server serves the web app at /app/', () => {
  it('serves files safely and redirects from /', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tn-web-'));
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'app.html'), '<!doctype html><title>x</title>');
    writeFileSync(join(dir, 'assets', 'app.js'), 'console.log(1)');
    writeFileSync(join(dir, '.secret'), 'no');
    writeFileSync(join(dir, 'notes.exe'), 'no');
    const srv = createApp({ ping: async () => true } as unknown as Store, { log: () => undefined, webDir: dir });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    try {
      const root = await fetch(base + '/', { redirect: 'manual' });
      expect(root.status).toBe(302); expect(root.headers.get('location')).toBe('/app/');
      const page = await fetch(base + '/app/');
      expect(page.status).toBe(200);
      expect(page.headers.get('content-type')).toContain('text/html');
      expect(page.headers.get('content-security-policy')).toContain("default-src 'none'");
      expect(page.headers.get('cache-control')).toBe('no-cache');
      const js = await fetch(base + '/app/assets/app.js');
      expect(js.headers.get('content-type')).toContain('javascript');
      expect(js.headers.get('content-security-policy')).toBeNull();
      for (const bad of ['/app/.secret', '/app/notes.exe', '/app/%2e%2e/etc/passwd', '/app/..%2f..%2fetc%2fpasswd', '/app/missing.js', '/app/%E0%A4%A']) {
        expect((await fetch(base + bad)).status, bad).toBe(404);
      }
      expect((await fetch(base + '/api/me')).status).toBe(401); // the API is still protected
    } finally { srv.close(); }
  });
  it('without a web folder, / is the plain text note', async () => {
    const srv = createApp({ ping: async () => true } as unknown as Store, { log: () => undefined });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    try {
      expect((await fetch(base + '/')).status).toBe(200);
      expect((await fetch(base + '/app/')).status).toBe(404);
    } finally { srv.close(); }
  });
});
