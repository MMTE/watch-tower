// Inbound reply store. Captures text messages the authorized Telegram chat
// sends to the bot and persists them so agent bridges (e.g. gholam's
// tg-bridge) can poll them via GET /api/agent/replies. The store is a small
// JSON file capped at MAX_REPLIES; consumers keep their own high-water mark
// against the monotonic Telegram message_id.

const fs = require('fs');
const path = require('path');

const MAX_REPLIES = 500;

// Utility commands stay with the bot itself; everything else from the
// authorized chat (including /status, /retry, /new and free text) is agent
// traffic.
const UTILITY_CMD = /^\/(start|ping|id|channels|help|time|echo)\b/;

const ISSUE_REF = /https?:\/\/\S*\/issues\/\d+|#\d+/;

function dataDir() {
  return process.env.WATCHTOWER_DATA_DIR || path.join(__dirname, '..', 'data');
}

function storePath() {
  return path.join(dataDir(), 'replies.json');
}

function list() {
  try {
    const parsed = JSON.parse(fs.readFileSync(storePath(), 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function save(entries) {
  fs.mkdirSync(dataDir(), { recursive: true });
  const tmp = `${storePath()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(entries, null, 2));
  fs.renameSync(tmp, storePath());
}

function append(entry) {
  const entries = list();
  entries.push(entry);
  save(entries.slice(-MAX_REPLIES));
  return entry;
}

function isAgentChat(chatId) {
  const configured = process.env.TELEGRAM_CHAT_ID;
  return Boolean(configured) && String(chatId) === String(configured);
}

// Returns true when the message was queued for agent polling (so the bot
// should not answer it itself). The issue reference is taken from the
// replied-to message first (replying to a notification is the natural
// gesture), falling back to the message text.
function capture(msg) {
  if (!msg.text || !isAgentChat(msg.chat.id)) return false;
  if (UTILITY_CMD.test(msg.text)) return false;
  const refSource = `${msg.reply_to_message?.text || ''}\n${msg.text}`;
  const ref = refSource.match(ISSUE_REF);
  append({
    id: msg.message_id,
    text: msg.text,
    reference: ref ? ref[0] : null,
    ts: new Date((msg.date || Date.now() / 1000) * 1000).toISOString(),
  });
  return true;
}

module.exports = { list, append, capture, isAgentChat, MAX_REPLIES };
