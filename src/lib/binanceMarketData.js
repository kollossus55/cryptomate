/**
 * Browser-side Binance market data.
 *
 * The server's egress region is geo-blocked by Binance (HTTP 451), so the
 * browser fetches the universe + klines and hands them to the server workers
 * for scoring/execution. Public Binance market-data endpoints allow CORS.
 *
 * One 24h-ticker call returns every symbol — no per-symbol requests for the
 * universe. Klines are fetched only for a small bounded set of candidates.
 */

const BINANCE = 'https://api.binance.com';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url, { timeoutMs = 10000, retries = 2 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
      clearTimeout(timer);
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

/**
 * 24h ticker snapshot for all USDT pairs, filtered to the top-N by quote
 * volume. Same shape the server's fetchUniverse produces, so workers consume
 * it unchanged.
 */
export async function fetchTickerUniverse({ topN = 100, minQuoteVolume24h = 5_000_000 } = {}) {
  const tickers = await fetchJson(`${BINANCE}/api/v3/ticker/24hr`);
  return tickers
    .filter((t) => typeof t.symbol === 'string' && t.symbol.endsWith('USDT'))
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
    .filter((t) => t.quoteVolume24h >= minQuoteVolume24h)
    .sort((a, b) => b.quoteVolume24h - a.quoteVolume24h)
    .slice(0, topN);
}

/** Raw Binance klines for one symbol (array of arrays). */
export async function fetchKlines(symbol, interval = '1h', limit = 201) {
  const raw = await fetchJson(`${BINANCE}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
  return Array.isArray(raw) ? raw : null;
}