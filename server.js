/**
 * Token Rug-Check & Safety Scanner - Backend Server v1.3
 * Node.js + Express + Ethers.js + Solana Web3.js
 * Free APIs: GoPlus, DexScreener, Blockchain Explorers (Etherscan API V2)
 * Supports: Ethereum, BSC, Polygon, Solana
 * Features: Top 10 Holders Concentration Analysis (EVM chains only)
 */

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { ethers } = require('ethers');
const { Connection, PublicKey } = require('@solana/web3.js');
require('dotenv').config();

// Fix for BigInt JSON serialization error
BigInt.prototype.toJSON = function() {
  return this.toString();
};

const app = express();
const PORT = process.env.PORT || 3000;

// Suppress Ethers.js network detection warnings
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
app.use(express.static('public'));

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

// Blockchain Explorer API Endpoints (Etherscan API V2 - Unified)
const EXPLORER_APIS = {
  ethereum: 'https://api.etherscan.io/api',
  bsc: 'https://api.bscscan.com/api',
  polygon: 'https://api.polygonscan.com/api'
};

// Get unified API key (Etherscan API V2 works across 50+ EVM chains)
const getExplorerApiKey = (network) => {
  return process.env[`${network.toUpperCase()}_API_KEY`] || 
         process.env.ETHERSCAN_API_KEY || 
         'YourApiKeyToken';
};

// Chain ID mapping
const CHAIN_IDS = {
  ethereum: '1',
  bsc: '56',
  polygon: '137',
  solana: 'solana'
};

// Timeouts configuration
const TIMEOUTS = {
  RPC_CALL: 8000,
  GOPLUS_API: 15000,
  DEXSCREENER_API: 10000,
  EXPLORER_API: 10000
};

// Holder concentration thresholds
const HOLDER_CONCENTRATION_THRESHOLD = 15; // 15% for top 10 holders

// Helper function to get provider
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

// Helper function to validate Ethereum address
const isValidAddress = (address) => {
  try {
    return ethers.isAddress(address);
  } catch {
    return false;
  }
};

// Helper function to validate Solana address
const isValidSolanaAddress = (address) => {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
};

// Helper function to get block explorer URL
function getExplorerUrl(network, address) {
  const explorers = {
    ethereum: `https://etherscan.io/token/${address}`,
    bsc: `https://bscscan.com/token/${address}`,
    polygon: `https://polygonscan.com/token/${address}`,
    solana: `https://solscan.io/token/${address}`
  };
  return explorers[network] || '#';
}

/**
 * Analyze holder concentration (Top 10 holders)
 */
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

    // Convert to percentage (if it's in decimal form)
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

/**
 * Get token info from Blockchain Explorer API
 */
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
      console.log(`   ✅ Total Supply: ${result.totalSupply || 'N/A'}`);
      console.log(`   ✅ Decimals: ${result.decimals || 'N/A'}`);
      
      return {
        found: true,
        name: result.tokenName || result.name || 'Unknown',
        symbol: result.symbol || 'Unknown',
        decimals: result.divisor || result.decimals || 18,
        totalSupply: result.totalSupply || '0',
        contractCreator: result.contractCreator || null,
        verified: true
      };
    } else if (response.data && response.data.message) {
      console.log(`   ⚠️  Explorer API: ${response.data.message}`);
    }
  } catch (error) {
    console.log(`   ⚠️  Explorer API error: ${error.message}`);
  }
  
  return { found: false };
}

/**
 * Get contract source code verification status
 */
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
        console.log(`   ✅ Contract verified on ${network} explorer`);
      } else {
        console.log(`   ⚠️  Contract NOT verified`);
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

/**
 * Get token info from DexScreener
 */
async function getTokenInfoFromDexScreener(address) {
  try {
    console.log('📊 Fetching token info from DexScreener...');
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
    console.log('📊 DexScreener lookup failed:', error.message);
  }
  return { name: 'Unknown Token', symbol: 'UNKNOWN', found: false };
}

/**
 * Get Solana token ownership info
 */
async function getSolanaTokenOwnership(address) {
  try {
    console.log('🔗 Checking Solana blockchain for ownership data...');
    
    const connection = new Connection(RPC_ENDPOINTS.solana, 'confirmed');
    const mintPublicKey = new PublicKey(address);
    
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Solana RPC timeout')), TIMEOUTS.RPC_CALL)
    );
    
    const mintInfo = await Promise.race([
      connection.getParsedAccountInfo(mintPublicKey),
      timeoutPromise
    ]);
    
    if (mintInfo.value && mintInfo.value.data && mintInfo.value.data.parsed) {
      const mintData = mintInfo.value.data.parsed.info;
      
      const mintAuthority = mintData.mintAuthority;
      const freezeAuthority = mintData.freezeAuthority;
      
      const isOwnershipRenounced = mintAuthority === null;
      const canFreeze = freezeAuthority !== null;
      
      console.log(`   ├─ Mint Authority: ${mintAuthority || '✓ RENOUNCED'}`);
      console.log(`   └─ Freeze Authority: ${freezeAuthority || '✓ DISABLED'}`);
      
      return {
        found: true,
        mintAuthority: mintAuthority,
        freezeAuthority: freezeAuthority,
        isOwnershipRenounced: isOwnershipRenounced,
        canFreeze: canFreeze,
        decimals: mintData.decimals,
        supply: mintData.supply
      };
    }
  } catch (error) {
    console.log('⚠️  Solana blockchain query failed:', error.message);
  }
  
  return { found: false };
}

/**
 * Calculate risk score with holder concentration analysis
 */
const calculateRiskScore = (securityData, verificationData, holderAnalysis) => {
  let score = 100;
  let risks = [];

  if (securityData.is_honeypot === '1') {
    score -= 40;
    risks.push('CRITICAL: Honeypot detected - Cannot sell tokens');
  }

  if (securityData.is_mintable === '1') {
    score -= 15;
    risks.push('HIGH: Mint function active - Supply can be increased');
  }

  if (securityData.owner_address && 
      securityData.owner_address !== '0x0000000000000000000000000000000000000000' &&
      securityData.owner_address !== null) {
    score -= 10;
    
    if (securityData.owner_address === 'SOLANA_OWNER_UNKNOWN') {
      risks.push('MEDIUM: Ownership status unknown (limited data)');
    } else {
      risks.push('MEDIUM: Ownership not renounced');
    }
  }

  if (securityData.can_take_back_ownership === '1') {
    score -= 15;
    risks.push('HIGH: Owner can reclaim ownership');
  }

  if (securityData.is_blacklisted === '1') {
    score -= 20;
    risks.push('HIGH: Blacklist function enabled');
  }

  const buyTax = parseFloat(securityData.buy_tax) || 0;
  const sellTax = parseFloat(securityData.sell_tax) || 0;

  if (buyTax > 0.1 || sellTax > 0.1) {
    score -= 10;
    risks.push(`MEDIUM: High tax - Buy: ${(buyTax * 100).toFixed(1)}%, Sell: ${(sellTax * 100).toFixed(1)}%`);
  }

  if (securityData.is_proxy === '1') {
    score -= 10;
    risks.push('MEDIUM: Proxy contract - Code can be changed');
  }

  // Holder concentration analysis
  if (holderAnalysis && holderAnalysis.available) {
    if (holderAnalysis.risk === 'high') {
      score -= 25;
      risks.push(`HIGH: ${holderAnalysis.message}`);
    } else if (holderAnalysis.risk === 'medium') {
      score -= 15;
      risks.push(`MEDIUM: ${holderAnalysis.message}`);
    }
  }

  // Contract verification bonus
  if (verificationData && verificationData.verified) {
    score += 5;
    score = Math.min(100, score);
  } else if (verificationData && !verificationData.verified) {
    score -= 5;
    risks.push('LOW: Contract source code not verified');
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

/**
 * Main Token Security Check Endpoint
 */
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

    console.log(`🔍 [${network.toUpperCase()}] Scanning: ${address.substring(0, 8)}...${address.substring(address.length - 6)}`);

    // For EVM chains, get verified data from blockchain explorer
    if (network !== 'solana') {
      const explorerData = await getTokenInfoFromExplorer(network, address);
      
      if (explorerData.found) {
        tokenInfo.name = explorerData.name;
        tokenInfo.symbol = explorerData.symbol;
        tokenInfo.decimals = Number(explorerData.decimals);
        tokenInfo.totalSupply = explorerData.totalSupply;
        tokenInfo.verified = explorerData.verified;
        console.log('✅ Using verified explorer data');
      }

      verificationData = await getContractVerificationStatus(network, address);
      tokenInfo.verified = verificationData.verified;
    }

    // Get security data from GoPlus API
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
    let goplusError = null;

    try {
      const goplusResponse = await axios.get(goplusUrl, {
        timeout: TIMEOUTS.GOPLUS_API,
        headers: { 
          'User-Agent': 'TokenScanner/1.3',
          'Accept': 'application/json'
        },
        validateStatus: (status) => status < 500
      });

      if (goplusResponse.status === 200 && goplusResponse.data && goplusResponse.data.result) {
        securityData = goplusResponse.data.result[addressKey];
        
        if (securityData) {
          console.log('✅ GoPlus security data received');
          
          if (tokenInfo.name === 'Unknown' && securityData.token_name) {
            tokenInfo.name = securityData.token_name;
          }
          if (tokenInfo.symbol === 'Unknown' && securityData.token_symbol) {
            tokenInfo.symbol = securityData.token_symbol;
          }
        } else {
          goplusError = 'Token not found in GoPlus database';
          console.log('⚠️  Token not indexed by GoPlus');
        }
      } else {
        goplusError = `GoPlus API returned status ${goplusResponse.status}`;
      }
    } catch (error) {
      goplusError = error.message;
      console.error('❌ GoPlus API Error:', error.message);
    }

    // Fallback for Solana if GoPlus doesn't have data
    if (!securityData && network === 'solana') {
      console.log('⚠️  GoPlus has no data for this Solana token');
      console.log('🔍 Querying Solana blockchain and DexScreener...');
      
      const dexInfo = await getTokenInfoFromDexScreener(address);
      
      if (dexInfo.found) {
        console.log(`✅ Token info from DexScreener: ${dexInfo.name} (${dexInfo.symbol})`);
        tokenInfo.name = dexInfo.name;
        tokenInfo.symbol = dexInfo.symbol;
      } else {
        console.log('⚠️  Token not found on DexScreener');
        tokenInfo.name = 'Unknown Solana Token';
        tokenInfo.symbol = 'UNKNOWN';
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
        
        console.log('✅ Using real Solana blockchain data');
      } else {
        ownerAddress = 'SOLANA_OWNER_UNKNOWN';
        console.log('⚠️  Could not fetch ownership from blockchain');
      }
      
      // Solana holder data not available via free APIs
      console.log('ℹ️  Top 10 holder analysis not available for Solana (no free API)');
      
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
        holders: [] // Not available for Solana via free APIs
      };
      
      if (solanaOwnership.found) {
        console.log('✅ Solana scan complete with blockchain verification');
      } else {
        console.log('ℹ️  Partial Solana scan (some data unavailable)');
      }
    }

    if (!securityData && network !== 'solana') {
      return res.status(404).json({ 
        error: 'Unable to fetch security data',
        details: goplusError || 'Token may not be supported or is too new',
        suggestion: 'Ensure the token has trading activity on DEXs',
        explorerData: tokenInfo.name !== 'Unknown' ? tokenInfo : null
      });
    }

    // Analyze holder concentration
    const holderAnalysis = analyzeHolderConcentration(securityData.holders || []);

    // Calculate risk assessment with holder analysis
    const riskAssessment = calculateRiskScore(securityData, verificationData, holderAnalysis);

    // Build comprehensive response
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
      explorerUrl: getExplorerUrl(network, address),
      dataSource: {
        primary: network === 'solana' ? 'blockchain' : tokenInfo.verified ? 'explorer' : 'goplus',
        security: 'goplus',
        verification: network !== 'solana' ? 'explorer' : 'blockchain',
        holders: network === 'solana' ? 'not available (no free API)' : 'goplus'
      }
    };

    console.log(`✅ Scan complete - Risk: ${riskAssessment.level.toUpperCase()} (${riskAssessment.score}/100)`);
    res.json(response);

  } catch (error) {
    console.error('💥 Server error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: error.message,
      details: 'Please try again or check if the token address is correct'
    });
  }
});

/**
 * Token Market Data from DexScreener
 */
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
        error: 'No trading pairs found for this token' 
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
        priceNative: pair.priceNative,
        liquidity: pair.liquidity,
        fdv: pair.fdv,
        volume: {
          h24: pair.volume?.h24,
          h6: pair.volume?.h6,
          h1: pair.volume?.h1
        },
        priceChange: {
          h24: pair.priceChange?.h24,
          h6: pair.priceChange?.h6,
          h1: pair.priceChange?.h1
        },
        txns: pair.txns,
        url: pair.url
      })),
      mainPair: {
        symbol: mainPair.baseToken?.symbol,
        priceUsd: mainPair.priceUsd,
        liquidity: mainPair.liquidity?.usd,
        volume24h: mainPair.volume?.h24,
        priceChange24h: mainPair.priceChange?.h24,
        fdv: mainPair.fdv,
        pairUrl: mainPair.url
      }
    };

    res.json(marketData);

  } catch (error) {
    console.error('DexScreener error:', error.message);
    res.status(500).json({ 
      error: 'Failed to fetch market data',
      message: error.message 
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    version: '1.3.0',
    networks: Object.keys(RPC_ENDPOINTS),
    apis: {
      etherscan: 'Etherscan API V2 (Unified - 50+ EVM chains)',
      goplus: 'GoPlus Security API',
      solana: 'Solana Blockchain Direct',
      dexscreener: 'DexScreener API'
    },
    features: [
      'Multi-chain token scanning (4 networks)',
      'Verified data from blockchain explorers',
      'Contract source code verification check',
      'GoPlus security analysis',
      'Solana blockchain verification',
      'DexScreener market data',
      'Etherscan API V2 unified key support',
      'Top 10 Holder Concentration Analysis (ETH/BSC/Polygon only)'
    ],
    holderAnalysis: {
      threshold: `${HOLDER_CONCENTRATION_THRESHOLD}%`,
      description: 'Warns if top 10 holders control more than 15% of supply',
      sources: {
        ethereum: 'GoPlus API',
        bsc: 'GoPlus API',
        polygon: 'GoPlus API',
        solana: 'Not available (no free API)'
      }
    },
    timeouts: TIMEOUTS
  });
});

// Start server
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
  console.log('   🔌 Data Sources:');
  console.log('      1. Blockchain Explorer APIs (Verified)');
  console.log('      2. Solana Web3.js (Direct Blockchain)');
  console.log('      3. GoPlus Security API');
  console.log('      4. DexScreener API');
  console.log('');
  console.log('   ✨ Features v1.3:');
  console.log('      📊 Top 10 Holder Concentration Analysis');
  console.log(`      ⚠️  Threshold: ${HOLDER_CONCENTRATION_THRESHOLD}% concentration`);
  console.log('      • >50% = HIGH RISK (Danger)');
  console.log('      • >15% = MEDIUM RISK (Warning)');
  console.log('      • <15% = LOW RISK (Safe)');
  console.log('');
  console.log('   📝 Note:');
  console.log('      Holder analysis available for: ETH, BSC, Polygon');
  console.log('      Solana: Holder data requires paid APIs');
  console.log('');
  console.log('   💡 Optional API Keys (.env):');
  console.log('      ETHERSCAN_API_KEY=your_key_here');
  console.log('');
  console.log('   ⚡ Ready to scan tokens!');
  console.log('═══════════════════════════════════════════════════');
  console.log('');
});

module.exports = app;
