# Famabria: security model (as implemented, 2026-11-03, app 2.6.0)

Full review and target design: project doc `claude/famabria-security-review.md`. Progress: `claude/famabria-security-status.md`.

## How a family is protected today (v2 families)
- **Encryption:** every device writes ONE object `d-<deviceId>.fc`, encrypted with AES-GCM under the family key (HKDF), and read by the other devices. The relay stores ciphertext only.
- **Device tokens** (relay `/v1`): HMAC-signed (secret `TOKEN_SECRET`, a Worker secret), roles admin / member / bot. Verified in the Worker BEFORE a Durable Object is created or woken. Member/admin tokens last 30 days and renew themselves at sync time (< 15 days left); bot tokens last 90 days and renew too.
- **Write isolation:** a device can write only its own object; bots are read-only; the admin can list and remove devices (Famiglia > Dispositivi, 2.7.0).
- **Limits:** 1 MB per object, 20 objects, 120 requests/minute/device, bodies refused by Content-Length and a capped stream before buffering.
- **One-time invites:** admin creates an invite (max 3 open, 15 minutes, one use, never admin). The link holds a signed ticket + a one-time secret; the family key is wrapped with a key derived from that secret, so the relay never sees it. After 5 wrong tries the invite is burnt. Every failure answers the same generic 403. The link fragment (`#invite=...`) never reaches a server.
- **Backups:** Impostazioni > Copia di sicurezza (notes + member names, no keys). Restoring never overwrites newer notes.
- **Domain:** famabria.com on Cloudflare with DNSSEC; the one-page site sends security headers (`site-famabria/_headers`).

## Legacy families (old permanent link `#join=...`)
Still work (`/r/<room>`), but the link is a permanent key + token. The family used by the owner has been migrated; other devices may still be pending. After the last device has moved, the old objects must be overwritten ("switch off the old link").

## Moving a legacy family to v2 (what the app does)
Famiglia > "Passa alla famiglia sicura": creates a v2 family on the same relay, keeps all notes on the device and sends them to the new family. Other devices: Esci dalla famiglia > Ho un invito > paste the new one-time link INSIDE the installed app (on iPhone the home-screen app and Safari have separate storage). Home-server reminders: "Invito per il server di casa" (bot, read-only), see `docs/REMINDERS.md`.

## Known open points (priority order)
1. Switch off the old permanent link after every device has migrated.
2. Reminder script on the home server still reads the old family until it is given a server invite.
3. ~~No device list / Remove button~~ DONE in 2.7.0 (Famiglia > Dispositivi, admin only). Removing does NOT yet rotate the key (see 4).
4. Removing a device does not rotate the family key (needs key epochs + rotation).
5. A malicious relay could add its own "device" (needs admin pinning of device keys).
6. Crypto v2 not done: per-file subkeys, replay protection (sequence numbers), padding, no gzip.
7. Bot reads everything (needs a reminders-only key).
8. Web app CSP / response headers for the app origin; rate limit on `POST /v1/families` (no WAF rule yet).

## Not protected (accepted)
A compromised member device sees everything current. The relay sees metadata (family id, number of devices, write times, object sizes, IP). The web app is as trustworthy as the deployment that serves it.
