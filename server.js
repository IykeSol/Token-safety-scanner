const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { ethers } = require('ethers');
const { Connection, PublicKey } = require('@solana/web3.js');
require('dotenv').config();

if (process.env.TELEGRAM_BOT_TOKEN) {
  require('./telegram-bot');
}

BigInt.prototype.toJSON = function() {
  return this.toString();
};

const app = express();
const PORT = process.env.PORT || 3000;

const originalConsoleError = console.error;
console.error = (...args) => {
  const msg = args[0]?.toString() || '';
  if (msg.includes('JsonRpcProvider failed to detect network')) {
    return;
  }
  originalConsoleError.apply(console, args);
};

// Middleware
app.use(cors());
app.use(express.json());

// ✅ Simple root endpoint (no file serving)
app.get('/', (req, res) => {
  res.json({
    message: 'Token Safety Scanner API',
    version: '1.3.0',
    status: 'running',
    endpoints: {
      health: '/health',
      checkToken: '/api/check-token/:network/:address',
      tokenInfo: '/api/token-info/:address'
    },
    networks: ['ethereum', 'bsc', 'polygon', 'solana']
  });
});

// Rate limiting storage (simple in-memory)
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const MAX_REQUESTS = 10;

// Rate limiting middleware
const rateLimit = (req, res, next) => {
  const ip = req.ip;
  const now = Date.now();
  
  if (!rateLimitMap.has(ip)) {
    rateLimitMap.set(ip, []);
  }
  
  const requests = rateLimitMap.get(ip).filter(time => now - time < RATE_LIMIT_WINDOW);
  
  if (requests.length >= MAX_REQUESTS) {
    return res.status(429).json({ 
      error: 'Too many requests. Please try again later.',
      retryAfter: 60 
    });
  }
  
  requests.push(now);
  rateLimitMap.set(ip, requests);
  next();
};

// Multiple RPC endpoints with fallbacks
const RPC_ENDPOINTS = {
  ethereum: [
    'https://ethereum-rpc.publicnode.com',
    'https://eth.llamarpc.com',
    'https://rpc.ankr.com/eth'
  ],
  bsc: [
    'https://bsc-dataseed1.binance.org',
    'https://bsc-dataseed2.binance.org',
    'https://bsc.publicnode.com'
  ],
  polygon: [
    'https://polygon-bor-rpc.publicnode.com',
    'https://polygon-rpc.com',
    'https://rpc.ankr.com/polygon'
  ],
  solana: 'https://api.mainnet-beta.solana.com'
};

// Blockchain Explorer API Endpoints
const EXPLORER_APIS = {
  ethereum: 'https://api.etherscan.io/api',
  bsc: 'https://api.bscscan.com/api',
  polygon: 'https://api.polygonscan.com/api'
};

const getExplorerApiKey = (network) => {
  return process.env[`${network.toUpperCase()}_API_KEY`] || 
         process.env.ETHERSCAN_API_KEY || 
         'YourApiKeyToken';
};

const CHAIN_IDS = {
  ethereum: '1',
  bsc: '56',
  polygon: '137',
  solana: 'solana'
};

const TIMEOUTS = {
  RPC_CALL: 8000,
  GOPLUS_API: 15000,
  DEXSCREENER_API: 10000,
  EXPLORER_API: 10000
};

const HOLDER_CONCENTRATION_THRESHOLD = 15;

const getProvider = (network, rpcIndex = 0) => {
  const rpcUrls = RPC_ENDPOINTS[network];
  if (!rpcUrls) {
    throw new Error('Unsupported network');
  }
  
  if (network === 'solana') {
    return rpcUrls;
  }
  
  const rpcUrl = Array.isArray(rpcUrls) ? rpcUrls[rpcIndex] : rpcUrls;
  return new ethers.JsonRpcProvider(rpcUrl);
};

const isValidAddress = (address) => {
  try {
    return ethers.isAddress(address);
  } catch {
    return false;
  }
};

const isValidSolanaAddress = (address) => {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
};

function getExplorerUrl(network, address) {
  const explorers = {
    ethereum: `https://etherscan.io/token/${address}`,
    bsc: `https://bscscan.com/token/${address}`,
    polygon: `https://polygonscan.com/token/${address}`,
    solana: `https://solscan.io/token/${address}`
  };
  return explorers[network] || '#';
}

function analyzeHolderConcentration(holders) {
  if (!holders || holders.length === 0) {
    return {
      available: false,
      top10Percentage: 0,
      isConcentrated: false,
      risk: 'unknown',
      message: 'Holder data not available'
    };
  }

  try {
    const top10Holders = holders.slice(0, 10);
    
    let top10Percentage = 0;
    top10Holders.forEach(holder => {
      const percentage = parseFloat(holder.percent || 0);
      top10Percentage += percentage;
    });

    if (top10Percentage < 1) {
      top10Percentage = top10Percentage * 100;
    }

    const isConcentrated = top10Percentage > HOLDER_CONCENTRATION_THRESHOLD;
    
    let risk, message;
    if (top10Percentage > 50) {
      risk = 'high';
      message = `DANGER: Top 10 holders control ${top10Percentage.toFixed(2)}% of supply`;
    } else if (top10Percentage > HOLDER_CONCENTRATION_THRESHOLD) {
      risk = 'medium';
      message = `WARNING: Top 10 holders control ${top10Percentage.toFixed(2)}% of supply`;
    } else {
      risk = 'low';
      message = `SAFE: Top 10 holders control only ${top10Percentage.toFixed(2)}% of supply`;
    }

    console.log(`   📊 Holder Analysis: ${message}`);

    return {
      available: true,
      top10Percentage: parseFloat(top10Percentage.toFixed(2)),
      isConcentrated: isConcentrated,
      risk: risk,
      message: message,
      top10Holders: top10Holders.map(h => ({
        address: h.address,
        balance: h.balance,
        percent: parseFloat((parseFloat(h.percent) * 100).toFixed(4)),
        tag: h.tag || 'Unknown'
      }))
    };
  } catch (error) {
    console.log(`   ⚠️  Holder analysis error: ${error.message}`);
    return {
      available: false,
      top10Percentage: 0,
      isConcentrated: false,
      risk: 'unknown',
      message: 'Unable to analyze holder concentration'
    };
  }
}

async function getTokenInfoFromExplorer(network, address) {
  if (network === 'solana' || !EXPLORER_APIS[network]) {
    return { found: false };
  }

  try {
    console.log(`🔗 Fetching verified data from ${network} explorer...`);
    
    const apiUrl = EXPLORER_APIS[network];
    const apiKey = getExplorerApiKey(network);
    
    const tokenInfoUrl = `${apiUrl}?module=token&action=tokeninfo&contractaddress=${address}&apikey=${apiKey}`;
    
    const response = await axios.get(tokenInfoUrl, {
      timeout: TIMEOUTS.EXPLORER_API,
      headers: { 'User-Agent': 'TokenScanner/1.3' }
    });

    if (response.data && response.data.status === '1' && response.data.result) {
      const result = Array.isArray(response.data.result) ? response.data.result[0] : response.data.result;
      
      console.log(`   ✅ Token: ${result.tokenName || 'Unknown'} (${result.symbol || 'Unknown'})`);
      
      return {
        found: true,
        name: result.tokenName || result.name || 'Unknown',
        symbol: result.symbol || 'Unknown',
        decimals: result.divisor || result.decimals || 18,
        totalSupply: result.totalSupply || '0',
        contractCreator: result.contractCreator || null,
        verified: true
      };
    }
  } catch (error) {
    console.log(`   ⚠️  Explorer API error: ${error.message}`);
  }
  
  return { found: false };
}

async function getContractVerificationStatus(network, address) {
  if (network === 'solana' || !EXPLORER_APIS[network]) {
    return { verified: false };
  }

  try {
    const apiUrl = EXPLORER_APIS[network];
    const apiKey = getExplorerApiKey(network);
    
    const sourceCodeUrl = `${apiUrl}?module=contract&action=getsourcecode&address=${address}&apikey=${apiKey}`;
    
    const response = await axios.get(sourceCodeUrl, {
      timeout: TIMEOUTS.EXPLORER_API,
      headers: { 'User-Agent': 'TokenScanner/1.3' }
    });

    if (response.data && response.data.status === '1' && response.data.result && response.data.result[0]) {
      const result = response.data.result[0];
      const isVerified = result.SourceCode && result.SourceCode !== '';
      
      if (isVerified) {
        console.log(`   ✅ Contract verified`);
      }
      
      return {
        verified: isVerified,
        contractName: result.ContractName || null,
        compilerVersion: result.CompilerVersion || null,
        optimization: result.OptimizationUsed === '1',
        license: result.LicenseType || 'None'
      };
    }
  } catch (error) {
    console.log(`   ⚠️  Verification check failed: ${error.message}`);
  }
  
  return { verified: false };
}

async function getTokenInfoFromDexScreener(address) {
  try {
    console.log('📊 Fetching from DexScreener...');
    const dexUrl = `https://api.dexscreener.com/latest/dex/tokens/${address}`;
    const response = await axios.get(dexUrl, {
      timeout: TIMEOUTS.DEXSCREENER_API,
      headers: { 'User-Agent': 'TokenScanner/1.3' }
    });

    if (response.data && response.data.pairs && response.data.pairs.length > 0) {
      const pairs = response.data.pairs.sort((a, b) => 
        parseFloat(b.liquidity?.usd || 0) - parseFloat(a.liquidity?.usd || 0)
      );
      const mainPair = pairs[0];
      
      return {
        name: mainPair.baseToken?.name || 'Unknown Token',
        symbol: mainPair.baseToken?.symbol || 'UNKNOWN',
        found: true
      };
    }
  } catch (error) {
    console.log('📊 DexScreener failed:', error.message);
  }
  return { name: 'Unknown Token', symbol: 'UNKNOWN', found: false };
}

async function getSolanaTokenOwnership(address) {
  try {
    console.log('🔗 Checking Solana blockchain...');
    
    const connection = new Connection(RPC_ENDPOINTS.solana, 'confirmed');
    const mintPublicKey = new PublicKey(address);
    
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Timeout')), TIMEOUTS.RPC_CALL)
    );
    
    const mintInfo = await Promise.race([
      connection.getParsedAccountInfo(mintPublicKey),
      timeoutPromise
    ]);
    
    if (mintInfo.value && mintInfo.value.data && mintInfo.value.data.parsed) {
      const mintData = mintInfo.value.data.parsed.info;
      
      return {
        found: true,
        mintAuthority: mintData.mintAuthority,
        freezeAuthority: mintData.freezeAuthority,
        isOwnershipRenounced: mintData.mintAuthority === null,
        canFreeze: mintData.freezeAuthority !== null,
        decimals: mintData.decimals,
        supply: mintData.supply
      };
    }
  } catch (error) {
    console.log('⚠️  Solana query failed:', error.message);
  }
  
  return { found: false };
}

const calculateRiskScore = (securityData, verificationData, holderAnalysis) => {
  let score = 100;
  let risks = [];

  if (securityData.is_honeypot === '1') {
    score -= 40;
    risks.push('CRITICAL: Honeypot detected');
  }

  if (securityData.is_mintable === '1') {
    score -= 15;
    risks.push('HIGH: Mint function active');
  }

  if (securityData.owner_address && 
      securityData.owner_address !== '0x0000000000000000000000000000000000000000' &&
      securityData.owner_address !== null) {
    score -= 10;
    risks.push('MEDIUM: Ownership not renounced');
  }

  if (securityData.can_take_back_ownership === '1') {
    score -= 15;
    risks.push('HIGH: Owner can reclaim ownership');
  }

  if (securityData.is_blacklisted === '1') {
    score -= 20;
    risks.push('HIGH: Blacklist enabled');
  }

  const buyTax = parseFloat(securityData.buy_tax) || 0;
  const sellTax = parseFloat(securityData.sell_tax) || 0;

  if (buyTax > 0.1 || sellTax > 0.1) {
    score -= 10;
    risks.push(`MEDIUM: High tax - Buy: ${(buyTax * 100).toFixed(1)}%, Sell: ${(sellTax * 100).toFixed(1)}%`);
  }

  if (securityData.is_proxy === '1') {
    score -= 10;
    risks.push('MEDIUM: Proxy contract');
  }

  if (holderAnalysis && holderAnalysis.available) {
    if (holderAnalysis.risk === 'high') {
      score -= 25;
      risks.push(`HIGH: ${holderAnalysis.message}`);
    } else if (holderAnalysis.risk === 'medium') {
      score -= 15;
      risks.push(`MEDIUM: ${holderAnalysis.message}`);
    }
  }

  if (verificationData && verificationData.verified) {
    score += 5;
    score = Math.min(100, score);
  } else if (verificationData && !verificationData.verified) {
    score -= 5;
    risks.push('LOW: Contract not verified');
  }

  if (securityData.holder_count && parseInt(securityData.holder_count) < 100) {
    score -= 5;
    risks.push('LOW: Low holder count');
  }

  if (securityData.lp_total_supply) {
    const lpSupply = parseFloat(securityData.lp_total_supply);
    if (lpSupply < 1) {
      score -= 15;
      risks.push('HIGH: Very low liquidity');
    }
  }

  return {
    score: Math.max(0, score),
    level: score >= 80 ? 'safe' : score >= 50 ? 'warning' : 'danger',
    risks: risks
  };
};

// Main API endpoint
app.get('/api/check-token/:network/:address', rateLimit, async (req, res) => {
  try {
    const { network, address } = req.params;

    if (!RPC_ENDPOINTS[network]) {
      return res.status(400).json({ error: 'Unsupported network' });
    }

    const chainId = CHAIN_IDS[network];
    
    let isValid = false;
    if (network === 'solana') {
      isValid = isValidSolanaAddress(address);
    } else {
      isValid = isValidAddress(address);
    }

    if (!isValid) {
      return res.status(400).json({ 
        error: `Invalid ${network} token address format` 
      });
    }

    let tokenInfo = {
      name: 'Unknown',
      symbol: 'Unknown',
      decimals: network === 'solana' ? 9 : 18,
      totalSupply: '0',
      ownerAddress: null,
      verified: false
    };

    let verificationData = null;

    console.log(`🔍 [${network.toUpperCase()}] ${address.substring(0, 8)}...`);

    if (network !== 'solana') {
      const explorerData = await getTokenInfoFromExplorer(network, address);
      
      if (explorerData.found) {
        tokenInfo.name = explorerData.name;
        tokenInfo.symbol = explorerData.symbol;
        tokenInfo.decimals = Number(explorerData.decimals);
        tokenInfo.totalSupply = explorerData.totalSupply;
        tokenInfo.verified = explorerData.verified;
      }

      verificationData = await getContractVerificationStatus(network, address);
      tokenInfo.verified = verificationData.verified;
    }

    let goplusUrl;
    let addressKey;

    if (network === 'solana') {
      goplusUrl = `https://api.gopluslabs.io/api/v1/token_security/solana?contract_addresses=${address}`;
      addressKey = address;
    } else {
      goplusUrl = `https://api.gopluslabs.io/api/v1/token_security/${chainId}?contract_addresses=${address.toLowerCase()}`;
      addressKey = address.toLowerCase();
    }

    let securityData = null;

    try {
      const goplusResponse = await axios.get(goplusUrl, {
        timeout: TIMEOUTS.GOPLUS_API,
        headers: { 
          'User-Agent': 'TokenScanner/1.3',
          'Accept': 'application/json'
        }
      });

      if (goplusResponse.data && goplusResponse.data.result) {
        securityData = goplusResponse.data.result[addressKey];
        
        if (securityData) {
          if (tokenInfo.name === 'Unknown' && securityData.token_name) {
            tokenInfo.name = securityData.token_name;
          }
          if (tokenInfo.symbol === 'Unknown' && securityData.token_symbol) {
            tokenInfo.symbol = securityData.token_symbol;
          }
        }
      }
    } catch (error) {
      console.error('GoPlus error:', error.message);
    }

    if (!securityData && network === 'solana') {
      const dexInfo = await getTokenInfoFromDexScreener(address);
      
      if (dexInfo.found) {
        tokenInfo.name = dexInfo.name;
        tokenInfo.symbol = dexInfo.symbol;
      }
      
      const solanaOwnership = await getSolanaTokenOwnership(address);
      
      let ownerAddress = null;
      let isMintable = '0';
      let canFreeze = '0';
      
      if (solanaOwnership.found) {
        ownerAddress = solanaOwnership.mintAuthority;
        isMintable = solanaOwnership.mintAuthority !== null ? '1' : '0';
        canFreeze = solanaOwnership.canFreeze ? '1' : '0';
        
        if (solanaOwnership.supply) {
          tokenInfo.totalSupply = solanaOwnership.supply;
        }
        if (solanaOwnership.decimals !== undefined) {
          tokenInfo.decimals = solanaOwnership.decimals;
        }
      }
      
      securityData = {
        token_name: tokenInfo.name,
        token_symbol: tokenInfo.symbol,
        is_honeypot: '0',
        is_mintable: isMintable,
        owner_address: ownerAddress,
        is_blacklisted: canFreeze,
        is_whitelisted: '0',
        is_proxy: '0',
        buy_tax: '0',
        sell_tax: '0',
        slippage_modifiable: '0',
        can_take_back_ownership: '0',
        trading_cooldown: '0',
        can_burn: '0',
        holder_count: 'N/A',
        lp_total_supply: 'N/A',
        lp_holder_count: 'N/A',
        holders: []
      };
    }

    if (!securityData) {
      return res.status(404).json({ 
        error: 'Unable to fetch security data'
      });
    }

    const holderAnalysis = analyzeHolderConcentration(securityData.holders || []);
    const riskAssessment = calculateRiskScore(securityData, verificationData, holderAnalysis);

    const response = {
      address: address,
      network: network,
      chainId: chainId,
      tokenInfo: tokenInfo,
      security: {
        isHoneypot: securityData.is_honeypot === '1',
        canSell: securityData.is_honeypot !== '1',
        tradingCooldown: securityData.trading_cooldown === '1',
        buyTax: securityData.buy_tax ? (parseFloat(securityData.buy_tax) * 100).toFixed(2) + '%' : '0%',
        sellTax: securityData.sell_tax ? (parseFloat(securityData.sell_tax) * 100).toFixed(2) + '%' : '0%',
        canModifyTax: securityData.slippage_modifiable === '1',
        ownerAddress: securityData.owner_address || tokenInfo.ownerAddress,
        isOwnershipRenounced: securityData.owner_address === '0x0000000000000000000000000000000000000000' || securityData.owner_address === null,
        canTakeBackOwnership: securityData.can_take_back_ownership === '1',
        isMintable: securityData.is_mintable === '1',
        canBurn: securityData.can_burn === '1',
        totalSupply: tokenInfo.totalSupply,
        hasBlacklist: securityData.is_blacklisted === '1',
        canBlacklist: securityData.is_blacklisted === '1',
        hasWhitelist: securityData.is_whitelisted === '1',
        isProxy: securityData.is_proxy === '1',
        isUpgradeable: securityData.is_proxy === '1',
        liquidityTotal: securityData.lp_total_supply || '0',
        lpHolderCount: securityData.lp_holder_count || '0',
        holderCount: securityData.holder_count || '0',
        topHolders: securityData.holders || []
      },
      holderConcentration: holderAnalysis,
      verification: verificationData || { verified: false },
      riskAssessment: riskAssessment,
      timestamp: new Date().toISOString(),
      explorerUrl: getExplorerUrl(network, address)
    };

    console.log(`✅ Risk: ${riskAssessment.level.toUpperCase()} (${riskAssessment.score}/100)`);
    res.json(response);

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: error.message
    });
  }
});

app.get('/api/token-info/:address', rateLimit, async (req, res) => {
  try {
    const { address } = req.params;

    const isEVM = isValidAddress(address);
    const isSolana = isValidSolanaAddress(address);

    if (!isEVM && !isSolana) {
      return res.status(400).json({ error: 'Invalid token address' });
    }

    const dexUrl = `https://api.dexscreener.com/latest/dex/tokens/${address}`;
    
    const response = await axios.get(dexUrl, {
      timeout: TIMEOUTS.DEXSCREENER_API,
      headers: { 'User-Agent': 'TokenScanner/1.3' }
    });

    if (!response.data || !response.data.pairs || response.data.pairs.length === 0) {
      return res.status(404).json({ 
        error: 'No trading pairs found' 
      });
    }

    const pairs = response.data.pairs.sort((a, b) => 
      parseFloat(b.liquidity?.usd || 0) - parseFloat(a.liquidity?.usd || 0)
    );

    const mainPair = pairs[0];

    const marketData = {
      pairs: pairs.slice(0, 5).map(pair => ({
        chainId: pair.chainId,
        dexId: pair.dexId,
        pairAddress: pair.pairAddress,
        baseToken: pair.baseToken,
        quoteToken: pair.quoteToken,
        priceUsd: pair.priceUsd,
        liquidity: pair.liquidity,
        volume: pair.volume,
        priceChange: pair.priceChange,
        url: pair.url
      })),
      mainPair: {
        symbol: mainPair.baseToken?.symbol,
        priceUsd: mainPair.priceUsd,
        liquidity: mainPair.liquidity?.usd,
        volume24h: mainPair.volume?.h24,
        priceChange24h: mainPair.priceChange?.h24,
        pairUrl: mainPair.url
      }
    };

    res.json(marketData);

  } catch (error) {
    res.status(500).json({ 
      error: 'Failed to fetch market data',
      message: error.message 
    });
  }
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    version: '1.3.0',
    networks: Object.keys(RPC_ENDPOINTS)
  });
});

app.listen(PORT, () => {
  console.log('');
  console.log('🚀 ═══════════════════════════════════════════════════');
  console.log('   Token Safety Scanner - Backend Server v1.3');
  console.log('   🆕 Top 10 Holder Analysis (EVM Chains)');
  console.log('   ═══════════════════════════════════════════════════');
  console.log('');
  console.log(`   📡 Server:     http://localhost:${PORT}`);
  console.log(`   ❤️  Health:     http://localhost:${PORT}/health`);
  console.log('');
  console.log('   🌐 Supported Networks:');
  console.log('      • Ethereum - Etherscan Verified ✓');
  console.log('      • BSC - BscScan Verified ✓');
  console.log('      • Polygon - PolygonScan Verified ✓');
  console.log('      • Solana - Blockchain Direct ✓');
  console.log('');
  console.log('   ✨ Features v1.3:');
  console.log('      📊 Top 10 Holder Concentration Analysis');
  console.log(`      ⚠️  Threshold: ${HOLDER_CONCENTRATION_THRESHOLD}% concentration`);
  console.log('      • >50% = HIGH RISK (Danger)');
  console.log('      • >15% = MEDIUM RISK (Warning)');
  console.log('      • <15% = LOW RISK (Safe)');
  console.log('');
  console.log('   ⚡ Ready to scan tokens!');
  console.log('═══════════════════════════════════════════════════');
  console.log('');
});

module.exports = app;

