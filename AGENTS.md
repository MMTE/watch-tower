# Watch Tower — notes for coding agents

Pluggable notification hub: one dispatcher fans out to channels; Telegram replies are
captured back into an inbox agents poll. MCP + REST + Telegram bot are the three faces.

## Ground rules

- Node ≥ 20, CommonJS (`require`), no build step, no TypeScript. Zero-runtime-dep policy:
  ask before adding any dependency.
- Config is env-only (`.env.example` is the source of truth). A channel is enabled iff its
  env vars are set; disabled channels are silently skipped.
- Tests: `npm test` (`test/smoke.js`) — assert-based, no frameworks, **no network**. CI
  runs it on every push. Add a test in the same style for any behavior you add; watch it
  fail first.
- `WATCHTOWER_MCP=1` suppresses Telegram polling/webhook side effects — the smoke test
  relies on it. `WATCHTOWER_DATA_DIR` relocates the reply store.

## Architecture map

- `src/channels/index.js` — registry + dispatcher (`notify` / `notifyFile` → `fanOut`).
  Result: `{ delivered, errors, message_ids }`. This is the spine; everything else calls it.
- `src/channels/<name>.js` — channel plugin: `{ name, enabled, sendMessage(text, opts),
  sendFile(path, opts), twoWay? }`. `opts.reply_to` threads when the provider can.
- `src/replies.js` — inbox: `capture(msg)`, `list({since, limit})`, `waitFor(since, ms)`
  (long-poll). File-backed, capped at 500.
- `src/mcpServer.js` — the 4 MCP tools; keep `INSTRUCTIONS` in sync with the actual loop.
- `src/api.js` (`/api/*`), `src/agent.js` (`/api/agent*`), `src/app.js` (factory, `/status`,
  `/mcp` HTTP), `src/bot.js` (Telegram command UI), `src/auth.js` (shared `requireApiKey`).

## Conventions

- Conventional commits (`feat:`, `fix:`, `docs:`, …). Update `CHANGELOG.md` on user-facing
  changes. Keep `README.md` endpoint tables in sync with `src/api.js` — drift is a bug.
- Error taxonomy: 400 validation/unknown channel (message lists available), 401 auth,
  502 zero delivered, 500 bugs.
- Adding a channel: module in `src/channels/`, register in `src/channels/index.js` `ALL`,
  env rows in `.env.example` + README matrix, interface test already enforces the shape.
