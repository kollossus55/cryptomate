/**
 * Browser-side OKX market data.
 *
 * Replaces the Binance endpoints which are geo-blocked in the UK (HTTP 451).
 * OKX public market-data endpoints allow CORS and are reachable from the UK.
 * Output shapes are kept identical to the old Binance format so downstream
 * consumers are unchanged.
 */

const OKX = 'https://www.okx.com';

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

// OKX bar interval mapping (Binance-style -> OKX)
const OKX_BAR = {
  '1m': '1m', '3m': '3m', '5m': '5m', '15m': '15m', '30m': '30m',
  '1h': '1H', '2h': '2H', '4h': '4H', '6h': '6H', '12h': '12H', '1d': '1D',
};

/**
 * 24h ticker snapshot for all USDT pairs, filtered to the top-N by quote
 * volume. Same shape the server's fetchUniverse produces, so workers consume
 * it unchanged.
 */
export async function fetchTickerUniverse({ topN = 100, minQuoteVolume24h = 5_000_000 } = {}) {
  const data = await fetchJson(`${OKX}/api/v5/market/tickers?instType=SPOT`);
  if (!data || !Array.isArray(data.data)) throw new Error('OKX tickers malformed');

  return data.data
    .filter((t) => typeof t.instId === 'string' && t.instId.endsWith('-USDT'))
    .filter((t) => !/(UP|DOWN|BULL|BEAR)-USDT$/.test(t.instId))
    .filter((t) => !/^(USDC|FDUSD|TUSD|BUSD|DAI|EUR|GBP|AEUR)-USDT$/.test(t.instId))
    .map((t) => {
      const base = t.instId.replace(/-USDT$/, '');
      const last = parseFloat(t.last);
      const open24h = parseFloat(t.open24h);
      return {
        symbol: `${base}USDT`,
        base,
        price: last,
        change24h: open24h > 0 ? ((last - open24h) / open24h) * 100 : 0,
        quoteVolume24h: parseFloat(t.volCcy24h),
        high24h: parseFloat(t.high24h),
        low24h: parseFloat(t.low24h),
        trades24h: 0,
      };
    })
    .filter((t) => Number.isFinite(t.price) && t.price > 0)
    .filter((t) => t.quoteVolume24h >= minQuoteVolume24h)
    .sort((a, b) => b.quoteVolume24h - a.quoteVolume24h)
    .slice(0, topN);
}

/** Raw klines for one symbol (array of arrays, Binance-compatible shape). */
export async function fetchKlines(symbol, interval = '1h', limit = 201) {
  // symbol is Binance format (BTCUSDT); convert to OKX instId (BTC-USDT)
  const instId = symbol.endsWith('USDT') ? `${symbol.slice(0, -4)}-USDT` : symbol;
  const bar = OKX_BAR[interval] || '1H';
  const data = await fetchJson(`${OKX}/api/v5/market/candles?instId=${instId}&bar=${bar}&limit=${limit}`);
  if (!data || !Array.isArray(data.data)) return null;

  // OKX candles: [ts, o, h, l, c, vol, volCcy, volCcyQuote, confirm]
  // Map to Binance-compatible: [openTime, open, high, low, close, volume, closeTime, quoteVolume, trades]
  return data.data
    .map((c) => [
      parseInt(c[0]),  // openTime
      c[1],            // open
      c[2],            // high
      c[3],            // low
      c[4],            // close
      c[5],            // volume (base asset)
      parseInt(c[0]),  // closeTime
      c[7],            // quote volume
      0,               // trades count (not provided by OKX)
    ])
    .reverse(); // OKX returns newest-first; reverse to chronological order
}