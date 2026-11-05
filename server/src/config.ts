import { readFileSync } from 'node:fs';

export interface Config {
  port: number;
  host: string;
  trustProxy: boolean;
  /** Folder with the built web app (dist/web). Served at /app/ when set. */
  webDir: string | null;
  db: { host: string; port: number; user: string; password: string; database: string };
}

/** Reads settings from environment variables. A password can come from a file (DB_PASSWORD_FILE) so it never appears in compose files. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const need = (k: string): string => {
    const v = env[k];
    if (!v) throw new Error(`Missing setting ${k}`);
    return v;
  };
  const dbHost = need('DB_HOST');
  const dbUser = need('DB_USER');
  let password = env.DB_PASSWORD ?? '';
  if (env.DB_PASSWORD_FILE) password = readFileSync(env.DB_PASSWORD_FILE, 'utf8').replace(/\r?\n$/, '');
  if (!password) throw new Error('Missing setting DB_PASSWORD (or DB_PASSWORD_FILE)');
  const num = (k: string, d: number) => {
    const n = Number(env[k] ?? d);
    if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error(`${k} must be a port number`);
    return n;
  };
  return {
    port: num('PORT', 8420),
    host: env.HOST || '0.0.0.0',
    trustProxy: env.TRUST_PROXY === '1',
    webDir: env.WEB_DIR || null,
    db: { host: dbHost, port: num('DB_PORT', 3306), user: dbUser, password, database: env.DB_NAME || 'tilenest' },
  };
}
