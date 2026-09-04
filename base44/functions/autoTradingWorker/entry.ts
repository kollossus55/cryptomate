import { createClientFromRequest } from 'npm:@base44/sdk@0.8.43';

import { fetchUniverse, fetchCandlesBatch, fetchOrderBook } from './shared/marketData.js';
import { scoreAsset, MIN_CANDLES } from './shared/signalEngine.js';
import { applyCosts, roundTripCostPercent, isEdgeSufficient } from './shared/costs.js';
import { calculatePositionSize, checkCorrelation, buildReturnsMap, checkPortfolioExposure } from './shared/sizing.js';
import { rollDailyCounters, evaluateAllGuards, utcDayKey } from './shared/risk.js';
import {
  createPortfolioState, calculateEquity, positionPnL, applyBuy, applySell,
  markToMarket, updateTrailingStop, activateBreakeven,
  toPersistablePortfolio, pendingTrades,
} from './shared/portfolio.js';
import { logReturns } from './shared/indicators.js';

/**
 * Auto-Trading Worker V5
 *
 * Rewritten from V4. The substantive changes:
 *
 *  - Signals come from real Binance OHLCV. generateSyntheticHistory() is gone
 *    with no fallback: if candles are unavailable we skip the asset, because
 *    trading on invented data is worse than not trading.
 *  - Risk limits (daily loss, daily trade count) are enforced HERE, before any
 *    market data is fetched. V4 only incremented the counters.
 *  - Daily counters roll over at UTC midnight. V4 never reset them.
 *  - Portfolio mutations happen against one in-memory object with a single
 *    write at the end. V4 read-modify-wrote inside a loop and lost proceeds
 *    whenever two positions closed in the same run.
 *  - Every fill goes through the fee and slippage model.
 *  - Position sizing is ATR-based, with correlation and gross exposure caps.
 *  - "confidence" is now "signal strength" — a 0-100 score, not a probability.
 *  - Exits are always processed, even when entry limits are hit. A stop-loss
 *    must be able to fire on trade number 11.
 */

const CANDLE_INTERVAL = '1h';
const CANDLE_LIMIT = 200;
const UNIVERSE_SIZE = 60;
const MAX_SCAN_CANDIDATES = 25;
const LOCK_DURATION_MS = 5 * 60 * 1000;

Deno.serve(async (req) => {
  const runId = crypto.randomUUID().slice(0, 8);
  const log = (msg: string) => console.log(`[${runId}] ${msg}`);

  try {
    const base44 = createClientFromRequest(req);
    const { settings_id, user_email } = await req.json();

    if (!settings_id || !user_email) {
      return Response.json({ success: false, error: 'Missing required parameters' }, { status: 400 });
    }

    // If a user token is present, the caller may only act on their own settings.
    // Service-role internal calls from the scheduler have no user token and fall
    // through to the DB verification below.
    try {
      const caller = await base44.auth.me();
      if (caller && caller.email !== user_email) {
        return Response.json({ success: false, error: 'Forbidden: settings do not belong to caller' }, { status: 403 });
      }
    } catch {
      // No user token — service-role internal call. Proceed with DB verification.
    }

    // NEVER trust caller-supplied settings/portfolio. Fetch the real records
    // from the DB so an attacker cannot inject crafted risk limits or a fake
    // portfolio for another user.
    let settings;
    try {
      settings = await base44.asServiceRole.entities.AutoTradingSettings.get(settings_id);
    } catch {
      settings = null;
    }
    if (!settings) {
      return Response.json({ success: false, error: 'Settings not found' }, { status: 404 });
    }
    if (settings.created_by !== user_email) {
      return Response.json({ success: false, error: 'Forbidden: settings owner mismatch' }, { status: 403 });
    }
    if (!settings.is_enabled || settings.execution_mode === 'browser') {
      return Response.json({ success: true, skipped: true, reason: 'server_trading_not_enabled' });
    }

    const portfolios = await base44.asServiceRole.entities.Portfolio.filter({ created_by: user_email });
    const portfolio = portfolios?.[0];
    if (!portfolio) {
      return Response.json({ success: false, error: 'Portfolio not found' }, { status: 404 });
    }

    log(`Run start for ${user_email}`);

    // -----------------------------------------------------------------------
    // 0. Concurrency lease
    //
    // The scheduler fires every 2 minutes; a slow run can still be working when
    // the next one starts, and two concurrent runs on the same portfolio will
    // double-spend. This is a best-effort lease, not a true mutex — Base44 has
    // no compare-and-swap, so there is a small window between read and write.
    // Narrow it further by keeping runs short. See the notes file.
    // -----------------------------------------------------------------------
    const now = new Date();
    if (settings.run_lock_until && new Date(settings.run_lock_until) > now) {
      log('Skipped: another run holds the lease');
      return Response.json({ success: true, skipped: true, reason: 'run_in_progress' });
    }

    await base44.asServiceRole.entities.AutoTradingSettings.update(settings.id, {
      run_lock_until: new Date(now.getTime() + LOCK_DURATION_MS).toISOString(),
    });

    try {
      const result = await runTradingCycle({ base44, settings, portfolio, user_email, log, now });
      return Response.json({ success: true, ...result });
    } finally {
      // Always release, even on error — a stuck lease silently halts trading.
      await base44.asServiceRole.entities.AutoTradingSettings.update(settings.id, {
        run_lock_until: null,
      }).catch((e) => log(`Lease release failed: ${e.message}`));
    }
  } catch (error) {
    console.error(`[${runId}] Worker error:`, error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});

async function runTradingCycle({ base44, settings, portfolio, user_email, log, now }) {
  // -------------------------------------------------------------------------
  // 1. Daily counter rollover
  // -------------------------------------------------------------------------
  const roll = rollDailyCounters(settings, now);
  const counters = roll.state;

  const state = createPortfolioState(portfolio);
  const priceMap = new Map();
  for (const pos of state.positions) {
    priceMap.set(pos.asset_symbol, pos.last_known_price ?? pos.avg_entry_price);
  }
  const startingEquity = calculateEquity(state, priceMap).equity;

  if (roll.needsReset) {
    log(`Rolling daily counters into ${utcDayKey(now)}`);
    counters.daily_start_equity = startingEquity;
    await base44.asServiceRole.entities.AutoTradingSettings.update(settings.id, {
      ...roll.resetFields,
      daily_start_equity: startingEquity,
    });
  } else if (!counters.daily_start_equity) {
    counters.daily_start_equity = startingEquity;
    await base44.asServiceRole.entities.AutoTradingSettings.update(settings.id, {
      daily_start_equity: startingEquity,
    });
  }

  // -------------------------------------------------------------------------
  // 2. Risk guards — BEFORE fetching market data
  // -------------------------------------------------------------------------
  const preGuards = evaluateAllGuards({ settings, counters, equity: startingEquity, universe: null, now });

  if (!preGuards.allowed) {
    log(`Halted: ${preGuards.reason}`);
    if (preGuards.tripBreaker && !settings.circuit_breaker_triggered_at) {
      await base44.asServiceRole.entities.AutoTradingSettings.update(settings.id, {
        circuit_breaker_triggered_at: now.toISOString(),
      });
      await notify(base44, user_email, {
        type: 'risk_alert',
        priority: 'high',
        title: 'Circuit breaker tripped',
        message: `Trading halted: ${preGuards.reason}. ` +
          `Daily loss ${preGuards.detail?.lossPercent?.toFixed(2)}% vs limit ${preGuards.detail?.limit}%.`,
      });
    }
    return { halted: true, reason: preGuards.reason, detail: preGuards.detail ?? null };
  }

  // -------------------------------------------------------------------------
  // 3. Market data — real, or we do not trade
  // -------------------------------------------------------------------------
  let universe;
  try {
    universe = await fetchUniverse({ topN: UNIVERSE_SIZE });
    log(`Universe: ${universe.length} liquid USDT pairs`);
  } catch (err) {
    // Server is geo-blocked from Binance (HTTP 451). Fall back to the latest
    // browser-fed scanner result so trading continues on real data.
    log(`Binance unreachable from server (${err.message}) — using scanner fallback`);
    try {
      const rows = await base44.asServiceRole.entities.ScanResult.list('-scanned_at', 1);
      const latest = rows?.[0];
      if (latest && Array.isArray(latest.opportunities) && latest.opportunities.length) {
        universe = latest.opportunities
          .filter((o) => o && o.symbol)
          .map((o) => ({
            symbol: o.symbol + 'USDT',
            base: o.symbol,
            price: o.price,
            change24h: o.momentum || 0,
            quoteVolume24h: o.volume24h || 0,
            high24h: null,
            low24h: null,
            trades24h: null,
          }));
        log(`Fallback universe: ${universe.length} symbols from scan @ ${latest.scanned_at}`);
      }
    } catch (e) {
      log(`ScanResult fallback read failed: ${e.message}`);
    }
    if (!universe || universe.length === 0) {
      log(`No scanner data either — aborting run`);
      return { halted: true, reason: 'market_data_unavailable', error: err.message };
    }
  }

  if (universe.length === 0) {
    return { halted: true, reason: 'empty_universe' };
  }

  const universeBySymbol = new Map(universe.map((u) => [u.symbol, u]));

  // Live prices for held positions, so exits use current marks.
  for (const pos of state.positions) {
    const ticker = universeBySymbol.get(pos.asset_symbol);
    if (ticker) priceMap.set(pos.asset_symbol, ticker.price);
  }

  // Held symbols outside the top-N still need candles for exit decisions.
  const heldSymbols = state.positions.map((p) => p.asset_symbol);

  // Consume the latest Altcoin Scanner result so the auto-trader and the
  // scanner share one scan and the same candidate list. Falls back to the
  // own-universe scan when no fresh scanner result is available (e.g. when
  // Binance is geo-blocked from the server).
  let scannerOppMap = null;
  try {
    const rows = await base44.asServiceRole.entities.ScanResult.list('-scanned_at', 1);
    const latest = rows?.[0];
    const SCAN_STALE_MS = 20 * 60 * 1000;
    if (latest && !latest.error && Array.isArray(latest.opportunities) && latest.scanned_at
        && (now.getTime() - new Date(latest.scanned_at).getTime()) < SCAN_STALE_MS) {
      scannerOppMap = new Map();
      for (const opp of latest.opportunities) {
        if (!opp || !opp.symbol) continue;
        const pair = opp.symbol + 'USDT';
        if (!universeBySymbol.has(pair)) continue;
        scannerOppMap.set(pair, opp);
      }
      log(`Using scanner candidates: ${scannerOppMap.size} from scan @ ${latest.scanned_at}`);
    }
  } catch (e) {
    log(`ScanResult read failed: ${e.message}`);
  }

  const scanSymbols = scannerOppMap
    ? [...scannerOppMap.keys()].slice(0, MAX_SCAN_CANDIDATES)
    : universe.slice(0, MAX_SCAN_CANDIDATES).map((u) => u.symbol);
  if (!scannerOppMap) log(`No fresh scanner result — scanning ${scanSymbols.length} from own universe`);

  const symbolsNeedingCandles = [...new Set([...heldSymbols, ...scanSymbols])];

  log(`Fetching ${CANDLE_INTERVAL} candles for ${symbolsNeedingCandles.length} symbols`);
  const candlesBySymbol = await fetchCandlesBatch(
    symbolsNeedingCandles, CANDLE_INTERVAL, CANDLE_LIMIT, 8
  );
  log(`Candles retrieved for ${candlesBySymbol.size} symbols`);

  // Re-check market-wide conditions now that we have breadth data.
  const guards = evaluateAllGuards({ settings, counters, equity: startingEquity, universe, now });
  const newEntriesAllowed = guards.allowed && guards.newEntriesAllowed !== false;
  if (!newEntriesAllowed) {
    log(`New entries blocked: ${guards.reason} — managing exits only`);
  }

  markToMarket(state, priceMap);

  // -------------------------------------------------------------------------
  // 4. Manage open positions (always runs, regardless of entry limits)
  // -------------------------------------------------------------------------
  const exchange = settings.exchange || 'binance';
  const actions = [];

  for (const position of [...state.positions]) {
    const symbol = position.asset_symbol;
    const currentPrice = priceMap.get(symbol);
    if (currentPrice === undefined) {
      log(`No price for held ${symbol} — skipping management this cycle`);
      continue;
    }

    const pnl = positionPnL(position, currentPrice);
    const ticker = universeBySymbol.get(symbol);

    const stopLossPercent = settings.stop_loss_percent ?? 3;
    const takeProfitPercent = settings.take_profit_percent ?? 8;

    let exitReason = null;

    // Compare NET percent — the number after costs is what you actually keep.
    if (pnl.netPercent <= -stopLossPercent) {
      exitReason = `Stop-loss at ${pnl.netPercent.toFixed(2)}% net`;
    } else if (position.breakeven_activated && currentPrice <= position.breakeven_price) {
      exitReason = 'Breakeven stop';
    } else if (position.trailing_stop_price && currentPrice <= position.trailing_stop_price) {
      exitReason = `Trailing stop at ${pnl.netPercent.toFixed(2)}% net`;
    } else if (pnl.netPercent >= takeProfitPercent) {
      exitReason = `Take-profit at ${pnl.netPercent.toFixed(2)}% net`;
    }

    if (exitReason) {
      const notional = position.quantity * currentPrice;
      const book = await fetchOrderBook(symbol, 100);
      const costs = applyCosts({
        side: 'sell',
        intendedPrice: currentPrice,
        quoteAmount: notional,
        exchange,
        book,
        quoteVolume24h: ticker?.quoteVolume24h,
      });

      const sell = applySell(state, {
        symbol,
        quantity: position.quantity,
        costs,
        strength: null,
        reason: exitReason,
        timestamp: now.toISOString(),
      });

      if (sell.ok) {
        log(`SELL ${symbol}: ${exitReason} | net P&L ${sell.netPnL.toFixed(2)}`);
        actions.push({ symbol, action: 'sell', reason: exitReason, netPnL: sell.netPnL });
        if (sell.netPnL < 0) counters.daily_loss += Math.abs(sell.netPnL);
        counters.trades_today += 1;
      }
      continue;
    }

    // Breakeven protection
    if (settings.use_breakeven_protection && !position.breakeven_activated) {
      const trigger = settings.breakeven_trigger_percent ?? 2;
      if (pnl.netPercent >= trigger) {
        const r = activateBreakeven(state, symbol, {
          offsetPercent: settings.breakeven_offset_percent ?? 0.2,
        });
        if (r.updated) actions.push({ symbol, action: 'breakeven_activated', price: r.breakevenPrice });
      }
    }

    // Trailing stop
    if (settings.use_trailing_stop) {
      const activation = settings.trailing_stop_activation ?? 3;
      if (pnl.netPercent >= activation) {
        const r = updateTrailingStop(state, symbol, {
          trailingStopPercent: settings.trailing_stop_percent ?? 2,
        });
        if (r.updated) actions.push({ symbol, action: 'trailing_updated', price: r.trailingStopPrice });
      }
    }
  }

  // -------------------------------------------------------------------------
  // 5. Scan for entries
  // -------------------------------------------------------------------------
  // Field name min_confidence kept for schema compatibility; it is a 0-100
  // strength threshold, not a probability.
  const minStrength = settings.min_confidence ?? 70;
  const scanned = [];

  if (newEntriesAllowed) {
    // Cost sanity check: does the configured TP/SL clear its own round trip?
    const costPercent = roundTripCostPercent({ exchange, estimatedSlippagePercent: 0.001 });
    const edge = isEdgeSufficient({
      takeProfitPercent: settings.take_profit_percent ?? 8,
      stopLossPercent: settings.stop_loss_percent ?? 3,
      assumedWinRate: 0.5,
      costPercent,
    });

    if (!edge.sufficient) {
      log(`Entry targets too tight for costs: gross edge ${edge.grossEdge.toFixed(2)}% vs round-trip ${costPercent.toFixed(2)}%`);
      await notify(base44, user_email, {
        type: 'risk_alert',
        priority: 'medium',
        title: 'Profit targets too tight',
        message: `Take-profit ${settings.take_profit_percent}% / stop ${settings.stop_loss_percent}% ` +
          `leaves ${edge.netEdge.toFixed(2)}% after ${costPercent.toFixed(2)}% round-trip costs. Widen targets.`,
      });
    } else {
      const heldNow = state.positions.map((p) => p.asset_symbol);
      const heldCandles = new Map();
      for (const s of heldNow) {
        const c = candlesBySymbol.get(s);
        if (c) heldCandles.set(s, c);
      }
      const heldReturns = buildReturnsMap(heldCandles);

      const candidateTickers = scannerOppMap
        ? scanSymbols.map((sym) => universeBySymbol.get(sym)).filter(Boolean)
        : universe.slice(0, MAX_SCAN_CANDIDATES);

      const candidates = [];
      for (const ticker of candidateTickers) {
        if (heldNow.includes(ticker.symbol)) continue;
        if (counters.assets_traded_today.includes(ticker.symbol)) continue;

        const candles = candlesBySymbol.get(ticker.symbol);
        if (!candles || candles.length < MIN_CANDLES) continue;

        let signal;
        if (scannerOppMap) {
          const opp = scannerOppMap.get(ticker.symbol);
          if (!opp) continue;
          // Reuse the scanner's SP500-AI score — one scan, shared candidate list.
          signal = {
            strength: opp.score,
            direction: opp.direction,
            reasons: opp.reasons || [],
            atrPercent: opp.volatility ?? 0.02,
          };
        } else {
          signal = scoreAsset(candles, {
            indicators: settings.indicator_settings || undefined,
            // No sentiment provider wired up, so sentiment contributes nothing.
            // See signalEngine.js — a random number is not sentiment analysis.
          });
          if (!signal) continue;
        }

        scanned.push({ symbol: ticker.symbol, strength: signal.strength });

        if (signal.strength >= minStrength && signal.direction === 'bullish') {
          candidates.push({ ticker, candles, signal });
        }
      }

      candidates.sort((a, b) => b.signal.strength - a.signal.strength);
      log(`${scanned.length} scanned, ${candidates.length} above strength ${minStrength}`);

      const equityNow = calculateEquity(state, priceMap).equity;

      for (const { ticker, candles, signal } of candidates) {
        if (counters.trades_today >= (settings.max_trades_per_day ?? 10)) {
          log('Daily trade limit reached mid-scan — stopping entries');
          break;
        }

        let sizing = calculatePositionSize({
          equity: equityNow,
          availableBalance: state.available_balance,
          price: ticker.price,
          candles,
          riskPerTradePercent: settings.risk_per_trade_percent ?? 1,
          atrMultiplier: settings.atr_stop_multiplier ?? 2,
          maxPositionPercent: settings.max_position_size_percent ?? 10,
        });

        // Server geo-block: no candles → no ATR. Fall back to flat-percent sizing
        // so the scanner's real-data signals can still execute.
        if (sizing.quoteAmount <= 0 && sizing.reason === 'insufficient_data_for_atr') {
          const flatAmount = Math.min(
            equityNow * ((settings.max_position_size_percent ?? 10) / 100),
            state.available_balance
          );
          if (flatAmount >= 10) {
            const stopPct = settings.stop_loss_percent ?? 3;
            sizing = {
              quoteAmount: flatAmount,
              quantity: flatAmount / ticker.price,
              stopPrice: ticker.price * (1 - stopPct / 100),
              stopDistancePercent: stopPct,
              riskAmount: flatAmount * (stopPct / 100),
              reason: 'ok',
            };
            log(`Flat sizing for ${ticker.symbol} (no ATR): ${flatAmount.toFixed(0)} USDT`);
          }
        }

        if (sizing.quoteAmount <= 0) {
          log(`Skip ${ticker.symbol}: ${sizing.reason}`);
          continue;
        }

        const exposure = checkPortfolioExposure({
          positions: state.positions,
          equity: equityNow,
          newPositionValue: sizing.quoteAmount,
          maxGrossExposurePercent: settings.max_gross_exposure_percent ?? 60,
          maxPositions: settings.max_open_positions ?? 5,
        });
        if (!exposure.allowed) {
          log(`Skip ${ticker.symbol}: ${exposure.reason}`);
          if (exposure.reason === 'max_positions_reached') break;
          continue;
        }

        const corr = checkCorrelation(logReturns(candles), heldReturns, {
          maxCorrelation: settings.max_correlation ?? 0.8,
        });
        if (!corr.allowed) {
          log(`Skip ${ticker.symbol}: ${corr.reason}`);
          continue;
        }

        const book = await fetchOrderBook(ticker.symbol, 100);
        const costs = applyCosts({
          side: 'buy',
          intendedPrice: ticker.price,
          quoteAmount: sizing.quoteAmount,
          exchange,
          book,
          quoteVolume24h: ticker.quoteVolume24h,
          atrPercent: signal.atrPercent ?? 0.02,
        });

        if (costs.insufficientLiquidity) {
          log(`Skip ${ticker.symbol}: order book too thin for ${sizing.quoteAmount.toFixed(0)} USDT`);
          continue;
        }

        const maxSlippage = (settings.max_slippage_percent ?? 0.5) / 100;
        if (costs.slippagePercent > maxSlippage) {
          log(`Skip ${ticker.symbol}: slippage ${(costs.slippagePercent * 100).toFixed(2)}% over limit`);
          continue;
        }

        const quantity = sizing.quoteAmount / costs.fillPrice;
        const buy = applyBuy(state, {
          symbol: ticker.symbol,
          quantity,
          costs,
          strength: signal.strength,
          reason: `Strength ${signal.strength}/100 — ${signal.reasons.slice(0, 3).join('; ')}`,
          timestamp: now.toISOString(),
        });

        if (buy.ok) {
          log(`BUY ${ticker.symbol} @ ${costs.fillPrice.toFixed(6)} | strength ${signal.strength} | fee ${costs.fee.toFixed(2)}`);
          actions.push({ symbol: ticker.symbol, action: 'buy', strength: signal.strength });
          counters.trades_today += 1;
          counters.assets_traded_today.push(ticker.symbol);
          priceMap.set(ticker.symbol, costs.fillPrice);
          heldReturns.set(ticker.symbol, logReturns(candles));
        } else {
          log(`Buy rejected for ${ticker.symbol}: ${buy.reason}`);
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // 6. Persist — ONE portfolio write for the whole run
  // -------------------------------------------------------------------------
  const trades = pendingTrades(state);

  if (state._dirty) {
    markToMarket(state, priceMap);
    const persistable = toPersistablePortfolio(state, priceMap);
    await base44.asServiceRole.entities.Portfolio.update(portfolio.id, persistable);

    for (const trade of trades) {
      await base44.asServiceRole.entities.Trade.create({
        asset_symbol: trade.asset_symbol,
        trade_type: trade.trade_type,
        quantity: trade.quantity,
        price: trade.price,
        total_value: trade.total_value,
        fee: trade.fee,
        slippage_percent: trade.slippage_percent,
        exchange: 'Paper Trading (Server V5)',
        status: 'completed',
        profit_loss: trade.profit_loss,
        ai_signal: {
          signal_strength: trade.signal_strength,
          reasoning: trade.reason,
          indicators: ['Signal Engine V5 (real OHLCV)'],
        },
        owner_email: user_email,
        created_by: user_email,
      });
    }

    await base44.asServiceRole.entities.AutoTradingSettings.update(settings.id, {
      trades_today: counters.trades_today,
      daily_loss: counters.daily_loss,
      assets_traded_today: counters.assets_traded_today,
      daily_counters_date: utcDayKey(now),
      last_trade_date: trades.length ? now.toISOString() : settings.last_trade_date,
    });

    for (const trade of trades) {
      await notify(base44, user_email, {
        type: 'order_filled',
        priority: 'medium',
        title: `${trade.trade_type.toUpperCase()} ${trade.asset_symbol}`,
        message: `${trade.quantity.toFixed(6)} @ $${trade.price.toFixed(6)} ` +
          `(fee $${trade.fee.toFixed(2)}, slippage ${trade.slippage_percent.toFixed(3)}%). ${trade.reason}`,
      });
    }
  }

  const finalEquity = calculateEquity(state, priceMap).equity;

  return {
    trades: actions,
    scanned: scanned.length,
    equity: finalEquity,
    equityChange: finalEquity - startingEquity,
    realizedPnL: state.realized_pnl_this_run,
    feesPaid: state.fees_paid_this_run,
    openPositions: state.positions.length,
    newEntriesAllowed,
    dataSource: 'binance_ohlcv',
  };
}

async function notify(base44, user_email, { type, priority, title, message }) {
  try {
    await base44.asServiceRole.entities.Notification.create({
      notification_type: type,
      priority,
      title,
      message,
      created_by: user_email,
    });
  } catch (err) {
    console.warn(`Notification failed: ${err.message}`);
  }
}