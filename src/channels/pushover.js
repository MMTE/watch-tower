const fs = require('fs');
const path = require('path');

const token = process.env.PUSHOVER_APP_TOKEN;
const user = process.env.PUSHOVER_USER_KEY;
const defaultDevice = process.env.PUSHOVER_DEVICE || '';
const enabled = Boolean(token && user);

const API = 'https://api.pushover.net/1/messages.json';

// info=0, warn=0, error=1, critical=2 (emergency requires retry/expire too,
// keep it at 1 for simplicity unless explicitly requested)
const LEVEL_PRIORITY = { info: -1, warn: 0, error: 1, critical: 2 };

function buildPriorityFields(level) {
  const priority = LEVEL_PRIORITY[level] ?? 0;
  const fields = { priority: String(priority) };
  if (priority === 2) {
    fields.retry = '60';
    fields.expire = '3600';
  }
  return fields;
}

async function sendMessage(text, { title, level } = {}) {
  if (!enabled) return;
  const form = new URLSearchParams({
    token,
    user,
    message: text,
    ...buildPriorityFields(level),
  });
  if (title) form.set('title', title);
  if (defaultDevice) form.set('device', defaultDevice);

  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Pushover error ${res.status}: ${body}`);
  }
}

async function sendFile(filePath, { caption, filename, title, level } = {}) {
  if (!enabled) return;
  const form = new FormData();
  form.set('token', token);
  form.set('user', user);
  form.set('message', caption || filename || path.basename(filePath));
  if (title) form.set('title', title);
  if (defaultDevice) form.set('device', defaultDevice);
  for (const [k, v] of Object.entries(buildPriorityFields(level))) form.set(k, v);

  const buf = fs.readFileSync(filePath);
  const blob = new Blob([buf]);
  form.set('attachment', blob, filename || path.basename(filePath));

  const res = await fetch(API, { method: 'POST', body: form });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Pushover file error ${res.status}: ${body}`);
  }
}

module.exports = {
  name: 'pushover',
  enabled,
  sendMessage,
  sendFile,
};
