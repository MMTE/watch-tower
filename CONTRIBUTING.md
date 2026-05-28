# Contributing to Watch Tower

Thanks for your interest! Watch Tower is intentionally small and pluggable.

## Dev setup

```bash
git clone https://github.com/MMTE/watch-tower.git
cd watch-tower
npm install
cp .env.example .env       # fill only the channels you want to test
npm start                  # REST API + Telegram bot
npm run mcp                # MCP server over stdio
npm test                   # smoke test (no network required)
```

Node ≥ 20 is required (uses global `fetch` / `FormData`).

## Adding a new channel

A channel is a CommonJS module under [`src/channels/`](src/channels) that exports:

```js
module.exports = {
  name: 'mychannel',           // lowercase, unique
  enabled: Boolean(/* env */), // computed at load time
  async sendMessage(text, { title, level, parse_mode } = {}) { /* ... */ },
  async sendFile(filePath, { caption, filename, title, level } = {}) { /* ... */ },
};
```

Then register it in the `ALL` array in [`src/channels/index.js`](src/channels/index.js) and add its env vars to [`.env.example`](.env.example) and the channel table in [`README.md`](README.md).

Guidelines:

- Map the four severity levels (`info`, `warn`, `error`, `critical`) to your channel's native priority if it has one.
- If your channel can't natively attach files, fall back to a textual message (see [`gotify.js`](src/channels/gotify.js)).
- Throw on hard failures so the dispatcher can report them per-channel; don't swallow errors silently.

## Style

- Plain CommonJS, no build step.
- Match the surrounding style; no linter is configured.
- Keep changes small and focused. New runtime dependencies need a clear reason.

## Pull requests

1. Fork and branch from `main`.
2. Run `npm test` before pushing.
3. Update [`README.md`](README.md) and [`CHANGELOG.md`](CHANGELOG.md) when behavior changes.
4. Describe what you changed and why in the PR body.

## Reporting bugs

Open an issue with reproduction steps, the channels involved, Node version, and any redacted error output. Please redact tokens and chat IDs.
