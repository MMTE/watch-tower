const express = require('express');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { bot } = require('./bot');
const apiRouter = require('./api');
const channels = require('./channels');
const { createMcpServer } = require('./mcpServer');
const pkg = require('../package.json');

function getApiKey(req) {
  const bearer = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
  return req.headers['x-api-key'] || req.query.key || bearer?.[1];
}

function requireApiKey(req, res, next) {
  const apiKey = getApiKey(req);
  if (!apiKey || apiKey !== process.env.API_KEY) {
    return res.status(401).json({ ok: false, message: 'Unauthorized: invalid or missing API key' });
  }
  next();
}

function formatUptime(seconds) {
  const total = Math.floor(seconds);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours || days) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  return parts.join(' ');
}

function renderStatusPage() {
  const memory = process.memoryUsage();
  const active = channels.enabledChannels().map((c) => c.name);
  const environment = process.env.NODE_ENV === 'production' ? 'production' : 'development';
  const rows = channels.ALL.map((c) => {
    const state = c.enabled ? 'enabled' : 'disabled';
    return `<li><span>${c.name}</span><strong class="${state}">${state}</strong></li>`;
  }).join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Watch Tower Status</title>
  <style>
    :root { color-scheme: light dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; background: Canvas; color: CanvasText; }
    main { max-width: 760px; margin: 0 auto; padding: 48px 20px; }
    h1 { margin: 0 0 8px; font-size: clamp(2rem, 6vw, 3.5rem); letter-spacing: 0; }
    p { margin: 0 0 28px; color: color-mix(in srgb, CanvasText 70%, Canvas 30%); }
    dl, ul { border: 1px solid color-mix(in srgb, CanvasText 18%, Canvas 82%); border-radius: 8px; margin: 0 0 20px; padding: 0; overflow: hidden; }
    div, li { display: flex; justify-content: space-between; gap: 20px; padding: 14px 16px; border-bottom: 1px solid color-mix(in srgb, CanvasText 12%, Canvas 88%); }
    div:last-child, li:last-child { border-bottom: 0; }
    dt, span { color: color-mix(in srgb, CanvasText 70%, Canvas 30%); }
    dd { margin: 0; font-weight: 650; text-align: right; }
    ul { list-style: none; }
    strong { text-align: right; }
    .enabled, .ok { color: #16753a; }
    .disabled { color: #8a4b08; }
  </style>
</head>
<body>
  <main>
    <h1>Watch Tower</h1>
    <p>Hosted notification hub status</p>
    <dl aria-label="Service status">
      <div><dt>API health</dt><dd class="ok">ok</dd></div>
      <div><dt>Version</dt><dd>${pkg.version}</dd></div>
      <div><dt>Environment</dt><dd>${environment}</dd></div>
      <div><dt>Uptime</dt><dd>${formatUptime(process.uptime())}</dd></div>
      <div><dt>Memory</dt><dd>${(memory.rss / 1024 / 1024).toFixed(1)} MB RSS</dd></div>
      <div><dt>Enabled channels</dt><dd>${active.length ? active.join(', ') : 'none'}</dd></div>
    </dl>
    <ul aria-label="Channel state">${rows}</ul>
  </main>
</body>
</html>`;
}

async function handleMcpRequest(req, res) {
  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error('[WatchTower MCP] Request failed:', err);
    if (!res.headersSent) {
      res.status(500).json({ ok: false, message: 'MCP request failed' });
    }
  } finally {
    await transport.close().catch(() => {});
    await server.close().catch(() => {});
  }
}

function createApp() {
  const app = express();
  const token = process.env.TELEGRAM_BOT_TOKEN;

  app.use(express.json());

  if (token) {
    app.post(`/bot${token}`, (req, res) => {
      if (bot) bot.processUpdate(req.body);
      res.sendStatus(200);
    });
  }

  app.get('/', (_req, res) => res.redirect(302, '/status'));
  app.get('/status', (_req, res) => {
    res.type('html').send(renderStatusPage());
  });
  app.post('/mcp', requireApiKey, handleMcpRequest);
  app.use('/api', apiRouter);

  return app;
}

module.exports = {
  createApp,
  formatUptime,
  getApiKey,
  renderStatusPage,
  requireApiKey,
};
