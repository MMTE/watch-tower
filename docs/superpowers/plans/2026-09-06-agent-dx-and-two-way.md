# Agent DX & Two-Way Replies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the agent loop — one MCP `send` tool + `get_replies` with long-poll, message-id correlation both directions, bot ack, and the tidy/docs fixes that make the tool self-teaching.

**Architecture:** The existing dispatcher (`src/channels/index.js`) stays the spine. Changes fan outward from it: `fanOut` returns `message_ids`, `notify`/`notifyFile` thread `reply_to`, `replies.js` becomes a queryable inbox (`list({since,limit})`, `waitFor`), `mcpServer.js` collapses to 4 tools with instructions, `api.js`/`agent.js` gain filtering + 400s, `bot.js` acks captures, status page shows channels + inbox.

**Tech Stack:** Node ≥ 20 (CommonJS), express, zod, @modelcontextprotocol/sdk, node-telegram-bot-api. Test harness: `test/smoke.js` (assert-based, no frameworks, no network).

**Spec:** `docs/superpowers/specs/2026-09-06-agent-dx-and-two-way-design.md`

## Global Constraints

- Zero new dependencies. Zero new env vars. Node ≥ 20, CommonJS, no build step.
- All tests no-network; harness is `npm test` (exits 1 on any failure).
- REST surface backward compatible (additive only). MCP tool consolidation is the one documented breaking change (v1.3.0).
- The smoke harness runs tests sequentially in one process with a shared reply store (`WATCHTOWER_DATA_DIR` temp dir, authorized chat `12345`, `API_KEY=test-key`, `WATCHTOWER_MCP=1`) — later tests may see entries written by earlier ones; always recompute the current high-water mark instead of assuming counts.
- Conventional commits (`feat:`/`fix:`/`docs:`/`test:`/`refactor:`), each task leaves `npm test` green.

---

### Task 1: Inbox correlation — capture stores `reply_to_message_id` and `chat_id`

**Files:**
- Modify: `src/replies.js` (function `capture`, ~line 59-77)
- Test: `test/smoke.js` (append new test after the existing `replies store:` test)

**Interfaces:**
- Produces: reply entries now include `chat_id: number` and `reply_to_message_id: number | null`. Existing fields (`id`, `text`, `reference`, `ts`) unchanged. Consumed by Task 2 (list/waitFor pass-through), Task 5 (MCP get_replies text), Task 7 (status page).

- [ ] **Step 1: Write the failing test**

Append to `test/smoke.js` before the final `if (failures)` block:

```js
await test('capture stores chat_id and reply_to_message_id for correlation', () => {
  const replies = require('../src/replies');
  const captured = replies.capture({
    message_id: 20,
    text: 'approved, ship it',
    chat: { id: 12345 },
    date: 1750000100,
    reply_to_message: { message_id: 4578, text: '🤖 [checkpoint] MMTE/gholam#42\n\nplan...' },
  });
  assert.equal(captured, true);
  const stored = replies.list().find((e) => e.id === 20);
  assert.equal(stored.chat_id, 12345);
  assert.equal(stored.reply_to_message_id, 4578);
  assert.equal(stored.reference, '#42'); // legacy regex field unchanged
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL `capture stores chat_id and reply_to_message_id` — `stored.chat_id` is `undefined`.

- [ ] **Step 3: Write minimal implementation**

In `src/replies.js`, inside `capture()`, change the `append({...})` call to:

```js
    append({
      id: msg.message_id,
      text: msg.text,
      chat_id: msg.chat.id,
      reply_to_message_id: msg.reply_to_message?.message_id ?? null,
      reference: ref ? ref[0] : null,
      ts: new Date((msg.date || Date.now() / 1000) * 1000).toISOString(),
    });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS, `all good`.

- [ ] **Step 5: Commit**

```bash
git add src/replies.js test/smoke.js
git commit -m "feat: store reply_to_message_id and chat_id on captured replies"
```

---

### Task 2: Queryable inbox — `list({since, limit})` and `waitFor` long-poll

**Files:**
- Modify: `src/replies.js` (functions `list`, new `waitFor`, exports)
- Test: `test/smoke.js`

**Interfaces:**
- Consumes: Task 1 entry shape.
- Produces: `list({ since?: number, limit?: number })` (defaults keep bare `list()` behavior: all entries); `waitFor(since: number, timeoutMs = 0): Promise<entry[]>` — resolves as soon as an entry with `id > since` exists, else `[]` at deadline. Consumed by Task 4 (REST) and Task 5 (MCP).

- [ ] **Step 1: Write the failing test**

```js
await test('list filters by since/limit; waitFor long-polls until a reply lands', async () => {
  const replies = require('../src/replies');
  const highest = replies.list().reduce((m, e) => Math.max(m, e.id), 0);

  assert.deepEqual(replies.list({ since: highest }), []);
  assert.ok(replies.list({ limit: 1 }).length <= 1);

  const none = await replies.waitFor(highest, 50);
  assert.equal(none.length, 0); // times out with nothing new

  setTimeout(() => {
    replies.capture({ message_id: highest + 5, text: 'late reply', chat: { id: 12345 }, date: 1750000200 });
  }, 250);
  const fresh = await replies.waitFor(highest, 2000);
  assert.equal(fresh.length, 1);
  assert.equal(fresh[0].text, 'late reply');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `replies.waitFor is not a function` (TypeError caught by the harness, prints FAIL).

- [ ] **Step 3: Write minimal implementation**

In `src/replies.js`, replace `list()` and add `waitFor` + export:

```js
const POLL_MS = 300;

function list(options = {}) {
  let entries;
  try {
    const parsed = JSON.parse(fs.readFileSync(storePath(), 'utf8'));
    entries = Array.isArray(parsed) ? parsed : [];
  } catch {
    entries = [];
  }
  if (options.since != null) entries = entries.filter((e) => e.id > options.since);
  if (options.limit != null) entries = entries.slice(-options.limit);
  return entries;
}

// ponytail: file polling is correct for the single-process deployment; a
// multi-process deployment needs an event bus on append instead.
async function waitFor(since, timeoutMs = 0) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const fresh = list({ since });
    if (fresh.length || Date.now() >= deadline) return fresh;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}
```

Update `module.exports` to `{ list, append, capture, waitFor, isAgentChat, MAX_REPLIES }`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS. Note: the existing `GET /api/agent/replies` test asserts `body.length === 2` — bare `list()` is unchanged, so it still passes.

- [ ] **Step 5: Commit**

```bash
git add src/replies.js test/smoke.js
git commit -m "feat: queryable reply inbox with long-poll waitFor"
```

---

### Task 3: Outbound correlation — `message_ids` in results, `reply_to` threading

**Files:**
- Modify: `src/channels/index.js` (`fanOut`, `notify`, `notifyFile`)
- Modify: `src/channels/telegram.js` (`sendMessage`, `sendFile`, exports)
- Modify: `src/api.js` (`respond` helper — include `message_ids`; `/api/send` and `/api/file` pass `reply_to`)
- Modify: `src/agent.js` (POST response includes `message_ids`)
- Test: `test/smoke.js`

**Interfaces:**
- Produces: dispatch results `{ delivered, errors, message_ids }` where `message_ids` maps channel name → provider message id (present only when the channel returns one — Telegram today). Channel contract gains an optional second-arg option `reply_to`; channels that can't thread ignore it. REST `/api/send` body and `/api/file` form field accept `reply_to` (number); both responses add `message_ids`.

- [ ] **Step 1: Write the failing tests**

```js
await test('fan-out result carries per-channel message ids', async () => {
  const ch = require('../src/channels');
  const fake = {
    name: 'fake-id',
    enabled: true,
    sendMessage: async () => ({ message_id: 4578 }),
    sendFile: async () => 'sent',
  };
  ch.ALL.push(fake);
  ch.BY_NAME[fake.name] = fake;
  try {
    const result = await ch.notify({ text: 'hi', channels: ['fake-id'] });
    assert.deepEqual(result.delivered, ['fake-id']);
    assert.deepEqual(result.message_ids, { 'fake-id': 4578 });
  } finally {
    ch.ALL.pop();
    delete ch.BY_NAME[fake.name];
  }
});

await test('notify threads reply_to into channel options', async () => {
  const ch = require('../src/channels');
  let seenOpts;
  const fake = {
    name: 'fake-thread',
    enabled: true,
    sendMessage: async (_text, opts) => { seenOpts = opts; return {}; },
    sendFile: async () => 'sent',
  };
  ch.ALL.push(fake);
  ch.BY_NAME[fake.name] = fake;
  try {
    await ch.notify({ text: 'hi', reply_to: 4578, channels: ['fake-thread'] });
    assert.equal(seenOpts.reply_to, 4578);
  } finally {
    ch.ALL.pop();
    delete ch.BY_NAME[fake.name];
  }
});

await test('REST /api/send response includes message_ids', async () => {
  const ch = require('../src/channels');
  const fake = {
    name: 'fake-rest',
    enabled: true,
    sendMessage: async () => ({ message_id: 99 }),
    sendFile: async () => 'sent',
  };
  ch.ALL.push(fake);
  ch.BY_NAME[fake.name] = fake;
  const express = require('express');
  const router = require('../src/api');
  const app = express();
  app.use(express.json());
  app.use('/api', router);
  await withServer(app, async (port) => {
    const response = await request({
      port, path: '/api/send', method: 'POST',
      headers: { Authorization: 'Bearer test-key', 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'hi', channels: ['fake-rest'] }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(response.body).message_ids, { 'fake-rest': 99 });
  });
  ch.ALL.pop();
  delete ch.BY_NAME[fake.name];
});
```

Note: the third test uses Bearer auth, which `/api/*` does not accept yet — it fails 401 until Task 4 swaps in the shared middleware. Two options: (a) use `x-api-key` here so this task is independently green, and let Task 4's Bearer test prove the swap; (b) accept red until Task 4. **Use `x-api-key` here** (tasks must land green).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL `fan-out result carries per-channel message ids` — `result.message_ids` is `undefined`.

- [ ] **Step 3: Write minimal implementation**

`src/channels/index.js` — `fanOut`:

```js
async function fanOut(fn, channels) {
  const targets = resolveChannels(channels);
  if (!targets.length) {
    return { delivered: [], errors: [{ channel: null, error: 'No channels enabled or selected' }], message_ids: {} };
  }
  const results = await Promise.allSettled(targets.map(fn));
  const delivered = [];
  const errors = [];
  const message_ids = {};
  results.forEach((r, i) => {
    const name = targets[i].name;
    if (r.status === 'fulfilled') {
      delivered.push(name);
      if (r.value?.message_id != null) message_ids[name] = r.value.message_id;
    } else {
      errors.push({ channel: name, error: r.reason?.message || String(r.reason) });
    }
  });
  return { delivered, errors, message_ids };
}
```

`notify` / `notifyFile` (add `reply_to` to both destructures and pass-through):

```js
async function notify({ text, title, level, parse_mode, reply_to, channels } = {}) {
  if (!text) throw new Error('notify: text is required');
  return fanOut((ch) => ch.sendMessage(text, { title, level, parse_mode, reply_to }), channels);
}

async function notifyFile({ filePath, caption, filename, title, level, reply_to, channels } = {}) {
  if (!filePath) throw new Error('notifyFile: filePath is required');
  return fanOut((ch) => ch.sendFile(filePath, { caption, filename, title, level, reply_to }), channels);
}
```

`src/channels/telegram.js` — thread when asked:

```js
async function sendMessage(text, { title, parse_mode, reply_to } = {}) {
  if (!enabled) return;
  const body = title ? `*${title}*\n\n${text}` : text;
  const opts = {};
  if (parse_mode) opts.parse_mode = parse_mode;
  else if (title) opts.parse_mode = 'Markdown';
  if (reply_to) opts.reply_to_message_id = reply_to;
  return bot.sendMessage(getChatId(), body, opts);
}

async function sendFile(filePath, { caption, filename, reply_to } = {}) {
  if (!enabled) return;
  const opts = caption ? { caption } : {};
  if (reply_to) opts.reply_to_message_id = reply_to;
  const fileOpts = filename ? { filename } : {};
  return bot.sendDocument(getChatId(), filePath, opts, fileOpts);
}
```

`src/api.js` — `respond` and route bodies:

```js
function respond(res, result) {
  const ok = result.delivered.length > 0;
  res.status(ok ? 200 : 502).json({ ok, delivered: result.delivered, errors: result.errors, message_ids: result.message_ids });
}
```

In `/api/send`: `const { text, parse_mode, title, level, reply_to } = req.body;` and pass `reply_to` into `channels.notify({...})`.
In `/api/file`: add `reply_to: Number(req.body.reply_to) || undefined,` to the `notifyFile` call.

`src/agent.js` — POST response line:

```js
res.status(ok ? 200 : 502).json({ ok, delivered: result.delivered, errors: result.errors, message_ids: result.message_ids });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/channels/index.js src/channels/telegram.js src/api.js src/agent.js test/smoke.js
git commit -m "feat: outbound message ids and reply_to threading through dispatcher"
```

---

### Task 4: REST tidy — shared auth, 400 for unknown channel, replies query params

**Files:**
- Modify: `src/api.js` (drop local `authMiddleware`, use `requireApiKey`; add `fail` helper)
- Modify: `src/agent.js` (`GET /replies` gains `since`/`limit`/`wait`)
- Test: `test/smoke.js`

**Interfaces:**
- Consumes: `requireApiKey` from `src/auth.js` (already exported); `replies.waitFor` (Task 2).
- Produces: `/api/agent/replies?since=&limit=&wait=` — `since` high-water mark (default 0 = all), `limit` most-recent N (oldest first), `wait` long-poll seconds capped at 55. Unknown channel on any send route → 400 `{ ok: false, message }` where message lists available channels.

- [ ] **Step 1: Write the failing tests**

```js
await test('REST /api/channels accepts Bearer auth (shared middleware)', async () => {
  const express = require('express');
  const router = require('../src/api');
  const app = express();
  app.use(express.json());
  app.use('/api', router);
  await withServer(app, async (port) => {
    const response = await request({
      port, path: '/api/channels',
      headers: { Authorization: 'Bearer test-key' },
    });
    assert.equal(response.status, 200);
    assert.equal(JSON.parse(response.body).ok, true);
  });
});

await test('POST /api/send with unknown channel returns 400 listing available', async () => {
  const express = require('express');
  const router = require('../src/api');
  const app = express();
  app.use(express.json());
  app.use('/api', router);
  await withServer(app, async (port) => {
    const response = await request({
      port, path: '/api/send', method: 'POST',
      headers: { 'x-api-key': 'test-key', 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'hi', channels: ['nope'] }),
    });
    assert.equal(response.status, 400);
    const body = JSON.parse(response.body);
    assert.equal(body.ok, false);
    assert.match(body.message, /Unknown channel: nope/);
    assert.match(body.message, /telegram/);
  });
});

await test('GET /api/agent/replies supports since, limit, and wait', async () => {
  const replies = require('../src/replies');
  const { createApp } = require('../src/app');
  const app = createApp();
  await withServer(app, async (port) => {
    const highest = replies.list().reduce((m, e) => Math.max(m, e.id), 0);
    const headers = { Authorization: 'Bearer test-key' };

    const filtered = await request({ port, path: `/api/agent/replies?since=${highest}&limit=1`, headers });
    assert.equal(JSON.parse(filtered.body).length, 0);

    const timedOut = await request({ port, path: `/api/agent/replies?since=${highest}&wait=1`, headers });
    assert.equal(JSON.parse(timedOut.body).length, 0);

    setTimeout(() => {
      replies.capture({ message_id: highest + 9, text: 'hello again', chat: { id: 12345 }, date: 1750000300 });
    }, 200);
    const arrived = await request({ port, path: `/api/agent/replies?since=${highest}&wait=5`, headers });
    const body = JSON.parse(arrived.body);
    assert.equal(body.length, 1);
    assert.equal(body[0].text, 'hello again');
    assert.equal(body[0].reply_to_message_id, null);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: Bearer test FAIL with 401; unknown-channel test FAIL with 500; replies-params test FAIL (`?since=` ignored → full list returned, length > 0).

- [ ] **Step 3: Write minimal implementation**

`src/api.js` — swap auth and add `fail`. At the top, add `const { requireApiKey } = require('./auth');`, delete the whole `authMiddleware` function, and replace its five usages with `requireApiKey`. Add:

```js
function fail(res, err) {
  const unknownChannel = /^Unknown channel/.test(err.message);
  res.status(unknownChannel ? 400 : 500).json({ ok: false, message: err.message });
}
```

Replace every `catch (err) { res.status(500).json({ ok: false, message: err.message }); }` with `catch (err) { fail(res, err); }`.

`src/agent.js` — replace the `/replies` route:

```js
function intParam(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

router.get('/replies', async (req, res) => {
  const since = intParam(req.query.since) ?? 0;
  const limit = intParam(req.query.limit);
  const wait = Math.min(intParam(req.query.wait) ?? 0, 55); // stay under proxy timeouts
  const fresh = await replies.waitFor(since, wait * 1000);
  res.json(limit != null ? fresh.slice(-limit) : fresh);
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — including the pre-existing `GET /api/agent/replies returns the captured list as a bare array` (bare call ⇒ `since=0` ⇒ all entries, unchanged shape).

- [ ] **Step 5: Commit**

```bash
git add src/api.js src/agent.js test/smoke.js
git commit -m "feat: shared auth on /api, 400 for unknown channels, replies since/limit/wait"
```

---

### Task 5: MCP overhaul — 4 tools, instructions, examples, `get_replies`

**Files:**
- Modify: `src/mcpServer.js` (full rewrite of tool registrations)
- Modify: `src/channels/telegram.js` (export `twoWay: true`)
- Test: `test/smoke.js`

**Interfaces:**
- Consumes: `replies.waitFor` (Task 2), `message_ids` (Task 3), `channels.LEVEL_EMOJI`.
- Produces: MCP tools `send`, `send_file`, `get_replies`, `list_channels` (old `send_message`/`send_alert`/`send_log` removed — documented breaking). Server `instructions` string. `send` params: `text`, `title?`, `level?` enum, `channels?`, `reply_to?`.

- [ ] **Step 1: Write the failing test**

Add an SSE-parse helper near the top of `test/smoke.js` (after `request`):

```js
function parseMcpMessage(raw) {
  const dataLine = raw.split('\n').find((l) => l.startsWith('data:'));
  return JSON.parse(dataLine.slice(5).trim());
}
```

Then the test:

```js
await test('MCP exposes send/send_file/get_replies/list_channels and loop instructions', async () => {
  const { createApp } = require('../src/app');
  const app = createApp();
  await withServer(app, async (port) => {
    const post = (method, params, id) => request({
      port, path: '/mcp', method: 'POST',
      headers: {
        Authorization: 'Bearer test-key',
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    });

    const init = parseMcpMessage(await post('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'smoke', version: '1.0.0' },
    }, 1));
    assert.match(init.result.instructions, /get_replies/);
    assert.match(init.result.instructions, /reply_to/);

    const tools = parseMcpMessage(await post('tools/list', {}, 2));
    assert.deepEqual(
      tools.result.tools.map((t) => t.name).sort(),
      ['get_replies', 'list_channels', 'send', 'send_file']
    );

    const call = parseMcpMessage(await post('tools/call', { name: 'get_replies', arguments: { limit: 1 } }, 3));
    assert.match(call.result.content[0].text, /Next call: since=\d+/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `init.result.instructions` is `undefined` (regex match on undefined throws) and tools list still contains `send_message`.

- [ ] **Step 3: Write minimal implementation**

`src/channels/telegram.js` — add to `module.exports`: `twoWay: true`.

`src/mcpServer.js` — replace the whole file with:

```js
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { z } = require('zod');
const channels = require('./channels');
const replies = require('./replies');
const pkg = require('../package.json');

const LEVELS = ['info', 'warn', 'error', 'critical'];
const CHANNEL_NAMES = channels.ALL.map((c) => c.name);
const channelArg = z
  .array(z.enum(CHANNEL_NAMES))
  .optional()
  .describe(`Channels to dispatch to. Available: ${CHANNEL_NAMES.join(', ')}. Omit to use defaults / all enabled.`);

const INSTRUCTIONS = [
  'Watch Tower notifies humans through Telegram, Bale, Pushover, Gotify, and ntfy — and reads their replies back to you.',
  "Loop: 1) send(...) and note the telegram message_id in the result. 2) get_replies({ since, wait }) — the human's answer arrives with reply_to_message_id linking it to your message. 3) send(..., { reply_to }) answers in the same thread.",
  'Start with list_channels() if unsure what is configured.',
].join('\n');

function formatResult(result) {
  const lines = [];
  if (result.delivered.length) {
    const ids = Object.entries(result.message_ids || {})
      .map(([name, id]) => `${name}: message_id ${id}`)
      .join(', ');
    lines.push(`Delivered to: ${result.delivered.join(', ')}${ids ? ` (${ids})` : ''}`);
  }
  if (result.errors.length) {
    lines.push(`Failed: ${result.errors.map((e) => `${e.channel || 'n/a'}: ${e.error}`).join('; ')}`);
  }
  return { content: [{ type: 'text', text: lines.join('\n') || 'No channels delivered' }] };
}

function createMcpServer() {
  const server = new McpServer(
    { name: 'watch-tower', version: pkg.version },
    { instructions: INSTRUCTIONS }
  );

  server.tool(
    'send',
    'Send a notification to a human. Example: {"text":"deploy #42 finished","title":"prod","level":"info"}. level maps to native priority on Pushover/Gotify/ntfy. The result includes the telegram message_id — pass it back as reply_to to thread a follow-up.',
    {
      text: z.string().describe('Message body'),
      title: z.string().optional().describe('Short header, shown bold on chat channels'),
      level: z.enum(LEVELS).optional().describe('Severity: info | warn | error | critical'),
      channels: channelArg,
      reply_to: z.number().optional().describe('Telegram message_id this message replies to (threads the conversation)'),
    },
    async ({ text, title, level, channels: ch, reply_to }) => {
      const result = await channels.notify({
        text,
        title: title && level ? `${channels.LEVEL_EMOJI[level]} ${title}` : title,
        level,
        reply_to,
        channels: ch,
      });
      return formatResult(result);
    }
  );

  server.tool(
    'send_file',
    'Send a local file as an attachment. Example: {"path":"/tmp/report.pdf","caption":"daily report"}. Channels without file support receive a textual fallback.',
    {
      path: z.string().describe('Absolute path to the file on the server'),
      caption: z.string().optional().describe('Optional caption'),
      filename: z.string().optional().describe('Override display filename'),
      title: z.string().optional().describe('Optional title'),
      level: z.enum(LEVELS).optional().describe('Severity: info | warn | error | critical'),
      reply_to: z.number().optional().describe('Telegram message_id this file replies to'),
      channels: channelArg,
    },
    async ({ path: filePath, caption, filename, title, level, reply_to, channels: ch }) => {
      const result = await channels.notifyFile({ filePath, caption, filename, title, level, reply_to, channels: ch });
      return formatResult(result);
    }
  );

  server.tool(
    'get_replies',
    'Read human replies captured from the Telegram chat. Example: {"since":4578,"wait":30} blocks up to 30 seconds for the next reply. Keep the highest id you have seen and pass it as since. Entries carry reply_to_message_id when they answer a specific notification.',
    {
      since: z.number().optional().describe('Only entries with id > since (high-water mark). Default 0 = all'),
      wait: z.number().optional().describe('Seconds to long-poll for a new reply (0-60, default 0)'),
      limit: z.number().optional().describe('Most recent N entries, oldest first (default 50)'),
    },
    async ({ since = 0, wait = 0, limit = 50 }) => {
      const entries = (await replies.waitFor(since, Math.min(wait, 60) * 1000)).slice(-limit);
      if (!entries.length) return { content: [{ type: 'text', text: 'No replies yet.' }] };
      const lines = entries.map((e) => `[${e.id}] ${e.ts}${e.reply_to_message_id ? ` (reply to ${e.reply_to_message_id})` : ''} ${e.text}`);
      lines.push(`Next call: since=${entries[entries.length - 1].id}`);
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }
  );

  server.tool(
    'list_channels',
    'List notification channels with configured state and two-way capability. Two-way channels capture human replies — read them with get_replies.',
    {},
    async () => {
      const rows = channels.ALL.map((c) => `${c.enabled ? '✅' : '⬜️'} ${c.name}${c.twoWay ? ' (two-way)' : ''}`);
      return { content: [{ type: 'text', text: rows.join('\n') }] };
    }
  );

  return server;
}

module.exports = { createMcpServer };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS. The pre-existing initialize test (`assert.match(response.body, /watch-tower/)` on the raw body) still passes.

- [ ] **Step 5: Commit**

```bash
git add src/mcpServer.js src/channels/telegram.js test/smoke.js
git commit -m "feat!: consolidate MCP tools to send/send_file/get_replies/list_channels with loop instructions"
```

---

### Task 6: Bot ack — 👍 reaction on captured replies

**Files:**
- Modify: `src/channels/telegram.js` (new `ackReaction`, exported)
- Modify: `src/bot.js` (`on('message')` handler calls it)
- Test: `test/smoke.js`

**Interfaces:**
- Produces: `telegram.ackReaction(chatId, messageId): Promise` — POSTs `setMessageReaction` to the Telegram Bot API (raw `fetch`; `node-telegram-bot-api` wrapper availability varies by version, raw call is boring and version-proof). Best-effort: callers must `.catch(() => {})`.

- [ ] **Step 1: Write the failing test**

```js
await test('ackReaction posts a 👍 reaction to the Telegram API', async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, opts) => { calls.push({ url, opts }); return { ok: true }; };
  try {
    const telegram = require('../src/channels/telegram');
    await telegram.ackReaction(12345, 4578);
  } finally {
    global.fetch = originalFetch;
  }
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/setMessageReaction$/);
  assert.deepEqual(JSON.parse(calls[0].opts.body), { chat_id: 12345, message_id: 4578, emoji: '👍' });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `telegram.ackReaction is not a function`.

- [ ] **Step 3: Write minimal implementation**

`src/channels/telegram.js` — add and export:

```js
// Best-effort visible ack for captured replies; callers swallow errors.
async function ackReaction(chatId, messageId) {
  const res = await fetch(`https://api.telegram.org/bot${token}/setMessageReaction`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, message_id: messageId, emoji: '👍' }),
  });
  if (!res.ok) throw new Error(`telegram setMessageReaction failed: ${res.status}`);
}
```

`src/bot.js` — in the `bot.on('message')` handler, replace the capture branch:

```js
bot.on('message', (msg) => {
  if (!msg.text) return;
  // Messages from the authorized chat are queued for agent polling
  // (GET /api/agent/replies); the 👍 tells the human it landed, the
  // answer itself comes from the agent.
  if (replies.capture(msg)) {
    telegram.ackReaction(msg.chat.id, msg.message_id).catch(() => {});
    return;
  }
  if (msg.text.startsWith('/') && !msg.text.match(/^\/(start|ping|id|status|channels|help|time|echo)/)) {
    bot.sendMessage(msg.chat.id, getHelpText(), { parse_mode: 'MarkdownV2' });
  }
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS. (`bot.js` is inert under `WATCHTOWER_MCP=1`; the exported `ackReaction` is what runs in production wiring.)

- [ ] **Step 5: Commit**

```bash
git add src/channels/telegram.js src/bot.js test/smoke.js
git commit -m "feat: react 👍 to captured replies so the human sees it landed"
```

---

### Task 7: Honest status page — channels + inbox sections

**Files:**
- Modify: `src/app.js` (`renderStatusPage` + requires)
- Test: `test/smoke.js` (extend the existing `/status` test)

**Interfaces:**
- Consumes: `channels.ALL` (with `enabled`), `replies.list()` (Task 1 shape).
- Produces: `/status` HTML gains a Channels list (name + enabled/not configured) and an Inbox row (last reply timestamp + first 80 chars, HTML-escaped — reply text is attacker-influenceable input rendered into HTML).

- [ ] **Step 1: Write the failing test**

Extend the existing `/status` test's assertions (inside `withServer`, after the existing asserts):

```js
      assert.match(response.body, /Channels/);
      assert.match(response.body, /telegram/);
      assert.match(response.body, /Inbox/);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL `GET /status returns public HTML status page` — page contains neither `Channels` section nor `telegram`.

- [ ] **Step 3: Write minimal implementation**

`src/app.js` — add requires at top: `const channels = require('./channels');` and `const replies = require('./replies');`

Add helper next to `formatUptime`:

```js
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
```

In `renderStatusPage`, before the template literal:

```js
  const inbox = replies.list();
  const lastReply = inbox.length
    ? `${escapeHtml(inbox[inbox.length - 1].ts.slice(0, 19))} UTC · ${escapeHtml(inbox[inbox.length - 1].text.slice(0, 80))}`
    : 'no replies captured yet';
```

And append two sections inside `<main>`, after the Services `</dl>`:

```html
    <p class="section-label">Channels</p>
    <dl aria-label="Channels">
      ${channels.ALL.map((c) => `<div><dt>${c.name}</dt><dd>${c.enabled ? '<span class="ok">enabled</span>' : '<span class="meta">not configured</span>'}</dd></div>`).join('\n      ')}
    </dl>

    <p class="section-label">Inbox</p>
    <dl aria-label="Inbox">
      <div><dt>Last reply</dt><dd><span class="meta">${lastReply}</span></dd></div>
    </dl>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS — and the existing `doesNotMatch /test-key/` assertion still holds.

- [ ] **Step 5: Commit**

```bash
git add src/app.js test/smoke.js
git commit -m "feat: status page shows real channel states and last captured reply"
```

---

### Task 8: Docs & release — README, AGENTS.md, CHANGELOG, version

**Files:**
- Modify: `README.md`, `CHANGELOG.md`, `package.json`
- Create: `AGENTS.md`

**Interfaces:** none (documentation). Content below is canonical — paste it.

- [ ] **Step 1: README — REST section**

Replace the four endpoint examples + response shape block with:

````markdown
### `POST /api/send`

The canonical endpoint. `alert` / `log` / `agent` below are sugar over it.

```bash
curl -X POST $BASE/api/send -H "Content-Type: application/json" -H "x-api-key: $KEY" \
  -d '{"text":"deploy done","title":"prod","level":"info","channels":["telegram","ntfy"],"reply_to":4578}'
```

| Field       | Type   | Notes                                        |
| ----------- | ------ | -------------------------------------------- |
| `text`      | string | Required. Message body                       |
| `title?`    | string | Bold header on chat channels                 |
| `level?`    | enum   | `info` \| `warn` \| `error` \| `critical`    |
| `channels?` | array  | Channel names; omit for defaults/all enabled |
| `reply_to?` | number | Telegram `message_id` to thread into         |

### `POST /api/alert`, `POST /api/log`, `POST /api/agent`

Sugar: `alert` = `{level, title, message}`, `log` = `{source, log}` (code-formatted),
`agent` = `{repo, summary, kind, issue?, issue_url?}` (checkpoint format). All accept
`channels` and compile into the same dispatch as `/api/send`.

### `POST /api/file`

```bash
curl -X POST $BASE/api/file -H "x-api-key: $KEY" \
  -F "file=@report.pdf" -F "caption=Daily report" -F "reply_to=4578"
```

### Response shape

```json
{ "ok": true, "delivered": ["telegram"], "errors": [], "message_ids": { "telegram": 4578 } }
```

`ok` is `true` if at least one channel delivered (else `502`). `message_ids` carries the
provider message id per channel when available (Telegram today) — use it as `reply_to` to
thread. Unknown channel name → `400` with the available list in the message.

## Reading replies (two-way)

Replies the authorized Telegram chat sends to the bot are captured with their
`reply_to_message_id` and polled by agents:

```bash
# everything after high-water mark 4578, long-poll up to 30s for the next one
curl "$BASE/api/agent/replies?since=4578&wait=30" -H "x-api-key: $KEY"
```

| Param    | Notes                                              |
| -------- | -------------------------------------------------- |
| `since`  | only entries with `id > since` (default 0 = all)   |
| `limit`  | most recent N, oldest first                        |
| `wait`   | long-poll seconds, capped at 55                    |

Each entry: `{ id, text, chat_id, reply_to_message_id, reference, ts }`. The bot reacts 👍
to every captured message so the human knows it landed; the answer comes from your agent.
````

- [ ] **Step 2: README — MCP section**

Replace the Tools table and config env block with:

````markdown
### Tools

| Tool            | Params                                            | Description                                    |
| --------------- | ------------------------------------------------- | ---------------------------------------------- |
| `send`          | `text`, `title?`, `level?`, `channels?`, `reply_to?` | Notify a human; result carries `message_id`  |
| `send_file`     | `path`, `caption?`, `filename?`, `reply_to?`, …   | Send a local file                              |
| `get_replies`   | `since?`, `wait?` (0–60s), `limit?`               | Read human replies, optional long-poll         |
| `list_channels` | —                                                 | Configured state + two-way capability          |

The server's `instructions` teach the loop: send → note the `message_id` →
`get_replies({ since, wait })` → the answer arrives with `reply_to_message_id` →
`send(..., { reply_to })` threads the follow-up.
````

Also update the config example env to include `"API_KEY": "..."` (HTTP MCP) and note stdio
servers read channel env directly. Replace the Channels table with the capability matrix:

```markdown
| Channel    | text | files         | two-way                        | Required env                               |
| ---------- | ---- | ------------- | ------------------------------ | ------------------------------------------ |
| `telegram` | ✅   | ✅            | ✅ capture + threading         | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`   |
| `bale`     | ✅   | ✅            | ❌ (roadmap)                   | `BALE_BOT_TOKEN`, `BALE_CHAT_ID`           |
| `pushover` | ✅   | text fallback | ❌ (provider limit)            | `PUSHOVER_APP_TOKEN`, `PUSHOVER_USER_KEY`  |
| `gotify`   | ✅   | text fallback | ❌ (provider limit)            | `GOTIFY_URL`, `GOTIFY_APP_TOKEN`           |
| `ntfy`     | ✅   | ✅            | ❌ (roadmap: action buttons)   | `NTFY_TOPIC` (+ `NTFY_URL`, auth)          |
```

Fix the Project layout diagram to include `app.js` (Express factory + status page),
`agent.js` (agent notify + replies), `auth.js` (shared API-key auth), `replies.js`
(inbox store), and `uploads/`. Update the roadmap list to: bale two-way capture, ntfy
action buttons, multiple configured instances per channel type, reply webhooks.

- [ ] **Step 3: AGENTS.md**

```markdown
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

- `src/channels/index.js` — registry + dispatcher (`notify` / `notifyFile` →
  `fanOut`). Result: `{ delivered, errors, message_ids }`. This is the spine; everything
  else calls it.
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
```

- [ ] **Step 4: CHANGELOG + package.json**

`CHANGELOG.md` — new section at the top:

```markdown
## [1.3.0] - 2026-09-06

### Added
- Two-way reply loop: MCP `get_replies` tool (`since`, `wait` long-poll, `limit`) and
  `GET /api/agent/replies?since=&limit=&wait=`.
- Reply correlation by id: captured entries store `chat_id` and `reply_to_message_id`.
- Outbound `message_ids` in dispatch results (REST + MCP); `reply_to` threads a Telegram
  follow-up into the original message (`send`, `send_file`, `/api/send`, `/api/file`).
- Bot reacts 👍 to captured replies so the human sees the message landed.
- MCP server `instructions` teaching the send → get_replies → reply_to loop.
- Status page shows real channel states and the last captured reply.
- `AGENTS.md` for coding agents working on this repo; `npm run dev` (watch mode).

### Changed
- MCP tools consolidated: `send_message`/`send_alert`/`send_log` → one `send` with
  `level` (**breaking** for MCP clients); `parse_mode` removed from the public schema.
- Shared API-key auth on `/api/*` — `Authorization: Bearer` now accepted everywhere.
- Unknown channel name in a send request returns `400` (was `500`) with the available
  channel list in the message.
```

`package.json` — `"version": "1.3.0"`, and in scripts add `"dev": "node --watch src/index.js",`.

- [ ] **Step 5: Verify docs match reality, run suite, commit**

Run: `npm test` — expected PASS. Spot-check README examples against `src/api.js` /
`src/mcpServer.js` (field names, response shape).

```bash
git add README.md AGENTS.md CHANGELOG.md package.json
git commit -m "docs: README/AGENTS.md for the two-way loop; release 1.3.0"
```

---

### Task 9: Simple admin page — `/admin` with channels, recent sends, inbox, test-send

**Files:**
- Create: `src/activity.js`
- Modify: `src/channels/index.js` (record sends in `notify`/`notifyFile`)
- Modify: `src/app.js` (new `/admin` route + `renderAdminPage`, shared style const)
- Test: `test/smoke.js`

**Interfaces:**
- Consumes: `channels.ALL`, `replies.list({limit})` (Task 2), dispatch results (Task 3), `escapeHtml` (Task 7).
- Produces: `activity.recordSend(entry)` / `activity.listSends()` — in-memory ring, newest first, capped 50, lost on restart ("recent activity", not an audit log). `GET /admin?key=…` → HTML; invalid/missing key → 401.

- [ ] **Step 1: Write the failing tests**

```js
await test('dispatcher records sends in the activity ring', async () => {
  const ch = require('../src/channels');
  const activity = require('../src/activity');
  const before = activity.listSends().length;
  const fake = {
    name: 'fake-act',
    enabled: true,
    sendMessage: async () => 'sent',
    sendFile: async () => 'sent',
  };
  ch.ALL.push(fake);
  ch.BY_NAME[fake.name] = fake;
  try {
    await ch.notify({ text: 'ring me', title: 't', channels: ['fake-act'] });
  } finally {
    ch.ALL.pop();
    delete ch.BY_NAME[fake.name];
  }
  const sends = activity.listSends();
  assert.equal(sends.length, before + 1);
  assert.equal(sends[0].text, 'ring me');
  assert.deepEqual(sends[0].delivered, ['fake-act']);
});

await test('GET /admin requires the key and renders sends, inbox, channels', async () => {
  const { createApp } = require('../src/app');
  const app = createApp();
  await withServer(app, async (port) => {
    const denied = await request({ port, path: '/admin' });
    assert.equal(denied.status, 401);

    const page = await request({ port, path: '/admin?key=test-key' });
    assert.equal(page.status, 200);
    assert.match(page.headers['content-type'], /text\/html/);
    assert.match(page.body, /Recent sends/);
    assert.match(page.body, /Inbox/);
    assert.match(page.body, /telegram/);
    assert.doesNotMatch(page.body, /test-key/); // the key is never embedded in the HTML
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/activity'`; `/admin` returns 404.

- [ ] **Step 3: Write minimal implementation**

Create `src/activity.js`:

```js
// In-memory ring of recent outbound sends. Newest first; lost on restart —
// it feeds the admin page's "recent activity", not an audit log.
const MAX_SENDS = 50;
const sends = [];

function recordSend(entry) {
  sends.push({ ...entry, text: String(entry.text || '').slice(0, 200), ts: new Date().toISOString() });
  if (sends.length > MAX_SENDS) sends.shift();
}

function listSends() {
  return sends.slice().reverse();
}

module.exports = { recordSend, listSends, MAX_SENDS };
```

`src/channels/index.js` — `const activity = require('../activity');` at top; record after fan-out:

```js
async function notify({ text, title, level, parse_mode, reply_to, channels } = {}) {
  if (!text) throw new Error('notify: text is required');
  const result = await fanOut((ch) => ch.sendMessage(text, { title, level, parse_mode, reply_to }), channels);
  activity.recordSend({ kind: 'message', title, text, level, delivered: result.delivered, errors: result.errors });
  return result;
}

async function notifyFile({ filePath, caption, filename, title, level, reply_to, channels } = {}) {
  if (!filePath) throw new Error('notifyFile: filePath is required');
  const result = await fanOut((ch) => ch.sendFile(filePath, { caption, filename, title, level, reply_to }), channels);
  activity.recordSend({ kind: 'file', title: title || filename || filePath, text: caption || '', level, delivered: result.delivered, errors: result.errors });
  return result;
}
```

`src/app.js` — extract the status-page CSS into a `STATUS_STYLES` const shared by both pages; add route and renderer:

```js
  app.get('/admin', requireApiKey, (_req, res) => {
    res.type('html').send(renderAdminPage());
  });
```

```js
function renderAdminPage() {
  const activity = require('./activity');
  const sendRows = activity.listSends().map((s) => `<div><dt>${escapeHtml((s.title || s.text || '').slice(0, 80))}</dt><dd><span class="meta">${escapeHtml(s.ts.slice(11, 19))} UTC · ${s.delivered.length ? s.delivered.join(', ') : `failed: ${s.errors.map((e) => e.channel || 'n/a').join(', ')}`}</span></dd></div>`).join('\n      ') || '<div><dt>nothing sent yet</dt><dd></dd></div>';
  const replyRows = replies.list({ limit: 10 }).slice().reverse().map((r) => `<div><dt>${escapeHtml(r.text.slice(0, 80))}</dt><dd><span class="meta">${escapeHtml(r.ts.slice(0, 19))}${r.reply_to_message_id ? ` · reply to ${r.reply_to_message_id}` : ''}</span></dd></div>`).join('\n      ') || '<div><dt>no replies yet</dt><dd></dd></div>';
  const channelRows = channels.ALL.map((c) => `<div><dt>${c.name}</dt><dd>${c.enabled ? '<span class="ok">enabled</span>' : '<span class="meta">not configured</span>'}</dd></div>`).join('\n      ');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Watch Tower Admin</title>
  <style>${STATUS_STYLES}</style>
</head>
<body>
  <main>
    <h1>Watch Tower</h1>
    <p class="sub">admin</p>

    <p class="section-label">Test send</p>
    <dl aria-label="Test send"><div>
      <dt><label for="t">text</label></dt>
      <dd><input id="t" style="width:100%"></dd>
    </div><div>
      <dt><label for="ttl">title</label> / <label for="lvl">level</label></dt>
      <dd><input id="ttl"> <select id="lvl"><option></option><option>info</option><option>warn</option><option>error</option><option>critical</option></select>
      <button onclick="send()">Send</button> <span id="r" class="meta"></span></dd>
    </div></dl>

    <p class="section-label">Recent sends</p>
    <dl aria-label="Recent sends">
      ${sendRows}
    </dl>

    <p class="section-label">Inbox</p>
    <dl aria-label="Inbox">
      ${replyRows}
    </dl>

    <p class="section-label">Channels</p>
    <dl aria-label="Channels">
      ${channelRows}
    </dl>
  </main>
  <script>
    async function send() {
      const key = new URLSearchParams(location.search).get('key');
      const body = { text: document.getElementById('t').value };
      const title = document.getElementById('ttl').value;
      const level = document.getElementById('lvl').value;
      if (title) body.title = title;
      if (level) body.level = level;
      const res = await fetch('/api/send?key=' + encodeURIComponent(key), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const json = await res.json();
      document.getElementById('r').textContent = json.ok ? 'sent to ' + json.delivered.join(', ') : 'failed';
      if (json.ok) setTimeout(() => location.reload(), 800);
    }
  </script>
</body>
</html>`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/activity.js src/channels/index.js src/app.js test/smoke.js
git commit -m "feat: simple /admin page - channels, recent sends, inbox, test-send form"
```

---

## Self-Review (already applied)

- **Spec coverage:** MCP loop (Tasks 3, 5), inbox correlation (1, 2), REST params + 400 + auth (4), ack (6), status page (7), docs/version (8), admin page (9) — every spec section maps to a task. Spec non-goals have no tasks.
- **Type consistency:** `waitFor(since, timeoutMs)` ms in module, seconds at both edges (REST caps 55, MCP caps 60). `reply_to` is a number everywhere; `message_ids` shape `{ [channel]: number }` consistent across api.js, agent.js, mcpServer.js.
- **Placeholders:** none — every step carries exact code or exact doc content.
