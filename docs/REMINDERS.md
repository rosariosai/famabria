# Reminders with ntfy (home server)

Each note can have a reminder ("Promemoria" in the note form). The notification is sent by `server/reminders/famabria-reminders.mjs`,
a small program that runs on the home server (any always-on machine) in a Node container.

* It joins the family with the invite link as a **read-only** device: it reads the encrypted notes from the relay (Cloudflare or home) and never writes.
* When a reminder is due it posts to ntfy; the ntfy app on the phone shows the notification.
* Cloudflare keeps syncing the phones and PCs; the home server only sends reminders. If the home server is off, reminders are not sent (nothing is lost: reminders that came due in the last 6 hours are sent when it restarts).

## Setup (home server, Docker image)
The program is published as a ready-made image: `ghcr.io/rosariosai/famabria-reminders` (amd64 and arm64, for example a Raspberry Pi). You do not need to copy the script.
1. In a folder on the server put `compose.yaml` (from `server/reminders/`).
2. Create `.env` in the same folder:
   ```
   FAMABRIA_INVITE=<paste the invite link from the app: Famiglia > Crea invito per il server>
   NTFY_URL=https://ntfy.sh
   NTFY_TOPIC=famabria-<20 random letters and digits>
   ```
   Use your own ntfy server address instead of `https://ntfy.sh` if you run one. The phone app must use the same server.
3. `docker compose up -d` and `docker compose logs -f` (it prints "Famabria promemoria attivo").
4. Test: `docker compose run --rm famabria-reminders node famabria-reminders.mjs --test`.
5. On the phone: ntfy app > + > the same topic and the same server; battery of the app set to "no restrictions".

No Docker image? Build it from source with `docker compose up -d --build` in `server/reminders/`, or run `node famabria-reminders.mjs` with the same variables.

The topic name acts as a password on an open ntfy server: keep it long and private. Times follow the server's time zone (`TZ=Europe/Rome` in the compose file).
Reminder rules: "all'ora" = at the note's time (09:00 for all-day notes), "10 minuti / 1 ora prima", "il giorno prima alle 18:00".


## Families created with the new invites (v2)
In the app: Famiglia > "Crea invito per il server" (read-only, one use, 15 minutes). Put that link in `FAMABRIA_INVITE` and start the script: it redeems the invite once and saves its own credentials in `STATE_FILE` (so keep `/data/state.json` on a volume and make a backup of it). After the first run you can delete the invite from `.env`. The script renews its 90-day token by itself. If the state file is lost, create a new server invite.
