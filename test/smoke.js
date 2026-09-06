// Minimal smoke test. No network calls. Runs in CI without any secrets.
// Loads each module, exercises the dispatcher with a fake channel, and
// checks the REST router answers /api/health.

const assert = require('node:assert/strict');
const http = require('node:http');

process.env.WATCHTOWER_MCP = '1'; // suppress Telegram polling / webhook setup
process.env.API_KEY = 'test-key';
process.env.WATCHTOWER_DATA_DIR = require('node:fs').mkdtempSync(
  require('node:path').join(require('node:os').tmpdir(), 'wt-smoke-')
);
process.env.TELEGRAM_CHAT_ID = '12345';

let failures = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`  ok  ${name}`);
  } catch (err) {
    failures++;
    console.error(`  FAIL ${name}\n    ${err.message}`);
  }
}

async function withServer(app, fn) {
  const server = app.listen(0);
  try {
    return await fn(server.address().port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function request({ port, path, method = 'GET', headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: '127.0.0.1', port, path, method, headers },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
      }
    );
    req.on('error', reject);
    if (body !== undefined) req.end(body);
    else req.end();
  });
}

(async () => {
  console.log('watch-tower smoke');

  await test('channels module loads with all 5 built-ins', () => {
    const ch = require('../src/channels');
    const names = ch.ALL.map((c) => c.name).sort();
    assert.deepEqual(names, ['bale', 'gotify', 'ntfy', 'pushover', 'telegram']);
  });

  await test('every channel exports the expected interface', () => {
    const ch = require('../src/channels');
    for (const c of ch.ALL) {
      assert.equal(typeof c.name, 'string', `${c.name} name`);
      assert.equal(typeof c.enabled, 'boolean', `${c.name} enabled`);
      assert.equal(typeof c.sendMessage, 'function', `${c.name} sendMessage`);
      assert.equal(typeof c.sendFile, 'function', `${c.name} sendFile`);
    }
  });

  await test('resolveChannels rejects unknown names', () => {
    const ch = require('../src/channels');
    assert.throws(() => ch.resolveChannels(['nope']), /Unknown channel/);
  });

  await test('notify with zero enabled channels reports error, not throw', async () => {
    const ch = require('../src/channels');
    const result = await ch.notify({ text: 'hi' });
    assert.equal(result.delivered.length, 0);
    assert.equal(result.errors.length, 1);
  });

  await test('notify fans out and aggregates per-channel results', async () => {
    const ch = require('../src/channels');
    const fake = {
      name: 'fake-ok',
      enabled: true,
      sendMessage: async () => 'sent',
      sendFile: async () => 'sent',
    };
    const broken = {
      name: 'fake-bad',
      enabled: true,
      sendMessage: async () => { throw new Error('boom'); },
      sendFile: async () => { throw new Error('boom'); },
    };
    // Inject for this test only.
    ch.ALL.push(fake, broken);
    ch.BY_NAME[fake.name] = fake;
    ch.BY_NAME[broken.name] = broken;
    try {
      const result = await ch.notify({ text: 'hi', channels: ['fake-ok', 'fake-bad'] });
      assert.deepEqual(result.delivered, ['fake-ok']);
      assert.equal(result.errors.length, 1);
      assert.equal(result.errors[0].channel, 'fake-bad');
    } finally {
      ch.ALL.splice(ch.ALL.indexOf(fake), 1);
      ch.ALL.splice(ch.ALL.indexOf(broken), 1);
      delete ch.BY_NAME[fake.name];
      delete ch.BY_NAME[broken.name];
    }
  });

  await test('REST /api/health returns ok and channel summary', async () => {
    const express = require('express');
    const router = require('../src/api');
    const app = express();
    app.use(express.json());
    app.use('/api', router);
    await withServer(app, async (port) => {
      const response = await request({ port, path: '/api/health' });
      const body = JSON.parse(response.body);
      assert.equal(body.ok, true);
      assert.ok(Array.isArray(body.channels));
      assert.equal(body.channels.length, 5);
    });
  });

  await test('REST /api/send without key is unauthorized', async () => {
    const express = require('express');
    const router = require('../src/api');
    const app = express();
    app.use(express.json());
    app.use('/api', router);
    await withServer(app, async (port) => {
      const response = await request({
        port,
        path: '/api/send',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'hi' }),
      });
      assert.equal(response.status, 401);
    });
  });

  await test('GET /status returns public HTML status page', async () => {
    const { createApp } = require('../src/app');
    const app = createApp();
    await withServer(app, async (port) => {
      const response = await request({ port, path: '/status' });
      assert.equal(response.status, 200);
      assert.match(response.headers['content-type'], /text\/html/);
      assert.match(response.body, /Watch Tower/);
      assert.match(response.body, /API backend/);
      assert.doesNotMatch(response.body, /test-key/);
    });
  });

  await test('POST /mcp rejects missing and invalid API keys', async () => {
    const { createApp } = require('../src/app');
    const app = createApp();
    await withServer(app, async (port) => {
      const missing = await request({
        port,
        path: '/mcp',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      assert.equal(missing.status, 401);

      const invalid = await request({
        port,
        path: '/mcp?key=wrong',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      assert.equal(invalid.status, 401);
    });
  });

  await test('MCP auth accepts x-api-key, query key, and bearer token forms', () => {
    const { getApiKey } = require('../src/app');
    assert.equal(getApiKey({ headers: { 'x-api-key': 'header-key' }, query: {} }), 'header-key');
    assert.equal(getApiKey({ headers: {}, query: { key: 'query-key' } }), 'query-key');
    assert.equal(getApiKey({ headers: { authorization: 'Bearer bearer-key' }, query: {} }), 'bearer-key');
  });

  await test('POST /mcp accepts bearer API key and returns MCP JSON-RPC response', async () => {
    const { createApp } = require('../src/app');
    const app = createApp();
    await withServer(app, async (port) => {
      const response = await request({
        port,
        path: '/mcp',
        method: 'POST',
        headers: {
          Authorization: 'Bearer test-key',
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'smoke', version: '1.0.0' },
          },
        }),
      });
      assert.equal(response.status, 200);
      assert.match(response.body, /"jsonrpc":"2.0"/);
      assert.match(response.body, /watch-tower/);
    });
  });

  await test('replies store: append/list round-trip, capped, capture rules', () => {
    const replies = require('../src/replies');
    assert.deepEqual(replies.list(), []);

    // Free text from the authorized chat is captured, reference from reply-to.
    const captured = replies.capture({
      message_id: 10,
      text: 'بله، ادامه بده',
      chat: { id: 12345 },
      date: 1750000000,
      reply_to_message: { text: '🤖 [checkpoint] MMTE/gholam#42\n\nplan...' },
    });
    assert.equal(captured, true);

    // Commands stay captured too (/status belongs to the agent in this chat)...
    assert.equal(replies.capture({ message_id: 11, text: '/status', chat: { id: 12345 } }), true);
    // ...but bot utility commands and other chats are not.
    assert.equal(replies.capture({ message_id: 12, text: '/ping', chat: { id: 12345 } }), false);
    assert.equal(replies.capture({ message_id: 13, text: 'hello', chat: { id: 999 } }), false);

    const stored = replies.list();
    assert.equal(stored.length, 2);
    assert.equal(stored[0].id, 10);
    assert.equal(stored[0].reference, '#42');
    assert.equal(stored[1].reference, null);
  });

  await test('POST /api/agent requires auth, accepts Bearer, validates payload', async () => {
    const { createApp } = require('../src/app');
    const app = createApp();
    await withServer(app, async (port) => {
      const noKey = await request({
        port,
        path: '/api/agent',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ summary: 'hi' }),
      });
      assert.equal(noKey.status, 401);

      const noSummary = await request({
        port,
        path: '/api/agent',
        method: 'POST',
        headers: { Authorization: 'Bearer test-key', 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo: 'o/r', kind: 'checkpoint' }),
      });
      assert.equal(noSummary.status, 400);

      // No channels enabled in CI: delivery fails with 502, but the endpoint
      // answers with the standard shape instead of throwing.
      const undeliverable = await request({
        port,
        path: '/api/agent',
        method: 'POST',
        headers: { Authorization: 'Bearer test-key', 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo: 'o/r', summary: 'hi', kind: 'checkpoint', issue: 42 }),
      });
      assert.equal(undeliverable.status, 502);
      const body = JSON.parse(undeliverable.body);
      assert.equal(body.ok, false);
      assert.ok(Array.isArray(body.errors));
    });
  });

  await test('GET /api/agent/replies returns the captured list as a bare array', async () => {
    const { createApp } = require('../src/app');
    const app = createApp();
    await withServer(app, async (port) => {
      const unauthorized = await request({ port, path: '/api/agent/replies' });
      assert.equal(unauthorized.status, 401);

      const response = await request({
        port,
        path: '/api/agent/replies',
        headers: { Authorization: 'Bearer test-key' },
      });
      assert.equal(response.status, 200);
      const body = JSON.parse(response.body);
      assert.ok(Array.isArray(body));
      assert.equal(body.length, 2); // from the replies-store test above
      assert.equal(body[0].text, 'بله، ادامه بده');
    });
  });

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
      headers: { 'x-api-key': 'test-key', 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'hi', channels: ['fake-rest'] }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(response.body).message_ids, { 'fake-rest': 99 });
  });
  ch.ALL.pop();
  delete ch.BY_NAME[fake.name];
});

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

  if (failures) {
    console.error(`\n${failures} test(s) failed`);
    process.exit(1);
  }
  console.log('\nall good');
})();
