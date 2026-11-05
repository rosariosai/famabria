// Entry point: `serve` (default), `add-user <name>`, `list-users`, `revoke-user <name>`, `check`.
import { createApp } from './app';
import { loadConfig } from './config';
import { Store } from './store';

async function main() {
  const [cmd = 'serve', arg] = process.argv.slice(2);
  const cfg = loadConfig();
  const store = new Store(cfg.db);
  try {
    await store.migrate();
    switch (cmd) {
      case 'add-user': {
        if (!arg) throw new Error('Usage: add-user <name>');
        const token = await store.addUser(arg);
        console.log(`User "${arg.toLowerCase()}" created. Copy this token now; it is shown only once:\n\n${token}\n`);
        break;
      }
      case 'list-users':
        for (const u of await store.listUsers()) console.log(`${u.name}\tcreated ${new Date(u.createdAt).toISOString()}${u.revokedAt ? '\tREVOKED' : ''}`);
        break;
      case 'revoke-user':
        if (!arg) throw new Error('Usage: revoke-user <name>');
        console.log((await store.revokeUser(arg)) ? `User "${arg}" removed. Its token no longer works.` : `No user called "${arg}".`);
        break;
      case 'check':
        console.log(`Database OK. Events stored: ${(await store.allEvents()).length}. Cursor: ${await store.cursor()}.`);
        break;
      case 'serve': {
        const server = createApp(store, { trustProxy: cfg.trustProxy, webDir: cfg.webDir });
        await new Promise<void>((ok) => server.listen(cfg.port, cfg.host, ok));
        console.log(`Famcal sync server listening on ${cfg.host}:${cfg.port} (database ${cfg.db.host}:${cfg.db.port}/${cfg.db.database})`);
        const stop = () => { console.log('Stopping...'); server.close(() => void store.close().then(() => process.exit(0))); setTimeout(() => process.exit(0), 5000).unref(); };
        process.on('SIGTERM', stop); process.on('SIGINT', stop);
        return; // keep running
      }
      default:
        throw new Error(`Unknown command "${cmd}". Use serve, add-user, list-users, revoke-user or check.`);
    }
  } catch (e) {
    console.error('Error:', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  }
  await store.close();
}
void main();
