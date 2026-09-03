/**
 * Altcoin Scanner — real Binance data only.
 *
 * Uses the same shared modules as the V5 server worker:
 *   - fetchUniverse      → real Binance 24h tickers, ranked by quote volume
 *   - fetchCandlesBatch  → real Binance OHLCV (closed bars only)
 *   - scoreAsset         → deterministic indicator score (RSI, MACD, EMA,
 *                          Bollinger, Stochastic, volume) — no randomness
 *
 * No Math.random(), no CoinGecko price simulation, no synthetic indicators.
 * If Binance is unavailable, the scan returns an empty list — it does NOT
 * invent opportunities. Trading on invented data is worse than not trading.
 */

import { fetchUniverse, fetchCandlesBatch } from '@shared/trading/marketData.js';
import { scoreAsset, MIN_CANDLES } from '@shared/trading/signalEngine.js';
import { relativeVolume } from '@shared/trading/indicators.js';

// Scan scope — top candidates by volume that we then score on real candles.
const SCAN_CANDIDATES = 25;
const CANDLE_INTERVAL = '1h';
const CANDLE_LIMIT = 200;

// ---------------------------------------------------------------------------
// Static classification — a symbol→category map is a label, not market data.
// ---------------------------------------------------------------------------

const NAME_MAP = {
  BTC: 'Bitcoin', ETH: 'Ethereum', SOL: 'Solana', BNB: 'BNB', XRP: 'XRP',
  ADA: 'Cardano', DOGE: 'Dogecoin', AVAX: 'Avalanche', DOT: 'Polkadot',
  LINK: 'Chainlink', MATIC: 'Polygon', UNI: 'Uniswap', ATOM: 'Cosmos',
  LTC: 'Litecoin', NEAR: 'NEAR Protocol', PEPE: 'Pepe', APT: 'Aptos',
  ARB: 'Arbitrum', RNDR: 'Render', INJ: 'Injective', TIA: 'Celestia',
  SUI: 'Sui', SEI: 'Sei', FTM: 'Fantom', OP: 'Optimism', FET: 'Fetch.ai',
  GRT: 'The Graph', FIL: 'Filecoin', AR: 'Arweave', RUNE: 'THORChain',
  AAVE: 'Aave', MKR: 'Maker', CRV: 'Curve DAO', COMP: 'Compound',
  SHIB: 'Shiba Inu', WIF: 'dogwifhat', BONK: 'Bonk', JUP: 'Jupiter',
  PYTH: 'Pyth Network', WLD: 'Worldcoin', STX: 'Stacks', IMX: 'Immutable',
};

const categorizeCoin = (base) => {
  if (['BTC', 'ETH', 'SOL', 'ADA', 'AVAX', 'DOT', 'ATOM', 'NEAR', 'FTM', 'SUI', 'SEI', 'ALGO', 'BNB', 'XRP', 'LTC'].includes(base)) return 'Layer 1';
  if (['MATIC', 'ARB', 'OP', 'IMX', 'MNT', 'STRK', 'STX'].includes(base)) return 'Layer 2';
  if (['UNI', 'AAVE', 'MKR', 'SNX', 'CRV', 'COMP', 'LDO', 'RPL', 'PENDLE', 'JUP', 'INJ', 'RUNE'].includes(base)) return 'DeFi';
  if (['DOGE', 'SHIB', 'PEPE', 'BONK', 'FLOKI', 'WIF', 'MEME'].includes(base)) return 'Meme';
  if (['FET', 'RNDR', 'GRT', 'OCEAN', 'WLD', 'AGIX'].includes(base)) return 'AI';
  if (['SAND', 'MANA', 'AXS', 'GALA', 'ILV', 'BEAM', 'PRIME'].includes(base)) return 'Gaming';
  if (['LINK', 'FIL', 'AR', 'VET', 'PYTH', 'TIA'].includes(base)) return 'Infrastructure';
  return 'Altcoin';
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export let ALTCOIN_LIST = [];

export const getCategories = () => [
  'Layer 1', 'Layer 2', 'DeFi', 'Meme', 'AI', 'Gaming', 'Infrastructure', 'Altcoin',
];

export const getAltcoinsByCategory = (category) =>
  ALTCOIN_LIST.filter((c) => c.category === category);

/**
 * Scan the real Binance universe and score the most liquid candidates on
 * real OHLCV with the deterministic signal engine.
 *
 * @param {number} count  How many opportunities to return.
 * @returns {Promise<Array>} Opportunities sorted by score, or [] on failure.
 */
export const scanAltcoins = async (count = 12) => {
  console.log(`🔍 Scanning real Binance universe…`);

  let universe = [];
  try {
    universe = await fetchUniverse({ topN: 100, minQuoteVolume24h: 5_000_000 });
  } catch (err) {
    console.warn('⚠️ Binance universe unavailable, returning no opportunities:', err.message);
    return [];
  }

  const candidates = universe.slice(0, SCAN_CANDIDATES);
  const symbols = candidates.map((u) => u.symbol);

  const candleMap = await fetchCandlesBatch(symbols, CANDLE_INTERVAL, CANDLE_LIMIT);

  const opportunities = [];

  for (const u of candidates) {
    const candles = candleMap.get(u.symbol);
    if (!candles || candles.length < MIN_CANDLES) continue;

    const result = scoreAsset(candles);
    if (!result) continue;

    const base = u.base;
    const rv = relativeVolume(candles);

    opportunities.push({
      symbol: base,
      name: NAME_MAP[base] || base,
      category: categorizeCoin(base),
      // 0–100 signal strength from real indicators (NOT a probability).
      score: result.strength,
      // Real 24h price change from Binance.
      momentum: parseFloat(u.change24h.toFixed(2)),
      // ATR-based volatility from real candles.
      volatility: parseFloat((result.atrPercent || 0).toFixed(2)),
      // Real relative volume (current vs average), 1.0 when unavailable.
      volume_surge: rv !== null ? parseFloat(rv.toFixed(2)) : 1.0,
      signal: result.strength >= 75 ? 'strong_buy'
        : result.strength >= 65 ? 'buy'
        : result.strength >= 45 ? 'hold'
        : result.strength >= 35 ? 'sell'
        : 'strong_sell',
      // Real last price from Binance candles. Field kept for UI compatibility.
      simulated_price: result.price,
      confidence: result.strength,
      direction: result.direction,
      reasons: result.reasons,
      dataPoints: result.dataPoints,
    });
  }

  // Strongest signals first (highest strength = most bullish).
  opportunities.sort((a, b) => b.score - a.score);

  ALTCOIN_LIST = opportunities;
  console.log(`✅ Scored ${opportunities.length} real opportunities from Binance`);
  return opportunities.slice(0, count);
};

/**
 * Detailed analysis for a scanned altcoin. Returns the real signal-engine
 * output captured during the scan — no fabricated RSI/MACD/sentiment.
 */
export const getAltcoinAnalysis = (altcoin) => ({
  technicals: {
    direction: altcoin.direction || 'neutral',
    reasons: altcoin.reasons || [],
  },
  risk_level: altcoin.volatility > 12 ? 'high' : altcoin.volatility > 8 ? 'medium' : 'low',
});