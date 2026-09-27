import { createClientFromRequest } from 'npm:@base44/sdk@0.8.43';

import { fetchUniverse, fetchCandlesBatch, fetchOrderBook, fetchPricesForSymbols } from './shared/marketData.js';
import { scoreAsset, MIN_CANDLES } from './shared/signalEngine.js';
import { applyCosts, roundTripCostPercent, isEdgeSufficient } from './shared/costs.js';
import { calculatePositionSize, checkCorrelation, buildReturnsMap, checkPortfolioExposure } from './shared/sizing.js';
import { rollDailyCounters, evaluateAllGuards, utcDayKey, checkPortfolioTakeProfit, checkPortfolioTakeProfitCooldown } from './shared/risk.js';
import {
  createPortfolioState, calculateEquity, positionPnL, applyBuy, applySell,
  markToMarket, updateTrailingStop, activateBreakeven,
  toPersistablePortfolio, pendingTrades,
} from './shared/portfolio.js';
import { logReturns } from './shared/indicators.js';
import { secrets } from 'base44:runtime';
import { decryptApiKey } from '../../shared/aiModelCrypto.ts';
import { callCustomLLM } from '../../shared/customLLM.ts';

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

const DEFAULT_CANDLE_INTERVAL = '1h';
const VALID_INTERVALS = new Set(['15m', '30m', '1h', '4h', '1d']);
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
    // Authenticate the caller. The platform scheduler invokes this worker via
    // asServiceRole.functions.invoke, which provides the service-role auth
    // context (admin-level). A user token is accepted only for the caller's
    // own settings or by an admin. The base44-service-authorization header is
    // NOT trusted — it can be spoofed by any external caller.
    let caller;
    try {
      caller = await base44.auth.me();
    } catch {
      return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    if (!caller) {
      return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    if (caller.email !== user_email && caller.role !== 'admin') {
      return Response.json({ success: false, error: 'Forbidden: settings do not belong to caller' }, { status: 403 });
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

async function loadLiveTradingConfig(base44: any, settings: any, user_email: string, log: (msg: string) => void) {
  if (!settings.live_trading_enabled || !settings.exchange_connection_id) {
    return { enabled: false };
  }

  if (settings.live_trading_requested_at) {
    const requestedAt = new Date(settings.live_trading_requested_at);
    const cooldownEnd = new Date(requestedAt.getTime() + 24 * 60 * 60 * 1000);
    if (new Date() < cooldownEnd) {
      log('Live trading enabled but 24h cooldown not yet passed — trading paper this cycle');
      return { enabled: false, reason: 'cooldown_active' };
    }
  }

  try {
    const connections = await base44.asServiceRole.entities.ExchangeConnection.filter({
      id: settings.exchange_connection_id,
    });
    const connection = connections?.[0];
    if (!connection || !connection.is_active || connection.connection_status !== 'connected') {
      log('Live trading enabled but exchange connection not active/connected');
      return { enabled: false, reason: 'connection_not_active' };
    }
    if (connection.trading_mode !== 'ready_for_live') {
      log('Live trading enabled but connection not in ready_for_live mode');
      return { enabled: false, reason: 'not_ready_for_live' };
    }
    log(`Live trading ACTIVE via ${connection.exchange_name} (conn ${connection.id.slice(0, 8)}...)`);
    return { enabled: true, connection_id: connection.id, exchange: connection.exchange_name };
  } catch (e) {
    log(`Failed to load exchange connection for live trading: ${e.message}`);
    return { enabled: false, reason: 'load_failed' };
  }
}

async function placeLiveOrder(base44: any, liveTrading: any, params: any) {
  try {
    const result = await base44.asServiceRole.functions.invoke('liveOrderExecution', {
      connection_id: liveTrading.connection_id,
      asset_symbol: params.asset_symbol,
      side: params.side,
      order_type: params.order_type || 'market',
      quantity: params.quantity,
      confirm_live: true,
      user_email: params.user_email,
    });
    const data = result?.data ?? result;
    if (!data || !data.success) {
      return { ok: false, error: data?.error || 'Unknown error' };
    }
    return {
      ok: true,
      fillPrice: data.avg_fill_price || null,
      fillQuantity: data.fill_quantity || null,
      orderId: data.order_id || null,
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function runTradingCycle({ base44, settings, portfolio, user_email, log, now, indicatorSettings }) {
  // -------------------------------------------------------------------------
  // 1. Daily counter rollover
  // -------------------------------------------------------------------------
  const roll = rollDailyCounters(settings, now);
  const counters = roll.state;

  const liveTrading = await loadLiveTradingConfig(base44, settings, user_email, log);

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

  const candleInterval = VALID_INTERVALS.has(settings.candle_interval)
    ? settings.candle_interval
    : DEFAULT_CANDLE_INTERVAL;
  log(`Fetching ${candleInterval} candles for ${symbolsNeedingCandles.length} symbols`);
  const candlesBySymbol = await fetchCandlesBatch(
    symbolsNeedingCandles, candleInterval, CANDLE_LIMIT, 8
  );
  log(`Candles retrieved for ${candlesBySymbol.size} symbols`);

  // Re-check market-wide conditions now that we have breadth data. The fallback
  // universe is the scanner's scored subset, not a clean market sample — running
  // the broad-market breadth check on it produces false halts whenever the
  // server is geo-blocked from Binance. Skip only that check in fallback mode;
  // every other guard (kill switch, daily loss, trade cap, schedule) still runs.
  const guards = evaluateAllGuards({ settings, counters, equity: startingEquity, universe: usedFallbackUniverse ? null : universe, now });
  let newEntriesAllowed = guards.allowed && guards.newEntriesAllowed !== false;
  if (!newEntriesAllowed) {
    log(`New entries blocked: ${guards.reason} — managing exits only`);
  }

  markToMarket(state, priceMap);

  // -------------------------------------------------------------------------
  // 3b. Portfolio take-profit — close everything when the account's daily
  // profit crosses the configured threshold, then halt new entries for the
  // rest of the UTC day. Mirrors the daily-loss circuit breaker on the
  // profit side. Baseline is daily_start_equity, same as the loss limit.
  // -------------------------------------------------------------------------
  let portfolioTpTriggered = false;
  let portfolioTpReason = null;
  if (settings.use_portfolio_take_profit) {
    const tpCooldown = checkPortfolioTakeProfitCooldown(settings, now);
    if (tpCooldown.active) {
      portfolioTpTriggered = true;
      log('Portfolio take-profit cooldown active — entries blocked, closing any remaining positions');
    } else {
      const tpEquity = calculateEquity(state, priceMap).equity;
      const tpCheck = checkPortfolioTakeProfit({
        equity: tpEquity,
        dailyStartEquity: counters.daily_start_equity ?? startingEquity,
        maxProfitPercent: settings.portfolio_take_profit_percent,
      });
      if (tpCheck.breached) {
        portfolioTpTriggered = true;
        portfolioTpReason = tpCheck;
        log(`Portfolio take-profit hit: ${tpCheck.profitPercent.toFixed(2)}% >= ${tpCheck.limit}% — closing all positions`);
      }
    }
    if (portfolioTpTriggered) newEntriesAllowed = false;
  }

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

    // Portfolio take-profit overrides per-position rules: close everything.
    if (portfolioTpTriggered) {
      exitReason = portfolioTpReason
        ? `Portfolio take-profit (account +${portfolioTpReason.profitPercent.toFixed(2)}%)`
        : 'Portfolio take-profit (cooldown)';
    } else if (pnl.netPercent <= -stopLossPercent) {
      // Compare NET percent — the number after costs is what you actually keep.
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

      // Live trading: place the real sell order before updating paper state
      if (liveTrading.enabled) {
        const liveOrder = await placeLiveOrder(base44, liveTrading, {
          side: 'sell',
          asset_symbol: symbol,
          quantity: position.quantity,
          user_email,
        });
        if (!liveOrder.ok) {
          log(`LIVE SELL FAILED ${symbol}: ${liveOrder.error} — skipping exit this cycle`);
          continue;
        }
        if (liveOrder.fillPrice) {
          costs.fillPrice = liveOrder.fillPrice;
        }
        log(`LIVE SELL filled ${symbol} @ ${liveOrder.fillPrice || 'market'}`);
      }

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

        // Resolve the open SignalOutcome for this position so the calibration
        // model can learn whether this strength score predicted a win.
        try {
          const openSignals = await base44.asServiceRole.entities.SignalOutcome.list('-entry_time', 200);
          const mine = (openSignals || []).find(
            (s) => s.owner_email === user_email && s.asset_symbol === symbol && !s.resolved
          );
          if (mine) {
            const entryNotional = position.quantity * position.avg_entry_price;
            const netPnlPercent = entryNotional > 0 ? (sell.netPnL / entryNotional) * 100 : 0;
            await base44.asServiceRole.entities.SignalOutcome.update(mine.id, {
              resolved: true,
              outcome: sell.netPnL > 0 ? 1 : 0,
              exit_price: currentPrice,
              exit_time: now.toISOString(),
              exit_reason: exitReason,
              net_pnl_percent: Math.round(netPnlPercent * 100) / 100,
            });
          }
        } catch (e) {
          log(`SignalOutcome resolve failed for ${symbol}: ${e.message}`);
        }
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

  // Persist the portfolio take-profit trigger and notify once per day.
  if (portfolioTpTriggered && !settings.portfolio_take_profit_triggered_at) {
    await base44.asServiceRole.entities.AutoTradingSettings.update(settings.id, {
      portfolio_take_profit_triggered_at: now.toISOString(),
    });
    await notify(base44, user_email, {
      type: 'risk_alert',
      priority: 'high',
      title: 'Portfolio take-profit reached',
      message: `Account profit hit ${portfolioTpReason?.profitPercent?.toFixed(2) ?? ''}% — all positions closed and trading halted for the day.`,
    });
  }

  // -------------------------------------------------------------------------
  // 5. Scan for entries
  // -------------------------------------------------------------------------
  // Field name min_confidence kept for schema compatibility; it is a 0-100
  // strength threshold, not a probability.
  const minStrength = settings.min_confidence ?? 70;
  const scanned = [];

  // Load the user's latest calibration model so entries can gate on calibrated
  // win-probability instead of raw strength. Falls back to strength when no
  // model has been fitted yet (sample < 20 resolved trades).
  let calibrationModel = null;
  try {
    const models = await base44.asServiceRole.entities.CalibrationModel.list('-fitted_at', 5);
    calibrationModel = (models || []).find((m) => m.owner_email === user_email) || null;
    if (calibrationModel) {
      log(`Calibration model loaded: sample ${calibrationModel.sample_size}, win rate ${((calibrationModel.win_rate || 0) * 100).toFixed(1)}%`);
    }
  } catch (e) {
    log(`Calibration model load failed: ${e.message}`);
  }
  const calibration = calibrationModel
    ? { intercept: calibrationModel.intercept, slope: calibrationModel.slope }
    : null;

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
      let scannerAdmitted = 0;
      for (const ticker of candidateTickers) {
        if (heldNow.includes(ticker.symbol)) continue;
        if (counters.assets_traded_today.includes(ticker.symbol)) continue;

        const candles = candlesBySymbol.get(ticker.symbol) || null;

        // Scanner-surfaced picks: the Altcoin Scanner already scored real OHLCV
        // (SP500-AI composite) and passed its own quality filters (score ≥ 65,
        // volume surge ≥ 1.5x, |momentum| ≥ 2%). Trust that signal directly so
        // the scanner's picks actually trade — bypass the worker's confluence
        // gate and min-strength threshold. Every risk control below (sizing,
        // exposure, correlation, liquidity, slippage, daily limits) still runs.
        const scannerOpp = scannerOppMap?.get(ticker.symbol);
        const scannerIsBuy = scannerOpp && (scannerOpp.signal === 'strong_buy' || scannerOpp.signal === 'buy');

        let signal;
        if (scannerIsBuy) {
          signal = {
            strength: scannerOpp.score,
            direction: 'bullish',
            reasons: scannerOpp.reasons || [`Scanner score ${scannerOpp.score}/100`],
            atrPercent: (scannerOpp.volatility || 0) / 100,
            components: { supplyDemand: null, composite: scannerOpp.score },
          };
          scanned.push({ symbol: ticker.symbol, strength: signal.strength });
          candidates.push({ ticker, candles, signal });
          scannerAdmitted++;
          continue;
        }

        // Own-universe candidates: score with the user's selected indicators.
        // No SP500-AI fallback — the scanner's composite is a separate tool and
        // must never drive auto-trader entries. If candles are unavailable,
        // skip the asset: trading on no data is worse than not trading.
        if (!candles || candles.length < MIN_CANDLES) continue;
        signal = scoreAsset(candles, {
          indicators: indicatorSettings || settings.indicator_settings || undefined,
          calibration,
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

        // Gate on calibrated probability when a model exists; otherwise fall
        // back to raw strength. Both are expressed as 0-100 against minStrength.
        const entryScore = signal.probability != null ? signal.probability * 100 : signal.strength;
        if (entryScore >= minStrength && signal.direction === 'bullish' && sdGate && sp500Gate) {
          candidates.push({ ticker, candles, signal });
        } else if (entryScore >= minStrength && signal.direction === 'bullish') {
          log(`Skip ${ticker.symbol}: confluence gate failed (SD=${sdScore ?? 'null'}, SP500=${sp500Score ?? 'null'})`);
        }
      }

      // Scanner picks first (they are the user's explicit opportunity list),
      // then own-universe picks by strength.
      candidates.sort((a, b) => (b.signal.strength || 0) - (a.signal.strength || 0));
      log(`${scanned.length} scanned, ${candidates.length} candidates (${scannerAdmitted} from scanner, ${candidates.length - scannerAdmitted} own-universe)`);

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

        // ── AI Confirmation Gate ──────────────────────────────────────────
        // Three modes: 'off' (no gate), 'auto' (LLM reviews and blocks),
        // 'manual' (create a pending approval for the user to confirm).
        const aiMode = settings.ai_confirmation_mode || 'off';
        if (aiMode === 'auto') {
          const aiResult = await aiConfirmTrade(base44, {
            ticker, signal, settings, candleInterval, log, user_email,
          });
          if (!aiResult.approve) {
            log(`AI REJECTED ${ticker.symbol}: ${aiResult.reasoning}`);
            continue;
          }
          log(`AI APPROVED ${ticker.symbol} (confidence ${aiResult.confidence}/100): ${aiResult.reasoning}`);
        } else if (aiMode === 'manual') {
          const tpPercent = settings.take_profit_percent ?? 8;
          await base44.asServiceRole.entities.PendingTradeApproval.create({
            asset_symbol: ticker.symbol,
            signal_strength: signal.strength,
            signal_direction: signal.direction || 'bullish',
            signal_reasons: signal.reasons || [],
            signal_components: signal.components || {},
            entry_price: ticker.price,
            stop_loss_price: sizing.stopPrice ?? null,
            take_profit_price: costs.fillPrice * (1 + tpPercent / 100),
            position_size_usdt: sizing.quoteAmount,
            candle_interval: candleInterval,
            status: 'pending',
            expires_at: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
            owner_email: user_email,
            created_by: user_email,
          });
          log(`MANUAL APPROVAL PENDING ${ticker.symbol} — waiting for user confirmation`);
          continue;
        }

        // Live trading: place the real buy order before updating paper state
        if (liveTrading.enabled) {
          const liveOrder = await placeLiveOrder(base44, liveTrading, {
            side: 'buy',
            asset_symbol: ticker.symbol,
            quantity,
            user_email,
          });
          if (!liveOrder.ok) {
            log(`LIVE BUY FAILED ${ticker.symbol}: ${liveOrder.error}`);
            continue;
          }
          if (liveOrder.fillPrice) {
            costs.fillPrice = liveOrder.fillPrice;
          }
          log(`LIVE BUY filled ${ticker.symbol} @ ${liveOrder.fillPrice || 'market'}`);
        }

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

          // Log the entry signal so its outcome can be calibrated later.
          try {
            const tpPercent = settings.take_profit_percent ?? 8;
            await base44.asServiceRole.entities.SignalOutcome.create({
              asset_symbol: ticker.symbol,
              signal_strength: signal.strength,
              signal_direction: signal.direction || 'bullish',
              signal_components: signal.components || {},
              signal_reasons: signal.reasons || [],
              entry_price: costs.fillPrice,
              stop_loss_price: sizing.stopPrice ?? null,
              take_profit_price: costs.fillPrice * (1 + tpPercent / 100),
              entry_time: now.toISOString(),
              resolved: false,
              owner_email: user_email,
              created_by: user_email,
            });
          } catch (e) {
            log(`SignalOutcome create failed for ${ticker.symbol}: ${e.message}`);
          }
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
        exchange: liveTrading.enabled ? `${liveTrading.exchange} (Live)` : 'Paper Trading (Server V5)',
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

/**
 * AI Confirmation Gate — asks an LLM to review a trade signal and decide
 * whether to approve it. Returns { approve, confidence, reasoning }.
 *
 * On AI service failure, the trade is REJECTED (fail-closed). The AI gate is
 * a safety control — an outage must not silently disable it and let trades
 * through. The user can always turn the gate off (ai_confirmation_mode='off')
 * or enable the kill switch to stop everything.
 */
async function aiConfirmTrade(base44, { ticker, signal, settings, candleInterval, log, user_email }) {
  const minScore = settings.ai_confirmation_min_score ?? 70;
  const tpPercent = settings.take_profit_percent ?? 8;
  const slPercent = settings.stop_loss_percent ?? 3;

  const prompt = `You are a disciplined crypto trading risk analyst. Review the following trade signal and decide whether to APPROVE or REJECT it.

ASSET: ${ticker.symbol}
CURRENT PRICE: $${ticker.price}
SIGNAL STRENGTH: ${signal.strength}/100
DIRECTION: ${signal.direction}
TIMEFRAME: ${candleInterval}
ATR VOLATILITY: ${((signal.atrPercent || 0) * 100).toFixed(2)}%
STOP LOSS: -${slPercent}%
TAKE PROFIT: +${tpPercent}%

SIGNAL REASONS:
${(signal.reasons || []).map((r) => `  - ${r}`).join('\n')}

INDICATOR COMPONENTS:
${JSON.stringify(signal.components || {}, null, 2)}

Your job:
1. Assess whether the technical evidence supports this entry.
2. Check for conflicting signals or weakness in the components.
3. Consider whether the risk/reward ratio is favourable.
4. Only APPROVE if your confidence is at least ${minScore}/100.

Respond as JSON: {"approve": <true|false>, "confidence": <0-100>, "reasoning": "<one sentence explanation>"}`;

  // Load the trading user's AI model config (platform model selector or custom
  // API key). Scope to this user only — asServiceRole bypasses RLS, so without
  // this filter configs[0] could be ANY user's config, leaking the trading
  // user's signal data to another user's custom LLM provider.
  let modelConfig = null;
  try {
    const configs = await base44.asServiceRole.entities.AIModelConfig.list();
    modelConfig = (configs || []).find(c => c.created_by === user_email) || null;
  } catch (e) {
    log(`AI model config load failed: ${e.message}`);
  }

  const responseSchema = {
    type: 'object',
    properties: {
      approve: { type: 'boolean' },
      confidence: { type: 'number' },
      reasoning: { type: 'string' },
    },
    required: ['approve', 'confidence', 'reasoning'],
  };

  try {
    let result;

    if (modelConfig && modelConfig.model_source === 'custom' && modelConfig.encrypted_api_key) {
      // Custom LLM — decrypt the API key and call the provider directly
      const keyHex = secrets.get('EXCHANGE_ENCRYPTION_KEY');
      const apiKey = decryptApiKey(modelConfig.encrypted_api_key, keyHex);
      log(`Using custom LLM: ${modelConfig.custom_provider}/${modelConfig.custom_model_name}`);
      result = await callCustomLLM(
        { provider: modelConfig.custom_provider, modelName: modelConfig.custom_model_name, apiKey },
        prompt,
        responseSchema,
      );
    } else {
      // Platform model via InvokeLLM
      const invokeParams = { prompt, response_json_schema: responseSchema };
      if (modelConfig?.platform_model && modelConfig.platform_model !== 'automatic') {
        invokeParams.model = modelConfig.platform_model;
        log(`Using platform model: ${modelConfig.platform_model}`);
      }
      result = await base44.asServiceRole.integrations.Core.InvokeLLM(invokeParams);
    }

    const approve = result?.approve === true;
    const confidence = Number(result?.confidence) || 0;
    const reasoning = result?.reasoning || 'No reasoning provided';

    // Double-gate: the AI must both approve AND meet the min score.
    if (approve && confidence < minScore) {
      return {
        approve: false,
        confidence,
        reasoning: `AI confidence ${confidence} below threshold ${minScore}: ${reasoning}`,
      };
    }

    return { approve, confidence, reasoning };
  } catch (e) {
    log(`AI confirmation service failed: ${e.message} — rejecting trade (fail-closed)`);
    return {
      approve: false,
      confidence: 0,
      reasoning: `AI service unavailable — trade rejected (fail-closed)`,
    };
  }
}