// In-memory ring of recent outbound sends. Newest first; lost on restart —
// it feeds the admin page's "recent activity", not an audit log.
const MAX_SENDS = 50;
const sends = [];

function recordSend(entry) {
  sends.push({ ...entry, text: String(entry.text || '').slice(0, 200), ts: new Date().toISOString() });
  if (sends.length > MAX_SENDS) sends.shift();
}

function listSends() {
  return sends.slice().reverse();
}

module.exports = { recordSend, listSends, MAX_SENDS };
