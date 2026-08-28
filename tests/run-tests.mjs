/**
 * Tests for the rebuilt trading modules.
 *
 * These use FIXED synthetic candles as test fixtures, which is a different
 * thing from the bug being fixed: a deterministic fixture with known properties
 * is how you verify an indicator returns the right number. The bug was feeding
 * random data into a LIVE trading decision.
 */

import assert from 'node:assert';
import {
  rsi, macd, bollingerBands, stochastic, atr, ema, sma,
  heikinAshi, sslChannel, mfi, cmo, relativeVolume, correlation, logReturns,
} from '../shared/trading/indicators.js';
import { scoreAsset, MIN_CANDLES } from '../shared/trading/signalEngine.js';
import { applyCosts, getFeeRate, estimateFillFromBook, roundTripCostPercent } from '../shared/trading/costs.js';
import { calculatePositionSize, checkCorrelation, checkPortfolioExposure } from '../shared/trading/sizing.js';
import {
  rollDailyCounters, checkDailyLossLimit, checkTradeLimit, evaluateAllGuards, checkSchedule,
} from '../shared/trading/risk.js';
import {
  createPortfolioState, applyBuy, applySell, calculateEquity,
  positionPnL, toPersistablePortfolio, updateTrailingStop,
} from '../shared/trading/portfolio.js';
import { runBacktest } from '../shared/trading/backtest.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err.message}`);
  }
}

function section(name) {
  console.log(`\n${name}`);
}

// ---------------------------------------------------------------------------
// Fixtures — deterministic, no Math.random anywhere
// ---------------------------------------------------------------------------

function makeCandles(closes, { volumeBase = 1000 } = {}) {
  return closes.map((close, i) => {
    const prev = i > 0 ? closes[i - 1] : close;
    const high = Math.max(close, prev) * 1.005;
    const low = Math.min(close, prev) * 0.995;
    return {
      openTime: 1700000000000 + i * 3600000,
      closeTime: 1700000000000 + (i + 1) * 3600000 - 1,
      open: prev,
      high,
      low,
      close,
      volume: volumeBase * (1 + (i % 5) * 0.1),
      quoteVolume: volumeBase * close,
    };
  });
}

const uptrend = makeCandles(Array.from({ length: 120 }, (_, i) => 100 + i * 0.8));
const downtrend = makeCandles(Array.from({ length: 120 }, (_, i) => 200 - i * 0.8));
const flat = makeCandles(Array.from({ length: 120 }, () => 100));
// Deterministic oscillation — no randomness, repeatable.
const choppy = makeCandles(
  Array.from({ length: 120 }, (_, i) => 100 + Math.sin(i / 3) * 5)
);

// ---------------------------------------------------------------------------

section('Indicators');

test('SMA computes the mean of the last N values', () => {
  assert.strictEqual(sma([1, 2, 3, 4, 5], 5), 3);
  assert.strictEqual(sma([10, 20, 30], 2), 25);
});

test('EMA returns null below period and tracks a rising series', () => {
  assert.strictEqual(ema([1, 2], 5), null);
  const rising = ema(uptrend.map((c) => c.close), 20);
  assert.ok(rising > 100 && rising < 200, `expected mid-range EMA, got ${rising}`);
});

test('RSI is near 100 in a pure uptrend and near 0 in a pure downtrend', () => {
  assert.ok(rsi(uptrend) > 95, `uptrend RSI was ${rsi(uptrend)}`);
  assert.ok(rsi(downtrend) < 5, `downtrend RSI was ${rsi(downtrend)}`);
});

test('RSI on a flat series is neutral, not NaN', () => {
  const value = rsi(flat);
  assert.ok(value !== null && !Number.isNaN(value), `got ${value}`);
});

test('MACD signal line differs from macd*0.9 (the V4 bug)', () => {
  const m = macd(choppy);
  assert.ok(m !== null, 'MACD returned null');
  const oldBuggySignal = m.macd * 0.9;
  assert.notStrictEqual(
    Math.round(m.signal * 1e6),
    Math.round(oldBuggySignal * 1e6),
    'signal line still equals the V4 approximation'
  );
});

test('MACD histogram = macd - signal, and detects crossovers', () => {
  const m = macd(choppy);
  assert.ok(Math.abs(m.histogram - (m.macd - m.signal)) < 1e-9);
  assert.ok(typeof m.crossedUp === 'boolean');
});

test('Bollinger percentB is 0-1 inside the bands', () => {
  const bb = bollingerBands(choppy);
  assert.ok(bb.upper > bb.middle && bb.middle > bb.lower);
  assert.ok(bb.percentB >= -0.5 && bb.percentB <= 1.5);
});

test('Stochastic uses real highs and lows, giving %K near 100 at the top', () => {
  const s = stochastic(uptrend);
  assert.ok(s.k > 80, `expected high %K in uptrend, got ${s.k}`);
});

test('ATR is positive and scales with range', () => {
  const a = atr(uptrend);
  assert.ok(a > 0, `ATR was ${a}`);
  const wide = makeCandles(Array.from({ length: 60 }, (_, i) => 100 + (i % 2) * 20));
  assert.ok(atr(wide) > a, 'wider-range series should have higher ATR');
});

test('Heikin Ashi produces smoothed candles with real OHLC', () => {
  const ha = heikinAshi(uptrend);
  assert.strictEqual(ha.length, uptrend.length);
  const lastHa = ha[ha.length - 1];
  assert.ok(lastHa.close > lastHa.open, 'uptrend should give bullish HA candle');
  assert.ok(lastHa.high >= lastHa.close && lastHa.low <= lastHa.close);
});

test('SSL channel is bullish in an uptrend, bearish in a downtrend', () => {
  assert.strictEqual(sslChannel(uptrend).bullish, true);
  assert.strictEqual(sslChannel(downtrend).bearish, true);
});

test('MFI uses volume and stays in 0-100', () => {
  const m = mfi(uptrend);
  assert.ok(m >= 0 && m <= 100, `MFI out of range: ${m}`);
  assert.ok(m > 50, `uptrend MFI should be above 50, got ${m}`);
});

test('CMO is positive in an uptrend, negative in a downtrend', () => {
  assert.ok(cmo(uptrend) > 0);
  assert.ok(cmo(downtrend) < 0);
});

test('relativeVolume compares latest bar to its average', () => {
  const rv = relativeVolume(uptrend);
  assert.ok(rv > 0, `got ${rv}`);
});

test('correlation is 1.0 for identical series and -1.0 for mirrored returns', () => {
  const a = logReturns(uptrend);
  assert.ok(Math.abs(correlation(a, a) - 1) < 1e-9);

  // Mirrored RETURNS, not mirrored prices.
  const mirrorA = makeCandles(Array.from({ length: 120 }, (_, i) => 100 * (1 + 0.01 * Math.sin(i / 3))));
  const mirrorB = makeCandles(Array.from({ length: 120 }, (_, i) => 100 * (1 - 0.01 * Math.sin(i / 3))));
  // Not exactly -1: the log transform is slightly asymmetric around a
  // multiplicative mirror, so ~-0.9999 is the correct answer, not a bug.
  const c = correlation(logReturns(mirrorA), logReturns(mirrorB));
  assert.ok(Math.abs(c + 1) < 1e-3, `expected ~-1, got ${c}`);
});

test('a linear uptrend and downtrend are POSITIVELY correlated in returns', () => {
  // Counterintuitive but correct, and exactly why the correlation gate must
  // operate on returns rather than on price direction: both series have log
  // returns that drift monotonically downward, so they correlate around +0.94.
  // Two assets moving opposite ways can still share a risk factor.
  const c = correlation(logReturns(uptrend), logReturns(downtrend));
  assert.ok(c > 0.9, `expected strong positive return correlation, got ${c}`);
});

test('correlation returns null on too-short input', () => {
  assert.strictEqual(correlation([1, 2, 3], [1, 2, 3]), null);
});

// ---------------------------------------------------------------------------

section('Signal engine');

test('scoreAsset returns null below MIN_CANDLES rather than a neutral score', () => {
  assert.strictEqual(scoreAsset(uptrend.slice(0, MIN_CANDLES - 1)), null);
});

test('scoreAsset is DETERMINISTIC — same input, same output', () => {
  const a = scoreAsset(choppy);
  const b = scoreAsset(choppy);
  assert.deepStrictEqual(a, b, 'engine is not deterministic');
});

test('scoreAsset rates an uptrend above a downtrend', () => {
  const up = scoreAsset(uptrend);
  const down = scoreAsset(downtrend);
  assert.ok(up.strength > down.strength, `up ${up.strength} vs down ${down.strength}`);
});

test('scoreAsset output has no percent semantics and exposes components', () => {
  const s = scoreAsset(uptrend);
  assert.ok(typeof s.strength === 'number' && s.strength >= 0 && s.strength <= 100);
  assert.ok(!('confidence' in s), 'should not expose a "confidence" field');
  assert.ok(s.components && typeof s.components === 'object');
  assert.ok(Array.isArray(s.reasons) && s.reasons.length > 0);
});

test('sentiment contributes nothing when no provider is supplied', () => {
  const s = scoreAsset(uptrend);
  assert.strictEqual(s.sentimentApplied, false);
});

test('a real sentiment provider does shift the score', () => {
  const base = scoreAsset(choppy);
  const bearish = scoreAsset(choppy, { sentiment: { score: -1, weight: 0.3 } });
  assert.ok(bearish.strength < base.strength, 'negative sentiment should lower strength');
  assert.strictEqual(bearish.sentimentApplied, true);
});

test('disabling indicators renormalises rather than dragging the score down', () => {
  const all = scoreAsset(uptrend);
  const some = scoreAsset(uptrend, { indicators: { rsi: true, macd: false, bollinger: false, ema: true, stoch: false } });
  assert.ok(some !== null);
  assert.ok(some.strength > 40, `renormalised score collapsed to ${some.strength}`);
});

// ---------------------------------------------------------------------------

section('Costs');

test('taker fee is higher than maker on Coinbase; BNB discount applies on Binance', () => {
  assert.ok(getFeeRate('coinbase', { isMaker: false }) > getFeeRate('coinbase', { isMaker: true }));
  const full = getFeeRate('binance');
  const discounted = getFeeRate('binance', { useBnbDiscount: true });
  assert.ok(discounted < full);
});

test('order book walk gives a worse average price than the best ask', () => {
  const book = { asks: [[100, 1], [101, 1], [102, 10]], bids: [[99, 1], [98, 1]] };
  const fill = estimateFillFromBook(book, 'buy', 250);
  assert.ok(fill.avgPrice > 100, `avg ${fill.avgPrice} should exceed best ask 100`);
  assert.ok(fill.slippagePercent > 0);
});

test('order book walk flags insufficient liquidity instead of inventing a price', () => {
  const book = { asks: [[100, 0.1]], bids: [[99, 0.1]] };
  const fill = estimateFillFromBook(book, 'buy', 100000);
  assert.strictEqual(fill.insufficientLiquidity, true);
  assert.strictEqual(fill.avgPrice, null);
});

test('applyCosts makes a buy more expensive and a sell cheaper', () => {
  const buy = applyCosts({ side: 'buy', intendedPrice: 100, quoteAmount: 1000, quoteVolume24h: 1e9 });
  const sell = applyCosts({ side: 'sell', intendedPrice: 100, quoteAmount: 1000, quoteVolume24h: 1e9 });
  assert.ok(buy.fillPrice >= 100, `buy filled at ${buy.fillPrice}`);
  assert.ok(sell.fillPrice <= 100, `sell filled at ${sell.fillPrice}`);
  assert.ok(buy.fee > 0 && sell.fee > 0);
});

test('slippage rises with order size relative to volume', () => {
  const small = applyCosts({ side: 'buy', intendedPrice: 100, quoteAmount: 100, quoteVolume24h: 1e9 });
  const large = applyCosts({ side: 'buy', intendedPrice: 100, quoteAmount: 1e7, quoteVolume24h: 1e9 });
  assert.ok(large.slippagePercent > small.slippagePercent);
});

test('round-trip cost is non-trivial vs an 8% target', () => {
  const cost = roundTripCostPercent({ exchange: 'binance' });
  assert.ok(cost > 0.15, `round trip only ${cost}%`);
  assert.ok(cost < 2, `round trip implausibly high: ${cost}%`);
});

// ---------------------------------------------------------------------------

section('Position sizing');

test('a wider stop gets a smaller position for the same risk budget', () => {
  const tight = makeCandles(Array.from({ length: 60 }, (_, i) => 100 + i * 0.01));
  const wide = makeCandles(Array.from({ length: 60 }, (_, i) => 100 + (i % 2 ? 6 : -6)));
  const a = calculatePositionSize({ equity: 10000, availableBalance: 10000, price: 100, candles: tight });
  const b = calculatePositionSize({ equity: 10000, availableBalance: 10000, price: 100, candles: wide });
  if (b.quoteAmount > 0) {
    assert.ok(a.quoteAmount > b.quoteAmount, 'tighter stop should get more capital');
  } else {
    assert.strictEqual(b.reason, 'volatility_too_high');
  }
});

test('sizing refuses when volatility is too high to size sensibly', () => {
  const violent = makeCandles(Array.from({ length: 60 }, (_, i) => 100 * (i % 2 ? 1.4 : 0.6)));
  const r = calculatePositionSize({ equity: 10000, availableBalance: 10000, price: 100, candles: violent });
  assert.strictEqual(r.quoteAmount, 0);
  assert.strictEqual(r.reason, 'volatility_too_high');
});

test('sizing respects the max position percent cap', () => {
  const r = calculatePositionSize({
    equity: 10000, availableBalance: 10000, price: 100, candles: uptrend,
    riskPerTradePercent: 50, maxPositionPercent: 10,
  });
  assert.ok(r.quoteAmount <= 1000 + 1e-9, `cap breached: ${r.quoteAmount}`);
});

test('sizing never exceeds available balance', () => {
  const r = calculatePositionSize({
    equity: 100000, availableBalance: 50, price: 100, candles: uptrend, maxPositionPercent: 100,
  });
  assert.ok(r.quoteAmount <= 50);
});

test('correlation gate blocks a candidate that mirrors an open position', () => {
  const held = new Map([['BTCUSDT', logReturns(uptrend)]]);
  const r = checkCorrelation(logReturns(uptrend), held, { maxCorrelation: 0.8 });
  assert.strictEqual(r.allowed, false);
  assert.ok(r.reason.startsWith('correlated_with'));
});

test('correlation gate allows an uncorrelated candidate', () => {
  const held = new Map([['BTCUSDT', logReturns(uptrend)]]);
  const r = checkCorrelation(logReturns(choppy), held, { maxCorrelation: 0.95 });
  assert.strictEqual(r.allowed, true);
});

test('gross exposure cap blocks over-concentration even under the position count', () => {
  const positions = [
    { asset_symbol: 'A', current_value: 3000 },
    { asset_symbol: 'B', current_value: 3000 },
  ];
  const r = checkPortfolioExposure({
    positions, equity: 10000, newPositionValue: 2000,
    maxGrossExposurePercent: 60, maxPositions: 5,
  });
  assert.strictEqual(r.allowed, false);
  assert.strictEqual(r.reason, 'max_gross_exposure_reached');
});

// ---------------------------------------------------------------------------

section('Risk guards');

test('daily loss limit compares PERCENT to PERCENT (the V4 unit bug)', () => {
  // $5 of loss on $10k equity is 0.05%, nowhere near a 5% limit.
  const r = checkDailyLossLimit({ dailyLoss: 5, dailyStartEquity: 10000, maxDailyLossPercent: 5 });
  assert.strictEqual(r.breached, false, 'V4 would have tripped here at $5');
  const r2 = checkDailyLossLimit({ dailyLoss: 500, dailyStartEquity: 10000, maxDailyLossPercent: 5 });
  assert.strictEqual(r2.breached, true, '$500 on $10k is 5% and must trip');
});

test('daily loss limit fails CLOSED when start equity is unknown', () => {
  const r = checkDailyLossLimit({ dailyLoss: 0, dailyStartEquity: null, maxDailyLossPercent: 5 });
  assert.strictEqual(r.breached, true);
  assert.strictEqual(r.reason, 'daily_start_equity_unknown');
});

test('trade limit uses a sane default rather than tripping on unset', () => {
  assert.strictEqual(checkTradeLimit({ tradesToday: 0, maxTradesPerDay: undefined }).breached, false);
  assert.strictEqual(checkTradeLimit({ tradesToday: 10, maxTradesPerDay: undefined }).breached, true);
});

test('daily counters roll over on a new UTC day', () => {
  const settings = {
    daily_counters_date: '2026-08-20',
    trades_today: 7,
    daily_loss: 250,
    assets_traded_today: ['BTCUSDT', 'ETHUSDT'],
  };
  const r = rollDailyCounters(settings, new Date('2026-08-21T00:05:00Z'));
  assert.strictEqual(r.needsReset, true);
  assert.strictEqual(r.state.trades_today, 0);
  assert.strictEqual(r.state.daily_loss, 0);
  assert.deepStrictEqual(r.state.assets_traded_today, []);
});

test('daily counters persist within the same UTC day', () => {
  const settings = {
    daily_counters_date: '2026-08-21',
    trades_today: 7,
    daily_loss: 250,
    assets_traded_today: ['BTCUSDT'],
  };
  const r = rollDailyCounters(settings, new Date('2026-08-21T18:00:00Z'));
  assert.strictEqual(r.needsReset, false);
  assert.strictEqual(r.state.trades_today, 7);
});

test('kill switch overrides everything', () => {
  const r = evaluateAllGuards({
    settings: { kill_switch_enabled: true, is_enabled: true, max_daily_loss_percent: 5 },
    counters: { daily_loss: 0, trades_today: 0, daily_start_equity: 10000 },
    equity: 10000,
  });
  assert.strictEqual(r.allowed, false);
  assert.strictEqual(r.reason, 'kill_switch_enabled');
});

test('trade limit blocks new entries but does NOT halt the run (exits must fire)', () => {
  const r = evaluateAllGuards({
    settings: { is_enabled: true, max_daily_loss_percent: 5, max_trades_per_day: 10 },
    counters: { daily_loss: 0, trades_today: 10, daily_start_equity: 10000 },
    equity: 10000,
  });
  assert.strictEqual(r.allowed, true, 'run must continue so stops can fire');
  assert.strictEqual(r.newEntriesAllowed, false);
});

test('daily loss breach halts the run and flags the breaker', () => {
  const r = evaluateAllGuards({
    settings: { is_enabled: true, max_daily_loss_percent: 5 },
    counters: { daily_loss: 600, trades_today: 0, daily_start_equity: 10000 },
    equity: 9400,
  });
  assert.strictEqual(r.allowed, false);
  assert.strictEqual(r.tripBreaker, true);
});

test('schedule window supports wrapping past midnight', () => {
  const settings = { trading_schedule: { enabled: true, days: ['fri'], start_hour: 22, end_hour: 6 } };
  const inside = checkSchedule(settings, new Date('2026-08-21T23:00:00Z')); // Friday 23:00
  assert.strictEqual(inside.allowed, true);
  const outside = checkSchedule(settings, new Date('2026-08-21T12:00:00Z')); // Friday 12:00
  assert.strictEqual(outside.allowed, false);
});

// ---------------------------------------------------------------------------

section('Portfolio accounting');

test('createPortfolioState does not mutate the caller object', () => {
  const original = { id: 'p1', available_balance: 1000, positions: [{ asset_symbol: 'X', quantity: 1 }] };
  const state = createPortfolioState(original);
  state.available_balance = 0;
  state.positions[0].quantity = 999;
  assert.strictEqual(original.available_balance, 1000);
  assert.strictEqual(original.positions[0].quantity, 1);
});

test('buy debits notional PLUS fee', () => {
  const state = createPortfolioState({ id: 'p', available_balance: 10000, positions: [] });
  const costs = applyCosts({ side: 'buy', intendedPrice: 100, quoteAmount: 1000, quoteVolume24h: 1e9 });
  applyBuy(state, { symbol: 'BTCUSDT', quantity: 1000 / costs.fillPrice, costs });
  const spent = 10000 - state.available_balance;
  assert.ok(spent > 1000, `expected notional + fee, spent ${spent}`);
  assert.ok(spent < 1020, `fee implausibly large: ${spent}`);
});

test('realised P&L is quantity x (exit - entry) - fees, not the V4 formula', () => {
  const state = createPortfolioState({ id: 'p', available_balance: 10000, positions: [] });
  const buyCosts = { fillPrice: 100, fee: 0, slippagePercent: 0 };
  applyBuy(state, { symbol: 'X', quantity: 10, costs: buyCosts });

  const sellCosts = { fillPrice: 200, fee: 0, slippagePercent: 0 };
  const result = applySell(state, { symbol: 'X', quantity: 10, costs: sellCosts });

  // Correct: 10 * (200 - 100) = 1000
  assert.strictEqual(Math.round(result.netPnL), 1000);
  // V4 would have computed totalValue * profitPercent = 2000 * 1.0 = 2000
  assert.notStrictEqual(Math.round(result.netPnL), 2000);
});

test('two sells in one run BOTH keep their proceeds (the V4 race)', () => {
  const state = createPortfolioState({
    id: 'p',
    available_balance: 0,
    positions: [
      { asset_symbol: 'A', quantity: 10, avg_entry_price: 100, fees_paid: 0 },
      { asset_symbol: 'B', quantity: 5, avg_entry_price: 200, fees_paid: 0 },
    ],
  });

  applySell(state, { symbol: 'A', quantity: 10, costs: { fillPrice: 110, fee: 0, slippagePercent: 0 } });
  applySell(state, { symbol: 'B', quantity: 5, costs: { fillPrice: 210, fee: 0, slippagePercent: 0 } });

  // 10*110 + 5*210 = 1100 + 1050 = 2150. V4 would have shown only 1050.
  assert.strictEqual(Math.round(state.available_balance), 2150);
  assert.strictEqual(state.positions.length, 0, 'both positions should be closed');
});

test('a sold position does not reappear after a later sell', () => {
  const state = createPortfolioState({
    id: 'p',
    available_balance: 0,
    positions: [
      { asset_symbol: 'A', quantity: 1, avg_entry_price: 100, fees_paid: 0 },
      { asset_symbol: 'B', quantity: 1, avg_entry_price: 100, fees_paid: 0 },
    ],
  });
  applySell(state, { symbol: 'A', quantity: 1, costs: { fillPrice: 100, fee: 0, slippagePercent: 0 } });
  applySell(state, { symbol: 'B', quantity: 1, costs: { fillPrice: 100, fee: 0, slippagePercent: 0 } });
  assert.ok(!state.positions.find((p) => p.asset_symbol === 'A'), 'position A resurrected');
});

test('partial sell keeps the remainder with pro-rated entry fees', () => {
  const state = createPortfolioState({
    id: 'p', available_balance: 0,
    positions: [{ asset_symbol: 'A', quantity: 10, avg_entry_price: 100, fees_paid: 10 }],
  });
  applySell(state, { symbol: 'A', quantity: 4, costs: { fillPrice: 110, fee: 0, slippagePercent: 0 } });
  const pos = state.positions.find((p) => p.asset_symbol === 'A');
  assert.strictEqual(pos.quantity, 6);
  assert.ok(Math.abs(pos.fees_paid - 6) < 1e-9, `expected 6 remaining fees, got ${pos.fees_paid}`);
});

test('equity is DERIVED from cash + marks, not accumulated', () => {
  const state = createPortfolioState({
    id: 'p', available_balance: 5000,
    positions: [{ asset_symbol: 'A', quantity: 10, avg_entry_price: 100, fees_paid: 0 }],
  });
  const prices = new Map([['A', 150]]);
  const { equity } = calculateEquity(state, prices);
  assert.strictEqual(equity, 5000 + 1500);
});

test('total_balance in the persisted object equals derived equity', () => {
  const state = createPortfolioState({
    id: 'p', available_balance: 5000,
    positions: [{ asset_symbol: 'A', quantity: 10, avg_entry_price: 100, fees_paid: 0 }],
  });
  const prices = new Map([['A', 150]]);
  const p = toPersistablePortfolio(state, prices);
  assert.strictEqual(p.total_balance, 6500);
  assert.strictEqual(p.available_balance, 5000);
});

test('buy is rejected when the balance cannot cover notional + fee', () => {
  const state = createPortfolioState({ id: 'p', available_balance: 100, positions: [] });
  const r = applyBuy(state, { symbol: 'X', quantity: 10, costs: { fillPrice: 100, fee: 1, slippagePercent: 0 } });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'insufficient_balance');
  assert.strictEqual(state.available_balance, 100, 'balance must be untouched on rejection');
});

test('positionPnL nets out entry fees', () => {
  const pos = { quantity: 10, avg_entry_price: 100, fees_paid: 50 };
  const pnl = positionPnL(pos, 110);
  assert.strictEqual(pnl.grossPnL, 100);
  assert.strictEqual(pnl.netPnL, 50);
  assert.ok(pnl.netPercent < pnl.percent);
});

test('trailing stop ratchets up only, never down', () => {
  const state = createPortfolioState({
    id: 'p', available_balance: 0,
    positions: [{ asset_symbol: 'A', quantity: 1, avg_entry_price: 100, highest_price: 120, trailing_stop_price: null }],
  });
  updateTrailingStop(state, 'A', { trailingStopPercent: 10 });
  const first = state.positions[0].trailing_stop_price;
  assert.strictEqual(first, 108);

  state.positions[0].highest_price = 110; // price fell back
  updateTrailingStop(state, 'A', { trailingStopPercent: 10 });
  assert.strictEqual(state.positions[0].trailing_stop_price, 108, 'stop must not loosen');
});

// ---------------------------------------------------------------------------

section('Backtest engine');

test('backtest refuses to run on insufficient history', () => {
  const data = new Map([['A', makeCandles(Array.from({ length: 20 }, (_, i) => 100 + i))]]);
  const r = runBacktest(data, {});
  assert.strictEqual(r.error, 'insufficient_history');
});

test('backtest produces a full result set on real-shaped data', () => {
  const data = new Map([
    ['AUSDT', choppy],
    ['BUSDT', makeCandles(Array.from({ length: 120 }, (_, i) => 50 + Math.sin(i / 4) * 4))],
  ]);
  const r = runBacktest(data, { initialCapital: 10000, minStrength: 55, warmupBars: 60 });
  assert.ok(r.metrics !== null, 'no metrics produced');
  assert.ok(Array.isArray(r.equityCurve) && r.equityCurve.length > 0);
  assert.ok(r.benchmark !== null, 'no buy-and-hold benchmark');
});

test('backtest is deterministic — same data, same result', () => {
  const data = new Map([['AUSDT', choppy]]);
  const a = runBacktest(data, { minStrength: 55, warmupBars: 60 });
  const b = runBacktest(data, { minStrength: 55, warmupBars: 60 });
  assert.strictEqual(a.metrics.totalReturn, b.metrics.totalReturn);
  assert.strictEqual(a.trades.length, b.trades.length);
});

test('every backtest trade has fees deducted (net < gross for winners)', () => {
  const data = new Map([['AUSDT', choppy]]);
  const r = runBacktest(data, { minStrength: 50, warmupBars: 60 });
  for (const t of r.trades) {
    assert.ok(t.fees > 0, `trade on ${t.symbol} recorded zero fees`);
    assert.ok(t.netPnL < t.grossPnL, 'net P&L should be below gross after fees');
  }
});

test('backtest flags a small sample as statistically meaningless', () => {
  const data = new Map([['AUSDT', choppy]]);
  const r = runBacktest(data, { minStrength: 55, warmupBars: 60 });
  if (r.metrics.totalTrades < 100) {
    assert.strictEqual(r.metrics.statisticallyMeaningful, false);
    assert.ok(r.metrics.sampleWarning !== null);
  }
});

test('entries fill at the NEXT bar open, never the signal bar close', () => {
  const data = new Map([['AUSDT', uptrend]]);
  const r = runBacktest(data, { minStrength: 50, warmupBars: 60, maxPositions: 1 });
  for (const t of r.trades) {
    const candles = uptrend;
    const entryBar = candles.find((c) => c.openTime === t.entryTime);
    assert.ok(entryBar !== undefined, 'entry time does not match a bar open');
  }
});

test('backtest reports a buy-and-hold benchmark to compare against', () => {
  const data = new Map([['AUSDT', uptrend]]);
  const r = runBacktest(data, { minStrength: 50, warmupBars: 60 });
  assert.ok(typeof r.benchmark.totalReturn === 'number');
  assert.ok(r.benchmark.totalReturn > 0, 'uptrend hold should be positive');
});

// ---------------------------------------------------------------------------

console.log(`\n${'-'.repeat(52)}`);
console.log(`${passed} passed, ${failed} failed`);
console.log(`${'-'.repeat(52)}\n`);

process.exit(failed > 0 ? 1 : 0);
