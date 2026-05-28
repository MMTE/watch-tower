const fs = require('fs');
const path = require('path');

const url = (process.env.GOTIFY_URL || '').replace(/\/+$/, '');
const token = process.env.GOTIFY_APP_TOKEN;
const enabled = Boolean(url && token);

// Gotify priorities: 0..10. Map alert levels.
const LEVEL_PRIORITY = { info: 2, warn: 5, error: 7, critical: 10 };

async function sendMessage(text, { title, level } = {}) {
  if (!enabled) return;
  const priority = LEVEL_PRIORITY[level] ?? 4;
  const res = await fetch(`${url}/message?token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: title || 'Watch Tower',
      message: text,
      priority,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gotify error ${res.status}: ${body}`);
  }
}

// Gotify has no native attachments in /message; expose file by sending a
// message that references the filename. Bigger files can be uploaded as a
// plugin/image extra later. For MVP we send the file's text content if it
// looks textual, otherwise a placeholder note.
async function sendFile(filePath, { caption, filename, title, level } = {}) {
  if (!enabled) return;
  const name = filename || path.basename(filePath);
  const stat = fs.statSync(filePath);
  const isSmallText = stat.size < 16 * 1024;
  let body = caption ? `${caption}\n\n` : '';
  body += `📎 ${name} (${stat.size} bytes)`;
  if (isSmallText) {
    try {
      const text = fs.readFileSync(filePath, 'utf8');
      if (/^[\x09\x0a\x0d\x20-\x7e]*$/.test(text)) {
        body += `\n\n\`\`\`\n${text}\n\`\`\``;
      }
    } catch {
      /* binary, skip inline */
    }
  }
  return sendMessage(body, { title: title || name, level });
}

module.exports = {
  name: 'gotify',
  enabled,
  sendMessage,
  sendFile,
};
