require('dotenv').config();

const express = require('express');
const { bot } = require('./bot');
const apiRouter = require('./api');
const channels = require('./channels');

const app = express();
const PORT = process.env.PORT || process.env.API_PORT || 3000;
const token = process.env.TELEGRAM_BOT_TOKEN;

app.use(express.json());

// Telegram webhook endpoint (only meaningful if Telegram is enabled)
if (token) {
  app.post(`/bot${token}`, (req, res) => {
    if (bot) bot.processUpdate(req.body);
    res.sendStatus(200);
  });
}

app.use('/api', apiRouter);

app.listen(PORT, () => {
  console.log(`[WatchTower] REST API listening on port ${PORT}`);
  const active = channels.enabledChannels().map((c) => c.name);
  console.log(`[WatchTower] Enabled channels: ${active.join(', ') || 'none'}`);
  if (token) {
    if (process.env.WEBHOOK_URL) console.log('[WatchTower] Telegram bot using webhook mode');
    else console.log('[WatchTower] Telegram bot is polling...');
    console.log('[WatchTower] Send /start to your bot to register your chat ID');
    if (process.env.TELEGRAM_CHAT_ID) {
      console.log(`[WatchTower] Using configured Telegram chat ID: ${process.env.TELEGRAM_CHAT_ID}`);
    }
  }
});
