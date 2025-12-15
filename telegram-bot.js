// telegram-bot.js
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const API_BASE = process.env.API_BASE || 'https://token-safety-scanner.onrender.com/api';

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// /start command
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    '👋 Send me a token address like:\n\n`/scan eth 0xdAC17F958D2ee523a2206206994597C13D831ec7`',
    { parse_mode: 'Markdown' }
  );
});

// /scan <network> <address>
bot.onText(/\/scan\s+(\w+)\s+([0-9a-zA-Z]+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const network = match[1].toLowerCase();
  const address = match[2];

  bot.sendMessage(chatId, `🔍 Scanning *${network.toUpperCase()}* token...\n${address}`, { parse_mode: 'Markdown' });

  try {
    const res = await axios.get(`${API_BASE}/check-token/${network}/${address}`);
    const data = res.data;

    const risk = data.riskAssessment;
    const ti = data.tokenInfo;
    const hc = data.holderConcentration;

    const text =
      `*${ti.name} (${ti.symbol})*\n` +
      `Network: *${network.toUpperCase()}*\n` +
      `Score: *${risk.score}/100* (${risk.level.toUpperCase()})\n` +
      (hc && hc.available ? `Top 10 holders: *${hc.top10Percentage}%* of supply\n` : '') +
      `\nMain risks:\n` +
      risk.risks.slice(0, 4).map(r => `• ${r}`).join('\n') +
      `\n\nExplorer: ${data.explorerUrl}`;

    await bot.sendMessage(chatId, text, { parse_mode: 'Markdown', disable_web_page_preview: true });
  } catch (err) {
    console.error(err.message);
    bot.sendMessage(chatId, '❌ Failed to scan token. Try again or check the address/network.');
  }
});
