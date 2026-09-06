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

function list(options = {}) {
  let entries;
  try {
    const parsed = JSON.parse(fs.readFileSync(storePath(), 'utf8'));
    entries = Array.isArray(parsed) ? parsed : [];
  } catch {
    entries = [];
  }
  if (options.since != null) entries = entries.filter((e) => e.id > options.since);
  if (options.limit != null) entries = entries.slice(-options.limit);
  return entries;
}

// ponytail: file polling is correct for the single-process deployment; a
// multi-process deployment needs an event bus on append instead.
const POLL_MS = 300;

async function waitFor(since, timeoutMs = 0) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const fresh = list({ since });
    if (fresh.length || Date.now() >= deadline) return fresh;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
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
  try {
    append({
      id: msg.message_id,
      text: msg.text,
      chat_id: msg.chat.id,
      reply_to_message_id: msg.reply_to_message?.message_id ?? null,
      reference: ref ? ref[0] : null,
      ts: new Date((msg.date || Date.now() / 1000) * 1000).toISOString(),
    });
  } catch (err) {
    // A broken store must not break message handling; the message is lost
    // but the failure is visible in the logs.
    console.error(`[WatchTower] reply store write failed (message ${msg.message_id} dropped):`, err.message);
  }
  return true;
}

module.exports = { list, append, capture, waitFor, isAgentChat, MAX_REPLIES };
