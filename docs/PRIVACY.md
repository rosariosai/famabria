# Privacy Policy

_Last updated: 2026-11-04_

Famabria is a family calendar made by Rosario Savoia. This page explains what data the extension, the web app and the optional relay handle.

## Short version

No accounts, no analytics, no ads, no tracking. Your notes are stored on your devices and, if you share with family, sent only in **encrypted** form.

## Data stored on your device

Notes, calendars, family member names and settings are stored locally in the browser (IndexedDB / extension storage). Nothing leaves the device unless you create or join a family.

## Sharing with family (relay)

When you create or join a family, each device uploads one encrypted file to a relay (by default a Cloudflare Worker operated by the author; you can host your own). Encryption is AES-GCM with a family key that is generated on your device and shared only inside the one-time invite link fragment, which is never sent to any server. The relay therefore cannot read your notes. It does see technical metadata: family and device identifiers, number of devices, file sizes, write times and IP addresses of requests. The relay keeps no account or email data.

## Permissions

The extension requests **no permission at install**. When you connect to a relay, it asks the browser for access to that single server address (optional host permission), only so the extension can send and receive the encrypted files. It does not read the pages you visit.

## Reminders (optional)

If you run the reminders program on your own machine, it reads the family's encrypted notes as a read-only device and sends the reminder text to the ntfy server you choose. That is outside this project's control; use a topic name that is long and random, or your own ntfy server.

## Third parties

No data is sold or shared with third parties. The website and relay run on Cloudflare, which may process request logs under its own policy.

## Your control

Delete your data by removing the extension / web app data, leaving the family (Famiglia > Esci dalla famiglia) and, as family admin, removing devices. You can export a backup (Impostazioni > Copia di sicurezza).

## Contact

Open an issue on <https://github.com/rosariosai/famabria> or use private vulnerability reporting for security matters.
