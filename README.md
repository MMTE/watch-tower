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

| Channel    | text | files         | two-way                      | Required env                               | Notes                          |
| ---------- | ---- | ------------- | ---------------------------- | ------------------------------------------ | ------------------------------ |
| `telegram` | ✅   | ✅            | ✅ capture + threading       | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`   | Bot UI + native file uploads   |
| `bale`     | ✅   | ✅            | ❌ (roadmap)                 | `BALE_BOT_TOKEN`, `BALE_CHAT_ID`           | Telegram-compatible BotAPI     |
| `pushover` | ✅   | text fallback | ❌ (provider limit)          | `PUSHOVER_APP_TOKEN`, `PUSHOVER_USER_KEY`  | Priority maps from `level`     |
| `gotify`   | ✅   | text fallback | ❌ (provider limit)          | `GOTIFY_URL`, `GOTIFY_APP_TOKEN`           | Files sent as inline text      |
| `ntfy`     | ✅   | ✅            | ❌ (roadmap: action buttons) | `NTFY_TOPIC` (+ `NTFY_URL`, auth)          | Native `Title`/`Priority`/`Tags` |

Set `DEFAULT_CHANNELS=telegram,ntfy` to scope the default fan-out list. Every API/MCP request can also override with its own `channels` field.

### Channel roadmap

- [ ] Bale two-way reply capture (mirrors the Telegram inbox).
- [ ] ntfy action buttons (approve/deny callbacks landing in the same inbox).
- [ ] Reply webhooks: push each captured reply to an agent runtime instead of polling.
- [ ] Support multiple configured instances of the same channel type, while keeping current single-instance env vars backward compatible. Example selectors: `telegram:ops`, `telegram:dev`, `ntfy:prod`, `ntfy:dev`.

### Severity → priority mapping

| Level      | Pushover         | Gotify | ntfy |
| ---------- | ---------------- | ------ | ---- |
| `info`     | -1               | 2      | 2    |
| `warn`     | 0                | 5      | 3    |
## REST API

Base path: `/api`. All endpoints except `/health` require an `x-api-key` header, `?key=`, or `Authorization: Bearer` token.

### `POST /api/send`

The canonical endpoint. `alert` / `log` / `agent` below are sugar over it.

```bash
curl -X POST $BASE/api/send -H "Content-Type: application/json" -H "x-api-key: $KEY" \
  -d '{"text":"deploy done","title":"prod","level":"info","channels":["telegram","ntfy"],"reply_to":4578}'
```

| Field       | Type   | Notes                                          |
| ----------- | ------ | ---------------------------------------------- |
| `text`      | string | Required. Message body                         |
| `title?`    | string | Bold header on chat channels                   |
| `level?`    | enum   | `info` \| `warn` \| `error` \| `critical`      |
| `channels?` | array  | Channel names; omit for defaults / all enabled |
| `reply_to?` | number | Telegram `message_id` to thread into           |

### `POST /api/alert`, `POST /api/log`, `POST /api/agent`

Sugar over `/api/send`: `alert` = `{level, title, message}`, `log` = `{source, log}`
(code-formatted), `agent` = `{repo, summary, kind, issue?, issue_url?}` (checkpoint
format). All accept `channels` and compile into the same dispatch.

### `POST /api/file`

```bash
curl -X POST $BASE/api/file -H "x-api-key: $KEY" \
  -F "file=@report.pdf" -F "filename=daily-report.pdf" -F "caption=Daily report" \
  -F "reply_to=4578" -F "channels=telegram,pushover"
```

### Response shape

```json
{ "ok": true, "delivered": ["telegram"], "errors": [], "message_ids": { "telegram": 4578 } }
```

`ok` is `true` if at least one channel delivered (else HTTP `502`). `message_ids` carries
the provider message id per channel when available (Telegram today) — use it as `reply_to`
to thread. An unknown channel name returns `400` with the available list in the message.

## Reading replies (two-way)

Messages the authorized Telegram chat sends to the bot are captured with their
`reply_to_message_id` and polled by agents:

```bash
# everything after high-water mark 4578, long-poll up to 30s for the next one
curl "$BASE/api/agent/replies?since=4578&wait=30" -H "x-api-key: $KEY"
```

| Param   | Notes                                            |
| ------- | ------------------------------------------------ |
| `since` | only entries with `id > since` (default 0 = all) |
| `limit` | most recent N, oldest first                      |
| `wait`  | long-poll seconds, capped at 55                  |

Each entry: `{ id, text, chat_id, reply_to_message_id, reference, ts }`. The bot reacts 👍
to every captured message so the human knows it landed; the answer comes from your agent.

## MCP server (for AI agents)

Stdio transport. For the HTTP transport (`POST /mcp` with an API key), deploy the server and point MCP clients at its URL. Configure a stdio client with `node /path/to/src/mcp.js`:


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

| Tool            | Params                                                | Description                                  |
| --------------- | ----------------------------------------------------- | -------------------------------------------- |
| `send`          | `text`, `title?`, `level?`, `channels?`, `reply_to?`  | Notify a human; result carries `message_id`   |
| `send_file`     | `path`, `caption?`, `filename?`, `reply_to?`, …       | Send a local file                             |
| `get_replies`   | `since?`, `wait?` (0–60s), `limit?`                   | Read human replies, optional long-poll        |
| `list_channels` | —                                                     | Configured state + two-way capability         |

The server's `instructions` teach the loop: `send` → note the `message_id` →
`get_replies({ since, wait })` → the answer arrives with `reply_to_message_id` →
`send(..., { reply_to })` threads the follow-up. `level` maps to native priority on
Pushover/Gotify/ntfy; `channels` selects specific channels, omitted = defaults.

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
├── index.js            Entry: REST + bot + status page
├── app.js              Express factory, /status, /admin, /mcp (HTTP)
├── api.js              REST routes
├── agent.js            Agent notify + replies inbox endpoint
├── auth.js             Shared API-key middleware
├── replies.js          Reply inbox store (capture / list / waitFor)
├── bot.js              Telegram bot UI (commands)
├── mcp.js              MCP stdio entry
├── mcpServer.js        MCP tools (send, send_file, get_replies, list_channels)
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
