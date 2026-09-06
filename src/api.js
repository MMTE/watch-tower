const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const channels = require('./channels');
const { requireApiKey } = require('./auth');

const router = express.Router();
const upload = multer({ dest: path.join(__dirname, '..', 'uploads') });

function parseChannels(body, query) {
  const raw = body?.channels ?? query?.channels;
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (Array.isArray(raw)) return raw;
  return String(raw).split(',').map((s) => s.trim()).filter(Boolean);
}

function respond(res, result) {
  const ok = result.delivered.length > 0;
  res.status(ok ? 200 : 502).json({ ok, delivered: result.delivered, errors: result.errors, message_ids: result.message_ids });
}

function fail(res, err) {
  const unknownChannel = /^Unknown channel/.test(err.message);
  res.status(unknownChannel ? 400 : 500).json({ ok: false, message: err.message });
}


router.get('/health', (_req, res) => {
  res.json({
    ok: true,
    message: 'Watch Tower is running',
    channels: channels.ALL.map((c) => ({ name: c.name, enabled: c.enabled })),
  });
});

router.get('/channels', requireApiKey, (_req, res) => {
  res.json({
    ok: true,
    channels: channels.ALL.map((c) => ({ name: c.name, enabled: c.enabled })),
  });
});

router.post('/send', requireApiKey, async (req, res) => {
  try {
    const { text, parse_mode, title, level, reply_to } = req.body;
    if (!text) return res.status(400).json({ ok: false, message: 'Missing required field: text' });
    const result = await channels.notify({
      text, title, level, parse_mode, reply_to: Number(reply_to) || undefined,
      channels: parseChannels(req.body, req.query),
    });
    respond(res, result);
  } catch (err) {
    fail(res, err);
  }
});

router.post('/alert', requireApiKey, async (req, res) => {
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
    fail(res, err);
  }
});

router.post('/log', requireApiKey, async (req, res) => {
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
    fail(res, err);
  }
});

router.post('/file', requireApiKey, upload.single('file'), async (req, res) => {
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
      reply_to: Number(req.body.reply_to) || undefined,
      channels: parseChannels(req.body, req.query),
    });
    respond(res, result);
  } catch (err) {
    fail(res, err);
  } finally {
    if (cleanupPath) fs.promises.unlink(cleanupPath).catch(() => {});
  }
});

module.exports = router;
