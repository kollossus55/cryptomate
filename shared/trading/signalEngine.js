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
  heikinAshi, sslChannel, mfi, cmo, tmo, relativeVolume, supplyDemandZones, _last as last,
} from './indicators.js';

/** Minimum closed bars before any score is meaningful. */
export const MIN_CANDLES = 60;

export const DEFAULT_WEIGHTS = {
  trend: 25,
  momentum: 20,
  meanReversion: 15,
  volume: 15,
  supplyDemand: 10,
  composite: 15,
};

export const DEFAULT_INDICATORS = {
  rsi: true,
  macd: true,
  bollinger: true,
  ema: true,
  stoch: true,
  supply_demand: false,
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

/**
 * Market regime.
 *
 * Computed FIRST, because every oscillator below means something different
 * depending on it. RSI 75 in an established uptrend is confirmation that the
 * trend is intact; RSI 75 in a range is a fade signal. The previous version
 * ignored this and applied the range interpretation everywhere, so a textbook
 * uptrend collected penalties from RSI, Stochastic, MFI and Bollinger at once
 * and the score never rose above ~56 in any market condition.
 *
 * Returns 'uptrend' | 'downtrend' | 'range' plus a 0-1 conviction figure used
 * to blend between the trend-following and mean-reverting readings, so scores
 * do not jump discontinuously as the regime flips.
 */
function detectRegime(candles) {
  const prices = candles.map((c) => c.close);
  const price = last(prices);
  const ema20 = ema(prices, 20);
  const ema50 = ema(prices, 50);
  if (ema20 === null || ema50 === null) return { regime: 'range', conviction: 0 };

  const separation = ema50 === 0 ? 0 : (ema20 - ema50) / ema50;
  const absSep = Math.abs(separation);

  // Below 0.3% apart the EMAs are noise, not a trend. Above ~3% the trend is
  // unambiguous. In between, conviction scales linearly.
  const conviction = clamp((absSep - 0.003) / (0.03 - 0.003), 0, 1);

  let regime = 'range';
  if (conviction > 0 && separation > 0 && price > ema50) regime = 'uptrend';
  else if (conviction > 0 && separation < 0 && price < ema50) regime = 'downtrend';

  return { regime, conviction, ema20, ema50, separation };
}

function trendComponent(candles, ctx) {
  const prices = candles.map((c) => c.close);
  const price = last(prices);
  const { ema20, ema50, conviction, regime } = ctx;
  if (ema20 === null || ema50 === null) return null;

  let score = 50;
  const reasons = [];

  // Full EMA stack alignment is the strongest single piece of evidence a
  // trend-following strategy has, so it carries the most weight here.
  if (price > ema20 && ema20 > ema50) {
    score += 30;
    reasons.push('Price above 20 EMA above 50 EMA — full bullish alignment');
  } else if (price < ema20 && ema20 < ema50) {
    score -= 30;
    reasons.push('Price below 20 EMA below 50 EMA — full bearish alignment');
  } else if (price > ema50) {
    score += 10;
    reasons.push('Price above 50 EMA, short term mixed');
  } else {
    score -= 10;
    reasons.push('Price below 50 EMA, short term mixed');
  }

  // Reward the trend in proportion to how established it is.
  if (regime === 'uptrend') {
    score += 10 * conviction;
    reasons.push(`Uptrend conviction ${(conviction * 100).toFixed(0)}%`);
  } else if (regime === 'downtrend') {
    score -= 10 * conviction;
    reasons.push(`Downtrend conviction ${(conviction * 100).toFixed(0)}%`);
  } else {
    // In a range, pull toward neutral instead of scoring a direction.
    score = 50 + (score - 50) * 0.4;
    reasons.push('No established trend — directional signal discounted');
  }

  return { score: clamp(score, 0, 100), reasons };
}

function momentumComponent(candles, enabled, ctx) {
  const { regime, conviction } = ctx;
  let score = 50;
  const reasons = [];
  let used = 0;

  if (enabled.macd) {
    const m = macd(candles);
    if (m) {
      used++;
      if (m.crossedUp) { score += 22; reasons.push('MACD crossed up (fresh)'); }
      else if (m.crossedDown) { score -= 22; reasons.push('MACD crossed down (fresh)'); }
      else if (m.histogram > 0) {
        const rising = m.histogramPrev !== null && m.histogram > m.histogramPrev;
        score += rising ? 16 : 9;
        reasons.push(rising ? 'MACD histogram positive and expanding' : 'MACD histogram positive');
      } else {
        const falling = m.histogramPrev !== null && m.histogram < m.histogramPrev;
        score -= falling ? 16 : 9;
        reasons.push(falling ? 'MACD histogram negative and expanding' : 'MACD histogram negative');
      }
    }
  }

  if (enabled.rsi) {
    const r = rsi(candles);
    if (r !== null) {
      used++;
      // Trend reading: high RSI confirms. Range reading: high RSI fades.
      // Blend by conviction so the transition is smooth.
      let trendView;
      if (r >= 80) trendView = 6;        // extended, but still an uptrend
      else if (r >= 60) trendView = 20;  // the sweet spot for momentum entries
      else if (r >= 50) trendView = 12;
      else if (r >= 40) trendView = -6;
      else trendView = -16;              // momentum has left

      let rangeView;
      if (r >= 70) rangeView = -18;
      else if (r >= 55) rangeView = 4;
      else if (r >= 45) rangeView = 0;
      else if (r >= 30) rangeView = 8;
      else rangeView = 14;               // oversold bounce candidate in a range

      const w = regime === 'uptrend' ? conviction : regime === 'downtrend' ? conviction : 0;
      const blended = regime === 'downtrend'
        ? -Math.abs(trendView) * w + rangeView * (1 - w)
        : trendView * w + rangeView * (1 - w);

      score += blended;
      reasons.push(`RSI ${r.toFixed(0)} (${regime})`);
    }
  }

  if (enabled.stoch) {
    const s = stochastic(candles);
    if (s) {
      used++;
      if (regime === 'uptrend') {
        // In an uptrend, %K above %D is the signal. High absolute readings are
        // normal and are NOT penalised — that was the old bug.
        if (s.k > s.d) { score += 10; reasons.push('Stochastic %K above %D'); }
        else { score -= 6; reasons.push('Stochastic %K below %D'); }
        if (s.k > 95) { score -= 4; reasons.push('Stochastic extremely extended'); }
      } else {
        if (s.k > 80) { score -= 10; reasons.push('Stochastic overbought in range'); }
        else if (s.k < 20) { score += 8; reasons.push('Stochastic oversold in range'); }
        else if (s.k > s.d) { score += 6; reasons.push('Stochastic %K above %D'); }
        else { score -= 4; reasons.push('Stochastic %K below %D'); }
      }
    }
  }

  if (used === 0) return null;
  return { score: clamp(score, 0, 100), reasons };
}

/**
 * Bollinger position.
 *
 * In a trend, price riding the upper band is strength — that is what "walking
 * the band" means, and fading it is how trend-followers lose money. Only
 * genuine over-extension (well outside the band) is penalised.
 */
function meanReversionComponent(candles, enabled, ctx) {
  if (!enabled.bollinger) return null;
  const bb = bollingerBands(candles);
  if (!bb) return null;

  const { regime, conviction } = ctx;
  let score = 50;
  const reasons = [];

  if (regime === 'uptrend') {
    if (bb.percentB > 1.15) {
      score -= 12;
      reasons.push('Price far outside upper band — over-extended');
    } else if (bb.percentB > 0.75) {
      score += 18;
      reasons.push('Price riding the upper band — trend strength');
    } else if (bb.percentB > 0.45) {
      score += 10;
      reasons.push('Price in upper half of the band');
    } else if (bb.percentB > 0.15) {
      score += 4;
      reasons.push('Pullback toward the middle band');
    } else {
      score -= 10;
      reasons.push('Price at the lower band despite uptrend — trend weakening');
    }
  } else {
    if (bb.percentB > 1) { score -= 16; reasons.push('Price above upper band'); }
    else if (bb.percentB > 0.8) { score -= 6; reasons.push('Price in upper band zone'); }
    else if (bb.percentB < 0) { score -= 4; reasons.push('Price below lower band — breakdown'); }
    else if (bb.percentB < 0.2) { score += 12; reasons.push('Price in lower band zone'); }
    else { score += 4; reasons.push('Price mid-band'); }
  }

  // A squeeze signals an imminent expansion but says nothing about direction,
  // so it damps the score toward neutral rather than moving it either way.
  if (bb.bandwidth < 0.04) {
    score = 50 + (score - 50) * 0.6;
    reasons.push('Bollinger squeeze — breakout pending, direction unknown');
  }

  return { score: clamp(score, 0, 100), reasons };
}

function volumeComponent(candles, ctx) {
  const rv = relativeVolume(candles);
  const m = mfi(candles);
  if (rv === null && m === null) return null;

  const { regime } = ctx;
  let score = 50;
  const reasons = [];

  if (rv !== null) {
    if (rv > 2) { score += 22; reasons.push(`Volume ${rv.toFixed(1)}x average`); }
    else if (rv > 1.3) { score += 13; reasons.push(`Volume ${rv.toFixed(1)}x average`); }
    else if (rv > 0.85) { score += 4; reasons.push('Volume around average'); }
    else if (rv < 0.6) { score -= 12; reasons.push('Volume well below average — move unconfirmed'); }
  }

  if (m !== null) {
    if (regime === 'uptrend') {
      // Strong money flow in an uptrend is confirmation. The old version
      // penalised MFI above 80 here, punishing exactly the condition a
      // momentum strategy wants to see.
      if (m > 90) { score -= 4; reasons.push(`MFI ${m.toFixed(0)} — extremely extended`); }
      else if (m > 55) { score += 16; reasons.push(`Strong money flow (${m.toFixed(0)})`); }
      else if (m > 45) { score += 4; reasons.push(`Neutral money flow (${m.toFixed(0)})`); }
      else { score -= 12; reasons.push(`Money flow negative despite uptrend (${m.toFixed(0)})`); }
    } else {
      if (m > 80) { score -= 10; reasons.push(`MFI overbought (${m.toFixed(0)})`); }
      else if (m > 55) { score += 10; reasons.push(`Money flow positive (${m.toFixed(0)})`); }
      else if (m < 20) { score += 6; reasons.push(`MFI oversold (${m.toFixed(0)})`); }
      else if (m < 45) { score -= 10; reasons.push(`Money flow negative (${m.toFixed(0)})`); }
    }
  }

  return { score: clamp(score, 0, 100), reasons };
}

/**
 * SP500-AI-style composite, rebuilt on real OHLCV.
 *
 * The vote conditions were previously written as bounded windows — CMO between
 * 0 and 50, RSI between 50 and 70, MFI between 50 and 80. In a strong uptrend
 * all three exceed their upper bounds and register as NOT bullish, so the
 * composite scored a powerful trend as bearish. Votes are now directional:
 * above the midpoint is bullish, with only genuine exhaustion excluded.
 */
function compositeComponent(candles) {
  const ha = heikinAshi(candles);
  const ssl = sslChannel(candles);
  const c = cmo(candles);
  const t = tmo(candles);
  const m = mfi(candles);
  const r = rsi(candles);
  const mac = macd(candles);

  if (!ha.length || !ssl || c === null || !t || m === null || r === null || !mac) return null;

  const haNow = last(ha);
  const votes = [
    { name: 'Heikin Ashi', bull: haNow.close > haNow.open },
    { name: 'SSL Channel', bull: ssl.bullish },
    { name: 'TMO', bull: t.bullish },
    { name: 'CMO', bull: c > 0 },
    { name: 'Money Flow', bull: m > 50 && m <= 95 },
    { name: 'RSI', bull: r > 50 && r <= 90 },
    { name: 'MACD', bull: mac.histogram > 0 },
  ];

  const bullCount = votes.filter((v) => v.bull).length;
  const bullNames = votes.filter((v) => v.bull).map((v) => v.name).join(', ') || 'none';

  return {
    score: scale(bullCount, 0, votes.length, 5, 95),
    bullCount,
    votes,
    reasons: [`Composite ${bullCount}/${votes.length} bullish: ${bullNames}`],
  };
}

/**
 * Supply & Demand zones — price-level confluence.
 *
 * Scores based on how price relates to the nearest unmitigated zones:
 *  - Bouncing up from a fresh demand zone → bullish.
 *  - Rejected down from a fresh supply zone → bullish (overhead supply held).
 *  - Pressing into fresh supply → bearish (overhead resistance).
 *  - Breaking down through fresh demand → bearish (support lost).
 *
 * Confluence contributor: only moves the score when price is near a zone
 * (within ~2 ATR). No zone nearby → returns null (no contribution).
 */
function supplyDemandComponent(candles, ctx) {
  const sd = supplyDemandZones(candles);
  if (!sd) return null;

  const { nearestDemand, nearestSupply, price } = sd;
  if (!nearestDemand && !nearestSupply) return null;

  const vol = atrPercent(candles) ?? 0.02;
  const proximity = 2 * vol;

  let score = 50;
  const reasons = [];

  if (nearestDemand) {
    const dist = (price - nearestDemand.top) / price;
    const distAtr = Math.abs(dist) / vol;
    if (distAtr <= proximity) {
      if (dist >= 0 && dist < vol) {
        score += 18;
        reasons.push('Price bouncing off unmitigated demand zone');
      } else if (dist < 0) {
        score -= 16;
        reasons.push('Price below unmitigated demand zone — support broken');
      }
    }
  }

  if (nearestSupply) {
    const dist = (price - nearestSupply.bottom) / price;
    const distAtr = Math.abs(dist) / vol;
    if (distAtr <= proximity) {
      if (dist <= 0 && dist > -vol) {
        score += 14;
        reasons.push('Price rejected from unmitigated supply zone');
      } else if (dist > 0) {
        score += 8;
        reasons.push('Price above unmitigated supply zone — resistance broken');
      }
    }
  }

  if (reasons.length === 0) return null;
  return { score: clamp(score, 0, 100), reasons };
}

export function scoreAsset(candles, opts = {}) {
  if (!Array.isArray(candles) || candles.length < MIN_CANDLES) {
    return null;
  }

  const indicators = { ...DEFAULT_INDICATORS, ...(opts.indicators || {}) };
  const weights = { ...DEFAULT_WEIGHTS, ...(opts.weights || {}) };

  // Gate every component by its underlying indicator toggles, so that when
  // the user enables only SP500 AI, the score is driven solely by the composite
  // — not by trend/volume components that would otherwise run unconditionally.
  const classicOn = !!(indicators.rsi || indicators.macd || indicators.bollinger || indicators.ema || indicators.stoch);

  // Regime is computed once and shared, because every oscillator below is
  // interpreted differently in a trend than in a range.
  const ctx = detectRegime(candles);

  const components = {
    trend: indicators.ema ? trendComponent(candles, ctx) : null,
    momentum: momentumComponent(candles, indicators, ctx),
    meanReversion: meanReversionComponent(candles, indicators, ctx),
    volume: classicOn ? volumeComponent(candles, ctx) : null,
    supplyDemand: indicators.supply_demand ? supplyDemandComponent(candles, ctx) : null,
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
    regime: ctx.regime,
    regimeConviction: Math.round((ctx.conviction ?? 0) * 100) / 100,
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