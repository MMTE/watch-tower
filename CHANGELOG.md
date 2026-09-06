# Changelog

All notable changes to this project will be documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows [SemVer](https://semver.org/).

## [1.3.0] - 2026-09-06

### Added
- Two-way reply loop: MCP `get_replies` tool (`since`, `wait` long-poll, `limit`) and
  `GET /api/agent/replies?since=&limit=&wait=`.
- Reply correlation by id: captured entries store `chat_id` and `reply_to_message_id`.
- Outbound `message_ids` in dispatch results (REST + MCP); `reply_to` threads a Telegram
  follow-up into the original message (`send`, `send_file`, `/api/send`, `/api/file`).
- Bot reacts 👍 to captured replies so the human sees the message landed.
- MCP server `instructions` teaching the send → get_replies → reply_to loop.
- Status page shows real channel states and the last captured reply; simple `/admin`
  page (API-key gated) with recent sends, inbox, and a test-send form.
- `AGENTS.md` for coding agents working on this repo; `npm run dev` (watch mode).

### Changed
- MCP tools consolidated: `send_message`/`send_alert`/`send_log` → one `send` with
  `level` (**breaking** for MCP clients); `parse_mode` removed from the public schema.
- Shared API-key auth on `/api/*` — `Authorization: Bearer` now accepted everywhere.
- Unknown channel name in a send request returns `400` (was `500`) with the available
  channel list in the message.

## [1.2.0] - 2026-05-28

### Added
- Streamable HTTP MCP transport at `POST /mcp`, protected by API key (accepts `x-api-key` header, `?key=` query param, or `Authorization: Bearer` token).
- Public status page at `GET /status` showing version, uptime, memory usage, environment, and per-channel enable state.
- `GET /` redirects to `/status`.
- `src/app.js` — Express app factory (`createApp`), auth helpers (`getApiKey`, `requireApiKey`), and status page renderer.
- `src/mcpServer.js` — MCP server factory (`createMcpServer`) shared by stdio and HTTP transports.
- Smoke tests for the status page, MCP HTTP endpoint, and all three API-key input forms.

### Changed
- `src/index.js` simplified to use `createApp()`.
- `src/mcp.js` simplified to use `createMcpServer()`.
- MCP server version now reads from `package.json` instead of being hardcoded.

## [1.1.0] - 2026-05-28

### Added
- Pluggable channel architecture under `src/channels/`.
- Pushover, Gotify, and ntfy channels.
- Per-request `channels` selector on every REST endpoint and MCP tool.
- `DEFAULT_CHANNELS` env to scope the default fan-out list.
- New MCP tools: `send_file`, `list_channels`.
- `/api/channels` REST endpoint and `/channels` Telegram bot command.
- Severity → priority mapping for Pushover (-1..2), Gotify (2..10), ntfy (1..5 + tags).
- Per-channel delivery report in API responses (`delivered`, `errors`).
- Automatic cleanup of files in `uploads/` after `/api/file` dispatch.
- Smoke test (`npm test`) covering channel resolution and dispatcher.
- LICENSE (MIT), CONTRIBUTING, SECURITY, CHANGELOG, GitHub Actions CI.

### Changed
- API response shape now reports per-channel outcome and returns `502` when no channel delivered.
- Telegram bot UI moved out of the channel module into `src/bot.js`.
- Dockerfile runs as a non-root user with a healthcheck.
- `docker-compose.yml` is now generic (no personal network or hostname).

### Removed
- Hard-coded production URL from the README.
- Old `src/bale.js` (replaced by `src/channels/bale.js`).

## [1.0.0]

- Initial release: Telegram bot + REST API + MCP server.
