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

/**
 * Data provider chain.
 *
 * OKX is the primary, Coinbase the fallback. Both expose free, unauthenticated
 * spot endpoints and return the same normalised shape so nothing downstream
 * needs to know which one replied.
 *
 * Binance was removed because the server is geo-blocked (HTTP 451) from
 * api.binance.com. OKX symbols map to Binance's almost one-to-one
 * (BTCUSDT -> BTC-USDT), so the rest of the app keeps Binance-style symbols.
 */

const PROVIDER_TIMEOUT = 8000;

// ---------------------------------------------------------------------------
// OKX
// ---------------------------------------------------------------------------

const OKX = 'https://www.okx.com';

const OKX_BAR = {
  '1m': '1m', '3m': '3m', '5m': '5m', '15m': '15m', '30m': '30m',
  '1h': '1H', '2h': '2H', '4h': '4H', '6h': '6H', '12h': '12H', '1d': '1D',
};

/** BTCUSDT -> BTC-USDT */
function toOkxInst(symbol) {
  if (!symbol.endsWith('USDT')) return null;
  return `${symbol.slice(0, -4)}-USDT`;
}

const okxProvider = {
  name: 'okx',

  async tickers() {
    const data = await fetchJson(`${OKX}/api/v5/market/tickers?instType=SPOT`, { timeoutMs: PROVIDER_TIMEOUT });
    if (data.code !== '0' || !Array.isArray(data.data)) throw new Error('OKX tickers malformed');

    return data.data
      .filter((t) => t.instId.endsWith('-USDT'))
      .map((t) => {
        const open = parseFloat(t.open24h);
        const price = parseFloat(t.last);
        return {
          // Normalise back to Binance-style symbols so the rest of the app,
          // the stored positions and the ScanResult records all stay consistent.
          symbol: t.instId.replace('-USDT', 'USDT'),
          base: t.instId.split('-')[0],
          price,
          change24h: open > 0 ? ((price - open) / open) * 100 : 0,
          quoteVolume24h: parseFloat(t.volCcy24h),
          high24h: parseFloat(t.high24h),
          low24h: parseFloat(t.low24h),
          trades24h: null,
        };
      });
  },

  async candles(symbol, interval, limit) {
    const instId = toOkxInst(symbol);
    const bar = OKX_BAR[interval];
    if (!instId || !bar) return null;

    const data = await fetchJson(
      `${OKX}/api/v5/market/candles?instId=${instId}&bar=${bar}&limit=${Math.min(limit + 1, 300)}`,
      { timeoutMs: PROVIDER_TIMEOUT }
    );
    if (data.code !== '0' || !Array.isArray(data.data)) return null;

    const intervalMs = INTERVAL_MS[interval];
    // OKX returns newest first; everything downstream expects oldest first.
    return data.data
      .slice()
      .reverse()
      .map((k) => ({
        openTime: Number(k[0]),
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5]),
        closeTime: Number(k[0]) + intervalMs - 1,
        quoteVolume: parseFloat(k[7] ?? k[6] ?? 0),
        // k[8] === '1' means the bar is closed. Trust it when present.
        _confirmed: k[8] === undefined ? null : k[8] === '1',
      }));
  },
};

// ---------------------------------------------------------------------------
// Coinbase
// ---------------------------------------------------------------------------

const COINBASE = 'https://api.exchange.coinbase.com';

const COINBASE_GRANULARITY = {
  '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '6h': 21600, '1d': 86400,
};

/** BTCUSDT -> BTC-USD (Coinbase quotes in USD, not USDT) */
function toCoinbaseProduct(symbol) {
  if (!symbol.endsWith('USDT')) return null;
  return `${symbol.slice(0, -4)}-USD`;
}

const coinbaseProvider = {
  name: 'coinbase',

  async tickers() {
    const products = await fetchJson(`${COINBASE}/products`, { timeoutMs: PROVIDER_TIMEOUT });
    const usd = products.filter((p) => p.quote_currency === 'USD' && p.status === 'online' && !p.trading_disabled);

    // Coinbase has no bulk ticker endpoint, so this would be one request per
    // product. Cap it at the majors — enough to keep the bot alive when the
    // other providers are unreachable, without hundreds of calls per cycle.
    const majors = usd.slice(0, 40);
    const stats = await mapLimit(majors, 6, async (p) => {
      try {
        const s = await fetchJson(`${COINBASE}/products/${p.id}/stats`, { timeoutMs: PROVIDER_TIMEOUT });
        const open = parseFloat(s.open);
        const price = parseFloat(s.last);
        if (!Number.isFinite(price) || price <= 0) return null;
        return {
          symbol: `${p.base_currency}USDT`,
          base: p.base_currency,
          price,
          change24h: open > 0 ? ((price - open) / open) * 100 : 0,
          quoteVolume24h: parseFloat(s.volume) * price,
          high24h: parseFloat(s.high),
          low24h: parseFloat(s.low),
          trades24h: null,
        };
      } catch {
        return null;
      }
    });

    return stats.filter((s) => s && !s.error);
  },

  async candles(symbol, interval, limit) {
    const product = toCoinbaseProduct(symbol);
    const granularity = COINBASE_GRANULARITY[interval];
    if (!product || !granularity) return null;

    const raw = await fetchJson(
      `${COINBASE}/products/${product}/candles?granularity=${granularity}`,
      { timeoutMs: PROVIDER_TIMEOUT }
    );
    if (!Array.isArray(raw)) return null;

    // Coinbase: [time, low, high, open, close, volume], newest first, seconds.
    return raw
      .slice()
      .reverse()
      .slice(-(limit + 1))
      .map((k) => ({
        openTime: k[0] * 1000,
        low: k[1],
        high: k[2],
        open: k[3],
        close: k[4],
        volume: k[5],
        closeTime: k[0] * 1000 + granularity * 1000 - 1,
        quoteVolume: k[5] * k[4],
        _confirmed: null,
      }));
  },
};

// ---------------------------------------------------------------------------
// Provider chain — OKX is primary, Coinbase is the fallback.
// Binance was removed because the server is geo-blocked (HTTP 451).
// ---------------------------------------------------------------------------

const PROVIDERS = [okxProvider, coinbaseProvider];

// Remember which provider last worked so a geo-blocked primary is not retried
// on every symbol of every cycle. Re-probed after the TTL.
let activeProvider = null;
let activeProviderAt = 0;
const PROVIDER_STICKY_MS = 10 * 60 * 1000;

export function getActiveProvider() {
  return activeProvider?.name ?? null;
}

/** Reset the sticky provider — call after a config change or for tests. */
export function resetProvider() {
  activeProvider = null;
  activeProviderAt = 0;
}

function orderedProviders() {
  if (activeProvider && Date.now() - activeProviderAt < PROVIDER_STICKY_MS) {
    return [activeProvider, ...PROVIDERS.filter((p) => p !== activeProvider)];
  }
  return PROVIDERS;
}

/**
 * Run an operation against each provider until one succeeds.
 * Throws only when every provider has failed.
 */
async function withProvider(operation, describe) {
  const errors = [];
  for (const provider of orderedProviders()) {
    try {
      const result = await operation(provider);
      if (result === null || (Array.isArray(result) && result.length === 0)) {
        errors.push(`${provider.name}: empty`);
        continue;
      }
      if (activeProvider !== provider) {
        console.log(`[marketData] using provider: ${provider.name} (${describe})`);
      }
      activeProvider = provider;
      activeProviderAt = Date.now();
      return result;
    } catch (err) {
      errors.push(`${provider.name}: ${err.message}`);
      // A geo-block or hard failure on the sticky provider means stop trusting
      // it immediately rather than waiting out the TTL.
      if (activeProvider === provider) {
        activeProvider = null;
      }
    }
  }
  throw new Error(`All providers failed (${describe}) — ${errors.join(' | ')}`);
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

  let raw;
  try {
    // Provider chain: OKX first, then Coinbase as fallback.
    raw = await withProvider(
      (provider) => provider.candles(symbol, interval, limit),
      `candles ${symbol} ${interval}`
    );
  } catch (err) {
    console.warn(`[marketData] candles unavailable for ${symbol}: ${err.message}`);
    return null;
  }

  if (!Array.isArray(raw) || raw.length === 0) return null;

  const now = Date.now();
  const candles = raw
    // Drop the forming bar, plus any row with a bad field. Providers that
    // report confirmation explicitly are trusted over the clock comparison.
    .filter((c) => (c._confirmed === false ? false : c.closeTime < now))
    .filter((c) => Number.isFinite(c.close) && Number.isFinite(c.high) &&
                   Number.isFinite(c.low) && Number.isFinite(c.volume))
    .map(({ _confirmed, ...c }) => c);

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

// Major/popular coins excluded from the trading universe — the bot trades
// altcoins only. These dominate any pure volume ranking, so skipping them lets
// the next tier of liquid altcoins through.
const MAJORS = new Set([
  'BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'ADA', 'DOGE', 'DOT', 'MATIC',
  'LTC', 'BCH', 'LINK', 'AVAX', 'TRX', 'ATOM',
]);

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
  // Provider chain: OKX first, then Coinbase as fallback.
  const tickers = await withProvider(
    (provider) => provider.tickers(),
    'universe tickers'
  );

  return tickers
    // Leveraged tokens (BTCUP/BTCDOWN) and stable-to-stable pairs behave
    // nothing like spot and must not be scored as if they do.
    .filter((t) => !/(UP|DOWN|BULL|BEAR)USDT$/.test(t.symbol))
    .filter((t) => !/^(USDC|FDUSD|TUSD|BUSD|DAI|EUR|GBP|AEUR)USDT$/.test(t.symbol))
    // Exclude major/popular coins — trade altcoins only.
    .filter((t) => !MAJORS.has(t.base))
    .filter((t) => Number.isFinite(t.price) && t.price > 0)
    // Liquidity floor. Below this, modelled slippage is guesswork and the
    // spread eats any edge the signal might have.
    .filter((t) => t.quoteVolume24h >= minQuoteVolume24h)
    .sort((a, b) => b.quoteVolume24h - a.quoteVolume24h)
    .slice(0, topN);
}

/**
 * Fetch current spot prices for a specific set of Binance-style symbols
 * (e.g. "ZECUSDT", "PEPEUSDT") in a single bulk call.
 *
 * Used to mark held positions to market when they fall outside the trading
 * universe (obscure altcoins below the liquidity floor or top-N cap). Without
 * this, markToMarket leaves their current_value at the entry price and their
 * profit_loss at just the entry fee, so the UI shows stale unrealized P&L.
 *
 * Returns a Map<string, number> of symbol -> live price. Symbols not found
 * on any provider are simply absent from the map.
 */
export async function fetchPricesForSymbols(symbols) {
  if (!symbols || symbols.length === 0) return new Map();
  const usdtSymbols = symbols.filter((s) => typeof s === 'string' && s.endsWith('USDT'));
  if (usdtSymbols.length === 0) return new Map();

  const wanted = new Set(usdtSymbols);
  const out = new Map();

  // OKX is the most reliable bulk endpoint and maps cleanly to Binance symbols.
  try {
    const data = await fetchJson(`${OKX}/api/v5/market/tickers?instType=SPOT`, { timeoutMs: PROVIDER_TIMEOUT });
    if (data.code === '0' && Array.isArray(data.data)) {
      for (const t of data.data) {
        if (typeof t.instId !== 'string' || !t.instId.endsWith('-USDT')) continue;
        const binanceSymbol = t.instId.replace('-USDT', 'USDT');
        if (wanted.has(binanceSymbol) && t.last) {
          const price = parseFloat(t.last);
          if (Number.isFinite(price) && price > 0) out.set(binanceSymbol, price);
        }
      }
    }
  } catch (err) {
    console.warn(`[marketData] fetchPricesForSymbols OKX failed: ${err.message}`);
  }

  // Fill any gaps from Coinbase single-product stats (best-effort, low concurrency).
  const missing = usdtSymbols.filter((s) => !out.has(s));
  if (missing.length > 0) {
    const results = await mapLimit(missing, 4, async (sym) => {
      try {
        const product = toCoinbaseProduct(sym);
        if (!product) return null;
        const s = await fetchJson(`${COINBASE}/products/${product}/stats`, { timeoutMs: 5000 });
        const price = parseFloat(s.last);
        if (Number.isFinite(price) && price > 0) return [sym, price];
      } catch { /* not listed on Coinbase */ }
      return null;
    });
    for (const r of results) {
      if (r && !r.error) out.set(r[0], r[1]);
    }
  }

  return out;
}

/**
 * Order book depth, used by the slippage model to size trades against real
 * liquidity rather than a flat percentage guess.
 */
export async function fetchOrderBook(symbol, limit = 100) {
  try {
    const instId = toOkxInst(symbol);
    if (!instId) return null;
    const data = await fetchJson(`${OKX}/api/v5/market/books?instId=${instId}&sz=${limit}`, { timeoutMs: PROVIDER_TIMEOUT });
    if (data.code !== '0' || !Array.isArray(data.data) || !data.data[0]) return null;
    const book = data.data[0];
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
  const instId = toOkxInst(symbol);
  const bar = OKX_BAR[interval];
  const intervalMs = INTERVAL_MS[interval];
  if (!instId || !bar || !intervalMs) throw new Error(`Unsupported symbol/interval: ${symbol} ${interval}`);

  const all = [];
  let after = endTime; // OKX 'after' = records older than this timestamp (ms)

  while (after > startTime) {
    const url = `${OKX}/api/v5/market/history-candles?instId=${instId}&bar=${bar}` +
                `&after=${after}&limit=100`;
    const data = await fetchJson(url, { timeoutMs: PROVIDER_TIMEOUT });
    if (data.code !== '0' || !Array.isArray(data.data) || data.data.length === 0) break;

    for (const k of data.data) {
      const openTime = Number(k[0]);
      if (openTime < startTime) continue;
      all.push({
        openTime,
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5]),
        closeTime: openTime + intervalMs - 1,
        quoteVolume: parseFloat(k[7] ?? 0),
      });
    }

    // OKX returns newest first; the last entry is the oldest.
    const oldest = Number(data.data[data.data.length - 1][0]);
    if (oldest >= after) break; // no forward progress
    after = oldest;

    await sleep(120);
  }

  all.sort((a, b) => a.openTime - b.openTime);
  return all.filter((c) => c.closeTime <= endTime);
}

export const _internal = { fetchJson, mapLimit, sleep, INTERVAL_MS };