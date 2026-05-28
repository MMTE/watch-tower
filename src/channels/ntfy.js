const fs = require('fs');
const path = require('path');

const baseUrl = (process.env.NTFY_URL || 'https://ntfy.sh').replace(/\/+$/, '');
const topic = process.env.NTFY_TOPIC;
const tokenOrUser = process.env.NTFY_TOKEN; // bearer
const user = process.env.NTFY_USER;
const pass = process.env.NTFY_PASSWORD;
const enabled = Boolean(topic);

// ntfy priority: 1..5 (min, low, default, high, max).
const LEVEL_PRIORITY = { info: 2, warn: 3, error: 4, critical: 5 };
const LEVEL_TAGS = {
  info: 'information_source',
  warn: 'warning',
  error: 'rotating_light',
  critical: 'sos',
};

function authHeader() {
  if (tokenOrUser) return { Authorization: `Bearer ${tokenOrUser}` };
  if (user && pass) {
    const basic = Buffer.from(`${user}:${pass}`).toString('base64');
    return { Authorization: `Basic ${basic}` };
  }
  return {};
}

function targetUrl() {
  return `${baseUrl}/${topic}`;
}

async function sendMessage(text, { title, level } = {}) {
  if (!enabled) return;
  const headers = { ...authHeader() };
  if (title) headers['Title'] = title;
  const priority = LEVEL_PRIORITY[level];
  if (priority) headers['Priority'] = String(priority);
  const tag = LEVEL_TAGS[level];
  if (tag) headers['Tags'] = tag;

  const res = await fetch(targetUrl(), {
    method: 'POST',
    headers,
    body: text,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`ntfy error ${res.status}: ${body}`);
  }
}

async function sendFile(filePath, { caption, filename, title, level } = {}) {
  if (!enabled) return;
  const name = filename || path.basename(filePath);
  const headers = {
    ...authHeader(),
    Filename: name,
  };
  if (title) headers['Title'] = title;
  if (caption) headers['Message'] = caption;
  const priority = LEVEL_PRIORITY[level];
  if (priority) headers['Priority'] = String(priority);
  const tag = LEVEL_TAGS[level];
  if (tag) headers['Tags'] = tag;

  const body = fs.readFileSync(filePath);
  const res = await fetch(targetUrl(), { method: 'PUT', headers, body });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ntfy file error ${res.status}: ${text}`);
  }
}

module.exports = {
  name: 'ntfy',
  enabled,
  sendMessage,
  sendFile,
};
