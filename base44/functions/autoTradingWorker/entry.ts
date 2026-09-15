import { createClientFromRequest } from 'npm:@base44/sdk@0.8.43';

import { fetchUniverse, fetchCandlesBatch, fetchOrderBook, fetchPricesForSymbols } from './shared/marketData.js';
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
const UNIVERSE_SIZE = 100;
const MAX_SCAN_CANDIDATES = 100;
// Liquidity floor for symbols admitted from a scan that are outside this
// worker's own volume-ranked universe. Matches the scanner's own floor.
const MIN_ADMIT_QUOTE_VOLUME = 400_000;
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

    // Authenticate the caller. Two legitimate paths exist:
    //   1. A user token (browser/manual call) — may only act on their own settings.
    //   2. The platform scheduler — no user token, but carries the internal
    //      `base44-service-authorization` header that only the platform sets.
    // An unauthenticated external request has neither and must be rejected;
    // previously the catch block assumed every tokenless call was internal.
    const hasServiceAuth = !!req.headers.get('base44-service-authorization');
    let caller = null;
    try {
      caller = await base44.auth.me();
    } catch {
      // No user token — only allowed if the platform scheduler header is present.
    }
    // Service role (platform scheduler or asServiceRole.functions.invoke from
    // another backend function) is trusted to act on any user's behalf. A
    // user token is only accepted for the caller's own settings or by an admin.
    if (hasServiceAuth) {
      log('Authorized via service role');
    } else if (caller) {
      if (caller.email !== user_email && caller.role !== 'admin') {
        return Response.json({ success: false, error: 'Forbidden: settings do not belong to caller' }, { status: 403 });
      }
    } else {
      return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 });
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

    // Fetch the user's AI signal config to get their selected indicators.
    // The auto-trader must score with the indicators the user enabled on the
    // AISignals page (RSI, MACD, Bollinger, EMA, Stochastic), not the scanner's
    // SP500-AI composite.
    let indicatorSettings = null;
    try {
      const configs = await base44.asServiceRole.entities.AISignalConfig.list();
      const userConfigs = configs.filter(c => c.created_by === user_email);
      const active = userConfigs.find(c => c.is_active) || userConfigs[0];
      if (active?.indicator_settings) {
        indicatorSettings = active.indicator_settings;
        const enabled = Object.entries(indicatorSettings).filter(([, v]) => v).map(([k]) => k);
        log(`Indicators from AISignalConfig "${active.config_name}": ${enabled.join(', ') || 'none'}`);
      }
    } catch (e) {
      log(`AISignalConfig fetch failed: ${e.message}`);
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
      const result = await runTradingCycle({ base44, settings, portfolio, user_email, log, now, indicatorSettings });
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

async function runTradingCycle({ base44, settings, portfolio, user_email, log, now, indicatorSettings }) {
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
  let usedFallbackUniverse = false;
  try {
    universe = await fetchUniverse({ topN: UNIVERSE_SIZE, minQuoteVolume24h: 400_000 });
    log(`Universe: ${universe.length} liquid USDT pairs`);
  } catch (err) {
    // OKX (or Coinbase fallback) unreachable. Fall back to the latest
    // browser-fed scanner result so trading continues on real data.
    log(`Market data provider unreachable from server (${err.message}) — using scanner fallback`);
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
        usedFallbackUniverse = true;
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

  // Held positions that aren't in the universe (obscure altcoins below the
  // liquidity floor or top-N cap) still need live prices for markToMarket and
  // exit decisions. Without this, their current_value stays at the entry
  // notional and profit_loss shows only the entry fee — stale unrealized P&L.
  const heldMissingPrice = state.positions
    .filter((p) => {
      const cached = priceMap.get(p.asset_symbol);
      return cached === undefined || cached === p.avg_entry_price;
    })
    .map((p) => p.asset_symbol);
  if (heldMissingPrice.length > 0) {
    try {
      const livePrices = await fetchPricesForSymbols(heldMissingPrice);
      let found = 0;
      for (const [sym, price] of livePrices) {
        priceMap.set(sym, price);
        found++;
      }
      if (found) log(`Fetched live prices for ${found}/${heldMissingPrice.length} held positions outside universe`);
    } catch (e) {
      log(`Live price fetch for held positions failed: ${e.message}`);
    }
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
    // The server is geo-blocked from Binance, so the scheduled scan cannot
    // refresh — only a browser (Altcoin Scanner page) feeds real data. Use the
    // latest real scan even if it is hours old; it is still real OHLCV data,
    // which beats not trading. Log staleness so it is never silent.
    const SCAN_STALE_MS = 24 * 60 * 60 * 1000;
    const scanAgeMs = latest?.scanned_at ? now.getTime() - new Date(latest.scanned_at).getTime() : Infinity;
    if (scanAgeMs > 20 * 60 * 1000 && scanAgeMs !== Infinity) log(`Scan is ${Math.round(scanAgeMs / 60000)} min old — using latest real scan`);
    if (latest && !latest.error && Array.isArray(latest.opportunities) && latest.scanned_at
        && scanAgeMs < SCAN_STALE_MS) {
      scannerOppMap = new Map();
      let admitted = 0;
      for (const opp of latest.opportunities) {
        if (!opp || !opp.symbol) continue;
        const pair = opp.symbol + 'USDT';

        // The scanner covers 100 symbols; this worker's own universe is only
        // the top 60 by volume. Previously anything the scanner found outside
        // that top 60 was DISCARDED here — which is exactly the altcoins the
        // scanner exists to surface. The scan found them, scored them, and the
        // worker silently dropped them for not being large enough.
        //
        // Scanner picks now EXTEND the universe rather than being filtered by
        // it. A scanner opportunity carries its own price and 24h volume, so
        // it can stand as a universe entry in its own right.
        if (!universeBySymbol.has(pair)) {
          const price = Number(opp.price);
          const vol = Number(opp.volume24h);
          // Still enforce the liquidity floor. Below it, modelled slippage is
          // guesswork and the spread eats any edge the signal might have.
          if (!Number.isFinite(price) || price <= 0) continue;
          if (!Number.isFinite(vol) || vol < MIN_ADMIT_QUOTE_VOLUME) continue;

          const entry = {
            symbol: pair,
            base: opp.symbol,
            price,
            change24h: Number(opp.momentum) || 0,
            quoteVolume24h: vol,
            high24h: null,
            low24h: null,
            trades24h: null,
            fromScanner: true,
          };
          universe.push(entry);
          universeBySymbol.set(pair, entry);
          admitted++;
        }
        scannerOppMap.set(pair, opp);
      }
      log(`Using scanner candidates: ${scannerOppMap.size} from scan @ ${latest.scanned_at}` +
          (admitted ? ` (${admitted} admitted beyond the top-${UNIVERSE_SIZE} universe)` : ''));
    }
  } catch (e) {
    log(`ScanResult read failed: ${e.message}`);
  }

  // Always scan the top MAX_SCAN_CANDIDATES from the universe (own OKX fetch +
  // scanner admits), scored with the user's indicators. The scanner's role is
  // to surface candidates; the worker re-scores everything itself.
  const scanSymbols = universe.slice(0, MAX_SCAN_CANDIDATES).map((u) => u.symbol);
  log(`Scanning ${scanSymbols.length} candidates from universe of ${universe.length}`);

  const symbolsNeedingCandles = [...new Set([...heldSymbols, ...scanSymbols])];

  log(`Fetching ${CANDLE_INTERVAL} candles for ${symbolsNeedingCandles.length} symbols`);
  const candlesBySymbol = await fetchCandlesBatch(
    symbolsNeedingCandles, CANDLE_INTERVAL, CANDLE_LIMIT, 8
  );
  log(`Candles retrieved for ${candlesBySymbol.size} symbols`);

  // Re-check market-wide conditions now that we have breadth data. The fallback
  // universe is the scanner's scored subset, not a clean market sample — running
  // the broad-market breadth check on it produces false halts whenever the
  // server is geo-blocked from Binance. Skip only that check in fallback mode;
  // every other guard (kill switch, daily loss, trade cap, schedule) still runs.
  const guards = evaluateAllGuards({ settings, counters, equity: startingEquity, universe: usedFallbackUniverse ? null : universe, now });
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

    // Signal-based exit: sell when the enabled confluence indicators turn
    // bearish. S&D (if enabled) must be bearish; SP500-AI (if enabled) must be
    // bearish. Mirrors the entry gate — only enabled indicators gate, so a
    // single-indicator setup can still exit on its own signal.
    if (!exitReason) {
      const heldCandles = candlesBySymbol.get(symbol);
      if (heldCandles && heldCandles.length >= MIN_CANDLES) {
        const heldSignal = scoreAsset(heldCandles, {
          indicators: indicatorSettings || settings.indicator_settings || undefined,
        });
        if (heldSignal) {
          const effInd = indicatorSettings || settings.indicator_settings || {};
          const sdScore = heldSignal.components?.supplyDemand;
          const sp500Score = heldSignal.components?.composite;
          const sdBearish = !effInd.supply_demand || (sdScore !== null && sdScore !== undefined && sdScore < 50);
          const sp500Bearish = !effInd.sp500ai || (sp500Score !== null && sp500Score !== undefined && sp500Score < 50);
          if (sdBearish && sp500Bearish) {
            exitReason = `Bearish confluence exit (SD=${sdScore ?? 'null'}, SP500=${sp500Score ?? 'null'})`;
          }
        }
      }
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

      const candidateTickers = universe.slice(0, MAX_SCAN_CANDIDATES);

      const candidates = [];
      for (const ticker of candidateTickers) {
        if (heldNow.includes(ticker.symbol)) continue;
        if (counters.assets_traded_today.includes(ticker.symbol)) continue;

        const candles = candlesBySymbol.get(ticker.symbol) || null;
        let signal;
        // Score ONLY with the user's selected indicators (from AISignalConfig).
        // No SP500-AI fallback — the scanner's composite is a separate tool and
        // must never drive auto-trader entries. If candles are unavailable,
        // skip the asset: trading on no data is worse than not trading.
        if (!candles || candles.length < MIN_CANDLES) continue;
        signal = scoreAsset(candles, {
          indicators: indicatorSettings || settings.indicator_settings || undefined,
        });
        if (!signal) continue;

        scanned.push({ symbol: ticker.symbol, strength: signal.strength });

        // Confluence gate: each enabled confluence indicator must agree on
        // direction. S&D (if enabled) must be bullish; SP500-AI (if enabled)
        // must be bullish. Indicators that are turned off don't gate — so S&D
        // can drive trades on its own when SP500-AI is off, and vice versa.
        const effInd = indicatorSettings || settings.indicator_settings || {};
        const sdScore = signal.components?.supplyDemand;
        const sp500Score = signal.components?.composite;
        const sdGate = !effInd.supply_demand || (sdScore !== null && sdScore !== undefined && sdScore > 50);
        const sp500Gate = !effInd.sp500ai || (sp500Score !== null && sp500Score !== undefined && sp500Score > 50);

        if (signal.strength >= minStrength && signal.direction === 'bullish' && sdGate && sp500Gate) {
          candidates.push({ ticker, candles, signal });
        } else if (signal.strength >= minStrength && signal.direction === 'bullish') {
          log(`Skip ${ticker.symbol}: confluence gate failed (SD=${sdScore ?? 'null'}, SP500=${sp500Score ?? 'null'})`);
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

        let sizing;
        if (!candles) {
          // Server geo-block: no OHLCV → no ATR. Use flat-percent sizing so the
          // scanner's real-data signals can still execute.
          sizing = { quoteAmount: 0, reason: 'insufficient_data_for_atr' };
        } else {
          sizing = calculatePositionSize({
            equity: equityNow,
            availableBalance: state.available_balance,
            price: ticker.price,
            candles,
            riskPerTradePercent: settings.risk_per_trade_percent ?? 1,
            atrMultiplier: settings.atr_stop_multiplier ?? 2,
            maxPositionPercent: settings.max_position_size_percent ?? 10,
          });
        }

        // No ATR available (geo-block) — fall back to flat-percent sizing.
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

        // Correlation needs candle returns; skip the gate when the server
        // geo-block left us with no candles for this candidate.
        if (candles && heldReturns.size > 0) {
          const corr = checkCorrelation(logReturns(candles), heldReturns, {
            maxCorrelation: settings.max_correlation ?? 0.8,
          });
          if (!corr.allowed) {
            log(`Skip ${ticker.symbol}: ${corr.reason}`);
            continue;
          }
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
          if (candles) heldReturns.set(ticker.symbol, logReturns(candles));
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
    dataSource: 'okx_ohlcv',
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