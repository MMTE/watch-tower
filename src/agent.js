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
    res.status(ok ? 200 : 502).json({ ok, delivered: result.delivered, errors: result.errors, message_ids: result.message_ids });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

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

module.exports = router;
