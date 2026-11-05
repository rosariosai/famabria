// Bundles the relay: relay/dist/worker.js (Cloudflare Worker, ES module) and relay/dist/famabria-relay.cjs (Node 22).
import { build } from 'esbuild';
await build({ entryPoints: ['relay/worker.ts'], outfile: 'relay/dist/worker.js', bundle: true, platform: 'neutral', format: 'esm', target: 'es2022', logLevel: 'info', legalComments: 'none' });
await build({ entryPoints: ['relay/node.ts'], outfile: 'relay/dist/famabria-relay.cjs', bundle: true, platform: 'node', target: 'node22', format: 'cjs', logLevel: 'info', legalComments: 'none' });
