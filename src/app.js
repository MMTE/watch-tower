const express = require('express');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { bot } = require('./bot');
const apiRouter = require('./api');
const agentRouter = require('./agent');
const { createMcpServer } = require('./mcpServer');
const { getApiKey, requireApiKey } = require('./auth');
const pkg = require('../package.json');
const channels = require('./channels');
const replies = require('./replies');

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

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderStatusPage() {
  const memory = process.memoryUsage();
  const environment = process.env.NODE_ENV === 'production' ? 'production' : 'development';
  const inbox = replies.list();
  const lastReply = inbox.length
    ? `${escapeHtml(inbox[inbox.length - 1].ts.slice(0, 19))} UTC · ${escapeHtml(inbox[inbox.length - 1].text.slice(0, 80))}`
    : 'no replies captured yet';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Watch Tower Status</title>
  <style>
    :root { color-scheme: light dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; background: Canvas; color: CanvasText; }
    main { max-width: 640px; margin: 0 auto; padding: 48px 20px; }
    h1 { margin: 0 0 4px; font-size: clamp(1.6rem, 5vw, 2.4rem); letter-spacing: -0.01em; }
    .sub { margin: 0 0 32px; color: color-mix(in srgb, CanvasText 55%, Canvas 45%); font-size: 0.9rem; }
    .section-label { font-size: 0.75rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: color-mix(in srgb, CanvasText 50%, Canvas 50%); margin: 28px 0 10px; }
    dl { border: 1px solid color-mix(in srgb, CanvasText 14%, Canvas 86%); border-radius: 10px; margin: 0 0 8px; padding: 0; overflow: hidden; }
    div { display: flex; justify-content: space-between; align-items: center; gap: 20px; padding: 13px 16px; border-bottom: 1px solid color-mix(in srgb, CanvasText 9%, Canvas 91%); }
    div:last-child { border-bottom: 0; }
    dt { color: color-mix(in srgb, CanvasText 65%, Canvas 35%); font-size: 0.9rem; }
    dd { margin: 0; font-weight: 600; font-size: 0.9rem; text-align: right; }
    .ok { color: #15803d; }
    .meta { color: color-mix(in srgb, CanvasText 55%, Canvas 45%); font-weight: 400; font-size: 0.8rem; margin-left: 8px; }
  </style>
</head>
<body>
  <main>
    <h1>Watch Tower</h1>
    <p class="sub">v${pkg.version} &middot; ${environment} &middot; up ${formatUptime(process.uptime())} &middot; ${(memory.rss / 1024 / 1024).toFixed(1)} MB RSS</p>

    <p class="section-label">Services</p>
    <dl aria-label="Service status">
      <div>
        <dt>API backend</dt>
        <dd><span class="ok">online</span><span class="meta">REST + /api/health</span></dd>
      </div>
      <div>
        <dt>MCP server</dt>
        <dd><span class="ok">online</span><span class="meta">POST /mcp (HTTP)</span></dd>
      </div>
      <div>
        <dt>Frontend website</dt>
        <dd><span class="ok">online</span><span class="meta"><a href="https://mmte.github.io/watch-tower" style="color:inherit">mmte.github.io/watch-tower</a></span></dd>
      </div>
    </dl>

    <p class="section-label">Channels</p>
    <dl aria-label="Channels">
      ${channels.ALL.map((c) => `<div><dt>${c.name}</dt><dd>${c.enabled ? '<span class="ok">enabled</span>' : '<span class="meta">not configured</span>'}</dd></div>`).join('\n      ')}
    </dl>

    <p class="section-label">Inbox</p>
    <dl aria-label="Inbox">
      <div><dt>Last reply</dt><dd><span class="meta">${lastReply}</span></dd></div>
    </dl>
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
  app.use('/api/agent', agentRouter);
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
