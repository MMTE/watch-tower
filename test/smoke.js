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
    const server = app.listen(0);
    try {
      const port = server.address().port;
      const body = await new Promise((resolve, reject) => {
        http.get(`http://127.0.0.1:${port}/api/health`, (res) => {
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => resolve(JSON.parse(data)));
        }).on('error', reject);
      });
      assert.equal(body.ok, true);
      assert.ok(Array.isArray(body.channels));
      assert.equal(body.channels.length, 5);
    } finally {
      server.close();
    }
  });

  await test('REST /api/send without key is unauthorized', async () => {
    const express = require('express');
    const router = require('../src/api');
    const app = express();
    app.use(express.json());
    app.use('/api', router);
    const server = app.listen(0);
    try {
      const port = server.address().port;
      const status = await new Promise((resolve, reject) => {
        const req = http.request(
          { hostname: '127.0.0.1', port, path: '/api/send', method: 'POST',
            headers: { 'Content-Type': 'application/json' } },
          (res) => resolve(res.statusCode)
        );
        req.on('error', reject);
        req.end(JSON.stringify({ text: 'hi' }));
      });
      assert.equal(status, 401);
    } finally {
      server.close();
    }
  });

  if (failures) {
    console.error(`\n${failures} test(s) failed`);
    process.exit(1);
  }
  console.log('\nall good');
})();
