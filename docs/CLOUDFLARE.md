# Cloudflare integration

Famabria uses Cloudflare for two optional things, both on the free plan:

1. **The relay** (a Worker with one Durable Object per family) that stores the encrypted family files. It also serves the web app (PWA) from the same address.
2. **The website** (`site-famabria/`), a static page on Cloudflare Pages.

The relay only ever holds ciphertext. Step-by-step beginner guide: [RELAY.md](RELAY.md). This page is the reference for developers and for automatic deploys from GitHub.

## 1. Deploy the relay by hand

```bash
npm ci
npx wrangler login
npm run deploy:relay        # builds the web app, copies it into relay/site, bundles the Worker, deploys
npx wrangler secret put TOKEN_SECRET --config relay/wrangler.toml   # paste a long random string
```

Generate the secret with `openssl rand -base64 48` (macOS/Linux) or PowerShell `[Convert]::ToBase64String((1..48 | % { Get-Random -Max 256 }))`. Without `TOKEN_SECRET` the `/v1` API answers 503 and nothing else changes. Never commit it.

Check: `https://<worker>.<you>.workers.dev/healthz` returns `{"ok":true,...}`. The app is at `/app/app.html`. Use that address as the relay URL in Famabria > Famiglia > Crea con relay.

Change the Worker name in `relay/wrangler.toml` (`name = "..."`) if you want your own address. The name becomes part of every invite link, so pick it once.

## 2. Automatic deploys from GitHub

### Option A: Cloudflare Workers Builds (no secrets in GitHub)
In the Cloudflare dashboard: Workers & Pages > your Worker > Settings > Builds > Connect to Git, choose your fork, then set:

- Build command: `npm ci && npm run build:web && node relay/site.mjs && npm run build:relay`
- Deploy command: `npx wrangler deploy -c relay/wrangler.toml`
- Production branch: `main`

Add `TOKEN_SECRET` under Settings > Variables and Secrets (type: Secret).

### Option B: GitHub Actions
`.github/workflows/deploy-relay.yml` deploys on demand (Actions tab > "Deploy relay" > Run workflow). In your fork add repository secrets:

| Secret | Where to get it |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare dashboard > My Profile > API Tokens > Create Token > template "Edit Cloudflare Workers" |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare dashboard > Workers & Pages (right column) |

The workflow runs typecheck and tests first and refuses to deploy if they fail. It does not touch `TOKEN_SECRET` (set once, see above).

## 3. Protect the relay

- Add a **rate limiting rule** for `POST /v1/families` (Security > WAF > Rate limiting rules), for example 10 requests per minute per IP. Anyone can create a family on an open relay; the limit stops abuse.
- Keep the Worker on the free plan limits: 1 MB per object, 20 devices per family, 120 requests/minute/device are enforced in code.
- Optional: attach a custom domain (Worker > Settings > Domains & Routes). Do this before sharing invites: the address is inside every invite and installed app.

## 4. The website on Cloudflare Pages

```bash
npx wrangler pages deploy site-famabria --project-name <your-project> --branch main
```

`site-famabria/_headers` sets security headers (CSP, HSTS, no framing). For a custom domain add it under Pages > Custom domains and enable DNSSEC in the zone.

## 5. Home server instead of Cloudflare

If you prefer not to use Cloudflare, `relay/node.ts` runs the same API on a Node server: `PORT=8430 HOST=0.0.0.0 DATA_FILE=/var/lib/famabria-relay.json node relay/dist/famabria-relay.cjs` after `npm run build:relay`. Put it behind HTTPS (the extension and phones require it for anything outside your LAN).
