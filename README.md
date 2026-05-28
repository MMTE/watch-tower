<p align="center">
  <img src="docs/logo.png" alt="Watch Tower" width="180" height="180" />
</p>

# Watch Tower

[![CI](https://github.com/MMTE/watch-tower/actions/workflows/ci.yml/badge.svg)](https://github.com/MMTE/watch-tower/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen.svg)](package.json)
[![MCP](https://img.shields.io/badge/MCP-1.x-purple.svg)](https://modelcontextprotocol.io)

Pluggable notification hub for AI agents and apps. One **MCP server** + one **REST API** that fan out to multiple notification channels.

**Built-in channels:** Telegram · Bale · Pushover · Gotify · ntfy.

No web UI — interact via the Telegram bot, the REST API, or the MCP server. Adding a new channel takes ~50 lines of code.

```diagram
╭──────────────╮     ╭──────────────╮     ╭─────────────╮
│  AI agent    │     │  Your app    │     │  Telegram   │
│  (MCP tool)  │     │  (REST)      │     │  bot user   │
╰──────┬───────╯     ╰──────┬───────╯     ╰──────┬──────╯
       │                    │                    │
       ▼                    ▼                    ▼
       ╰──────▶ ╭──────────────────────────╮ ◀──╯
                │      Watch Tower         │
                │   dispatcher (fan-out)   │
                ╰────┬────┬────┬────┬──────╯
                     ▼    ▼    ▼    ▼    ▼
              Telegram Bale Push Gotify ntfy
```

## Quick start

```bash
git clone https://github.com/MMTE/watch-tower.git
cd watch-tower
cp .env.example .env       # fill in only the channels you want
npm install
npm start                  # REST API + Telegram bot
npm run mcp                # MCP server over stdio (for AI agents)
npm test                   # smoke test, no network required
```

Requires **Node ≥ 20** (uses global `fetch` / `FormData`).

With Docker:

```bash
cp .env.example .env
docker compose up -d --build
```

## Deploy on Railway

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/81DFSm?referralCode=1PbvOz&utm_medium=integration&utm_source=template&utm_campaign=generic)

Uses the existing `Dockerfile` and `railway.json` (healthcheck on `/api/health`, restart on failure). After the first deploy:

1. Set `API_KEY` and any channel credentials (`TELEGRAM_BOT_TOKEN`, `NTFY_TOPIC`, …) in the Variables tab.
2. Under Settings → Networking, generate a public domain.
3. Set `WEBHOOK_URL` to that public HTTPS URL (no trailing slash) — Telegram then uses webhook mode instead of polling.
4. Redeploy.

Railway injects `PORT`; the app picks it up automatically.

> **Heads up on the free / Hobby tier:** Railway sleeps idle apps, which means alerts sent while the service is asleep are lost (Telegram drops webhook updates after retries; the others have no retry at all). For production alerting, use the paid plan or a host that doesn't idle.

## Channels

A channel is **enabled** when its environment variables are set. Disabled channels are silently skipped.

| Channel    | Required env                                | Notes                                  |
| ---------- | ------------------------------------------- | -------------------------------------- |
| `telegram` | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`    | Bot UI + native file uploads           |
| `bale`     | `BALE_BOT_TOKEN`, `BALE_CHAT_ID`            | Telegram-compatible BotAPI             |
| `pushover` | `PUSHOVER_APP_TOKEN`, `PUSHOVER_USER_KEY`   | Priority maps from `level`             |
| `gotify`   | `GOTIFY_URL`, `GOTIFY_APP_TOKEN`            | Files sent as inline text fallback     |
| `ntfy`     | `NTFY_TOPIC` (+ optional `NTFY_URL`, auth)  | Native `Title` / `Priority` / `Tags`   |

Set `DEFAULT_CHANNELS=telegram,ntfy` to scope the default fan-out list. Every API/MCP request can also override with its own `channels` field.

### Channel roadmap

- [ ] Support multiple configured instances of the same channel type, while keeping current single-instance env vars backward compatible. Example selectors: `telegram:ops`, `telegram:dev`, `ntfy:prod`, `ntfy:dev`.

### Severity → priority mapping

| Level      | Pushover         | Gotify | ntfy |
| ---------- | ---------------- | ------ | ---- |
| `info`     | -1               | 2      | 2    |
| `warn`     | 0                | 5      | 3    |
| `error`    | 1                | 7      | 4    |
| `critical` | 2 (emergency)    | 10     | 5    |

## REST API

Base path: `/api`. All endpoints except `/health` require an `x-api-key` header (or `?key=`).

Every send endpoint accepts an optional `channels` field — an array or comma-separated string of channel names.

### `GET /api/health`

Public. Reports per-channel configured state.

```json
{ "ok": true, "channels": [{ "name": "telegram", "enabled": true }, ...] }
```

### `POST /api/send`

```bash
curl -X POST $BASE/api/send -H "Content-Type: application/json" -H "x-api-key: $KEY" \
  -d '{"text":"deploy done","title":"prod","channels":["telegram","ntfy"]}'
```

### `POST /api/alert`

```bash
curl -X POST $BASE/api/alert -H "Content-Type: application/json" -H "x-api-key: $KEY" \
  -d '{"level":"error","title":"Deployment Failed","message":"Build #42 failed"}'
```

### `POST /api/log`

```bash
curl -X POST $BASE/api/log -H "Content-Type: application/json" -H "x-api-key: $KEY" \
  -d '{"source":"nginx","log":"502 Bad Gateway"}'
```

### `POST /api/file`

```bash
curl -X POST $BASE/api/file -H "x-api-key: $KEY" \
  -F "file=@report.pdf" -F "filename=daily-report.pdf" -F "caption=Daily report" \
  -F "channels=telegram,pushover"
```

### Response shape

```json
{ "ok": true, "delivered": ["telegram","ntfy"], "errors": [] }
```

`ok` is `true` if at least one channel accepted the message. Returns HTTP `502` when zero channels delivered.

## MCP server (for AI agents)

Stdio transport. Configure your client with `node /path/to/src/mcp.js`.

```json
{
  "mcpServers": {
    "watch-tower": {
      "command": "node",
      "args": ["/absolute/path/to/watch-tower/src/mcp.js"],
      "env": {
        "TELEGRAM_BOT_TOKEN": "...",
        "TELEGRAM_CHAT_ID": "...",
        "NTFY_TOPIC": "...",
        "WATCHTOWER_MCP": "1"
      }
    }
  }
}
```

### Tools

| Tool            | Params                                                                | Description                                  |
| --------------- | --------------------------------------------------------------------- | -------------------------------------------- |
| `send_message`  | `text`, `title?`, `parse_mode?`, `channels?`                          | Plain text notification                      |
| `send_alert`    | `level`, `title`, `message`, `channels?`                              | Severity-tagged alert                        |
| `send_log`      | `source`, `log`, `channels?`                                          | Code-formatted log entry                     |
| `send_file`     | `path`, `caption?`, `filename?`, `title?`, `level?`, `channels?`      | Send a local file                            |
| `list_channels` | —                                                                     | Show which channels are configured           |

`channels` is an array of channel names; omit to use defaults / all enabled.

## Telegram bot commands

| Command         | Description                       |
| --------------- | --------------------------------- |
| `/start`        | Register and get chat ID          |
| `/ping`         | Liveness check                    |
| `/id`           | Show your chat ID                 |
| `/status`       | Uptime, memory, active channels   |
| `/channels`     | List configured channels          |
| `/help`         | Show help                         |
| `/time`         | Server time                       |
| `/echo <text>`  | Echo back                         |

## Project layout

```diagram
src/
├── index.js            REST + Telegram webhook
├── api.js              Express routes
├── bot.js              Telegram bot UI (commands)
├── mcp.js              MCP stdio server
└── channels/
    ├── index.js        Registry + dispatcher (notify / notifyFile)
    ├── telegram.js
    ├── bale.js
    ├── pushover.js
    ├── gotify.js
    └── ntfy.js
test/
└── smoke.js            No-network unit + HTTP smoke
```

## Adding a channel

See [CONTRIBUTING.md](CONTRIBUTING.md#adding-a-new-channel). TL;DR: drop a module in `src/channels/` exporting `{ name, enabled, sendMessage, sendFile }` and register it in [`src/channels/index.js`](src/channels/index.js).

## Contributing & security

- Contributions: see [CONTRIBUTING.md](CONTRIBUTING.md).
- Vulnerability reports: see [SECURITY.md](SECURITY.md). Please don't open a public issue for security problems.
- Changes by release: see [CHANGELOG.md](CHANGELOG.md).

## License

MIT — see [LICENSE](LICENSE).
