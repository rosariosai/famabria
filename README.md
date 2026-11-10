# Famabria

A family calendar for notes and reminders shared between everyone's phones and computers. End-to-end encrypted, no accounts, works offline.

Famabria comes as a **browser extension** (Chrome, Firefox, Brave), an **installable web app** (PWA, for phones and tablets) and a tiny **relay** you can host yourself on Cloudflare's free plan. Website: <https://famabria.com>

> The interface is available in English and Italian (Settings → Language; by default it follows your browser). More translations are welcome (see [CONTRIBUTING](CONTRIBUTING.md)).

## How it works

- Each device keeps its notes locally (IndexedDB) and works fully offline.
- To share with family, one person creates a family and sends **one-time invite links** (valid 15 minutes, usable once). Nobody needs an account.
- Devices exchange **encrypted** files through a relay. The relay stores ciphertext only: it never sees your notes or your family key. The key travels only in the invite link fragment (`#invite=...`), which is never sent to a server.
- Optional **reminders**: a small program on your own always-on machine reads the family's notes as a read-only device and sends push reminders through [ntfy](https://ntfy.sh).

Details: [docs/SECURITY.md](docs/SECURITY.md), [docs/PRIVACY.md](docs/PRIVACY.md), [docs/RELAY.md](docs/RELAY.md), [docs/REMINDERS.md](docs/REMINDERS.md).

## Install

- **Chrome / Brave:** Chrome Web Store (link coming with the first release), or load `dist/chrome` as an unpacked extension.
- **Firefox:** [Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/famabria-family-calendar/), or load `dist/firefox` temporarily from `about:debugging`.
- **Phone / tablet:** open the web app, then "Add to Home Screen".
- **Android app (APK):** download the signed APK from the [latest release](https://github.com/rosariosai/famabria/releases/latest). To get updates automatically, install [Obtainium](https://github.com/ImranR98/Obtainium), choose "Add app" and paste `https://github.com/rosariosai/famabria`. The app is the web app bundled for offline use, plus native reminders (notifications that work with the app closed). Releases are signed with the same key every time, so updates install over the previous version. F-Droid and IzzyOnDroid listings are planned.

## Build from source

Requires Node.js 22+.

```bash
npm ci
npm run typecheck
npm test
npm run build          # builds dist/chrome, dist/firefox and the web app
npm run zip            # store-ready zip files
```

## Host your own relay

The relay is a Cloudflare Worker with one Durable Object per family (free plan is enough). It also serves the web app.

- Beginner guide, about 10 minutes: [docs/RELAY.md](docs/RELAY.md)
- Developer reference, secrets, rate limiting, automatic deploys from GitHub (Workers Builds or the `Deploy relay` Action), Pages website: [docs/CLOUDFLARE.md](docs/CLOUDFLARE.md)
- No Cloudflare? A Node version for a home server is included (`relay/node.ts`, `server/`).

```bash
npx wrangler login
npm run deploy:relay
npx wrangler secret put TOKEN_SECRET --config relay/wrangler.toml
```

## Project layout

| Folder | What it is |
|---|---|
| `src/` | Extension and web app (React + TypeScript), crypto, sync, calendar |
| `public/`, `public-web/` | Extension background script, icons, PWA manifest and service worker |
| `relay/` | Cloudflare Worker (relay API `/v1`) |
| `server/` | Optional home-server pieces: Node sync server and the reminders program |
| `scripts/` | Manifest, icons, zip and end-to-end test helpers |
| `site-famabria/` | The one-page website |
| `tests/` | Unit tests (Vitest) |

## Security

Please report vulnerabilities privately, see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) (c) 2026 Rosario Savoia.
