// telegram-bot.js
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const WEBHOOK_URL = process.env.WEBHOOK_URL; // e.g., https://token-safety-scanner.onrender.com
const PORT = process.env.PORT || 3000;

// Create bot WITHOUT polling
const bot = new TelegramBot(BOT_TOKEN);

// Set webhook
bot.setWebHook(`${WEBHOOK_URL}/bot${BOT_TOKEN}`);

// Add webhook endpoint to your Express app
const app = express();
app.use(express.json());

app.post(`/bot${BOT_TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// Your bot commands here
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, '👋 Welcome! Send /scan <network> <address>');
});

bot.onText(/\/scan\s+(\w+)\s+([0-9a-zA-Z]+)/, async (msg, match) => {
  // ... your scan logic
});

app.listen(PORT, () => {
  console.log(`✅ Telegram bot webhook listening on port ${PORT}`);
});
