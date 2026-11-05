// Tiny HTTP API, no framework. Routes: GET /healthz, GET /api/me, GET /api/changes, POST /api/changes, GET /api/export.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { parseEvents } from '../../src/core/events';
import type { Store } from './store';

export const VERSION = '0.2.0';
export const MAX_BODY = 1_000_000; // bytes
export const MAX_BATCH = 500;
export const MAX_PAGE = 1000;

export interface AppOptions { webDir?: string | null; trustProxy?: boolean; log?: (line: string) => void; failLimit?: number; failWindowMs?: number }

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};
const WEB_CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/** Serves the built calendar web app (static files, no data). Returns false when the path is not a file of the app. */
async function serveWeb(webDir: string, pathname: string, res: ServerResponse): Promise<boolean> {
  let rel = decodeURIComponent(pathname.slice('/app/'.length));
  if (rel === '') rel = 'app.html';
  const root = resolve(webDir);
  const file = resolve(root, rel);
  if (!file.startsWith(root + sep) || rel.split('/').some((p) => p.startsWith('.'))) return false;
  const type = TYPES[extname(file).toLowerCase()];
  if (!type) return false;
  let body: Buffer;
  try { body = await readFile(file); } catch { return false; }
  const html = type.startsWith('text/html');
  res.writeHead(200, {
    'Content-Type': type, 'Content-Length': body.length, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
    'Cache-Control': html || extname(file) === '.webmanifest' ? 'no-cache' : 'public, max-age=3600',
    ...(html ? { 'Content-Security-Policy': WEB_CSP } : {}),
  });
  res.end(body);
  return true;
}

class HttpError extends Error { constructor(readonly status: number, message: string, readonly headers: Record<string, string> = {}) { super(message); } }

function send(res: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', ...extra,
  });
  res.end(text);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const len = Number(req.headers['content-length'] ?? 0);
  if (len > MAX_BODY) throw new HttpError(413, 'Request too large.');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, 'Request too large.');
    chunks.push(c as Buffer);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, 'The body is not valid JSON.'); }
}

export function createApp(store: Store, opts: AppOptions = {}): Server {
  const log = opts.log ?? ((l: string) => console.log(l));
  const failLimit = opts.failLimit ?? 10, failWindow = opts.failWindowMs ?? 60_000;
  const fails = new Map<string, number[]>();
  const clientIp = (req: IncomingMessage) => {
    if (opts.trustProxy) { const xf = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim(); if (xf) return xf; }
    return req.socket.remoteAddress ?? 'unknown';
  };
  const recentFails = (ip: string, now: number) => { const l = (fails.get(ip) ?? []).filter((t) => now - t < failWindow); fails.set(ip, l); return l; };

  async function authenticate(req: IncomingMessage): Promise<string> {
    const ip = clientIp(req), now = Date.now();
    if (recentFails(ip, now).length >= failLimit) throw new HttpError(429, 'Too many failed attempts. Wait a minute.', { 'Retry-After': '60' });
    const m = /^Bearer (\S+)$/.exec(String(req.headers.authorization ?? ''));
    const user = m ? await store.userForToken(m[1]) : null;
    if (!user) { recentFails(ip, now).push(now); throw new HttpError(401, 'Missing or invalid token.', { 'WWW-Authenticate': 'Bearer' }); }
    return user;
  }

  async function route(req: IncomingMessage, res: ServerResponse, url: URL): Promise<string> {
    const { pathname } = url;
    if (opts.webDir && req.method === 'GET') {
      if (pathname === '/' || pathname === '/app') { res.writeHead(302, { Location: '/app/' }); res.end(); return '-'; }
      if (pathname.startsWith('/app/')) {
        let ok = false;
        try { ok = await serveWeb(opts.webDir, pathname, res); } catch { ok = false; }
        if (ok) return '-';
        throw new HttpError(404, 'Not found.');
      }
    }
    if (pathname === '/' && req.method === 'GET') { send(res, 200, 'Tilenest sync server. Nothing to see here; use the extension.\n'); return '-'; }
    if (pathname === '/healthz' && req.method === 'GET') {
      const db = await store.ping();
      send(res, db ? 200 : 503, { ok: db, db, version: VERSION, time: Date.now() });
      return '-';
    }
    if (!pathname.startsWith('/api/')) throw new HttpError(404, 'Not found.');
    const user = await authenticate(req);

    if (pathname === '/api/me' && req.method === 'GET') { send(res, 200, { user, version: VERSION, cursor: await store.cursor(), time: Date.now() }); return user; }

    if (pathname === '/api/changes' && req.method === 'GET') {
      const since = Number(url.searchParams.get('since') ?? 0);
      const limit = Number(url.searchParams.get('limit') ?? 500);
      if (!Number.isInteger(since) || since < 0) throw new HttpError(400, '"since" must be a whole number, 0 or more.');
      if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE) throw new HttpError(400, `"limit" must be between 1 and ${MAX_PAGE}.`);
      send(res, 200, await store.changesSince(since, limit));
      return user;
    }

    if (pathname === '/api/changes' && req.method === 'POST') {
      const body = await readJson(req);
      const list = typeof body === 'object' && body !== null ? (body as { events?: unknown }).events : undefined;
      if (!Array.isArray(list)) throw new HttpError(400, 'Send {"events": [...]}.');
      if (list.length > MAX_BATCH) throw new HttpError(413, `At most ${MAX_BATCH} events per request.`);
      const { events, dropped } = parseEvents(list);
      const result = await store.push(events, user);
      send(res, 200, { ...result, rejected: [...result.rejected, ...(dropped ? [{ id: '?', reason: `${dropped} invalid ${dropped === 1 ? 'entry was' : 'entries were'} skipped.` }] : [])] });
      return user;
    }

    if (pathname === '/api/export' && req.method === 'GET') { send(res, 200, { exportedAt: Date.now(), events: await store.allEvents() }); return user; }

    throw new HttpError(404, 'Not found.');
  }

  return createServer((req, res) => {
    const t0 = Date.now();
    // Browsers (Firefox especially) check CORS before they look at extension permissions. The token is the protection, not the origin.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Max-Age', '600');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    const url = new URL(req.url ?? '/', 'http://localhost');
    let who = '-';
    route(req, res, url)
      .then((u) => { who = u; })
      .catch((e: unknown) => {
        if (e instanceof HttpError) send(res, e.status, { error: e.message }, e.headers);
        else { console.error(e); send(res, 500, { error: 'Server error.' }); }
      })
      .finally(() => log(`${new Date().toISOString()} ${req.method} ${url.pathname} ${res.statusCode} ${Date.now() - t0}ms ${who}`));
  });
}
