# Security Policy

## Reporting a vulnerability

Please do **not** open a public issue for security problems.

Use GitHub's private vulnerability reporting: go to the **Security** tab of this repository and choose **Report a vulnerability**. Include what you found, how to reproduce it and the version (Settings > About in the app).

You will get an acknowledgement within a few days. This is a one-person project, so fixes are made on a best-effort basis; critical issues come first.

## Scope

In scope: the extension, the web app, the relay Worker (`relay/`), the reminders program (`server/reminders/`) and the cryptography in `src/core` and `src/sync`.

Out of scope: attacks that need a compromised member device (it can read everything current by design) and the metadata the relay necessarily sees (see [docs/SECURITY.md](docs/SECURITY.md) for the model and known open points).

## Supported versions

Only the latest release receives fixes.
