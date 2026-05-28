const TelegramBot = require('node-telegram-bot-api');

const token = process.env.BALE_BOT_TOKEN;
const chatId = process.env.BALE_CHAT_ID;
const BALE_API = 'https://tapi.bale.ai';
const enabled = Boolean(token && chatId);

let bot = null;
if (enabled) {
  bot = new TelegramBot(token, { baseApiUrl: BALE_API });
}

async function sendMessage(text, { title, parse_mode } = {}) {
  if (!enabled) return;
  const body = title ? `*${title}*\n\n${text}` : text;
  const opts = {};
  if (parse_mode) opts.parse_mode = parse_mode;
  else if (title) opts.parse_mode = 'Markdown';
  try {
    return await bot.sendMessage(chatId, body, opts);
  } catch (err) {
    console.error('[WatchTower] Bale sendMessage error:', err.message);
  }
}

async function sendFile(filePath, { caption, filename } = {}) {
  if (!enabled) return;
  const opts = caption ? { caption } : {};
  const fileOpts = filename ? { filename } : {};
  try {
    return await bot.sendDocument(chatId, filePath, opts, fileOpts);
  } catch (err) {
    console.error('[WatchTower] Bale sendFile error:', err.message);
  }
}

module.exports = {
  name: 'bale',
  enabled,
  sendMessage,
  sendFile,
};
