# Firefox Add-ons (AMO) submission (Famabria)

Package: `npm run build:firefox && npm run zip` -> zip of `dist/firefox`. Add-on ID: `famabria@rosariosai.github.io`. Minimum Firefox 128.

## Listing
- **Name:** Famabria — Family Calendar
- **Summary (max 250):** Family calendar with shared notes and reminders. End-to-end encrypted, no accounts, works offline. Interface in Italian.
- **Categories:** Organization
- **License:** MIT
- **Privacy policy:** https://github.com/rosariosai/famabria/blob/main/docs/PRIVACY.md
- **Support site / email:** https://github.com/rosariosai/famabria/issues
- **Homepage:** https://famabria.com

## Data collection (manifest `data_collection_permissions`)
`required: ["none"]` — the add-on does not collect or transmit personal data to the developer. Family sync sends only end-to-end encrypted files to the relay the user chooses.

## Permissions
No permissions at install. Optional host permissions are requested at runtime for the single relay address (see Chrome doc).

## Notes for reviewers
- Build from source: Node.js 22, `npm ci`, `npm run build:firefox`; output in `dist/firefox`. Source: https://github.com/rosariosai/famabria (tag of this version). No minified third-party code is copied by hand; dependencies are in `package-lock.json`.
- No remote code, no eval. CSP: `script-src 'self'; object-src 'self'`.
- Network access: only to the relay URL the user enters or receives in an invite link (optional host permission).
- To test: open the add-on page, create a family with a relay URL (any HTTPS Worker running `relay/`, see `docs/RELAY.md`); the app also works fully offline without any relay.
