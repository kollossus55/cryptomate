import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { fetchUniverse, fetchCandlesBatch } from './shared/marketData.js';
import { scoreAsset, MIN_CANDLES } from './shared/signalEngine.js';
import { relativeVolume } from './shared/indicators.js';

/**
 * Altcoin Scanner Worker — server-side scan of the real OKX universe.
 *
 * Runs entirely on the server so the browser never touches Binance: it fetches
 * the 24h ticker universe, pulls OHLCV candles for the top candidates in
 * rate-limited batches, scores each with the SP500-AI composite (real OHLCV,
 * no synthetic data), and stores the results in the ScanResult entity. The UI
 * just reads the latest ScanResult record — instant, zero browser cost.
 *
 * Invoked either by a scheduled workflow (no user context) or manually from
 * the Altcoin Scanner page via the SDK. Either way it acts as the service role.
 */

const SCAN_CANDIDATES = 100;     // top symbols by 24h quote volume
const CANDLE_INTERVAL = '1h';
const CANDLE_LIMIT = 200;
const BATCH_SIZE = 10;           // fetch this many symbols per batch
const BATCH_CONCURRENCY = 5;    // parallel requests within a batch
const BATCH_DELAY_MS = 300;     // pause between batches to respect rate limits
const MIN_QUOTE_VOLUME_24H = 400_000;

// Static classification — a symbol→category map is a label, not market data.
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Parse raw Binance kline arrays into the candle format scoreAsset expects. */
function parseKlines(raw) {
  if (!Array.isArray(raw)) return null;
  const now = Date.now();
  const candles = raw
    .map((k) => ({
      openTime: k[0], open: parseFloat(k[1]), high: parseFloat(k[2]),
      low: parseFloat(k[3]), close: parseFloat(k[4]), volume: parseFloat(k[5]),
      closeTime: k[6], quoteVolume: parseFloat(k[7]), trades: k[8],
    }))
    .filter((c) => c.closeTime < now)
    .filter((c) => Number.isFinite(c.close) && Number.isFinite(c.high) &&
                   Number.isFinite(c.low) && Number.isFinite(c.volume));
  return candles.length ? candles : null;
}

/** Ticker-derived score when OHLCV is unavailable (server geo-blocked). */
function scoreFromTicker(u) {
  const momentum = u.change24h || 0;
  // FRACTION, not percent. This is consumed as `atrPercent` by the cost model,
  // which expects 0.05 for 5%. Returning 5.0 here made the slippage estimate
  // ~100x too large, pinned it at its cap, and the max_slippage_percent gate
  // then rejected every candidate the scanner produced.
  const volatility = (u.high24h && u.low24h && u.price)
    ? (u.high24h - u.low24h) / u.price : 0;
  let strength = 50 + momentum * 1.5;
  strength = Math.max(5, Math.min(95, strength));
  const direction = momentum > 0.5 ? 'bullish' : momentum < -0.5 ? 'bearish' : 'neutral';
  return {
    strength: Math.round(strength),
    direction,
    atrPercent: volatility,
    price: u.price,
    reasons: [`Ticker momentum ${momentum.toFixed(2)}%`, `24h range ${(volatility * 100).toFixed(2)}%`],
    dataPoints: 2,
  };
}

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);

    // Health check
    const url = new URL(req.url);
    if (url.searchParams.get('check_only') === 'true') {
      return Response.json({ status: 'healthy', message: 'altcoin scanner worker ready' });
    }

    // Authenticate the caller. Two legitimate paths exist:
    //   1. A user token (manual call from the Altcoin Scanner page) — any
    //      logged-in user may trigger a server-side scan.
    //   2. The platform scheduler — no user token, but the platform's
    //      invoke_backend_function provides the service-role auth context
    //      (admin-level), so base44.auth.me() still resolves.
    // An unauthenticated external request has neither and must be rejected;
    // previously the server-side fetch path did no auth check, so anyone
    // who knew the URL could trigger the service-role DB writes below.
    try {
      const caller = await base44.auth.me();
      if (!caller) {
        return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 });
      }
    } catch {
      return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    console.log('🔍 Altcoin Scanner Worker: starting server-side scan…');

    // 1. Universe: prefer a browser-fed payload (server is geo-blocked from
    //    Binance), fall back to a server fetch when no payload is supplied.
    const body = await req.json().catch(() => ({}));
    const providedUniverse = Array.isArray(body?.universe) ? body.universe : null;
    const providedCandles = body?.candles && typeof body.candles === 'object' ? body.candles : null;

    // Browser-fed data overwrites the shared ScanResult that all users read
    // (and that autoTradingWorker uses as its fallback universe). Require an
    // authenticated admin to submit it — a non-admin must not be able to
    // inject fake market data into the shared scan feed.
    if (providedUniverse || providedCandles) {
      try {
        const caller = await base44.auth.me();
        if (!caller || caller.role !== 'admin') {
          return Response.json({ success: false, error: 'Forbidden: admin required to submit scan data' }, { status: 403 });
        }
      } catch {
        return Response.json({ success: false, error: 'Forbidden: admin required to submit scan data' }, { status: 403 });
      }
    }

    let universe = [];
    if (providedUniverse) {
      universe = providedUniverse;
      console.log(`📥 Using browser-fed universe: ${universe.length} symbols`);
    } else {
      try {
        universe = await fetchUniverse({ topN: SCAN_CANDIDATES, minQuoteVolume24h: MIN_QUOTE_VOLUME_24H });
      } catch (err) {
        // Server is geo-blocked from Binance. Do NOT wipe a valid browser-fed
        // scan with an empty error record — just report and leave the DB as-is.
        console.warn('⚠️ Binance universe unavailable (server geo-block):', err.message);
        return Response.json({ success: false, error: 'Universe unavailable — market data source unreachable' });
      }
    }

    // 2. Build the candle map. Browser-fed klines first; remaining symbols are
    //    fetched server-side only when the browser supplied nothing (egress OK).
    const candleMap = new Map();
    if (providedCandles) {
      for (const [sym, raw] of Object.entries(providedCandles)) {
        const parsed = parseKlines(raw);
        if (parsed && parsed.length >= MIN_CANDLES) candleMap.set(sym, parsed);
      }
      console.log(`📥 Browser-fed candles: ${candleMap.size} symbols`);
    } else {
      // Fetch candles for only the top movers by |change24h|, not all 100.
      // Fetching all 100 triggers OKX rate limits (429) and makes the scan
      // take 50+ seconds. The remaining symbols use the ticker fallback score.
      const candidates = [...universe]
        .sort((a, b) => Math.abs(b.change24h) - Math.abs(a.change24h))
        .slice(0, 20);
      const fetched = await fetchCandlesBatch(
        candidates.map((u) => u.symbol), CANDLE_INTERVAL, CANDLE_LIMIT, BATCH_CONCURRENCY
      );
      for (const [sym, c] of fetched.entries()) candleMap.set(sym, c);
    }

    // 3. Score every universe symbol. Full SP500-AI on OHLCV where available,
    //    ticker-derived momentum score everywhere else (server geo-block fallback).
    const opportunities = [];
    let scored = 0;

    for (const u of universe) {
      const candles = candleMap.get(u.symbol);
      let result = null;
      if (candles && candles.length >= MIN_CANDLES) {
        result = scoreAsset(candles, {
          indicators: { rsi: false, macd: false, bollinger: false, ema: false, stoch: false, sp500ai: true },
        });
      }
      if (!result) result = scoreFromTicker(u);
      if (!result) continue;

      scored++;
      const base = u.base;
      const rv = candles ? relativeVolume(candles) : null;

      opportunities.push({
        symbol: base,
        name: NAME_MAP[base] || base,
        category: categorizeCoin(base),
        score: result.strength,
        momentum: parseFloat((u.change24h || 0).toFixed(2)),
        volatility: parseFloat((result.atrPercent || 0).toFixed(2)),
        volume_surge: rv !== null ? parseFloat(rv.toFixed(2)) : 1.0,
        volume24h: u.quoteVolume24h || 0,
        risk_level: (result.atrPercent || 0) > 12 ? 'high' : (result.atrPercent || 0) > 8 ? 'medium' : 'low',
        signal: result.strength >= 75 ? 'strong_buy'
          : result.strength >= 65 ? 'buy'
          : result.strength >= 45 ? 'hold'
          : result.strength >= 35 ? 'sell'
          : 'strong_sell',
        price: result.price,
        confidence: result.strength,
        direction: result.direction,
        reasons: result.reasons,
        dataPoints: result.dataPoints,
      });
    }

    // 3. Strongest signals first.
    opportunities.sort((a, b) => b.score - a.score);

    // 4. Persist (replaces any previous scan record).
    await storeScanResult(base44, opportunities, universe.length, scored, null);

    console.log(`✅ Scan complete: ${scored}/${universe.length} scored, ${opportunities.length} opportunities`);
    return Response.json({
      success: true,
      scanned: universe.length,
      scored,
      opportunities: opportunities.length,
    });
  } catch (error) {
    console.error('❌ Altcoin Scanner Worker error:', error);
    return Response.json({ success: false, error: 'Scanner run failed' }, { status: 500 });
  }
}

/** Replace any previous scan record with the latest, so the UI reads one fresh row. */
async function storeScanResult(base44, opportunities, scanned, scored, error) {
  try {
    await base44.asServiceRole.entities.ScanResult.deleteMany({});
  } catch (e) {
    // Empty store on first run — safe to ignore.
  }
  await base44.asServiceRole.entities.ScanResult.create({
    scan_scope: 'top100',
    opportunities,
    scanned_at: new Date().toISOString(),
    symbols_scanned: scanned,
    symbols_scored: scored,
    candle_interval: CANDLE_INTERVAL,
    error: error || null,
  });
}