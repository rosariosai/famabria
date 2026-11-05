# Chrome Web Store submission (Famabria)

Package: `npm run build:chrome && npm run zip` -> zip of `dist/chrome`. Version: see `package.json`.

## Listing
- **Name:** Famabria — Family Calendar
- **Summary (max 132):** Family calendar with shared notes and reminders. Encrypted, no accounts, works offline.
- **Category:** Productivity
- **Language:** English (the app interface is Italian; say so in the description)
- **Privacy policy URL:** https://github.com/rosariosai/famabria/blob/main/docs/PRIVACY.md
- **Website / support:** https://famabria.com , https://github.com/rosariosai/famabria/issues

## Description
Famabria is a calendar for your family's notes and reminders, shared between everyone's computers and phones.

- Works offline: notes are stored on your device.
- Share with family using one-time invite links. No accounts, no email, no sign-up.
- End-to-end encrypted: the relay server only ever holds unreadable data.
- Optional push reminders through ntfy, sent by a small program you run yourself.
- Open source (MIT): https://github.com/rosariosai/famabria

The interface is in Italian.

## Single purpose
A shared family calendar: write notes on days, share them with your family in encrypted form.

## Permission justification
- **Permissions at install:** none.
- **Optional host permissions** (`https://*/*`, `http://*/*`): requested at runtime, only for the one relay server address the user enters or receives in an invite link, so the extension can upload/download the encrypted family files. The extension never reads or changes web pages and has no content scripts.
- **Remote code:** none. All code is bundled; CSP `script-src 'self'`.

## Data usage form
- Collects: none by the developer. Notes stay on the device; shared notes are end-to-end encrypted.
- Certify: not sold, not used for unrelated purposes, not used for creditworthiness.

## Assets
Screenshots 1280x800 in `docs/store/chrome/` (calendar month, week, note form, family/invite, settings). Icon 128x128 from `public/icons/128.png`.
