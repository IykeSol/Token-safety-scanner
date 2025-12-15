// telegram-bot.js
const TelegramBot = require('node-telegram-bot-api');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const WEBHOOK_URL = process.env.WEBHOOK_URL;

if (!BOT_TOKEN) {
  console.log('⚠️  No TELEGRAM_BOT_TOKEN found, skipping bot setup');
  module.exports = null;
  return;
}

// Create bot WITHOUT polling (webhook mode)
const bot = new TelegramBot(BOT_TOKEN);

// Set webhook URL
const webhookPath = `/bot${BOT_TOKEN}`;
bot.setWebHook(`${WEBHOOK_URL}${webhookPath}`)
  .then(() => console.log(`✅ Telegram webhook set: ${WEBHOOK_URL}${webhookPath}`))
  .catch(err => console.error('❌ Failed to set webhook:', err.message));

// Bot commands
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    '👋 *Welcome to Token Safety Scanner!*\n\n' +
    'Send me a token address like:\n' +
    '`/scan eth 0xdAC17F958D2ee523a2206206994597C13D831ec7`\n\n' +
    'Supported networks:\n• eth (Ethereum)\n• bsc (Binance Smart Chain)\n• polygon\n• solana',
    { parse_mode: 'Markdown' }
  );
});

bot.onText(/\/scan\s+(\w+)\s+([0-9a-zA-Z]+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const network = match[1].toLowerCase();
  const address = match[2];

  const validNetworks = ['eth', 'ethereum', 'bsc', 'polygon', 'solana'];
  if (!validNetworks.includes(network)) {
    return bot.sendMessage(chatId, '❌ Invalid network. Use: eth, bsc, polygon, or solana');
  }

  bot.sendMessage(chatId, `🔍 Scanning *${network.toUpperCase()}* token...\n\`${address}\``, 
    { parse_mode: 'Markdown' }
  );

  try {
    const axios = require('axios');
    const API_BASE = process.env.API_BASE || 'http://localhost:10000/api';
    
    const res = await axios.get(`${API_BASE}/check-token/${network}/${address}`, {
      timeout: 30000
    });
    
    const data = res.data;
    const risk = data.riskAssessment;
    const ti = data.tokenInfo;
    const hc = data.holderConcentration;

    let riskEmoji = risk.level === 'safe' ? '✅' : risk.level === 'medium' ? '⚠️' : '🚨';

    const text =
      `${riskEmoji} *${ti.name} (${ti.symbol})*\n\n` +
      `*Network:* ${network.toUpperCase()}\n` +
      `*Risk Score:* ${risk.score}/100 (${risk.level.toUpperCase()})\n` +
      (hc && hc.available ? `*Top 10 Holders:* ${hc.top10Percentage}% of supply\n` : '') +
      `\n*Main Risks:*\n` +
      risk.risks.slice(0, 5).map(r => `• ${r}`).join('\n') +
      `\n\n[View on Explorer](${data.explorerUrl})`;

    await bot.sendMessage(chatId, text, { 
      parse_mode: 'Markdown', 
      disable_web_page_preview: true 
    });
  } catch (err) {
    console.error('Telegram scan error:', err.message);
    bot.sendMessage(
      chatId, 
      '❌ Failed to scan token. Please check:\n• Valid address format\n• Correct network\n• Token exists'
    );
  }
});

// Export bot instance and webhook path
module.exports = { bot, webhookPath };
