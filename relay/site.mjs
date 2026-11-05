// Copies the built web app (dist/web, only the files app.html really uses) into relay/site/, which the Worker serves as static files.
// Result: ONE Cloudflare deploy gives both the relay (/r/…, /healthz) and the app itself (/app/app.html), reachable from anywhere.
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
// plain read+write (cpSync deletes the old file first, which some locked-down folders refuse)
const copy = (a, b) => { mkdirSync(join(b, '..'), { recursive: true }); if (statSync(a).isDirectory()) { for (const f of readdirSync(a)) copy(join(a, f), join(b, f)); } else writeFileSync(b, readFileSync(a)); };
const src = 'dist/web', out = 'relay/site/app';
const html = readFileSync(join(src, 'app.html'), 'utf8');
const refs = new Set([...html.matchAll(/assets\/[^"')\s]+/g)].map((m) => m[0]));
mkdirSync(join(out, 'assets'), { recursive: true });
for (const f of readdirSync(src)) { if (f !== 'assets') copy(join(src, f), join(out, f)); }
for (const r of refs) copy(join(src, r), join(out, r));
copy(join(out, 'app.html'), join(out, 'index.html')); // start_url /app/ must open the app
writeFileSync('relay/site/index.html', '<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=/app/app.html"><title>Famabria</title><a href="/app/app.html">Famabria</a>\n');
const size = (d) => readdirSync(d).reduce((n, f) => { const p = join(d, f); return n + (statSync(p).isDirectory() ? size(p) : statSync(p).size); }, 0);
console.log(`relay/site ready: ${refs.size} asset files, ${(size('relay/site') / 1024).toFixed(0)} KB`);
