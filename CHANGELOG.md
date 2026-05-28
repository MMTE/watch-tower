# Changelog

All notable changes to this project will be documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows [SemVer](https://semver.org/).

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
