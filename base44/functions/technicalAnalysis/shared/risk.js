// GENERATED FILE — DO NOT EDIT.
// Copied from /shared/trading by scripts/sync-shared.mjs.
// Edit the source in /shared/trading and re-run: npm run sync:functions
/**
 * Risk guards.
 *
 * Three bugs this replaces:
 *
 * 1. UNIT MISMATCH. The old check was
 *      (settings.daily_loss || 0) >= (settings.max_daily_loss_percent || 0)
 *    comparing accumulated DOLLARS against a PERCENTAGE. A 5% limit tripped at
 *    $5 of loss. And the `|| 0` default meant an unset limit tripped instantly.
 *
 * 2. NOT ENFORCED SERVER-SIDE. The browser engine checked these limits; the
 *    server worker only incremented the counters. Since the scheduler routes
 *    everyone with execution_mode !== 'browser' to the worker, the default
 *    path had no circuit breaker and no daily trade cap at all.
 *
 * 3. NO DAILY RESET. Nothing ever cleared trades_today, daily_loss or
 *    assets_traded_today, so assets_traded_today grew forever and permanently
 *    excluded more of the universe on every run.
 */

/** UTC calendar day key. UTC, not local, so the reset does not drift. */
export function utcDayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

/**
 * Roll daily counters if the stored day is not today.
 *
 * Returns { needsReset, resetFields, state } where `state` is the counter set
 * to use for this run — so a caller gets correct values immediately without
 * waiting for the DB write to land.
 */
export function rollDailyCounters(settings, now = new Date()) {
  const today = utcDayKey(now);
  const storedDay = settings.daily_counters_date
    || (settings.last_trade_date ? utcDayKey(new Date(settings.last_trade_date)) : null);

  if (storedDay === today) {
    return {
      needsReset: false,
      resetFields: null,
      state: {
        trades_today: settings.trades_today || 0,
        daily_loss: settings.daily_loss || 0,
        daily_start_equity: settings.daily_start_equity || null,
        assets_traded_today: settings.assets_traded_today || [],
      },
    };
  }

  const resetFields = {
    trades_today: 0,
    daily_loss: 0,
    assets_traded_today: [],
    daily_counters_date: today,
    daily_start_equity: null, // caller sets from current equity
  };

  return {
    needsReset: true,
    resetFields,
    state: {
      trades_today: 0,
      daily_loss: 0,
      daily_start_equity: null,
      assets_traded_today: [],
    },
  };
}

/**
 * Daily loss limit, in the right units.
 *
 * `daily_loss` accumulates dollars. `max_daily_loss_percent` is a percentage of
 * the equity you started the day with. Convert before comparing.
 */
export function checkDailyLossLimit({ dailyLoss, dailyStartEquity, maxDailyLossPercent }) {
  const limit = typeof maxDailyLossPercent === 'number' ? maxDailyLossPercent : 5;

  if (!dailyStartEquity || dailyStartEquity <= 0) {
    // Cannot evaluate the limit. Fail CLOSED: a risk control that cannot be
    // evaluated must block, not wave trades through.
    return { breached: true, reason: 'daily_start_equity_unknown', lossPercent: null, limit };
  }

  const lossPercent = (dailyLoss / dailyStartEquity) * 100;
  return {
    breached: lossPercent >= limit,
    reason: lossPercent >= limit ? 'daily_loss_limit' : 'ok',
    lossPercent,
    limit,
    remaining: Math.max(0, limit - lossPercent),
  };
}

export function checkTradeLimit({ tradesToday, maxTradesPerDay }) {
  const limit = typeof maxTradesPerDay === 'number' ? maxTradesPerDay : 10;
  return {
    breached: (tradesToday || 0) >= limit,
    reason: (tradesToday || 0) >= limit ? 'daily_trade_limit' : 'ok',
    tradesToday: tradesToday || 0,
    limit,
  };
}

/** Cooldown after the breaker fires — stops instant re-entry into the same conditions. */
export function checkCircuitBreakerCooldown(settings, now = new Date()) {
  if (!settings.circuit_breaker_triggered_at) return { active: false };

  const triggered = new Date(settings.circuit_breaker_triggered_at).getTime();
  const cooldownMs = (settings.circuit_breaker_cooldown_minutes || 60) * 60 * 1000;
  const elapsed = now.getTime() - triggered;

  if (elapsed < cooldownMs) {
    return {
      active: true,
      reason: 'circuit_breaker_cooldown',
      minutesRemaining: Math.ceil((cooldownMs - elapsed) / 60000),
    };
  }
  return { active: false };
}

export function checkSchedule(settings, now = new Date()) {
  const schedule = settings.trading_schedule;
  if (!schedule?.enabled) return { allowed: true };

  const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const today = days[now.getUTCDay()];
  if (Array.isArray(schedule.days) && !schedule.days.includes(today)) {
    return { allowed: false, reason: 'schedule_day_paused' };
  }

  const hour = now.getUTCHours();
  const start = schedule.start_hour ?? 0;
  const end = schedule.end_hour ?? 24;

  // Support windows that wrap midnight (e.g. 22:00 -> 06:00).
  const inWindow = start <= end ? hour >= start && hour < end : hour >= start || hour < end;
  if (!inWindow) return { allowed: false, reason: 'schedule_hour_paused' };

  return { allowed: true };
}

/**
 * Market-wide halt.
 *
 * When most of the universe is dumping together, per-asset signals stop being
 * informative — everything correlates to one and the strategy is just long
 * beta into a crash.
 */
export function checkMarketConditions(universe, { crashThreshold = -8, breadthThreshold = 0.7 } = {}) {
  if (!universe || universe.length < 10) {
    return { halt: false, reason: 'insufficient_universe_data' };
  }

  const declining = universe.filter((a) => a.change24h < 0).length;
  const crashing = universe.filter((a) => a.change24h < crashThreshold).length;
  const breadth = declining / universe.length;

  if (crashing / universe.length > 0.5) {
    return { halt: true, reason: 'market_crash', breadth, crashingPercent: crashing / universe.length };
  }
  if (breadth > breadthThreshold) {
    return { halt: true, reason: 'broad_market_decline', breadth };
  }
  return { halt: false, reason: 'ok', breadth };
}

/**
 * Single gate every trading run must pass.
 *
 * Deliberately ordered cheapest-first: the kill switch and schedule cost
 * nothing to evaluate, so a halted account never triggers a market data fetch.
 */
export function evaluateAllGuards({ settings, counters, equity, universe, now = new Date() }) {
  // Manual kill switch — flip without a deploy, overrides everything.
  if (settings.kill_switch_enabled) {
    return { allowed: false, reason: 'kill_switch_enabled', halting: true };
  }
  if (!settings.is_enabled) {
    return { allowed: false, reason: 'auto_trading_disabled' };
  }

  const cooldown = checkCircuitBreakerCooldown(settings, now);
  if (cooldown.active) {
    return { allowed: false, reason: cooldown.reason, minutesRemaining: cooldown.minutesRemaining };
  }

  const schedule = checkSchedule(settings, now);
  if (!schedule.allowed) return { allowed: false, reason: schedule.reason };

  const lossCheck = checkDailyLossLimit({
    dailyLoss: counters.daily_loss,
    dailyStartEquity: counters.daily_start_equity ?? equity,
    maxDailyLossPercent: settings.max_daily_loss_percent,
  });
  if (lossCheck.breached) {
    return { allowed: false, reason: lossCheck.reason, detail: lossCheck, tripBreaker: true };
  }

  const tradeCheck = checkTradeLimit({
    tradesToday: counters.trades_today,
    maxTradesPerDay: settings.max_trades_per_day,
  });
  // A trade cap blocks NEW entries but must not block exits — a stop-loss has
  // to be able to fire on trade number 11.
  const newEntriesAllowed = !tradeCheck.breached;

  let marketHalt = { halt: false };
  if (universe) {
    marketHalt = checkMarketConditions(universe);
    if (marketHalt.halt) {
      return {
        allowed: true,
        newEntriesAllowed: false,
        reason: marketHalt.reason,
        detail: marketHalt,
        manageExitsOnly: true,
      };
    }
  }

  return {
    allowed: true,
    newEntriesAllowed,
    reason: newEntriesAllowed ? 'ok' : tradeCheck.reason,
    lossCheck,
    tradeCheck,
    marketHalt,
  };
}
