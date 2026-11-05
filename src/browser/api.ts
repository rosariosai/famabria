// The ONLY module that touches chrome.* / browser.*. Everything else stays browser-agnostic.
type Perms = {
  contains(p: { permissions?: string[]; origins?: string[] }): Promise<boolean>;
  request(p: { permissions?: string[]; origins?: string[] }): Promise<boolean>;
};
type Ext = { runtime?: { getURL(p: string): string; getManifest?(): { version: string } }; permissions?: Perms };
const ext: Ext | undefined =
  (globalThis as unknown as { browser?: Ext }).browser ?? (globalThis as unknown as { chrome?: Ext }).chrome;

export const IS_WEB = __TARGET__ === 'web';

/** Ask for access to the sync server (one host). Must be called straight from a click handler. */
export async function requestOriginAccess(url: string): Promise<boolean> {
  if (IS_WEB) return true; // a web page talks to its own server: no permission needed
  if (!ext?.permissions) return false;
  // host only, no port: match patterns cover every port of the host, and a port in a pattern is not reliable across browsers
  const u = new URL(url);
  const want = { origins: [`${u.protocol}//${u.hostname}/*`] };
  return await ext.permissions.request(want); // no await before this: Firefox only accepts it straight from the click
}

/** Same, for several fixed origins at once (full match patterns, e.g. https://api.dropboxapi.com/). */
export async function requestFixedOrigins(origins: string[]): Promise<boolean> {
  if (IS_WEB) return true;
  if (!ext?.permissions) return false;
  return await ext.permissions.request({ origins: origins.map((o) => `${o.replace(/\/+$/, '')}/*`) });
}

export function extensionVersion(): string {
  try { return `v${ext?.runtime?.getManifest?.().version ?? 'dev'}`; } catch { return 'vdev'; }
}

