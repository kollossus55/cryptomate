// GENERATED FILE — DO NOT EDIT.
// Copied from /shared/trading by scripts/sync-shared.mjs.
// Edit the source in /shared/trading and re-run: npm run sync:functions
/**
 * Market Data — real OHLCV only.
 *
 * REPLACES: generateSyntheticHistory(), which fabricated price history with
 * Math.random(). There is deliberately no synthetic fallback in this module.
 * If data is unavailable, callers get null and MUST NOT trade. Trading on
 * invented data is worse than not trading.
 *
 * Runs unmodified in the browser and in Deno (fetch + ESM only, no deps).
 */

const BINANCE = 'https://api.binance.com';
const COINGECKO = 'https://api.coingecko.com/api/v3';

/** Interval -> milliseconds, used for cache keying on bar close. */
const INTERVAL_MS = {
  '1m': 60e3, '3m': 180e3, '5m': 300e3, '15m': 900e3, '30m': 1800e3,
  '1h': 3600e3, '2h': 7200e3, '4h': 14400e3, '6h': 21600e3,
  '12h': 43200e3, '1d': 86400e3,
};

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

async function fetchJson(url, { timeoutMs = 10000, retries = 2 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      clearTimeout(timer);

      // 429/418 = rate limited. Respect Retry-After, then back off.
      if (res.status === 429 || res.status === 418) {
        const retryAfter = Number(res.headers.get('Retry-After')) || 2 ** attempt;
        await sleep(retryAfter * 1000);
        lastErr = new Error(`Rate limited (${res.status})`);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.json();
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      if (attempt < retries) await sleep(250 * 2 ** attempt);
    }
  }
  throw lastErr;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Run async tasks with bounded concurrency (avoids hammering rate limits). */
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      try {
        results[i] = await fn(items[i], i);
      } catch (err) {
        results[i] = { error: err };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------------------
// Candles
// ---------------------------------------------------------------------------

const candleCache = new Map(); // `${symbol}|${interval}` -> { barId, candles }

/**
 * Fetch OHLCV candles for one symbol.
 *
 * Returns an array of { openTime, open, high, low, close, volume, closeTime,
 * quoteVolume, trades } — oldest first — or null if unavailable.
 *
 * The final candle is DROPPED when it is still forming. An unclosed bar
 * repaints: an indicator computed on it changes value as the bar develops,
 * which produces signals that look great in a backtest and cannot be traded
 * live. Every candle this returns is closed and final.
 */
export async function fetchCandles(symbol, interval = '1h', limit = 200) {
  const cacheKey = `${symbol}|${interval}`;
  const intervalMs = INTERVAL_MS[interval];
  if (!intervalMs) throw new Error(`Unsupported interval: ${interval}`);

  // Cache is keyed on which bar is currently forming, so a cached entry is
  // reused for the life of that bar and refreshed exactly once per bar close.
  const currentBarId = Math.floor(Date.now() / intervalMs);
  const cached = candleCache.get(cacheKey);
  if (cached && cached.barId === currentBarId) return cached.candles;

  // limit+1 because we discard the in-progress bar.
  const url = `${BINANCE}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit + 1}`;

  let raw;
  try {
    raw = await fetchJson(url);
  } catch (err) {
    console.warn(`[marketData] candles unavailable for ${symbol}: ${err.message}`);
    return null;
  }

  if (!Array.isArray(raw) || raw.length === 0) return null;

  const now = Date.now();
  const candles = raw
    .map((k) => ({
      openTime: k[0],
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
      closeTime: k[6],
      quoteVolume: parseFloat(k[7]),
      trades: k[8],
    }))
    // Drop the forming bar, plus any row with a bad field.
    .filter((c) => c.closeTime < now)
    .filter((c) => Number.isFinite(c.close) && Number.isFinite(c.high) &&
                   Number.isFinite(c.low) && Number.isFinite(c.volume));

  if (candles.length === 0) return null;

  candleCache.set(cacheKey, { barId: currentBarId, candles });
  return candles;
}

/** Fetch candles for many symbols with bounded concurrency. */
export async function fetchCandlesBatch(symbols, interval = '1h', limit = 200, concurrency = 8) {
  const results = await mapLimit(symbols, concurrency, (s) => fetchCandles(s, interval, limit));
  const out = new Map();
  symbols.forEach((sym, i) => {
    const r = results[i];
    if (r && !r.error && Array.isArray(r)) out.set(sym, r);
  });
  return out;
}

// ---------------------------------------------------------------------------
// Universe
// ---------------------------------------------------------------------------

let tradableSymbolsCache = { at: 0, set: null };

/**
 * Symbols currently open for spot trading against USDT on Binance.
 * Cached for an hour — listings change rarely.
 */
export async function fetchTradableUsdtSymbols() {
  if (tradableSymbolsCache.set && Date.now() - tradableSymbolsCache.at < 3600e3) {
    return tradableSymbolsCache.set;
  }
  const info = await fetchJson(`${BINANCE}/api/v3/exchangeInfo`);
  const set = new Set(
    info.symbols
      .filter((s) => s.status === 'TRADING' && s.quoteAsset === 'USDT' && s.isSpotTradingAllowed)
      .map((s) => s.symbol)
  );
  tradableSymbolsCache = { at: Date.now(), set };
  return set;
}

/**
 * Build the tradable universe in TWO network calls, not 250.
 *
 * The old worker fetched CoinGecko top-250 and then would have needed a
 * per-symbol candle request to do any real analysis — too slow for a function
 * with an execution timeout. Instead: one call gets a 24h ticker snapshot for
 * every symbol on the exchange, we rank on that, and only the top candidates
 * get a candle request.
 *
 * Returns [{ symbol, base, price, change24h, quoteVolume24h, high24h, low24h }]
 * sorted by 24h quote volume descending. Throws on failure — the caller must
 * treat "no market data" as "do not trade".
 */
export async function fetchUniverse({ topN = 60, minQuoteVolume24h = 5_000_000 } = {}) {
  const [tickers, tradable] = await Promise.all([
    fetchJson(`${BINANCE}/api/v3/ticker/24hr`),
    fetchTradableUsdtSymbols(),
  ]);

  return tickers
    .filter((t) => tradable.has(t.symbol))
    // Leveraged tokens (BTCUP/BTCDOWN) and stable-to-stable pairs behave
    // nothing like spot and must not be scored as if they do.
    .filter((t) => !/(UP|DOWN|BULL|BEAR)USDT$/.test(t.symbol))
    .filter((t) => !/^(USDC|FDUSD|TUSD|BUSD|DAI|EUR|GBP|AEUR)USDT$/.test(t.symbol))
    .map((t) => ({
      symbol: t.symbol,
      base: t.symbol.replace(/USDT$/, ''),
      price: parseFloat(t.lastPrice),
      change24h: parseFloat(t.priceChangePercent),
      quoteVolume24h: parseFloat(t.quoteVolume),
      high24h: parseFloat(t.highPrice),
      low24h: parseFloat(t.lowPrice),
      trades24h: t.count,
    }))
    .filter((t) => Number.isFinite(t.price) && t.price > 0)
    // Liquidity floor. Below this, modelled slippage is guesswork and the
    // spread eats any edge the signal might have.
    .filter((t) => t.quoteVolume24h >= minQuoteVolume24h)
    .sort((a, b) => b.quoteVolume24h - a.quoteVolume24h)
    .slice(0, topN);
}

/**
 * Order book depth, used by the slippage model to size trades against real
 * liquidity rather than a flat percentage guess.
 */
export async function fetchOrderBook(symbol, limit = 100) {
  try {
    const book = await fetchJson(`${BINANCE}/api/v3/depth?symbol=${symbol}&limit=${limit}`);
    return {
      bids: book.bids.map(([p, q]) => [parseFloat(p), parseFloat(q)]),
      asks: book.asks.map(([p, q]) => [parseFloat(p), parseFloat(q)]),
    };
  } catch (err) {
    console.warn(`[marketData] order book unavailable for ${symbol}: ${err.message}`);
    return null;
  }
}

/** Market-cap ranking, if you want to weight or filter by it. Optional. */
export async function fetchMarketCaps(perPage = 250) {
  const url = `${COINGECKO}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${perPage}&page=1&sparkline=false`;
  try {
    const data = await fetchJson(url);
    const byBase = new Map();
    for (const c of data) byBase.set(c.symbol.toUpperCase(), c.market_cap || 0);
    return byBase;
  } catch (err) {
    console.warn(`[marketData] market caps unavailable: ${err.message}`);
    return new Map();
  }
}

/** Historical candles for backtesting — pages backwards past the 1000-row cap. */
export async function fetchHistoricalCandles(symbol, interval, startTime, endTime) {
  const intervalMs = INTERVAL_MS[interval];
  if (!intervalMs) throw new Error(`Unsupported interval: ${interval}`);

  const all = [];
  let cursor = startTime;

  while (cursor < endTime) {
    const url = `${BINANCE}/api/v3/klines?symbol=${symbol}&interval=${interval}` +
                `&startTime=${cursor}&endTime=${endTime}&limit=1000`;
    const raw = await fetchJson(url);
    if (!Array.isArray(raw) || raw.length === 0) break;

    for (const k of raw) {
      all.push({
        openTime: k[0],
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5]),
        closeTime: k[6],
        quoteVolume: parseFloat(k[7]),
      });
    }

    const last = raw[raw.length - 1][0];
    if (last <= cursor) break; // no forward progress; stop rather than loop
    cursor = last + intervalMs;

    await sleep(120); // stay well inside the rate limit
  }

  return all.filter((c) => c.closeTime <= endTime);
}

export const _internal = { fetchJson, mapLimit, sleep, INTERVAL_MS };
