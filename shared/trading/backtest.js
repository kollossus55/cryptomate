/**
 * Backtest engine — real candles, no look-ahead, costs on every fill.
 *
 * The old backtester (src/pages/Backtesting.jsx) drew every price from
 * Math.random(), including entry and exit independently — so a "trade" was two
 * unrelated random numbers subtracted from each other. It measured nothing, and
 * the UI described it as "realistic market simulation with slippage".
 *
 * This replays real historical bars through THE SAME scoreAsset() the live
 * worker uses. That matters more than it sounds: a backtest that re-implements
 * the strategy is testing the re-implementation, and the two drift apart within
 * weeks. Import, do not copy.
 *
 * Three properties that make a backtest honest, all enforced here:
 *
 *  1. NO LOOK-AHEAD. A signal computed from bars up to and including bar t
 *     fills at bar t+1's OPEN. Filling at bar t's close means trading on a
 *     price you could not have known when the signal fired — the single most
 *     common way a backtest manufactures returns that do not exist.
 *
 *  2. INTRABAR STOP PRIORITY. When a bar's range spans both stop and target,
 *     this assumes the STOP filled. Without OHLC tick data you cannot know
 *     which came first, and assuming the favourable one inflates results.
 *
 *  3. COSTS ON EVERY FILL. Fees and slippage, same model as live.
 */

import { scoreAsset, MIN_CANDLES } from './signalEngine.js';
import { applyCosts } from './costs.js';
import { atr } from './indicators.js';

/**
 * @param {Map<string, Array>} candlesBySymbol  real OHLCV, oldest first
 * @param {Object} config
 * @returns full result set with trades, equity curve and metrics
 */
export function runBacktest(candlesBySymbol, config = {}) {
  const {
    initialCapital = 10000,
    minStrength = 70,
    stopLossPercent = 3,
    takeProfitPercent = 8,
    maxPositions = 5,
    riskPerTradePercent = 1,
    maxPositionPercent = 10,
    useTrailingStop = false,
    trailingStopPercent = 2,
    exchange = 'binance',
    indicators = undefined,
    warmupBars = MIN_CANDLES,
  } = config;

  const symbols = [...candlesBySymbol.keys()];
  if (symbols.length === 0) {
    return { error: 'no_data', trades: [], metrics: null };
  }

  // Align every symbol onto a shared timeline of bar close times, so the
  // simulation advances in real time rather than by array index (symbols can
  // have gaps or different listing dates).
  const timeline = buildTimeline(candlesBySymbol);
  if (timeline.length < warmupBars + 10) {
    return { error: 'insufficient_history', barsAvailable: timeline.length, trades: [], metrics: null };
  }

  const indexBySymbol = new Map();
  for (const [symbol, candles] of candlesBySymbol.entries()) {
    const map = new Map();
    candles.forEach((c, i) => map.set(c.closeTime, i));
    indexBySymbol.set(symbol, map);
  }

  let cash = initialCapital;
  const positions = new Map();
  const trades = [];
  const equityCurve = [];
  let peakEquity = initialCapital;
  let maxDrawdown = 0;
  let totalFees = 0;

  // Signals fire on bar t and fill on bar t+1's open.
  let pendingEntries = [];

  for (let t = warmupBars; t < timeline.length - 1; t++) {
    const barTime = timeline[t];
    const nextBarTime = timeline[t + 1];

    // ---------------------------------------------------------------------
    // 1. Fill entries queued on the previous bar, at THIS bar's open
    // ---------------------------------------------------------------------
    for (const entry of pendingEntries) {
      if (positions.size >= maxPositions) break;
      if (positions.has(entry.symbol)) continue;

      const candles = candlesBySymbol.get(entry.symbol);
      const idx = indexBySymbol.get(entry.symbol).get(barTime);
      if (idx === undefined) continue;

      const fillBar = candles[idx];
      const intendedPrice = fillBar.open;

      const costs = applyCosts({
        side: 'buy',
        intendedPrice,
        quoteAmount: entry.quoteAmount,
        exchange,
        quoteVolume24h: fillBar.quoteVolume * 24,
        atrPercent: entry.atrPercent,
      });

      const totalDebit = entry.quoteAmount + costs.fee;
      if (totalDebit > cash) continue;

      const quantity = entry.quoteAmount / costs.fillPrice;
      cash -= totalDebit;
      totalFees += costs.fee;

      positions.set(entry.symbol, {
        symbol: entry.symbol,
        quantity,
        entryPrice: costs.fillPrice,
        entryTime: fillBar.openTime,
        entryFee: costs.fee,
        highestPrice: costs.fillPrice,
        trailingStop: null,
        strength: entry.strength,
        stopPrice: costs.fillPrice * (1 - stopLossPercent / 100),
        targetPrice: costs.fillPrice * (1 + takeProfitPercent / 100),
      });
    }
    pendingEntries = [];

    // ---------------------------------------------------------------------
    // 2. Manage open positions against THIS bar's range
    // ---------------------------------------------------------------------
    for (const [symbol, position] of [...positions.entries()]) {
      const candles = candlesBySymbol.get(symbol);
      const idx = indexBySymbol.get(symbol).get(barTime);
      if (idx === undefined) continue;

      const bar = candles[idx];
      let exitPrice = null;
      let exitReason = null;

      // Stop checked first. If the bar spans both levels we cannot know the
      // order without tick data, so we assume the unfavourable one filled.
      if (bar.low <= position.stopPrice) {
        exitPrice = position.stopPrice;
        exitReason = 'stop_loss';
      } else if (position.trailingStop && bar.low <= position.trailingStop) {
        exitPrice = position.trailingStop;
        exitReason = 'trailing_stop';
      } else if (bar.high >= position.targetPrice) {
        exitPrice = position.targetPrice;
        exitReason = 'take_profit';
      }

      if (exitPrice !== null) {
        const notional = position.quantity * exitPrice;
        const costs = applyCosts({
          side: 'sell',
          intendedPrice: exitPrice,
          quoteAmount: notional,
          exchange,
          quoteVolume24h: bar.quoteVolume * 24,
        });

        const proceeds = position.quantity * costs.fillPrice;
        const grossPnL = position.quantity * (costs.fillPrice - position.entryPrice);
        const netPnL = grossPnL - position.entryFee - costs.fee;

        cash += proceeds - costs.fee;
        totalFees += costs.fee;

        trades.push({
          symbol,
          entryTime: position.entryTime,
          exitTime: bar.closeTime,
          entryPrice: position.entryPrice,
          exitPrice: costs.fillPrice,
          quantity: position.quantity,
          grossPnL,
          netPnL,
          fees: position.entryFee + costs.fee,
          returnPercent: (grossPnL / (position.quantity * position.entryPrice)) * 100,
          netReturnPercent: (netPnL / (position.quantity * position.entryPrice)) * 100,
          exitReason,
          strength: position.strength,
          barsHeld: Math.round((bar.closeTime - position.entryTime) / (bar.closeTime - bar.openTime)),
        });

        positions.delete(symbol);
        continue;
      }

      // Trailing stop ratchets on the bar's high.
      if (useTrailingStop) {
        position.highestPrice = Math.max(position.highestPrice, bar.high);
        const newStop = position.highestPrice * (1 - trailingStopPercent / 100);
        if (position.trailingStop === null || newStop > position.trailingStop) {
          position.trailingStop = newStop;
        }
      }
    }

    // ---------------------------------------------------------------------
    // 3. Generate signals from bars up to and including t — queue for t+1
    // ---------------------------------------------------------------------
    if (positions.size < maxPositions) {
      const candidates = [];

      for (const symbol of symbols) {
        if (positions.has(symbol)) continue;
        const candles = candlesBySymbol.get(symbol);
        const idx = indexBySymbol.get(symbol).get(barTime);
        if (idx === undefined || idx < warmupBars) continue;

        // The critical slice. Only bars up to and including t are visible.
        const visible = candles.slice(0, idx + 1);
        const signal = scoreAsset(visible, { indicators });
        if (!signal) continue;

        if (signal.strength >= minStrength && signal.direction === 'bullish') {
          candidates.push({ symbol, signal, visible });
        }
      }

      candidates.sort((a, b) => b.signal.strength - a.signal.strength);

      const equity = calcEquity(cash, positions, candlesBySymbol, indexBySymbol, barTime);
      const slotsLeft = maxPositions - positions.size;

      for (const c of candidates.slice(0, slotsLeft)) {
        const atrValue = atr(c.visible);
        const price = c.visible[c.visible.length - 1].close;
        if (!atrValue || !price) continue;

        // Same ATR-based sizing as live.
        const stopDistancePercent = Math.max(
          stopLossPercent,
          Math.min((atrValue * 2 / price) * 100, 12)
        );
        const riskAmount = equity * (riskPerTradePercent / 100);
        let quoteAmount = riskAmount / (stopDistancePercent / 100);
        quoteAmount = Math.min(quoteAmount, equity * (maxPositionPercent / 100), cash * 0.95);

        if (quoteAmount < 10) continue;

        pendingEntries.push({
          symbol: c.symbol,
          quoteAmount,
          strength: c.signal.strength,
          atrPercent: c.signal.atrPercent,
        });
      }
    }

    // ---------------------------------------------------------------------
    // 4. Record equity
    // ---------------------------------------------------------------------
    const equity = calcEquity(cash, positions, candlesBySymbol, indexBySymbol, barTime);
    peakEquity = Math.max(peakEquity, equity);
    const drawdown = peakEquity > 0 ? ((peakEquity - equity) / peakEquity) * 100 : 0;
    maxDrawdown = Math.max(maxDrawdown, drawdown);

    equityCurve.push({
      time: barTime,
      date: new Date(barTime).toISOString(),
      equity: round2(equity),
      cash: round2(cash),
      openPositions: positions.size,
      drawdown: round2(drawdown),
    });
  }

  // Close anything still open, at the last bar's close.
  const finalTime = timeline[timeline.length - 1];
  for (const [symbol, position] of positions.entries()) {
    const candles = candlesBySymbol.get(symbol);
    const idx = indexBySymbol.get(symbol).get(finalTime);
    if (idx === undefined) continue;
    const bar = candles[idx];

    const costs = applyCosts({
      side: 'sell',
      intendedPrice: bar.close,
      quoteAmount: position.quantity * bar.close,
      exchange,
      quoteVolume24h: bar.quoteVolume * 24,
    });

    const grossPnL = position.quantity * (costs.fillPrice - position.entryPrice);
    const netPnL = grossPnL - position.entryFee - costs.fee;
    cash += position.quantity * costs.fillPrice - costs.fee;
    totalFees += costs.fee;

    trades.push({
      symbol,
      entryTime: position.entryTime,
      exitTime: bar.closeTime,
      entryPrice: position.entryPrice,
      exitPrice: costs.fillPrice,
      quantity: position.quantity,
      grossPnL,
      netPnL,
      fees: position.entryFee + costs.fee,
      returnPercent: (grossPnL / (position.quantity * position.entryPrice)) * 100,
      netReturnPercent: (netPnL / (position.quantity * position.entryPrice)) * 100,
      exitReason: 'end_of_backtest',
      strength: position.strength,
    });
  }
  positions.clear();

  const metrics = calculateMetrics({
    trades, equityCurve, initialCapital, finalCapital: cash, maxDrawdown, totalFees,
  });

  const benchmark = calculateBuyAndHold(candlesBySymbol, timeline, warmupBars, initialCapital);

  return { trades, equityCurve, metrics, benchmark, config, barsSimulated: timeline.length - warmupBars - 1 };
}

// ---------------------------------------------------------------------------

function buildTimeline(candlesBySymbol) {
  const times = new Set();
  for (const candles of candlesBySymbol.values()) {
    for (const c of candles) times.add(c.closeTime);
  }
  return [...times].sort((a, b) => a - b);
}

function calcEquity(cash, positions, candlesBySymbol, indexBySymbol, barTime) {
  let value = cash;
  for (const [symbol, position] of positions.entries()) {
    const idx = indexBySymbol.get(symbol)?.get(barTime);
    const candles = candlesBySymbol.get(symbol);
    const price = idx !== undefined ? candles[idx].close : position.entryPrice;
    value += position.quantity * price;
  }
  return value;
}

/**
 * Metrics.
 *
 * Sharpe is annualised from per-bar returns; the bars-per-year figure assumes
 * hourly data, so adjust it if you change the interval. Note that Sharpe on a
 * short sample is dominated by noise — under ~100 trades, treat every number
 * here as an estimate with very wide error bars, not a result.
 */
export function calculateMetrics({ trades, equityCurve, initialCapital, finalCapital, maxDrawdown, totalFees }) {
  const closed = trades.filter((t) => t.netPnL !== undefined);
  const wins = closed.filter((t) => t.netPnL > 0);
  const losses = closed.filter((t) => t.netPnL < 0);

  const grossProfit = wins.reduce((s, t) => s + t.netPnL, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.netPnL, 0));

  const returns = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const prev = equityCurve[i - 1].equity;
    if (prev > 0) returns.push((equityCurve[i].equity - prev) / prev);
  }

  const meanReturn = returns.length ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const variance = returns.length > 1
    ? returns.reduce((s, r) => s + (r - meanReturn) ** 2, 0) / (returns.length - 1)
    : 0;
  const stdDev = Math.sqrt(variance);

  const BARS_PER_YEAR = 24 * 365; // hourly
  const sharpe = stdDev > 0 ? (meanReturn / stdDev) * Math.sqrt(BARS_PER_YEAR) : 0;

  // Sortino: penalise downside deviation only.
  const downside = returns.filter((r) => r < 0);
  const downsideDev = downside.length
    ? Math.sqrt(downside.reduce((s, r) => s + r ** 2, 0) / downside.length)
    : 0;
  const sortino = downsideDev > 0 ? (meanReturn / downsideDev) * Math.sqrt(BARS_PER_YEAR) : 0;

  const totalReturn = ((finalCapital - initialCapital) / initialCapital) * 100;

  return {
    totalTrades: closed.length,
    winningTrades: wins.length,
    losingTrades: losses.length,
    winRate: closed.length ? (wins.length / closed.length) * 100 : 0,
    totalReturn,
    finalCapital: round2(finalCapital),
    grossProfit: round2(grossProfit),
    grossLoss: round2(grossLoss),
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : 0),
    avgWin: wins.length ? round2(grossProfit / wins.length) : 0,
    avgLoss: losses.length ? round2(grossLoss / losses.length) : 0,
    expectancy: closed.length ? round2((grossProfit - grossLoss) / closed.length) : 0,
    maxDrawdown: round2(maxDrawdown),
    sharpeRatio: round2(sharpe),
    sortinoRatio: round2(sortino),
    totalFees: round2(totalFees),
    // Fees as a share of gross P&L. If this is large, the strategy is a
    // fee-generation machine wearing a trading strategy's clothes.
    feeDragPercent: grossProfit > 0 ? round2((totalFees / grossProfit) * 100) : null,
    exitBreakdown: countBy(closed, (t) => t.exitReason),
    // Sample-size honesty flag, surfaced deliberately in the UI.
    statisticallyMeaningful: closed.length >= 100,
    sampleWarning: closed.length < 100
      ? `Only ${closed.length} trades. Under ~100, these metrics are dominated by noise and should not drive decisions.`
      : null,
  };
}

/**
 * Buy-and-hold benchmark.
 *
 * The honest comparison for any long-only crypto strategy. Beating cash is
 * easy in a bull market; beating an equal-weight hold of the same assets over
 * the same window is the actual bar, and most strategies do not clear it.
 */
function calculateBuyAndHold(candlesBySymbol, timeline, warmupBars, initialCapital) {
  const symbols = [...candlesBySymbol.keys()];
  const perSymbol = initialCapital / symbols.length;
  const startTime = timeline[warmupBars];
  const endTime = timeline[timeline.length - 1];

  let finalValue = 0;
  let counted = 0;

  for (const symbol of symbols) {
    const candles = candlesBySymbol.get(symbol);
    const startBar = candles.find((c) => c.closeTime >= startTime);
    const endBar = [...candles].reverse().find((c) => c.closeTime <= endTime);
    if (!startBar || !endBar || startBar.close <= 0) continue;
    finalValue += perSymbol * (endBar.close / startBar.close);
    counted++;
  }

  if (counted === 0) return null;
  const scaled = finalValue * (symbols.length / counted);

  return {
    finalValue: round2(scaled),
    totalReturn: round2(((scaled - initialCapital) / initialCapital) * 100),
    description: 'Equal-weight buy and hold of the same assets over the same window',
  };
}

function countBy(arr, fn) {
  const out = {};
  for (const item of arr) {
    const key = fn(item);
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Walk-forward split.
 *
 * Tune on `train`, then evaluate ONCE on `test`. If you tune, look at the test
 * result, adjust, and re-run — the test set is now training data too, and the
 * out-of-sample guarantee is gone. That loop is how overfitted strategies get
 * built with the best of intentions.
 */
export function splitTrainTest(candlesBySymbol, trainFraction = 0.7) {
  const train = new Map();
  const test = new Map();
  for (const [symbol, candles] of candlesBySymbol.entries()) {
    const cut = Math.floor(candles.length * trainFraction);
    train.set(symbol, candles.slice(0, cut));
    test.set(symbol, candles.slice(cut));
  }
  return { train, test };
}
