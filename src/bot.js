// Telegram bot command UI. Only runs when not in MCP mode.
const telegram = require('./channels/telegram');
const channels = require('./channels');
const replies = require('./replies');

const isMCP = process.env.WATCHTOWER_MCP === '1';
const token = process.env.TELEGRAM_BOT_TOKEN;
const webhookUrl = process.env.WEBHOOK_URL || null;

if (!telegram.enabled || isMCP) {
  module.exports = { bot: telegram.bot };
  return;
}

const bot = telegram.bot;

function getHelpText() {
  return `🧭 *Watch Tower Commands*

/start \\- Register and get your chat ID
/ping \\- Check if bot is alive
/id \\- Get your chat ID
/status \\- Bot status, uptime, active channels
/channels \\- List configured notification channels
/help \\- Show this help message
/echo <text\\> \\- Echo back your message
/time \\- Current server time`;
}

if (webhookUrl) {
  bot.setWebHook(`${webhookUrl}/bot${token}`)
    .then(() => console.log(`[WatchTower] Telegram webhook set: ${webhookUrl}/bot${token}`))
    .catch((err) => console.error('[WatchTower] Failed to set webhook:', err.message));
} else {
  console.log('[WatchTower] Telegram bot using polling mode');
}

bot.setMyCommands([
  { command: 'start', description: 'Register and get chat ID' },
  { command: 'ping', description: 'Check if bot is alive' },
  { command: 'id', description: 'Get your chat ID' },
  { command: 'status', description: 'Bot status and uptime' },
  { command: 'channels', description: 'List notification channels' },
  { command: 'help', description: 'Show help message' },
  { command: 'time', description: 'Current server time' },
  { command: 'echo', description: 'Echo back your message' },
]).catch((err) => console.error('[WatchTower] Failed to set commands:', err.message));

bot.onText(/\/start/, (msg) => {
  const id = String(msg.chat.id);
  telegram.setChatId(id);
  console.log(`[WatchTower] Chat ID detected: ${id}`);
  console.log(`[WatchTower] Add this to your .env: TELEGRAM_CHAT_ID=${id}`);
  bot.sendMessage(
    msg.chat.id,
    `🏗 *Watch Tower is connected\\!*\n\nYour chat ID: \`${id}\`\n\n` + getHelpText(),
    { parse_mode: 'MarkdownV2' }
  );
});

bot.onText(/\/ping/, (msg) => bot.sendMessage(msg.chat.id, '🏓 Pong! Watch Tower is alive.'));

bot.onText(/\/id/, (msg) =>
  bot.sendMessage(msg.chat.id, `Your chat ID: \`${msg.chat.id}\``, { parse_mode: 'Markdown' })
);

bot.onText(/\/help/, (msg) => bot.sendMessage(msg.chat.id, getHelpText(), { parse_mode: 'MarkdownV2' }));

bot.onText(/\/channels/, (msg) => {
  const all = channels.ALL.map((c) => `${c.enabled ? '✅' : '⬜️'} ${c.name}`).join('\n');
  bot.sendMessage(msg.chat.id, `🔌 *Channels*\n${all}`, { parse_mode: 'Markdown' });
});

bot.onText(/\/status/, (msg) => {
  // In the authorized agent chat, /status belongs to the agent bridge
  // (fleet status) — captured by the message handler below, answered by the
  // polling agent. The uptime status stays available from any other chat.
  if (replies.isAgentChat(msg.chat.id)) return;
  const uptime = process.uptime();
  const h = Math.floor(uptime / 3600);
  const m = Math.floor((uptime % 3600) / 60);
  const s = Math.floor(uptime % 60);
  const mem = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);
  const active = channels.enabledChannels().map((c) => c.name).join(', ') || 'none';
  const status = `📊 *Watch Tower Status*\n\n⏱ Uptime: ${h}h ${m}m ${s}s\n💾 Memory: ${mem} MB\n🔌 Channels: ${active}\n🟢 Status: Online`;
  bot.sendMessage(msg.chat.id, status, { parse_mode: 'Markdown' });
});

bot.onText(/\/echo (.+)/, (msg, match) => bot.sendMessage(msg.chat.id, `🔊 ${match[1]}`));

bot.onText(/\/time/, (msg) => {
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
  bot.sendMessage(msg.chat.id, `🕐 Server time: \`${now} UTC\``, { parse_mode: 'Markdown' });
});

bot.on('message', (msg) => {
  if (!msg.text) return;
  // Messages from the authorized chat are queued for agent polling
  // (GET /api/agent/replies); the 👍 tells the human it landed, the
  // answer itself comes from the agent.
  if (replies.capture(msg)) {
    telegram.ackReaction(msg.chat.id, msg.message_id).catch(() => {});
    return;
  }
  if (msg.text.startsWith('/') && !msg.text.match(/^\/(start|ping|id|status|channels|help|time|echo)/)) {
    bot.sendMessage(msg.chat.id, getHelpText(), { parse_mode: 'MarkdownV2' });
  }
});

bot.on('polling_error', (err) => console.error('[WatchTower] Bot polling error:', err.message));

module.exports = { bot };
