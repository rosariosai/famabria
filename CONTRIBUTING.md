# Contributing

Thanks for your interest in Famabria! Bug reports, translations and pull requests are welcome.

## Before you start

- Open an issue first for anything bigger than a small fix, so we can agree on the approach.
- Security problems: do not open an issue, see [SECURITY.md](SECURITY.md).

## Development

```bash
npm ci
npm run dev            # watch build for the Chrome extension
npm run typecheck
npm test
```

Load `dist/chrome` as an unpacked extension (chrome://extensions, Developer mode). For Firefox use `npm run build:firefox` and `about:debugging`.

## Pull requests

- Keep changes focused; one topic per PR.
- `npm run typecheck` and `npm test` must pass (CI runs them, plus the build).
- Add or update tests for behaviour changes, especially in crypto, sync and the relay.
- The app does not collect analytics or load remote code: please keep it that way. New network destinations or permissions need a clear justification.
- Never commit secrets, real invite links, tokens or personal addresses.

By contributing you agree that your contribution is licensed under the MIT License.
