// telegram-bot.js
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const WEBHOOK_URL = process.env.WEBHOOK_URL;

if (!BOT_TOKEN) {
  console.log('⚠️  No TELEGRAM_BOT_TOKEN found, skipping bot setup');
  module.exports = null;
  return;
}

const bot = new TelegramBot(BOT_TOKEN);

const webhookPath = `/bot${BOT_TOKEN}`;
bot.setWebHook(`${WEBHOOK_URL}${webhookPath}`)
  .then(() => console.log(`✅ Telegram webhook set: ${WEBHOOK_URL}${webhookPath}`))
  .catch(err => console.error('❌ Failed to set webhook:', err.message));

// Store user sessions
const userSessions = new Map();

// Helper function to format numbers
function formatNumber(num) {
  if (!num) return '0';
  const n = parseFloat(num);
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(2) + 'K';
  if (n < 0.000001) return n.toExponential(2);
  if (n < 0.01) return n.toFixed(6);
  if (n < 1) return n.toFixed(4);
  return n.toFixed(2);
}

// Helper function to format price
function formatPrice(price) {
  if (!price) return 'N/A';
  const p = parseFloat(price);
  if (p < 0.000001) return `$${p.toExponential(2)}`;
  if (p < 0.01) return `$${p.toFixed(8)}`;
  if (p < 1) return `$${p.toFixed(6)}`;
  if (p < 100) return `$${p.toFixed(4)}`;
  return `$${p.toFixed(2)}`;
}

// Helper function to format percentage
function formatPercentage(percent) {
  if (!percent || isNaN(percent)) return 'N/A';
  const p = parseFloat(percent);
  const sign = p >= 0 ? '📈' : '📉';
  return `${sign} ${p >= 0 ? '+' : ''}${p.toFixed(2)}%`;
}

// /start command - Show network selection
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  
  const keyboard = {
    inline_keyboard: [
      [
        { text: '🔷 Ethereum', callback_data: 'network_ethereum' },
        { text: '🟡 BSC', callback_data: 'network_bsc' }
      ],
      [
        { text: '🟣 Polygon', callback_data: 'network_polygon' },
        { text: '🟢 Solana', callback_data: 'network_solana' }
      ]
    ]
  };

  bot.sendMessage(
    chatId,
    '🛡️ *Token Safety Scanner Bot*\n\n' +
    '✨ *Professional Token Analysis*\n' +
    '━━━━━━━━━━━━━━━━━━━━\n\n' +
    '🔍 *We Check:*\n' +
    '• Real-time Price & Market Data\n' +
    '• Honeypot Detection\n' +
    '• Holder Concentration Risk\n' +
    '• Ownership & Renouncement\n' +
    '• Contract Verification\n' +
    '• Tax Rates & Liquidity\n\n' +
    '👇 *Select Network to Scan:*',
    { 
      parse_mode: 'Markdown',
      reply_markup: keyboard
    }
  );
});

// /scan command - Show network selection
bot.onText(/\/scan/, (msg) => {
  const chatId = msg.chat.id;
  
  const keyboard = {
    inline_keyboard: [
      [
        { text: '🔷 Ethereum', callback_data: 'network_ethereum' },
        { text: '🟡 BSC', callback_data: 'network_bsc' }
      ],
      [
        { text: '🟣 Polygon', callback_data: 'network_polygon' },
        { text: '🟢 Solana', callback_data: 'network_solana' }
      ]
    ]
  };

  bot.sendMessage(
    chatId,
    '🌐 *Select Blockchain Network*\n━━━━━━━━━━━━━━━━━━━━\n\nChoose the network:',
    { 
      parse_mode: 'Markdown',
      reply_markup: keyboard
    }
  );
});

// Handle network selection buttons
bot.on('callback_query', async (callbackQuery) => {
  const msg = callbackQuery.message;
  const chatId = msg.chat.id;
  const data = callbackQuery.data;

  // Handle network selection
  if (data.startsWith('network_')) {
    const network = data.replace('network_', '');
    
    userSessions.set(chatId, { network });

    const networkEmojis = {
      ethereum: '🔷',
      bsc: '🟡',
      polygon: '🟣',
      solana: '🟢'
    };

    bot.answerCallbackQuery(callbackQuery.id);

    bot.sendMessage(
      chatId,
      `${networkEmojis[network]} *${network.toUpperCase()} Network Selected*\n` +
      '━━━━━━━━━━━━━━━━━━━━\n\n' +
      '📋 *Send Token Contract Address*\n\n' +
      '✏️ Example:\n' +
      '`0xdAC17F958D2ee523a2206206994597C13D831ec7`',
      { parse_mode: 'Markdown' }
    );
  }
});

// Handle text messages (token addresses)
bot.on('message', async (msg) => {
  if (msg.text && msg.text.startsWith('/')) return;
  
  const chatId = msg.chat.id;
  const address = msg.text?.trim();

  const session = userSessions.get(chatId);
  
  if (!session || !session.network) {
    return bot.sendMessage(
      chatId,
      '⚠️ *Please select a network first!*\n\nUse /scan to start.',
      { parse_mode: 'Markdown' }
    );
  }

  const network = session.network;

  if (!address || address.length < 32) {
    return bot.sendMessage(
      chatId,
      '❌ *Invalid address format*\n\nPlease send a valid contract address.',
      { parse_mode: 'Markdown' }
    );
  }

  const scanMsg = await bot.sendMessage(
    chatId,
    `🔍 *Scanning Token...*\n━━━━━━━━━━━━━━━━━━━━\n\n` +
    `Network: *${network.toUpperCase()}*\n` +
    `Address: \`${address.substring(0, 10)}...${address.substring(address.length - 8)}\`\n\n` +
    '⏳ Analyzing security & fetching market data...',
    { parse_mode: 'Markdown' }
  );

  try {
    const API_BASE = process.env.API_BASE || 'https://token-safety-scanner.onrender.com/api';
    
    // Fetch security data and market data in parallel
    const [securityRes, marketRes] = await Promise.allSettled([
      axios.get(`${API_BASE}/check-token/${network}/${address}`, { timeout: 30000 }),
      axios.get(`${API_BASE}/token-info/${address}`, { timeout: 10000 })
    ]);

    if (securityRes.status !== 'fulfilled') {
      throw new Error('Security scan failed');
    }

    const data = securityRes.value.data;
    const risk = data.riskAssessment;
    const ti = data.tokenInfo;
    const hc = data.holderConcentration;

    // Get market data if available
    let marketData = null;
    if (marketRes.status === 'fulfilled' && marketRes.value.data.mainPair) {
      marketData = marketRes.value.data.mainPair;
    }

    // Risk emoji
    let riskEmoji = '✅';
    if (risk.level === 'danger') riskEmoji = '🚨';
    else if (risk.level === 'warning') riskEmoji = '⚠️';

    // Build professional message
    let message = `${riskEmoji} *${ti.name} (${ti.symbol})*\n`;
    message += '━━━━━━━━━━━━━━━━━━━━\n\n';

    // Market Data Section
    if (marketData) {
      message += '💰 *MARKET DATA*\n';
      message += `Price: *${formatPrice(marketData.priceUsd)}*\n`;
      
      if (marketData.priceChange24h) {
        message += `24h Change: ${formatPercentage(marketData.priceChange24h)}\n`;
      }
      
      if (marketData.liquidity) {
        message += `Liquidity: *$${formatNumber(marketData.liquidity)}*\n`;
      }
      
      if (marketData.volume24h) {
        message += `24h Volume: *$${formatNumber(marketData.volume24h)}*\n`;
      }
      
      message += '\n';
    }

    // Security Section
    message += '🛡️ *SECURITY ANALYSIS*\n';
    message += `Network: *${network.toUpperCase()}*\n`;
    message += `Risk Score: *${risk.score}/100* (*${risk.level.toUpperCase()}*)\n`;
    
    // Holder concentration
    if (hc && hc.available) {
      const holderEmoji = hc.risk === 'high' ? '🚨' : hc.risk === 'medium' ? '⚠️' : '✅';
      message += `${holderEmoji} Top 10 Holders: *${hc.top10Percentage}%*\n`;
    }
    
    // Main risks
    if (risk.risks && risk.risks.length > 0) {
      message += `\n⚠️ *KEY RISKS:*\n`;
      risk.risks.slice(0, 4).forEach(r => {
        message += `• ${r}\n`;
      });
    }
    
    message += '\n━━━━━━━━━━━━━━━━━━━━';

    // Buttons
    const keyboard = {
      inline_keyboard: [
        [{ text: '🔍 View on Explorer', url: data.explorerUrl }]
      ]
    };

    // Add DEX chart button if market data exists
    if (marketData && marketData.pairUrl) {
      keyboard.inline_keyboard.push([
        { text: '📊 View DEX Chart', url: marketData.pairUrl }
      ]);
    }

    keyboard.inline_keyboard.push([
      { text: '🔄 Scan Another Token', callback_data: 'scan_new' }
    ]);

    bot.deleteMessage(chatId, scanMsg.message_id).catch(() => {});

    await bot.sendMessage(chatId, message, { 
      parse_mode: 'Markdown',
      reply_markup: keyboard,
      disable_web_page_preview: true 
    });

    userSessions.delete(chatId);

  } catch (err) {
    console.error('Scan error:', err.response?.data || err.message);
    
    bot.deleteMessage(chatId, scanMsg.message_id).catch(() => {});

    let errorMsg = '❌ *Scan Failed*\n━━━━━━━━━━━━━━━━━━━━\n\n';
    
    if (err.response?.status === 400) {
      errorMsg += '❗ *Invalid Request*\n\n';
      errorMsg += `• Check address is valid for *${network.toUpperCase()}*\n`;
      errorMsg += '• Verify token exists on this network';
    } else if (err.response?.status === 404) {
      errorMsg += '⚠️ *Token Not Found*\n\n';
      errorMsg += 'This token may not be:\n';
      errorMsg += '• Listed on DEX yet\n';
      errorMsg += '• Deployed on this network';
    } else if (err.code === 'ECONNABORTED') {
      errorMsg += '⏱️ *Request Timeout*\n\n';
      errorMsg += 'Server response took too long.\nPlease try again.';
    } else {
      errorMsg += '🔧 *Server Error*\n\n';
      errorMsg += 'Our servers are busy.\nTry again in a moment.';
    }

    const retryKeyboard = {
      inline_keyboard: [
        [{ text: '🔄 Try Again', callback_data: `network_${network}` }],
        [{ text: '🏠 Select Network', callback_data: 'scan_new' }]
      ]
    };
    
    bot.sendMessage(chatId, errorMsg, { 
      parse_mode: 'Markdown',
      reply_markup: retryKeyboard
    });
  }
});

// Handle "Scan Another Token" button
bot.on('callback_query', async (callbackQuery) => {
  const data = callbackQuery.data;
  
  if (data === 'scan_new') {
    bot.answerCallbackQuery(callbackQuery.id);
    
    const keyboard = {
      inline_keyboard: [
        [
          { text: '🔷 Ethereum', callback_data: 'network_ethereum' },
          { text: '🟡 BSC', callback_data: 'network_bsc' }
        ],
        [
          { text: '🟣 Polygon', callback_data: 'network_polygon' },
          { text: '🟢 Solana', callback_data: 'network_solana' }
        ]
      ]
    };

    bot.sendMessage(
      callbackQuery.message.chat.id,
      '🌐 *Select Blockchain Network*\n━━━━━━━━━━━━━━━━━━━━\n\nChoose the network:',
      { 
        parse_mode: 'Markdown',
        reply_markup: keyboard
      }
    );
  }
});

// /help command
bot.onText(/\/help/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    '📖 *HOW TO USE*\n' +
    '━━━━━━━━━━━━━━━━━━━━\n\n' +
    '1️⃣ Send /scan or /start\n' +
    '2️⃣ Click network button\n' +
    '3️⃣ Paste contract address\n' +
    '4️⃣ Get instant analysis!\n\n' +
    '🌐 *SUPPORTED NETWORKS*\n' +
    '• 🔷 Ethereum\n' +
    '• 🟡 Binance Smart Chain\n' +
    '• 🟣 Polygon\n' +
    '• 🟢 Solana\n\n' +
    '🔍 *WE ANALYZE*\n' +
    '• 💰 Real-time Price\n' +
    '• 📊 24h Volume & Liquidity\n' +
    '• 🛡️ Honeypot Detection\n' +
    '• 👥 Holder Concentration\n' +
    '• 🔒 Ownership Status\n' +
    '• ✅ Contract Verification\n' +
    '• 💸 Buy/Sell Tax Rates',
    { parse_mode: 'Markdown' }
  );
});

module.exports = { bot, webhookPath };
