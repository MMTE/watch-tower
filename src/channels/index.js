const telegram = require('./telegram');
const bale = require('./bale');
const pushover = require('./pushover');
const gotify = require('./gotify');
const ntfy = require('./ntfy');

const ALL = [telegram, bale, pushover, gotify, ntfy];
const BY_NAME = Object.fromEntries(ALL.map((c) => [c.name, c]));

const defaultListEnv = (process.env.DEFAULT_CHANNELS || '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

function enabledChannels() {
  return ALL.filter((c) => c.enabled);
}

function resolveChannels(selection) {
  let names = [];
  if (Array.isArray(selection) && selection.length) {
    names = selection;
  } else if (typeof selection === 'string' && selection.trim()) {
    names = selection.split(',');
  } else if (defaultListEnv.length) {
    names = defaultListEnv;
  } else {
    return enabledChannels();
  }
  const out = [];
  for (const raw of names) {
    const n = String(raw).trim().toLowerCase();
    if (!n) continue;
    const ch = BY_NAME[n];
    if (!ch) throw new Error(`Unknown channel: ${n}. Available: ${ALL.map((c) => c.name).join(', ')}`);
    if (!ch.enabled) continue; // silently skip channels that aren't configured
    out.push(ch);
  }
  return out;
}

async function fanOut(fn, channels) {
  const targets = resolveChannels(channels);
  if (!targets.length) {
    return { delivered: [], errors: [{ channel: null, error: 'No channels enabled or selected' }] };
  }
  const results = await Promise.allSettled(targets.map(fn));
  const delivered = [];
  const errors = [];
  results.forEach((r, i) => {
    const name = targets[i].name;
    if (r.status === 'fulfilled') delivered.push(name);
    else errors.push({ channel: name, error: r.reason?.message || String(r.reason) });
  });
  return { delivered, errors };
}

async function notify({ text, title, level, parse_mode, channels } = {}) {
  if (!text) throw new Error('notify: text is required');
  return fanOut((ch) => ch.sendMessage(text, { title, level, parse_mode }), channels);
}

async function notifyFile({ filePath, caption, filename, title, level, channels } = {}) {
  if (!filePath) throw new Error('notifyFile: filePath is required');
  return fanOut((ch) => ch.sendFile(filePath, { caption, filename, title, level }), channels);
}

const LEVEL_EMOJI = {
  info: 'ℹ️',
  warn: '⚠️',
  error: '🔴',
  critical: '🚨',
};

function formatAlert(level, title, message) {
  const emoji = LEVEL_EMOJI[level] || 'ℹ️';
  return `${emoji} ${title}\n\n${message}`;
}

function formatLog(source, log) {
  const label = source || 'unknown';
  return `📋 Log from ${label}\n\n\`\`\`\n${log}\n\`\`\``;
}

module.exports = {
  ALL,
  BY_NAME,
  enabledChannels,
  resolveChannels,
  notify,
  notifyFile,
  formatAlert,
  formatLog,
  LEVEL_EMOJI,
};
