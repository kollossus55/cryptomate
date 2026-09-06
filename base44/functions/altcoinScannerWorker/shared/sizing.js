// GENERATED FILE — DO NOT EDIT.
// Copied from /shared/trading by scripts/sync-shared.mjs.
// Edit the source in /shared/trading and re-run: npm run sync:functions
/**
 * Position sizing and portfolio exposure limits.
 *
 * The original sized every position identically:
 *   min(balance * max_position_size_percent, balance * 0.25)
 *
 * Two problems with that. First, a 3% stop on BTC and a 3% stop on a low-cap
 * alt get the same capital despite completely different odds of the stop being
 * hit by noise alone — on a quiet day, 3% is inside the daily range of a thin
 * alt. Second, nothing checked correlation, so five "different" positions in an
 * alt rally is one leveraged beta bet that unwinds together.
 *
 * This module fixes both: size by volatility so each position risks the same
 * fraction of equity, and cap exposure per correlation cluster.
 */

import { atr, correlation, logReturns } from './indicators.js';

/**
 * Risk-based position size.
 *
 * The principle: decide what fraction of equity you are willing to lose if the
 * stop is hit, then work backwards to a position size. A wide stop gets a small
 * position, a tight stop gets a larger one, and each trade risks the same
 * amount. That is what makes the win rate and the average loss comparable
 * across assets.
 *
 * @returns { quoteAmount, quantity, stopPrice, riskAmount, stopDistancePercent, reason }
 *   quoteAmount 0 means do not trade, with `reason` explaining why.
 */
export function calculatePositionSize({
  equity,
  availableBalance,
  price,
  candles,
  riskPerTradePercent = 1,
  atrMultiplier = 2,
  maxPositionPercent = 10,
  minStopPercent = 1.5,
  maxStopPercent = 12,
  minOrderValue = 10,
}) {
  const atrValue = atr(candles);
  if (atrValue === null || !price || price <= 0) {
    return { quoteAmount: 0, reason: 'insufficient_data_for_atr' };
  }

  // Stop distance from volatility, then clamped. The clamps stop a dead-quiet
  // asset getting an absurdly tight stop that noise trips instantly, and a
  // wildly volatile one getting a stop so wide the position becomes tiny.
  let stopDistance = atrValue * atrMultiplier;
  let stopDistancePercent = (stopDistance / price) * 100;

  if (stopDistancePercent < minStopPercent) {
    stopDistancePercent = minStopPercent;
    stopDistance = price * (minStopPercent / 100);
  } else if (stopDistancePercent > maxStopPercent) {
    // Too volatile to size sensibly — skipping beats holding a position whose
    // stop is so wide that hitting it blows the daily loss limit on its own.
    return {
      quoteAmount: 0,
      reason: 'volatility_too_high',
      stopDistancePercent,
    };
  }

  const riskAmount = equity * (riskPerTradePercent / 100);
  let quoteAmount = riskAmount / (stopDistancePercent / 100);

  // Hard caps: never let volatility sizing produce a concentrated position.
  const maxByPercent = equity * (maxPositionPercent / 100);
  quoteAmount = Math.min(quoteAmount, maxByPercent, availableBalance);

  if (quoteAmount < minOrderValue) {
    return { quoteAmount: 0, reason: 'below_min_order_value', stopDistancePercent };
  }

  return {
    quoteAmount,
    quantity: quoteAmount / price,
    stopPrice: price - stopDistance,
    stopDistancePercent,
    riskAmount: quoteAmount * (stopDistancePercent / 100),
    atrValue,
    reason: 'ok',
  };
}

/**
 * Correlation gate.
 *
 * Rejects a candidate that moves too closely with something already held.
 * Without this, "five positions, max 10% each" can be 50% of the book in one
 * risk factor — and when it turns, all five stops fire in the same run, which
 * is precisely the scenario the daily-loss breaker is supposed to catch.
 *
 * @param candidateReturns  log returns for the candidate
 * @param heldReturns       Map of symbol -> log returns for open positions
 */
export function checkCorrelation(candidateReturns, heldReturns, { maxCorrelation = 0.8 } = {}) {
  const correlations = [];

  for (const [symbol, returns] of heldReturns.entries()) {
    const c = correlation(candidateReturns, returns);
    if (c === null) continue;
    correlations.push({ symbol, correlation: c });
  }

  const breaches = correlations.filter((c) => Math.abs(c.correlation) > maxCorrelation);

  return {
    allowed: breaches.length === 0,
    correlations: correlations.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation)),
    breaches,
    reason: breaches.length
      ? `correlated_with_${breaches.map((b) => b.symbol).join('_')}`
      : 'ok',
  };
}

/** Build the returns map for currently held positions. */
export function buildReturnsMap(candlesBySymbol) {
  const map = new Map();
  for (const [symbol, candles] of candlesBySymbol.entries()) {
    if (candles && candles.length > 25) map.set(symbol, logReturns(candles));
  }
  return map;
}

/**
 * Portfolio-level exposure check, run before opening anything.
 *
 * Gross exposure is capped separately from position count because five 10%
 * positions and ten 5% positions carry the same market risk, and only the
 * former is caught by a position-count limit.
 */
export function checkPortfolioExposure({
  positions,
  equity,
  newPositionValue,
  maxGrossExposurePercent = 60,
  maxPositions = 5,
}) {
  const currentExposure = positions.reduce((sum, p) => sum + (p.current_value || 0), 0);
  const projected = currentExposure + newPositionValue;
  const projectedPercent = equity > 0 ? (projected / equity) * 100 : 100;

  if (positions.length >= maxPositions) {
    return { allowed: false, reason: 'max_positions_reached', projectedPercent };
  }
  if (projectedPercent > maxGrossExposurePercent) {
    return { allowed: false, reason: 'max_gross_exposure_reached', projectedPercent };
  }
  return { allowed: true, reason: 'ok', projectedPercent };
}
