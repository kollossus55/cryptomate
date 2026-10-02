// GENERATED FILE — DO NOT EDIT.
// Copied from /shared/trading by scripts/sync-shared.mjs.
// Synced: includes adx() and awesomeOscillator().
// Edit the source in /shared/trading and re-run: npm run sync:functions
/**
 * Technical indicators — computed on real OHLCV.
 *
 * Every function takes an array of closed candles
 * ({ open, high, low, close, volume }, oldest first) and returns either a
 * single current value or a full series.
 *
 * Fixes vs. the original implementation:
 *  - RSI used a simple average over one window; Wilder's RSI uses a smoothed
 *    average over the whole series. Different numbers, different signals.
 *  - MACD approximated its signal line as `macdLine * 0.9`, which made the
 *    histogram sign identical to the MACD sign — so MACD and EMA-cross were
 *    the same indicator counted twice. This uses a real 9-period EMA.
 *  - EMA seeded from prices[0]; seeding from an SMA of the first `period`
 *    values converges far faster on short series.
 *  - Heikin Ashi / SSL / money flow ran with high = low = close and no
 *    volume, which made them degenerate. They now use real H/L/V.
 */

const close = (c) => c.close;
const high = (c) => c.high;
const low = (c) => c.low;
const volume = (c) => c.volume;

function last(arr) {
  return arr.length ? arr[arr.length - 1] : undefined;
}

// ---------------------------------------------------------------------------
// Moving averages
// ---------------------------------------------------------------------------

export function sma(values, period) {
  if (values.length < period) return null;
  let sum = 0;
  for (let i = values.length - period; i < values.length; i++) sum += values[i];
  return sum / period;
}

/** Full EMA series, seeded with an SMA of the first `period` values. */
export function emaSeries(values, period) {
  if (values.length < period) return [];
  const k = 2 / (period + 1);
  const out = [];
  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i];
  let prev = seed / period;
  out.push(prev);
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

export function ema(values, period) {
  const series = emaSeries(values, period);
  return series.length ? last(series) : null;
}

// ---------------------------------------------------------------------------
// RSI (Wilder)
// ---------------------------------------------------------------------------

export function rsiSeries(candles, period = 14) {
  const prices = candles.map(close);
  if (prices.length < period + 1) return [];

  const out = [];
  let avgGain = 0;
  let avgLoss = 0;

  // Seed: simple average of the first `period` changes.
  for (let i = 1; i <= period; i++) {
    const diff = prices[i] - prices[i - 1];
    if (diff >= 0) avgGain += diff;
    else avgLoss -= diff;
  }
  avgGain /= period;
  avgLoss /= period;
  out.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));

  // Wilder smoothing for the rest.
  for (let i = period + 1; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  }
  return out;
}

export function rsi(candles, period = 14) {
  const series = rsiSeries(candles, period);
  return series.length ? last(series) : null;
}

// ---------------------------------------------------------------------------
// MACD — with a real signal line
// ---------------------------------------------------------------------------

export function macd(candles, fast = 12, slow = 26, signal = 9) {
  const prices = candles.map(close);
  if (prices.length < slow + signal) return null;

  const fastSeries = emaSeries(prices, fast);
  const slowSeries = emaSeries(prices, slow);

  // Align: the fast series starts earlier, so trim its head.
  const offset = fastSeries.length - slowSeries.length;
  const macdLine = slowSeries.map((s, i) => fastSeries[i + offset] - s);

  const signalSeries = emaSeries(macdLine, signal);
  if (!signalSeries.length) return null;

  const macdNow = last(macdLine);
  const signalNow = last(signalSeries);
  const histNow = macdNow - signalNow;

  // Previous histogram, for detecting a fresh crossover rather than a
  // state that has been true for fifty bars.
  const prevMacd = macdLine[macdLine.length - 2];
  const prevSignal = signalSeries[signalSeries.length - 2];
  const histPrev = prevMacd !== undefined && prevSignal !== undefined
    ? prevMacd - prevSignal
    : null;

  return {
    macd: macdNow,
    signal: signalNow,
    histogram: histNow,
    histogramPrev: histPrev,
    crossedUp: histPrev !== null && histPrev <= 0 && histNow > 0,
    crossedDown: histPrev !== null && histPrev >= 0 && histNow < 0,
  };
}

// ---------------------------------------------------------------------------
// Bollinger Bands
// ---------------------------------------------------------------------------

export function bollingerBands(candles, period = 20, multiplier = 2) {
  const prices = candles.map(close);
  if (prices.length < period) return null;

  const slice = prices.slice(-period);
  const middle = slice.reduce((a, b) => a + b, 0) / period;
  // Population stddev, matching the standard Bollinger definition.
  const variance = slice.reduce((acc, p) => acc + (p - middle) ** 2, 0) / period;
  const stdDev = Math.sqrt(variance);
  const upper = middle + stdDev * multiplier;
  const lower = middle - stdDev * multiplier;
  const price = last(prices);

  return {
    upper,
    middle,
    lower,
    stdDev,
    // Where price sits in the band: 0 = lower, 1 = upper.
    percentB: upper === lower ? 0.5 : (price - lower) / (upper - lower),
    // Band width relative to the mean — a squeeze/expansion measure.
    bandwidth: middle === 0 ? 0 : (upper - lower) / middle,
  };
}

// ---------------------------------------------------------------------------
// Stochastic — real highs and lows
// ---------------------------------------------------------------------------

export function stochastic(candles, kPeriod = 14, dPeriod = 3) {
  if (candles.length < kPeriod + dPeriod) return null;

  const kValues = [];
  for (let i = kPeriod - 1; i < candles.length; i++) {
    const window = candles.slice(i - kPeriod + 1, i + 1);
    const hh = Math.max(...window.map(high));
    const ll = Math.min(...window.map(low));
    const c = candles[i].close;
    kValues.push(hh === ll ? 50 : ((c - ll) / (hh - ll)) * 100);
  }

  const k = last(kValues);
  const d = sma(kValues, dPeriod);
  return { k, d: d ?? k };
}

// ---------------------------------------------------------------------------
// ATR — required for volatility-scaled position sizing and stops
// ---------------------------------------------------------------------------

export function atr(candles, period = 14) {
  if (candles.length < period + 1) return null;

  const trueRanges = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prevClose = candles[i - 1].close;
    trueRanges.push(Math.max(
      c.high - c.low,
      Math.abs(c.high - prevClose),
      Math.abs(c.low - prevClose)
    ));
  }

  // Wilder smoothing.
  let value = trueRanges.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trueRanges.length; i++) {
    value = (value * (period - 1) + trueRanges[i]) / period;
  }
  return value;
}

/** ATR as a fraction of price — comparable across assets. */
export function atrPercent(candles, period = 14) {
  const a = atr(candles, period);
  const price = last(candles)?.close;
  if (a === null || !price) return null;
  return a / price;
}

// ---------------------------------------------------------------------------
// Heikin Ashi — real OHLC
// ---------------------------------------------------------------------------

export function heikinAshi(candles) {
  if (candles.length < 2) return [];
  const out = [];
  let prevOpen = (candles[0].open + candles[0].close) / 2;
  let prevClose = (candles[0].open + candles[0].high + candles[0].low + candles[0].close) / 4;
  out.push({ open: prevOpen, close: prevClose, high: candles[0].high, low: candles[0].low });

  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const haClose = (c.open + c.high + c.low + c.close) / 4;
    const haOpen = (prevOpen + prevClose) / 2;
    out.push({
      open: haOpen,
      close: haClose,
      high: Math.max(c.high, haOpen, haClose),
      low: Math.min(c.low, haOpen, haClose),
    });
    prevOpen = haOpen;
    prevClose = haClose;
  }
  return out;
}

// ---------------------------------------------------------------------------
// SSL Channel — real high/low SMAs
// ---------------------------------------------------------------------------

export function sslChannel(candles, period = 9) {
  if (candles.length < period + 1) return null;

  let hlv = 0;
  for (let i = period; i < candles.length; i++) {
    const window = candles.slice(i - period + 1, i + 1);
    const smaHigh = window.reduce((a, c) => a + c.high, 0) / period;
    const smaLow = window.reduce((a, c) => a + c.low, 0) / period;
    const c = candles[i].close;
    if (c > smaHigh) hlv = 1;
    else if (c < smaLow) hlv = -1;
    // else: carry the previous state forward, which is the point of the channel
  }

  const window = candles.slice(-period);
  const smaHigh = window.reduce((a, c) => a + c.high, 0) / period;
  const smaLow = window.reduce((a, c) => a + c.low, 0) / period;

  return {
    hlv,
    bullish: hlv > 0,
    bearish: hlv < 0,
    sslUp: hlv < 0 ? smaHigh : smaLow,
    sslDown: hlv < 0 ? smaLow : smaHigh,
  };
}

// ---------------------------------------------------------------------------
// Money Flow Index — real volume
// ---------------------------------------------------------------------------

export function mfi(candles, period = 14) {
  if (candles.length < period + 1) return null;

  let positiveFlow = 0;
  let negativeFlow = 0;
  const typical = (c) => (c.high + c.low + c.close) / 3;

  for (let i = candles.length - period; i < candles.length; i++) {
    const tp = typical(candles[i]);
    const tpPrev = typical(candles[i - 1]);
    const rawFlow = tp * candles[i].volume;
    if (tp > tpPrev) positiveFlow += rawFlow;
    else if (tp < tpPrev) negativeFlow += rawFlow;
  }

  if (negativeFlow === 0) return positiveFlow === 0 ? 50 : 100;
  const ratio = positiveFlow / negativeFlow;
  return 100 - 100 / (1 + ratio);
}

// ---------------------------------------------------------------------------
// Chande Momentum Oscillator
// ---------------------------------------------------------------------------

export function cmo(candles, period = 14) {
  const prices = candles.map(close);
  if (prices.length < period + 1) return null;

  let up = 0;
  let down = 0;
  for (let i = prices.length - period; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) up += change;
    else down += Math.abs(change);
  }
  if (up + down === 0) return 0;
  return ((up - down) / (up + down)) * 100;
}

// ---------------------------------------------------------------------------
// True Momentum Oscillator (TMO)
// Compares each close to prior closes over a lookback, EMA-smooths the tally.
// ---------------------------------------------------------------------------

export function tmo(candles, length = 14, calcLength = 5, smoothLength = 3) {
  const prices = candles.map(close);
  const n = prices.length;
  if (n < length + 1) return null;

  // Raw TMO: for each bar, sum sign(close[i] - close[i - j]) over j = 1..length.
  const raw = [];
  for (let i = length; i < n; i++) {
    let sum = 0;
    for (let j = 1; j <= length; j++) {
      const cmpIdx = i - j;
      if (cmpIdx < 0) break;
      const diff = prices[i] - prices[cmpIdx];
      sum += diff > 0 ? 1 : diff < 0 ? -1 : 0;
    }
    raw.push(sum);
  }

  const emaArr = (arr, period) => {
    if (arr.length === 0) return [];
    if (arr.length < period) return arr.slice();
    const k = 2 / (period + 1);
    const seed = arr.slice(0, period).reduce((a, b) => a + b, 0) / period;
    const out = [seed];
    for (let i = period; i < arr.length; i++) out.push(arr[i] * k + out[out.length - 1] * (1 - k));
    return out;
  };

  const mainSeries = emaArr(raw, calcLength);
  const signalSeries = emaArr(mainSeries, smoothLength);
  const main = last(mainSeries);
  const signal = last(signalSeries);
  if (main === undefined || signal === undefined) return null;

  return {
    main,
    signal,
    bullish: main > signal && main > 0,
    bearish: main < signal && main < 0,
  };
}

// ---------------------------------------------------------------------------
// Trend strength (ADX) and the Awesome Oscillator
// ---------------------------------------------------------------------------

/**
 * Wilder's ADX with +DI / -DI.
 *
 * Directional movement and true range are smoothed with Wilder's running
 * average rather than a plain window mean, because that is the definition every
 * charting package uses — an ADX of 27 here should be the same 27 the user sees
 * on a chart.
 *
 * Returns { adx, adxPrev, plusDI, minusDI, trend }, or null on too few bars.
 * `trend` follows the Signal Indicators panel wording: >= 25 is a strong trend.
 */
export function adx(candles, period = 14) {
  if (!Array.isArray(candles) || candles.length < period * 2 + 1) return null;

  const tr = [];
  const plusDM = [];
  const minusDM = [];
  for (let i = 1; i < candles.length; i++) {
    const upMove = candles[i].high - candles[i - 1].high;
    const downMove = candles[i - 1].low - candles[i].low;
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
    const prevClose = candles[i - 1].close;
    tr.push(Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - prevClose),
      Math.abs(candles[i].low - prevClose),
    ));
  }

  let smoothTR = tr.slice(0, period).reduce((a, b) => a + b, 0);
  let smoothPlus = plusDM.slice(0, period).reduce((a, b) => a + b, 0);
  let smoothMinus = minusDM.slice(0, period).reduce((a, b) => a + b, 0);

  const dx = [];
  let plusDI = 0;
  let minusDI = 0;
  for (let i = period; i < tr.length; i++) {
    if (i > period) {
      smoothTR = smoothTR - smoothTR / period + tr[i];
      smoothPlus = smoothPlus - smoothPlus / period + plusDM[i];
      smoothMinus = smoothMinus - smoothMinus / period + minusDM[i];
    }
    plusDI = smoothTR === 0 ? 0 : (smoothPlus / smoothTR) * 100;
    minusDI = smoothTR === 0 ? 0 : (smoothMinus / smoothTR) * 100;
    const sum = plusDI + minusDI;
    dx.push(sum === 0 ? 0 : (Math.abs(plusDI - minusDI) / sum) * 100);
  }

  if (dx.length < period) return null;

  // ADX is itself a Wilder average of DX; keep the series so the caller can see
  // whether trend strength is building or fading.
  let value = dx.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const series = [value];
  for (let i = period; i < dx.length; i++) {
    value = (value * (period - 1) + dx[i]) / period;
    series.push(value);
  }

  const current = series[series.length - 1];
  const prev = series.length > 1 ? series[series.length - 2] : null;
  const trend = current >= 25
    ? (plusDI > minusDI ? 'strong_uptrend' : 'strong_downtrend')
    : 'weak_trend';

  return { adx: current, adxPrev: prev, plusDI, minusDI, trend };
}

/**
 * Awesome Oscillator — SMA5(median price) − SMA34(median price).
 *
 * The value is a price difference, so its magnitude only means something
 * relative to the asset's own price. Callers should read the sign, the slope
 * and zero-line crossings, which is what the indicator is used for.
 */
export function awesomeOscillator(candles, fast = 5, slow = 34) {
  if (!Array.isArray(candles) || candles.length < slow + 1) return null;

  const median = candles.map((c) => (c.high + c.low) / 2);
  const series = [];
  for (let i = slow - 1; i < median.length; i++) {
    let fastSum = 0;
    for (let j = i - fast + 1; j <= i; j++) fastSum += median[j];
    let slowSum = 0;
    for (let j = i - slow + 1; j <= i; j++) slowSum += median[j];
    series.push(fastSum / fast - slowSum / slow);
  }

  if (series.length < 2) return null;
  const value = last(series);
  const prev = series[series.length - 2];

  return {
    value,
    prev,
    rising: value > prev,
    // Fresh zero-line cross — the classic AO trigger.
    crossedUp: prev <= 0 && value > 0,
    crossedDown: prev >= 0 && value < 0,
  };
}

// ---------------------------------------------------------------------------
// Volume analysis — real relative volume
// ---------------------------------------------------------------------------

export function relativeVolume(candles, period = 20) {
  if (candles.length < period + 1) return null;
  const recent = last(candles).volume;
  const window = candles.slice(-period - 1, -1);
  const avg = window.reduce((a, c) => a + c.volume, 0) / window.length;
  return avg === 0 ? null : recent / avg;
}

// ---------------------------------------------------------------------------
// Returns / correlation — used to stop five positions being one bet
// ---------------------------------------------------------------------------

export function logReturns(candles) {
  const out = [];
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1].close;
    const curr = candles[i].close;
    if (prev > 0 && curr > 0) out.push(Math.log(curr / prev));
  }
  return out;
}

export function correlation(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 20) return null; // too short to mean anything

  const x = a.slice(-n);
  const y = b.slice(-n);
  const meanX = x.reduce((s, v) => s + v, 0) / n;
  const meanY = y.reduce((s, v) => s + v, 0) / n;

  let cov = 0, varX = 0, varY = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    cov += dx * dy;
    varX += dx * dx;
    varY += dy * dy;
  }
  if (varX === 0 || varY === 0) return null;
  return cov / Math.sqrt(varX * varY);
}

// ---------------------------------------------------------------------------
// Supply & Demand zones — consolidation bases preceding impulse moves
// ---------------------------------------------------------------------------

/**
 * Detect Supply & Demand zones from OHLCV.
 *
 * A demand zone is a tight consolidation (base) followed by a strong bullish
 * impulse; a supply zone is the mirror. The zone's price range is the base's
 * high–low. It stays "fresh" (unmitigated) until price revisits it.
 *
 * Returns the nearest unmitigated demand and supply zones relative to the
 * current price, plus all detected zones for inspection.
 */
export function supplyDemandZones(candles, opts = {}) {
  const n = candles.length;
  if (n < 30) return null;

  const baseMax = opts.baseMax ?? 4;
  const baseRangePct = opts.baseRangePct ?? 0.04;
  const impulseMinPct = opts.impulseMinPct ?? 0.02;
  const lookback = opts.lookback ?? 100;

  const price = candles[n - 1].close;
  const start = Math.max(0, n - lookback);
  const zones = [];

  for (let i = start; i < n - baseMax; i++) {
    for (let baseLen = 2; baseLen <= baseMax; baseLen++) {
      const baseEnd = i + baseLen - 1;
      if (baseEnd >= n - 1) continue;
      const base = candles.slice(i, i + baseLen);
      const baseHigh = Math.max(...base.map(high));
      const baseLow = Math.min(...base.map(low));
      const baseMid = (baseHigh + baseLow) / 2;
      if (baseMid === 0) continue;
      if ((baseHigh - baseLow) / baseMid > baseRangePct) continue;

      const impulse = candles[baseEnd + 1];
      const impulseMove = impulse.close - baseMid;
      const impulsePct = Math.abs(impulseMove) / baseMid;
      if (impulsePct < impulseMinPct) continue;

      const isDemand = impulseMove > 0;
      let mitigated = false;
      for (let j = baseEnd + 2; j < n; j++) {
        const c = candles[j];
        if (isDemand && c.low <= baseHigh) { mitigated = true; break; }
        if (!isDemand && c.high >= baseLow) { mitigated = true; break; }
      }
      zones.push({ type: isDemand ? 'demand' : 'supply', top: baseHigh, bottom: baseLow, index: i, impulsePct, mitigated });
      break;
    }
  }

  if (zones.length === 0) return null;

  const freshDemand = zones
    .filter((z) => z.type === 'demand' && !z.mitigated)
    .sort((a, b) => Math.abs(price - a.top) - Math.abs(price - b.top))[0];
  const freshSupply = zones
    .filter((z) => z.type === 'supply' && !z.mitigated)
    .sort((a, b) => Math.abs(price - a.bottom) - Math.abs(price - b.bottom))[0];

  return { zones, nearestDemand: freshDemand || null, nearestSupply: freshSupply || null, price };
}

export { last as _last };