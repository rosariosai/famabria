// Node entry: a tiny relay for a home server or VPS.  node famabria-relay.cjs   (env: PORT=8430, HOST=0.0.0.0, DATA_FILE=/data/relay.json)
import { createServer, type Server } from 'node:http';
import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { createRelay, MAX_OBJECT_BYTES, type Store } from './core';

export function memoryStore(file?: string): Store {
  const m = new Map<string, { rev: string; data: string }>();
  if (file && existsSync(file)) for (const [k, v] of Object.entries(JSON.parse(readFileSync(file, 'utf8')))) m.set(k, v as { rev: string; data: string });
  let t: ReturnType<typeof setTimeout> | undefined;
  const save = () => { if (!file) return; clearTimeout(t); t = setTimeout(() => { writeFileSync(file + '.tmp', JSON.stringify(Object.fromEntries(m))); renameSync(file + '.tmp', file); }, 500); };
  return { get: async (k) => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); save(); }, list: async (p) => [...m.keys()].filter((k) => k.startsWith(p)), del: async (k) => { m.delete(k); save(); } };
}

export function createRelayServer(store: Store): Server {
  const relay = createRelay(store);
  return createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = []; let size = 0;
      for await (const c of req) { size += (c as Buffer).length; if (size > MAX_OBJECT_BYTES + 1024) { res.writeHead(413).end(); return; } chunks.push(c as Buffer); }
      const body = Buffer.concat(chunks);
      const r = await relay(new Request(`http://${req.headers.host ?? 'localhost'}${req.url}`, { method: req.method, headers: req.headers as Record<string, string>, body: req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS' ? undefined : body }));
      res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer()));
    } catch { res.writeHead(500).end(); }
  });
}

if (typeof require !== 'undefined' && require.main === module) {
  const port = Number(process.env.PORT || 8430); const host = process.env.HOST || '0.0.0.0';
  createRelayServer(memoryStore(process.env.DATA_FILE)).listen(port, host, () => console.log(`Famabria relay listening on ${host}:${port}`));
}
