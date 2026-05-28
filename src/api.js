const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const channels = require('./channels');

const router = express.Router();
const upload = multer({ dest: path.join(__dirname, '..', 'uploads') });

function authMiddleware(req, res, next) {
  const apiKey = req.headers['x-api-key'] || req.query.key;
  if (!apiKey || apiKey !== process.env.API_KEY) {
    return res.status(401).json({ ok: false, message: 'Unauthorized: invalid or missing API key' });
  }
  next();
}

function parseChannels(body, query) {
  const raw = body?.channels ?? query?.channels;
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (Array.isArray(raw)) return raw;
  return String(raw).split(',').map((s) => s.trim()).filter(Boolean);
}

function respond(res, result) {
  const ok = result.delivered.length > 0;
  res.status(ok ? 200 : 502).json({
    ok,
    delivered: result.delivered,
    errors: result.errors,
  });
}

router.get('/health', (_req, res) => {
  res.json({
    ok: true,
    message: 'Watch Tower is running',
    channels: channels.ALL.map((c) => ({ name: c.name, enabled: c.enabled })),
  });
});

router.get('/channels', authMiddleware, (_req, res) => {
  res.json({
    ok: true,
    channels: channels.ALL.map((c) => ({ name: c.name, enabled: c.enabled })),
  });
});

router.post('/send', authMiddleware, async (req, res) => {
  try {
    const { text, parse_mode, title, level } = req.body;
    if (!text) return res.status(400).json({ ok: false, message: 'Missing required field: text' });
    const result = await channels.notify({
      text, title, level, parse_mode,
      channels: parseChannels(req.body, req.query),
    });
    respond(res, result);
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

router.post('/alert', authMiddleware, async (req, res) => {
  try {
    const { level, title, message } = req.body;
    if (!level || !title || !message) {
      return res.status(400).json({ ok: false, message: 'Missing required fields: level, title, message' });
    }
    const result = await channels.notify({
      text: message,
      title: `${channels.LEVEL_EMOJI[level] || ''} ${title}`.trim(),
      level,
      channels: parseChannels(req.body, req.query),
    });
    respond(res, result);
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

router.post('/log', authMiddleware, async (req, res) => {
  try {
    const { source, log } = req.body;
    if (!log) return res.status(400).json({ ok: false, message: 'Missing required field: log' });
    const label = source || 'unknown';
    const result = await channels.notify({
      text: `\`\`\`\n${log}\n\`\`\``,
      title: `📋 Log from ${label}`,
      parse_mode: 'Markdown',
      channels: parseChannels(req.body, req.query),
    });
    respond(res, result);
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

router.post('/file', authMiddleware, upload.single('file'), async (req, res) => {
  let cleanupPath = null;
  try {
    if (!req.file) return res.status(400).json({ ok: false, message: 'No file uploaded' });
    cleanupPath = req.file.path;
    const caption = req.body.caption || req.file.originalname;
    const filename = req.body.filename || req.file.originalname;
    const result = await channels.notifyFile({
      filePath: req.file.path,
      caption,
      filename,
      title: req.body.title,
      level: req.body.level,
      channels: parseChannels(req.body, req.query),
    });
    respond(res, result);
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  } finally {
    if (cleanupPath) fs.promises.unlink(cleanupPath).catch(() => {});
  }
});

module.exports = router;
