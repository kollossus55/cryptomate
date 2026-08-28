/**
 * Signal Engine — deterministic scoring on real market data.
 *
 * Two changes of substance from the original:
 *
 * 1. NO RANDOMNESS. The old engine scored on a Math.random() price walk and
 *    added a Math.random() "news sentiment" worth 30% of the composite. Run it
 *    twice on identical market data and you got different answers. This engine
 *    is a pure function of the candles: same input, same output, always.
 *
 * 2. HONEST NAMING. The old output was called "confidence" and rendered as a
 *    percentage, which reads as "this trade wins 72% of the time". It was a
 *    tally of hand-picked constants. This returns `strength` on a 0–100 scale
 *    with no percent sign, plus the component breakdown that produced it.
 *    See calibrate() at the bottom for turning it into a real probability.
 *
 * The weights below are still hand-chosen — I have not fitted them to data,
 * and neither had the original. They are a starting point to be replaced by
 * fitted values once you have a labelled trade history.
 */

import {
  rsi, macd, bollingerBands, stochastic, ema, atrPercent,
  heikinAshi, sslChannel, mfi, cmo, relativeVolume, _last as last,
} from './indicators.js';

/** Minimum closed bars before any score is meaningful. */
export const MIN_CANDLES = 60;

export const DEFAULT_WEIGHTS = {
  trend: 25,
  momentum: 20,
  meanReversion: 15,
  volume: 15,
  composite: 25,
};

export const DEFAULT_INDICATORS = {
  rsi: true,
  macd: true,
  bollinger: true,
  ema: true,
  stoch: true,
  sp500ai: false,
};

/**
 * Sentiment weight defaults to ZERO.
 *
 * The old engine weighted a random number at 30% of every score. Rather than
 * keep a fake, this takes an optional real provider. With no provider the
 * feature contributes nothing and is reported as unavailable — an absent
 * feature is better than a fabricated one.
 */
export const DEFAULT_SENTIMENT_WEIGHT = 0;

// ---------------------------------------------------------------------------

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

/** Map a value in [inLo, inHi] onto [outLo, outHi], clamped. */
function scale(v, inLo, inHi, outLo = 0, outHi = 100) {
  if (inHi === inLo) return (outLo + outHi) / 2;
  const t = clamp((v - inLo) / (inHi - inLo), 0, 1);
  return outLo + t * (outHi - outLo);
}

// ---------------------------------------------------------------------------
// Components — each returns 0–100, where 50 is neutral
// ---------------------------------------------------------------------------

function trendComponent(candles) {
  const prices = candles.map((c) => c.close);
  const price = last(prices);
  const ema20 = ema(prices, 20);
  const ema50 = ema(prices, 50);
  if (ema20 === null || ema50 === null) return null;

  let score = 50;
  const reasons = [];

  if (price > ema20 && ema20 > ema50) {
    score += 25;
    reasons.push('Price above rising 20/50 EMA stack');
  } else if (price < ema20 && ema20 < ema50) {
    score -= 25;
    reasons.push('Price below falling 20/50 EMA stack');
  } else if (price > ema50) {
    score += 8;
    reasons.push('Price above 50 EMA, short-term mixed');
  } else {
    score -= 8;
    reasons.push('Price below 50 EMA, short-term mixed');
  }

  // Separation matters: EMAs 0.05% apart is not a trend, it is noise.
  const separation = ema50 === 0 ? 0 : Math.abs(ema20 - ema50) / ema50;
  if (separation < 0.005) {
    score = 50 + (score - 50) * 0.4;
    reasons.push('EMAs tightly coiled — trend signal discounted');
  }

  return { score: clamp(score, 0, 100), reasons };
}

function momentumComponent(candles, enabled) {
  let score = 50;
  const reasons = [];
  let used = 0;

  if (enabled.macd) {
    const m = macd(candles);
    if (m) {
      used++;
      // A fresh crossover is worth more than a stale state.
      if (m.crossedUp) { score += 20; reasons.push('MACD crossed up (fresh)'); }
      else if (m.crossedDown) { score -= 20; reasons.push('MACD crossed down (fresh)'); }
      else if (m.histogram > 0) {
        const rising = m.histogramPrev !== null && m.histogram > m.histogramPrev;
        score += rising ? 12 : 6;
        reasons.push(rising ? 'MACD histogram positive and expanding' : 'MACD histogram positive but fading');
      } else {
        const falling = m.histogramPrev !== null && m.histogram < m.histogramPrev;
        score -= falling ? 12 : 6;
        reasons.push(falling ? 'MACD histogram negative and expanding' : 'MACD histogram negative but fading');
      }
    }
  }

  if (enabled.rsi) {
    const r = rsi(candles);
    if (r !== null) {
      used++;
      // Treat RSI as trend confirmation in the 40–60 band, and as a warning
      // at the extremes. Buying a 25 RSI outright is knife-catching.
      if (r > 70) { score -= 15; reasons.push(`RSI overbought (${r.toFixed(0)})`); }
      else if (r > 55) { score += 10; reasons.push(`RSI constructive (${r.toFixed(0)})`); }
      else if (r < 30) { score -= 10; reasons.push(`RSI oversold — falling knife risk (${r.toFixed(0)})`); }
      else if (r < 45) { score -= 5; reasons.push(`RSI soft (${r.toFixed(0)})`); }
    }
  }

  if (enabled.stoch) {
    const s = stochastic(candles);
    if (s) {
      used++;
      if (s.k > 80) { score -= 8; reasons.push('Stochastic overbought'); }
      else if (s.k < 20) { score -= 4; reasons.push('Stochastic oversold'); }
      else if (s.k > s.d) { score += 8; reasons.push('Stochastic %K above %D'); }
      else { score -= 4; reasons.push('Stochastic %K below %D'); }
    }
  }

  if (used === 0) return null;
  return { score: clamp(score, 0, 100), reasons };
}

function meanReversionComponent(candles, enabled) {
  if (!enabled.bollinger) return null;
  const bb = bollingerBands(candles);
  if (!bb) return null;

  let score = 50;
  const reasons = [];

  if (bb.percentB > 1) { score -= 15; reasons.push('Price above upper Bollinger band'); }
  else if (bb.percentB > 0.8) { score -= 5; reasons.push('Price in upper Bollinger zone'); }
  else if (bb.percentB < 0) { score -= 5; reasons.push('Price below lower band — momentum breakdown'); }
  else if (bb.percentB < 0.2) { score += 10; reasons.push('Price in lower Bollinger zone'); }
  else { score += 5; reasons.push('Price mid-band'); }

  // A squeeze precedes expansion but says nothing about direction, so it
  // only nudges the score toward neutral rather than up or down.
  if (bb.bandwidth < 0.04) {
    reasons.push('Bollinger squeeze — breakout pending, direction unknown');
    score = 50 + (score - 50) * 0.5;
  }

  return { score: clamp(score, 0, 100), reasons };
}

function volumeComponent(candles) {
  const rv = relativeVolume(candles);
  const m = mfi(candles);
  if (rv === null && m === null) return null;

  let score = 50;
  const reasons = [];

  if (rv !== null) {
    if (rv > 2) { score += 20; reasons.push(`Volume ${rv.toFixed(1)}x average`); }
    else if (rv > 1.3) { score += 10; reasons.push(`Volume ${rv.toFixed(1)}x average`); }
    else if (rv < 0.6) { score -= 15; reasons.push('Volume well below average — move unconfirmed'); }
  }

  if (m !== null) {
    if (m > 80) { score -= 10; reasons.push(`MFI overbought (${m.toFixed(0)})`); }
    else if (m > 55) { score += 10; reasons.push(`Money flow positive (${m.toFixed(0)})`); }
    else if (m < 20) { score -= 5; reasons.push(`MFI oversold (${m.toFixed(0)})`); }
    else if (m < 45) { score -= 10; reasons.push(`Money flow negative (${m.toFixed(0)})`); }
  }

  return { score: clamp(score, 0, 100), reasons };
}

/**
 * The SP500-AI-style composite, rebuilt on real data.
 *
 * The original ran with high = low = close and no volume, which made Heikin
 * Ashi, SSL and money flow degenerate — six "independent" confirmations that
 * were really one number viewed six ways. With real OHLCV they are genuinely
 * distinct, so agreement between them carries information.
 */
function compositeComponent(candles) {
  const ha = heikinAshi(candles);
  const ssl = sslChannel(candles);
  const c = cmo(candles);
  const m = mfi(candles);
  const r = rsi(candles);
  const mac = macd(candles);

  if (!ha.length || !ssl || c === null || m === null || r === null || !mac) return null;

  const haNow = last(ha);
  const votes = [
    { name: 'Heikin Ashi', bull: haNow.close > haNow.open },
    { name: 'SSL Channel', bull: ssl.bullish },
    { name: 'CMO', bull: c > 0 && c < 50 },
    { name: 'Money Flow', bull: m > 50 && m < 80 },
    { name: 'RSI', bull: r > 50 && r < 70 },
    { name: 'MACD', bull: mac.histogram > 0 },
  ];

  const bullCount = votes.filter((v) => v.bull).length;
  const reasons = [`Composite ${bullCount}/6 bullish: ${votes.filter((v) => v.bull).map((v) => v.name).join(', ') || 'none'}`];

  return {
    score: scale(bullCount, 0, 6, 5, 95),
    bullCount,
    votes,
    reasons,
  };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Score one asset.
 *
 * @param {Array} candles  Closed OHLCV candles, oldest first.
 * @param {Object} opts
 *   - indicators: which indicator families to enable
 *   - weights: component weights
 *   - sentiment: { score: -1..1, weight: 0..1 } from a REAL provider, optional
 *
 * @returns {Object|null} null when there is not enough data — callers must
 *   treat null as "no opinion, do not trade", never as a neutral score.
 */
export function scoreAsset(candles, opts = {}) {
  if (!Array.isArray(candles) || candles.length < MIN_CANDLES) {
    return null;
  }

  const indicators = { ...DEFAULT_INDICATORS, ...(opts.indicators || {}) };
  const weights = { ...DEFAULT_WEIGHTS, ...(opts.weights || {}) };

  const components = {
    trend: trendComponent(candles),
    momentum: momentumComponent(candles, indicators),
    meanReversion: meanReversionComponent(candles, indicators),
    volume: volumeComponent(candles),
    composite: indicators.sp500ai ? compositeComponent(candles) : null,
  };

  // Renormalise over the components that actually produced a value, so
  // disabling an indicator shifts weight to the others rather than silently
  // dragging every score toward zero.
  let weighted = 0;
  let totalWeight = 0;
  const reasons = [];

  for (const [name, comp] of Object.entries(components)) {
    if (!comp) continue;
    const w = weights[name] ?? 0;
    if (w <= 0) continue;
    weighted += comp.score * w;
    totalWeight += w;
    reasons.push(...comp.reasons);
  }

  if (totalWeight === 0) return null;

  let strength = weighted / totalWeight;

  // Optional real sentiment. No provider means no contribution.
  const sentimentWeight = opts.sentiment?.weight ?? DEFAULT_SENTIMENT_WEIGHT;
  let sentimentApplied = false;
  if (opts.sentiment && typeof opts.sentiment.score === 'number' && sentimentWeight > 0) {
    const sentimentScore = scale(opts.sentiment.score, -1, 1, 0, 100);
    strength = strength * (1 - sentimentWeight) + sentimentScore * sentimentWeight;
    sentimentApplied = true;
    reasons.push(`Sentiment ${opts.sentiment.score.toFixed(2)} (weight ${sentimentWeight})`);
  }

  const vol = atrPercent(candles);
  const price = last(candles).close;

  return {
    // 0–100. NOT a probability. See calibrate().
    strength: Math.round(clamp(strength, 0, 100)),
    direction: strength >= 55 ? 'bullish' : strength <= 45 ? 'bearish' : 'neutral',
    price,
    atrPercent: vol,
    components: Object.fromEntries(
      Object.entries(components).map(([k, v]) => [k, v ? Math.round(v.score) : null])
    ),
    reasons,
    sentimentApplied,
    // Provenance, so a stale or thin candle set is visible downstream.
    dataPoints: candles.length,
    lastBarClose: last(candles).closeTime,
  };
}

/**
 * Turn `strength` into a calibrated probability.
 *
 * This is a placeholder that returns null until you fit it. To make it real:
 *   1. Log every signal with its strength and the eventual outcome
 *      (1 if take-profit hit before stop-loss, 0 otherwise).
 *   2. Fit a logistic regression of outcome on strength.
 *   3. Check calibration on held-out data: of the signals you scored at 0.7,
 *      roughly 70% should have won. If not, the model is not calibrated and
 *      the number should not be shown as a probability.
 *
 * Until that exists, the UI must not render strength with a percent sign.
 */
export function calibrate(strength, model = null) {
  if (!model || typeof model.intercept !== 'number' || typeof model.slope !== 'number') {
    return null;
  }
  const z = model.intercept + model.slope * strength;
  return 1 / (1 + Math.exp(-z));
}
