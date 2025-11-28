/**
 * Altcoin Scanner - Finds the best trading opportunities among hundreds of altcoins
 */

// Simple in-memory cache to prevent API rate limiting
let CACHED_COINS = [];
let LAST_FETCH = 0;
const CACHE_DURATION = 60000; // 1 minute cache

// Fallback list if API fails (Top 20 + some popular ones)
const FALLBACK_LIST = [
  { symbol: "BTC", name: "Bitcoin", coinGeckoId: "bitcoin", category: "Layer 1", marketCap: 1000000000000 },
  { symbol: "ETH", name: "Ethereum", coinGeckoId: "ethereum", category: "Layer 1", marketCap: 300000000000 },
  { symbol: "SOL", name: "Solana", coinGeckoId: "solana", category: "Layer 1", marketCap: 70000000000 },
  { symbol: "BNB", name: "BNB", coinGeckoId: "binancecoin", category: "Layer 1", marketCap: 80000000000 },
  { symbol: "XRP", name: "XRP", coinGeckoId: "ripple", category: "Layer 1", marketCap: 30000000000 },
  { symbol: "ADA", name: "Cardano", coinGeckoId: "cardano", category: "Layer 1", marketCap: 15000000000 },
  { symbol: "DOGE", name: "Dogecoin", coinGeckoId: "dogecoin", category: "Meme", marketCap: 20000000000 },
  { symbol: "AVAX", name: "Avalanche", coinGeckoId: "avalanche-2", category: "Layer 1", marketCap: 12000000000 },
  { symbol: "DOT", name: "Polkadot", coinGeckoId: "polkadot", category: "Layer 1", marketCap: 10000000000 },
  { symbol: "LINK", name: "Chainlink", coinGeckoId: "chainlink", category: "Infrastructure", marketCap: 10000000000 },
  { symbol: "MATIC", name: "Polygon", coinGeckoId: "matic-network", category: "Layer 2", marketCap: 8000000000 },
  { symbol: "UNI", name: "Uniswap", coinGeckoId: "uniswap", category: "DeFi", marketCap: 6000000000 },
  { symbol: "ATOM", name: "Cosmos", coinGeckoId: "cosmos", category: "Layer 1", marketCap: 4000000000 },
  { symbol: "LTC", name: "Litecoin", coinGeckoId: "litecoin", category: "Layer 1", marketCap: 6000000000 },
  { symbol: "NEAR", name: "NEAR Protocol", coinGeckoId: "near", category: "Layer 1", marketCap: 5000000000 },
  { symbol: "PEPE", name: "Pepe", coinGeckoId: "pepe", category: "Meme", marketCap: 3000000000 },
  { symbol: "APT", name: "Aptos", coinGeckoId: "aptos", category: "Layer 1", marketCap: 3000000000 },
  { symbol: "ARB", name: "Arbitrum", coinGeckoId: "arbitrum", category: "Layer 2", marketCap: 2000000000 },
  { symbol: "RNDR", name: "Render", coinGeckoId: "render-token", category: "AI", marketCap: 3000000000 },
  { symbol: "INJ", name: "Injective", coinGeckoId: "injective-protocol", category: "DeFi", marketCap: 2500000000 }
];

// Keep for backward compatibility with existing imports, but it will be populated dynamically
export let ALTCOIN_LIST = [...FALLBACK_LIST];

/**
 * Helper to categorize coins based on tags or symbol
 */
const categorizeCoin = (coin) => {
  const symbol = coin.symbol.toUpperCase();
  const name = coin.name.toLowerCase();
  
  if (['BTC', 'ETH', 'SOL', 'ADA', 'AVAX', 'DOT', 'ATOM', 'NEAR', 'FTM', 'SUI', 'SEI', 'ALGO'].includes(symbol)) return 'Layer 1';
  if (['MATIC', 'ARB', 'OP', 'IMX', 'MNT', 'STRK'].includes(symbol)) return 'Layer 2';
  if (['UNI', 'AAVE', 'MKR', 'SNX', 'CRV', 'COMP', 'LDO', 'RPL', 'PENDLE', 'JUP'].includes(symbol)) return 'DeFi';
  if (['DOGE', 'SHIB', 'PEPE', 'BONK', 'FLOKI', 'WIF', 'MEME'].includes(symbol)) return 'Meme';
  if (['FET', 'RNDR', 'GRT', 'OCEAN', 'WLD', 'AGIX'].includes(symbol)) return 'AI';
  if (['SAND', 'MANA', 'AXS', 'GALA', 'ILV', 'BEAM', 'PRIME'].includes(symbol)) return 'Gaming';
  if (['LINK', 'FIL', 'AR', 'VET', 'PYTH', 'TIA'].includes(symbol)) return 'Infrastructure';
  if (['USDT', 'USDC', 'DAI', 'FDUSD'].includes(symbol)) return 'Stablecoin';
  
  if (name.includes('inu') || name.includes('dog') || name.includes('cat')) return 'Meme';
  if (name.includes('swap') || name.includes('finance') || name.includes('dao')) return 'DeFi';
  
  return 'Altcoin'; // Default
};

/**
 * Scans top 250 altcoins and returns the best opportunities
 * Uses live CoinGecko API data
 */
export const scanAltcoins = async (count = 10) => {
  const TOP_COUNT = 250;
  console.log(`🔍 Scanning top ${TOP_COUNT} assets from CoinGecko...`);
  
  let marketData = [];
  
  try {
    // Check cache first
    if (CACHED_COINS.length > 0 && Date.now() - LAST_FETCH < CACHE_DURATION) {
      console.log('⚡ Using cached coin data');
      marketData = CACHED_COINS;
    } else {
      // Fetch live data
      const response = await fetch(
        `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${TOP_COUNT}&page=1&sparkline=false`
      );
      
      if (response.ok) {
        const data = await response.json();
        // Filter out stablecoins
        marketData = data.filter(coin => {
          const sym = coin.symbol.toUpperCase();
          return !['USDT', 'USDC', 'DAI', 'FDUSD', 'TUSD', 'USDD', 'USDP'].includes(sym);
        });
        
        // Update cache and exported list
        CACHED_COINS = marketData;
        LAST_FETCH = Date.now();
        
        // Update ALTCOIN_LIST for compatibility with other functions
        ALTCOIN_LIST = marketData.map(coin => ({
          symbol: coin.symbol.toUpperCase(),
          name: coin.name,
          coinGeckoId: coin.id,
          category: categorizeCoin(coin),
          marketCap: coin.market_cap
        }));
        
        console.log(`✅ Successfully fetched ${marketData.length} assets`);
      } else {
        throw new Error(`API returned ${response.status}`);
      }
    }
  } catch (error) {
    console.warn('⚠️ Live scan failed, using fallback data:', error.message);
    // Use fallback data with simulated price changes
    marketData = FALLBACK_LIST.map(coin => ({
      id: coin.coinGeckoId,
      symbol: coin.symbol.toLowerCase(),
      name: coin.name,
      current_price: coin.marketCap / 100000000, // Rough simulation
      price_change_percentage_24h: (Math.random() * 10) - 4,
      total_volume: coin.marketCap * 0.05,
      market_cap: coin.marketCap
    }));
  }
  
  const opportunities = [];
  
  // Process each coin
  for (const coin of marketData) {
    // Skip if missing crucial data
    if (coin.price_change_percentage_24h === null || coin.price_change_percentage_24h === undefined) continue;
    
    // Extract metrics
    const change = coin.price_change_percentage_24h;
    const volatility = Math.abs(change);
    const volume = coin.total_volume || 0;
    const mcap = coin.market_cap || 0;
    const category = categorizeCoin(coin);
    
    // Calculate Score (0-100)
    let score = 50;
    
    // 1. Momentum Scoring
    if (change > 10) score += 25;      // Strong pump
    else if (change > 5) score += 15;  // Strong uptrend
    else if (change > 2) score += 10;  // Uptrend
    else if (change > 0) score += 5;   // Slight uptrend
    else if (change < -10) score -= 25; // Strong dump
    else if (change < -5) score -= 15;  // Strong downtrend
    else if (change < -2) score -= 10;  // Downtrend
    
    // 2. Volume Factor (Relative to market cap is better, but raw volume works for major coins)
    if (volume > 1000000000) score += 10;
    else if (volume > 100000000) score += 5;
    else if (volume < 1000000) score -= 10;
    
    // 3. Stability Bonus
    if (mcap > 10000000000) score += 5;
    
    // 4. Category Trends (Simulated preference)
    if (category === 'AI' || category === 'Meme' || category === 'Layer 2') score += 5;
    
    // 5. Volatility Penalty (unless high risk allowed)
    if (volatility > 15) score -= 5;
    
    // Add some randomness to simulate market noise/changing conditions
    score += (Math.random() * 10) - 5;
    
    // Clamp score
    score = Math.max(20, Math.min(95, Math.round(score)));
    
    // Only include interesting opportunities
    if (score > 60 || score < 40) {
      opportunities.push({
        symbol: coin.symbol.toUpperCase(),
        name: coin.name,
        coinGeckoId: coin.id,
        category: category,
        marketCap: mcap,
        score,
        momentum: parseFloat(change.toFixed(2)),
        volatility: parseFloat(volatility.toFixed(1)),
        volume_surge: volume > 500000000 ? 2.0 : 1.0, // Simplified
        signal: score >= 75 ? 'strong_buy' : score >= 65 ? 'buy' : score >= 55 ? 'hold' : score >= 45 ? 'sell' : 'strong_sell',
        simulated_price: coin.current_price,
        confidence: Math.round(score * 0.95),
      });
    }
  }
  
  // Sort by score (highest first) and return top N
  const topOpportunities = opportunities
    .sort((a, b) => b.score - a.score)
    .slice(0, count);
  
  console.log(`✅ Found ${topOpportunities.length} top opportunities from ${marketData.length} scanned`);
  return topOpportunities;
};

/**
 * Generate realistic price based on market cap
 */
const generatePrice = (altcoin) => {
  const basePrice = altcoin.marketCap / 1000000000; // $1 per billion market cap
  return basePrice * (0.8 + Math.random() * 0.4); // ±20% variation
};

/**
 * Get detailed analysis for a specific altcoin
 */
export const getAltcoinAnalysis = (altcoin) => {
  const analysis = {
    technicals: {
      rsi: 30 + Math.random() * 40, // 30-70 range
      macd: (Math.random() - 0.5) * 2,
      trend: Math.random() > 0.5 ? 'bullish' : 'bearish',
    },
    fundamentals: {
      category_growth: altcoin.category === 'AI' || altcoin.category === 'Gaming' ? 'high' : 'moderate',
      market_position: altcoin.marketCap > 1000000000 ? 'established' : 'emerging',
    },
    sentiment: {
      social_buzz: Math.random() > 0.6 ? 'high' : Math.random() > 0.3 ? 'moderate' : 'low',
      news_impact: Math.random() > 0.7 ? 'positive' : Math.random() > 0.4 ? 'neutral' : 'negative',
    },
    risk_level: altcoin.volatility > 12 ? 'high' : altcoin.volatility > 8 ? 'medium' : 'low',
  };
  
  return analysis;
};

/**
 * Filter altcoins by category
 */
export const getAltcoinsByCategory = (category) => {
  return ALTCOIN_LIST.filter(coin => coin.category === category);
};

/**
 * Get all unique categories
 */
export const getCategories = () => {
  return [...new Set(ALTCOIN_LIST.map(coin => coin.category))];
};