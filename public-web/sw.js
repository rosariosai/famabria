/* Famabria service worker (web app only): opens the app with no network.
 * - the app files are saved the first time; later visits use the network when it answers and the saved copy when it does not;
 * - notes live in the phone's own database, so reading AND writing keep working offline; the family sync resumes by itself when the network is back;
 * - only files under this folder (/app/) are handled: the relay and the home server are never touched. */
const V = new URL(self.location.href).searchParams.get('v') || '0';
const CACHE = `famabria-${V}`;
const BASE = new URL('./', self.location.href).pathname;      // "/app/"
const SHELL = BASE + '__shell';                                   // key of the saved app page
const PAGE = BASE + 'app.html';

// A redirected response cannot be handed to a page: copy its body into a plain one.
const plain = async (r) => new Response(await r.blob(), { status: 200, headers: { 'content-type': r.headers.get('content-type') || 'text/html' } });

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    const r = await fetch(PAGE, { cache: 'reload' });
    if (!r.ok) throw new Error('shell');
    const text = await r.clone().text();
    await c.put(SHELL, await plain(r));
    const files = new Set(['manifest.webmanifest', 'theme-boot.js', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'].map((f) => BASE + f));
    for (const m of text.matchAll(/(?:src|href)="([^"]*assets\/[^"]+)"/g)) files.add(new URL(m[1], self.location.origin + BASE).pathname);
    await Promise.all([...files].map((f) => c.add(f).catch(() => undefined)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if ((k.startsWith('famabria-') || k.startsWith('famcal-')) && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

const withTimeout = (p, ms) => new Promise((ok, no) => { const t = setTimeout(() => no(new Error('slow')), ms); p.then((v) => { clearTimeout(t); ok(v); }, (x) => { clearTimeout(t); no(x); }); });

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || !url.pathname.startsWith(BASE) || url.pathname === BASE + 'sw.js') return;
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const r = await withTimeout(fetch(req), 4000);
        // keep the saved page fresh in the background
        e.waitUntil(fetch(PAGE).then(async (p) => { if (p.ok) (await caches.open(CACHE)).put(SHELL, await plain(p)); }).catch(() => undefined));
        return r;
      } catch {
        const hit = await caches.match(SHELL);
        return hit || new Response('Famabria: serve la rete la prima volta.', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } });
      }
    })());
    return;
  }
  // files: saved copy first (names carry a hash, so a saved copy is never stale), network otherwise, and save what the network gave
  e.respondWith((async () => {
    const hit = await caches.match(req);
    if (hit) return hit;
    const r = await fetch(req);
    if (r.ok) (await caches.open(CACHE)).put(req, r.clone());
    return r;
  })());
});
