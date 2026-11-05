// Builds the manifest for each browser. Keep ALL browser differences in this file.
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

export function buildManifest(target, { test = false } = {}) {
  const manifest = {
    manifest_version: 3,
    name: 'Famabria — Family Calendar',
    version: pkg.version,
    description: 'Family calendar with shared notes and reminders. Local-first, end-to-end encrypted sync, no accounts, no tracking.',
    icons: { 16: 'icons/16.png', 32: 'icons/32.png', 48: 'icons/48.png', 128: 'icons/128.png' },
    // The toolbar button opens the calendar in a tab (no popup, no new-tab takeover).
    action: { default_title: 'Famabria — open the calendar' },
    permissions: [],
    // Asked for one server at a time, only when the user saves the sync address. Never requested at install time.
    optional_host_permissions: ['https://*/*', 'http://*/*'],
  };

  // TEST BUILD ONLY (never packaged): lets the sync e2e skip the permission prompt.
  if (test) manifest.host_permissions = ['http://127.0.0.1/*'];

  if (target === 'chrome') {
    manifest.minimum_chrome_version = '110';
    manifest.background = { service_worker: 'background.js' };
  }

  if (target === 'firefox') {
    manifest.background = { scripts: ['background.js'] };
    // Firefox's default MV3 policy adds upgrade-insecure-requests, which turns http://192.168.x.x (the home sync server) into https and fails.
    manifest.content_security_policy = { extension_pages: "script-src 'self'; object-src 'self'" };
    manifest.browser_specific_settings = {
      gecko: {
        id: 'famabria@rosariosai.github.io',
        strict_min_version: '128.0',
        data_collection_permissions: { required: ['none'] },
      },
      gecko_android: { strict_min_version: '128.0' },
    };
  }
  return manifest;
}
