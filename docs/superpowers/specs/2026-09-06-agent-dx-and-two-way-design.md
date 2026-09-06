# Watch Tower: Agent DX & Two-Way Replies — Design

Date: 2026-09-06 · Status: proposed · Milestone: v1.3.0

## Problem

Three user-reported failures:
1. **AI agents lose the tool.** Seven send entry points across three surfaces speak four
   payload dialects (`text` / `message` / `log` / `summary`); MCP tool descriptions are
   one-liners with no examples; no server-level instructions. There is no MCP tool to read
   replies, so over MCP an agent can notify but never hear the answer.
2. **Two-way is half-built.** Telegram reply capture exists but correlates via regex over
   text instead of Telegram's `reply_to_message.message_id`; outbound sends return no
   message ids; the bot stays silent when it captures a reply, so the human thinks it died.
3. **Not tidy.** Duplicate auth middleware (Bearer unsupported on `/api/*`), unknown channel
   name yields 500 instead of 400, `parse_mode` (a Telegram-ism) leaks into the generic MCP
   schema, the status page shows three always-green rows, README project layout is stale.

## Goal

An AI agent connects once (MCP) and runs a full loop with nothing to remember:

```
send(...) ──────────▶ channel ──▶ human
   │ message_id 4578
   ▼
get_replies({since, wait}) ◀── human's answer (reply_to 4578)
   │
send(..., {reply_to: 4578}) ──▶ same thread
```

Practical, usable, DX-friendly — for agents (MCP), apps (REST), and humans (bot, status page).

## Non-goals (deliberate cuts)

| Cut | Rung | Why / upgrade path |
|---|---|---|
| ~~Admin web dashboard~~ | YAGNI | Cut originally; **reinstated simplified on spec approval** as a single static `/admin` page (see §7). |
| REST endpoint consolidation | reuse | The dispatcher already normalizes internally; `/api/alert`, `/api/log`, `/api/agent` have real consumers. The dialect problem is agent-side and is solved in MCP. |
| OpenAPI spec, llms.txt, MCP resources | YAGNI | 5 endpoints, README table suffices; tool descriptions + instructions are what agents actually see. |
| Bale two-way capture | YAGNI | Telegram covers the named case; Bale would duplicate the bot runtime. Roadmap. |
| ntfy action buttons (approve/deny callbacks) | YAGNI | Needs a new callback endpoint + auth surface. Roadmap. |
| ESLint config, lazy-bot-init refactor | YAGNI | No user-visible gain; churn risk. |
| New env vars, new dependencies | — | None needed. |

## Design

### 1. MCP: one `send` tool, instructions that teach the loop (breaking)

Collapse `send_message` / `send_alert` / `send_log` into one **`send`** tool
(`text`, `title?`, `level?` enum, `channels?`, `reply_to?`). Keep `send_file`
(+ `reply_to`), `list_channels` (now marks two-way channels). Add **`get_replies`**
(`since?`, `wait?` 0–60s long-poll, `limit?`). Drop `parse_mode` from the public MCP
schema (internal formatting stays). Set server `instructions` describing the loop.
Tool descriptions carry usage examples. Result text includes per-channel `message_id`.

Rationale: fewer tools with rich schemas beat many thin ones; an agent that can see
one `send` + one `get_replies` + a taught loop never has to remember dialects.
Breaking change is acceptable at v1.3.0 (young tool, primary consumer is the owner);
documented in CHANGELOG.

### 2. Inbox with real correlation

`replies.capture()` stores `chat_id` and `reply_to_message.message_id` (IDs, not regex).
The legacy regex `reference` field stays (gholam reads it). New helpers:
`list({since, limit})` and `waitFor(since, timeoutMs)` — polls the store every 300 ms,
resolves early when a reply with `id > since` lands, else `[]` at deadline.
Single-process, file-backed: polling is correct here (`ponytail:` ceiling — multi-process
deployments would need an event bus; upgrade path: EventEmitter on append).

### 3. Outbound message ids + threading

`fanOut` collects `message_ids` (from any channel result exposing `message_id` — today
only Telegram). `notify`/`notifyFile` accept `reply_to`; Telegram maps it to
`reply_to_message_id` on `sendMessage`/`sendDocument`. REST `/api/send` and `/api/file`
accept `reply_to` in the body; responses gain `message_ids` next to `delivered`/`errors`
(additive, backward compatible).

### 4. Bot ack

On a captured reply the bot sets a 👍 reaction via a raw `setMessageReaction` call
(best-effort, failures swallowed). The human sees the message was received; the answer
itself still comes from the agent. Raw fetch over a library wrapper: boring, works
regardless of `node-telegram-bot-api` version.

### 5. Tidy fixes

- `api.js` uses the shared `requireApiKey` (Bearer now works on `/api/*`; local duplicate
  middleware deleted).
- Unknown channel name → **400** JSON whose message lists available channels (detected by
  the existing `Unknown channel:` error prefix — no new error class).
- Status page: add a **Channels** section (all five, enabled state) and an **Inbox** section
  (last captured reply, HTML-escaped). Honest again, still one static page.

### 6. Docs

README: canonical REST reference (incl. `reply_to`, `message_ids`, replies query params),
MCP section with the loop and 4-tool table, two-way capability matrix, corrected project
layout, updated roadmap. New `AGENTS.md` (conventions for coding agents working on this
repo: CommonJS, Node ≥ 20, no build step, channel contract, `npm test`, commit style).
CHANGELOG 1.3.0. `package.json`: version bump, `npm run dev` (one line).

### 7. Simple admin page (added on spec approval)

`GET /admin` (API-key gated, `?key=` — navigation can't send headers). One static page in
`app.js` reusing the status-page styles: Channels, Recent sends (last 50, from a new
in-memory ring `src/activity.js` recorded in the dispatcher — the single choke point; lost
on restart, fine for "recent"), Inbox (last 10 captured replies), and a test-send form
that calls `/api/send` via fetch using the key already in the page URL
(`location.search`) — the key is never embedded in the HTML. One new file, no deps.

## Capability matrix (to publish in README)

| Channel | text | files | two-way |
|---|---|---|---|
| telegram | ✅ | ✅ | ✅ reply capture + threading |
| bale | ✅ | ✅ | ❌ roadmap |
| pushover | ✅ | text fallback | ❌ provider limit |
| gotify | ✅ | text fallback | ❌ provider limit |
| ntfy | ✅ | ✅ | ❌ roadmap (action buttons) |

## Error handling

400 validation & unknown channel (message lists available) · 401 auth (all forms, all
routes) · 502 zero channels delivered · 500 actual bugs. MCP errors surface the same
messages as tool-result text.

## Testing

Existing no-network smoke harness (`test/smoke.js`, assert-based, zero frameworks).
Every task lands red-green: failing test first, minimal code, `npm test` green, commit.
New coverage: capture correlation, `waitFor` long-poll, `message_ids`/`reply_to` fan-out,
Bearer on `/api/*`, 400 unknown channel, replies query params, MCP tools/instructions,
ack API-call shape, status page channels/inbox.
