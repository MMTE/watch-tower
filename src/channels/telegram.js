const TelegramBot = require('node-telegram-bot-api');

const token = process.env.TELEGRAM_BOT_TOKEN;
const webhookUrl = process.env.WEBHOOK_URL || null;
let chatId = process.env.TELEGRAM_CHAT_ID || null;

const isMCP = process.env.WATCHTOWER_MCP === '1';
const enabled = Boolean(token);

let bot = null;
if (enabled) {
  if (isMCP) {
    bot = new TelegramBot(token);
  } else if (webhookUrl) {
    bot = new TelegramBot(token);
  } else {
    bot = new TelegramBot(token, { polling: true });
  }
}

function setChatId(id) {
  chatId = String(id);
}

function getChatId() {
  if (!chatId) throw new Error('No Telegram chat ID configured. Send /start to the bot or set TELEGRAM_CHAT_ID.');
  return chatId;
}

async function sendMessage(text, { title, parse_mode } = {}) {
  if (!enabled) return;
  const body = title ? `*${title}*\n\n${text}` : text;
  const opts = {};
  if (parse_mode) opts.parse_mode = parse_mode;
  else if (title) opts.parse_mode = 'Markdown';
  return bot.sendMessage(getChatId(), body, opts);
}

async function sendFile(filePath, { caption, filename } = {}) {
  if (!enabled) return;
  const opts = caption ? { caption } : {};
  const fileOpts = filename ? { filename } : {};
  return bot.sendDocument(getChatId(), filePath, opts, fileOpts);
}

module.exports = {
  name: 'telegram',
  enabled,
  bot,
  setChatId,
  getChatId,
  sendMessage,
  sendFile,
};
