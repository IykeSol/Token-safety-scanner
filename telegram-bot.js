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
    '🛡️ *Welcome to Token Safety Scanner!*\n\n' +
    '🔍 Check any crypto token for:\n' +
    '• Honeypot detection\n' +
    '• Holder concentration\n' +
    '• Ownership risks\n' +
    '• Contract verification\n\n' +
    '👇 *Select a network to scan:*',
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
    '🌐 *Select Network*\n\nChoose the blockchain network:',
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
    
    // Store selected network in user session
    userSessions.set(chatId, { network });

    // Network emojis
    const networkEmojis = {
      ethereum: '🔷',
      bsc: '🟡',
      polygon: '🟣',
      solana: '🟢'
    };

    // Answer callback query (removes loading state)
    bot.answerCallbackQuery(callbackQuery.id);

    // Ask for token address
    bot.sendMessage(
      chatId,
      `${networkEmojis[network]} *${network.toUpperCase()} Selected*\n\n` +
      '📋 *Now send the token contract address:*\n\n' +
      'Example:\n' +
      '`0xdAC17F958D2ee523a2206206994597C13D831ec7`',
      { parse_mode: 'Markdown' }
    );
  }
});

// Handle text messages (token addresses)
bot.on('message', async (msg) => {
  // Ignore commands
  if (msg.text && msg.text.startsWith('/')) return;
  
  const chatId = msg.chat.id;
  const address = msg.text?.trim();

  // Check if user has selected a network
  const session = userSessions.get(chatId);
  
  if (!session || !session.network) {
    return bot.sendMessage(
      chatId,
      '⚠️ Please select a network first!\n\nUse /scan to start.',
      { parse_mode: 'Markdown' }
    );
  }

  const network = session.network;

  // Validate address format
  if (!address || address.length < 32) {
    return bot.sendMessage(
      chatId,
      '❌ Invalid address format.\n\nPlease send a valid contract address.',
      { parse_mode: 'Markdown' }
    );
  }

  // Send scanning message
  const scanMsg = await bot.sendMessage(
    chatId,
    `🔍 *Scanning ${network.toUpperCase()} token...*\n\n` +
    `Address: \`${address.substring(0, 10)}...${address.substring(address.length - 8)}\`\n\n` +
    '⏳ Please wait...',
    { parse_mode: 'Markdown' }
  );

  try {
    const API_BASE = process.env.API_BASE || 'https://token-safety-scanner.onrender.com/api';
    
    const res = await axios.get(`${API_BASE}/check-token/${network}/${address}`, {
      timeout: 30000
    });
    
    const data = res.data;
    const risk = data.riskAssessment;
    const ti = data.tokenInfo;
    const hc = data.holderConcentration;

    // Risk emoji and color
    let riskEmoji = '✅';
    if (risk.level === 'danger') riskEmoji = '🚨';
    else if (risk.level === 'warning') riskEmoji = '⚠️';

    // Build response
    let message = `${riskEmoji} *${ti.name} (${ti.symbol})*\n\n`;
    message += `*Network:* ${network.toUpperCase()}\n`;
    message += `*Risk Score:* ${risk.score}/100 (*${risk.level.toUpperCase()}*)\n`;
    
    // Holder concentration
    if (hc && hc.available) {
      const holderEmoji = hc.risk === 'high' ? '🚨' : hc.risk === 'medium' ? '⚠️' : '✅';
      message += `${holderEmoji} *Top 10 Holders:* ${hc.top10Percentage}% of supply\n`;
    }
    
    // Main risks
    if (risk.risks && risk.risks.length > 0) {
      message += `\n*⚠️ Main Risks:*\n`;
      risk.risks.slice(0, 5).forEach(r => {
        message += `• ${r}\n`;
      });
    }
    
    // Explorer link button
    const keyboard = {
      inline_keyboard: [
        [{ text: '🔍 View on Explorer', url: data.explorerUrl }],
        [{ text: '🔄 Scan Another Token', callback_data: 'scan_new' }]
      ]
    };

    // Delete scanning message
    bot.deleteMessage(chatId, scanMsg.message_id).catch(() => {});

    // Send result
    await bot.sendMessage(chatId, message, { 
      parse_mode: 'Markdown',
      reply_markup: keyboard,
      disable_web_page_preview: true 
    });

    // Clear session after successful scan
    userSessions.delete(chatId);

  } catch (err) {
    console.error('Scan error:', err.response?.data || err.message);
    
    // Delete scanning message
    bot.deleteMessage(chatId, scanMsg.message_id).catch(() => {});

    let errorMsg = '❌ *Failed to scan token*\n\n';
    
    if (err.response?.status === 400) {
      errorMsg += '❗ Invalid address or network mismatch\n\n';
      errorMsg += 'Make sure:\n';
      errorMsg += `• Address is valid for *${network.toUpperCase()}*\n`;
      errorMsg += '• Token exists on this network';
    } else if (err.response?.status === 404) {
      errorMsg += '⚠️ Token not found\n\n';
      errorMsg += 'This token may not be listed or deployed yet.';
    } else if (err.code === 'ECONNABORTED') {
      errorMsg += '⏱️ Request timeout\n\n';
      errorMsg += 'The server took too long to respond. Try again.';
    } else {
      errorMsg += '🔧 Server error\n\n';
      errorMsg += 'Please try again in a moment.';
    }

    const retryKeyboard = {
      inline_keyboard: [
        [{ text: '🔄 Try Again', callback_data: `network_${network}` }],
        [{ text: '🏠 Back to Networks', callback_data: 'scan_new' }]
      ]
    };
    
    bot.sendMessage(chatId, errorMsg, { 
      parse_mode: 'Markdown',
      reply_markup: retryKeyboard
    });

    // Keep session for retry
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
      '🌐 *Select Network*\n\nChoose the blockchain network:',
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
    '📖 *How to Use*\n\n' +
    '1️⃣ Send /scan or /start\n' +
    '2️⃣ Click on a network button\n' +
    '3️⃣ Send the token contract address\n' +
    '4️⃣ Get instant security analysis!\n\n' +
    '*Supported Networks:*\n' +
    '🔷 Ethereum\n' +
    '🟡 Binance Smart Chain\n' +
    '🟣 Polygon\n' +
    '🟢 Solana\n\n' +
    '*What we check:*\n' +
    '✓ Honeypot detection\n' +
    '✓ Holder concentration\n' +
    '✓ Ownership status\n' +
    '✓ Contract verification\n' +
    '✓ Tax rates\n' +
    '✓ Liquidity analysis',
    { parse_mode: 'Markdown' }
  );
});

module.exports = { bot, webhookPath };
