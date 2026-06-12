// Agent-facing endpoints. POST / accepts a gholam-style notify payload and
// fans it out to the notification channels; GET /replies returns the inbound
// messages captured from the authorized Telegram chat (see replies.js).
// Mounted at /api/agent, so an agent configures one base URL for both
// directions (gholam: GHOLAM_WATCHTOWER_URL=https://host/api/agent).

const express = require('express');
const channels = require('./channels');
const replies = require('./replies');
const { requireApiKey } = require('./auth');

const router = express.Router();
router.use(requireApiKey);

// Payload: { repo, summary, kind, issue?, issue_url? }. Plain text only —
// summaries are arbitrary agent output, so no Markdown parse mode that a
// stray underscore could break.
router.post('/', async (req, res) => {
  try {
    const { repo, summary, kind, issue, issue_url } = req.body || {};
    if (!summary) {
      return res.status(400).json({ ok: false, message: 'Missing required field: summary' });
    }
    const headline = `🤖 [${kind || 'notify'}] ${issue != null ? `${repo || ''}#${issue}` : repo || ''}`.trim();
    const lines = [headline, '', summary];
    if (issue_url) lines.push('', issue_url);
    const result = await channels.notify({
      text: lines.join('\n'),
      channels: req.body?.channels,
    });
    const ok = result.delivered.length > 0;
    res.status(ok ? 200 : 502).json({ ok, delivered: result.delivered, errors: result.errors });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

router.get('/replies', (_req, res) => {
  res.json(replies.list());
});

module.exports = router;
