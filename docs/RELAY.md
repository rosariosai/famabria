# Famabria relay on Cloudflare (option B) — step by step, about 10 minutes, free

**What it is.** A tiny mailbox on the internet. Famabria puts *encrypted* files in it and your family's phones pick them up. Cloudflare never sees your notes (only unreadable data). You do this **once**; then every relative just taps an invite link.

**What you need.** A computer with Windows/Mac, an email address, and **Node.js** (free, from https://nodejs.org → the "LTS" button → install with all defaults). No credit card.

## Part 1 — Cloudflare account (in the browser)
1. Go to https://dash.cloudflare.com/sign-up and create the account (email + password). Open the email Cloudflare sends and click the confirmation link.
2. Log in. You are now in the **dashboard**. You don't need to buy or configure anything there.
3. In the left menu click **Workers & Pages**. If it asks you to choose a free *subdomain* (a name like `yourname.workers.dev`), type a short name and confirm. Skip anything that asks to "Create application" — the next part does that for you.

## Part 2 — Put the relay online (two commands)
1. Open a terminal in the Famabria folder: Windows → open the Famabria folder, click the address bar, type `cmd`, press Enter. (Mac: right-click the folder → New Terminal at Folder.)
2. Type this and press Enter: `npx wrangler login`
   - It asks "OK to proceed?" → type `y` and Enter. Your browser opens a Cloudflare page → click **Allow**. The terminal says "Successfully logged in". (No password or token to copy anywhere.)
3. Type this and press Enter: `npx wrangler deploy -c relay/wrangler.toml`
   - If it asks "Would you like to register a workers.dev subdomain?" → `y`, then type the name you like.
   - Wait about 20 seconds. It ends with a line like **`https://famcal-relay.yourname.workers.dev`**. That is your **relay address**. Copy it.
4. Check it: paste that address followed by `/healthz` in the browser, e.g. `https://famcal-relay.yourname.workers.dev/healthz`. You should see `{"ok":true,"relay":"famcal","v":1}`. 

Back in the Cloudflare dashboard → Workers & Pages you will now see **famcal-relay**. Nothing else to set.

## Part 3 — Create the family in Famabria
1. Open Famabria → **Famiglia** → **Crea con relay**.
2. Type a family name (e.g. "Casa"), paste the relay address, press **Crea e collega**.
3. The **invite link** appears. Press **Condividi…** (or **Copia il link**) and send it on WhatsApp to each relative.
4. They open the link and tap **Entra nella famiglia**. From then on the notes sync by themselves.

## If something goes wrong
- *"npx is not recognized"*: Node.js is not installed (or restart the terminal after installing it).
- *The terminal says you are not logged in*: run `npx wrangler login` again.
- *Famabria says the relay is not reachable*: the address must start with `https://` and the `/healthz` check above must work.
- *You want to cut everyone off*: Famiglia → Esci dalla famiglia, then create a new family (new key, new link).

## Good to know
- Free plan: 100,000 requests a day; a family syncing every 5 minutes uses a tiny fraction.
- Each device keeps one encrypted file up to 1 MB (thousands of notes). Up to 20 devices per family.
- Treat the invite link like a key: whoever has it can read the family's notes.
- Update later (new Famabria version): run the same `npx wrangler deploy -c relay/wrangler.toml`.

## Developers
Build the Worker: `npm run build:relay` → `relay/dist/worker.js` (a prebuilt copy ships in the folder, so the steps above need no build). One Durable Object per family room (strongly consistent; Cloudflare KV was rejected because its free plan allows only ~1000 list calls a day). Local test: `npm run dev:relay`. Home Node server instead of Cloudflare: `PORT=8430 HOST=0.0.0.0 DATA_FILE=/var/lib/famcal-relay.json node relay/dist/famcal-relay.cjs` (HTTPS in front when reached from outside).
Verified: 6 unit tests, and the Worker was run in Cloudflare's local runtime (`wrangler dev`) with the real Famabria client.


## The app itself on the same address (no home server needed)

`npm run deploy:relay` now also publishes the web app, so ONE address does everything:

- relay: `https://famcal-relay.<yourname>.workers.dev/healthz`
- the app (open this on every phone, also on 5G): `https://famcal-relay.<yourname>.workers.dev/app/app`

Steps on a phone (yours and your family's):

1. Open the app address above in Chrome (Android) or Safari (iPhone). Menu → **Add to Home screen** to get an icon.
2. Press **Famiglia → Crea con relay**. The relay address is already filled in. Press **Crea e collega**.
3. In the connected view press **Condividi…** and send the link to the family by WhatsApp. They open it and press **Entra nella famiglia**.

Note: notes typed in the extension stay in the extension (a different storage from the web app). Use the web app on phones.

**Windows without `npm install`:** the app files are already prepared in `relay/site`, so you do not need to build anything. Just run `npx wrangler deploy -c relay/wrangler.toml` (or `npm run publish:relay`). `npm run deploy:relay` rebuilds everything first and needs `npm install` once.


## API v1 (device tokens) — security steps 1-2

Next to the legacy `/r/<room>` API (unchanged, existing families keep working) the Worker offers `/v1`:

- `POST /v1/families` creates a family and returns `{family, device, token}` (you are its admin).
- `GET /v1/f/<family>/objects[/<name>]` reads; `PUT /v1/f/<family>/objects/d-<device>.fc` writes **only for the device that owns that name** (member/admin tokens; bots are read-only).
- `POST /v1/f/<family>/devices {"role":"member|bot"}` (admin) issues a token for another device; `DELETE /v1/f/<family>/devices/<id>` revokes it and removes its object.
- Tokens are `fc1.<payload>.<hmac>` signed with the Worker secret `TOKEN_SECRET`, valid 30 days (bots 90 days). The Worker verifies the token **before** a Durable Object is created or woken and rejects oversized uploads (Content-Length, then a capped stream) before buffering. 120 requests/minute per device (in memory).

Before the first deploy with v1: `npx wrangler secret put TOKEN_SECRET --config relay/wrangler.toml` (paste a long random string, e.g. `openssl rand -base64 48`), then `npx wrangler deploy -c relay/wrangler.toml`. Without the secret `/v1` answers 503 and nothing else changes. Also add a Cloudflare rate-limit rule on `POST /v1/families`.

### One-time invites (security step 3, relay side)
- `POST /v1/f/<family>/invites {authHash, role: member|bot, ttl<=900, blob}` (admin): stores `SHA-256(authKey)` and an opaque wrapped-key `blob` (<= 2 KB); returns a signed `ticket` (`fci.…`). At most 3 open invites; expired ones are purged.
- `POST /v1/f/<family>/invites/<ticket>/redeem {auth, pub?}` (no token): the Worker checks the ticket signature/expiry before any Durable Object; the DO compares `SHA-256(auth)` in constant time, burns the invite on success (returns `{device, role, token, blob}`) and after 5 wrong tries. Every failure answers the same `403 invalid invite`.
- Invites can never create admins. The relay never sees the family key: `blob` is encrypted with a key derived from the invite secret that only lives in the link fragment.

### Token refresh
`POST /v1/f/<family>/token/refresh` (admin/member token) returns a fresh 30-day token for the same device; bots cannot renew (90-day token). The app asks for a new token at sync time when fewer than 15 days are left and stores it; a device that stays offline for more than 30 days must be invited again.

`GET /v1/f/<family>/devices` (admin) lists the family's devices `[{device, role, first, revoked}]`; the relay records a device the first time it is seen. Names are not known to the relay (they are inside the encrypted objects); the app shows them.
