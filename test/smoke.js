// Minimal smoke test. No network calls. Runs in CI without any secrets.
// Loads each module, exercises the dispatcher with a fake channel, and
// checks the REST router answers /api/health.

const assert = require('node:assert/strict');
const http = require('node:http');

process.env.WATCHTOWER_MCP = '1'; // suppress Telegram polling / webhook setup
process.env.API_KEY = 'test-key';

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

  if (failures) {
    console.error(`\n${failures} test(s) failed`);
    process.exit(1);
  }
  console.log('\nall good');
})();
