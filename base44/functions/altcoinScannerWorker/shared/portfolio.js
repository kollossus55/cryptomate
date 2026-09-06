// GENERATED FILE — DO NOT EDIT.
// Copied from /shared/trading by scripts/sync-shared.mjs.
// Edit the source in /shared/trading and re-run: npm run sync:functions
/**
 * Portfolio state machine.
 *
 * Two classes of bug this replaces:
 *
 * 1. STALE-READ RACE. The old executeTrade() read portfolio.available_balance
 *    and portfolio.positions from the request object, computed a new value, and
 *    wrote the whole thing back — inside a loop. Two stop-losses in one run and
 *    the second sell read the same original balance as the first, so the first
 *    sale's proceeds were silently overwritten and the sold position reappeared
 *    in the positions array. Same for total_trades and total_profit_loss.
 *
 *    Fix: all mutations happen against ONE in-memory object, and the caller
 *    persists once at the end of the run.
 *
 * 2. WRONG P&L. The old code used
 *      profit_loss = totalValue * (profitPercent / 100)
 *    where totalValue = quantity * currentPrice. Correct realised P&L is
 *      quantity * (exitPrice - entryPrice) - fees
 *    The old formula equals the correct one scaled by currentPrice/entryPrice,
 *    so a position that doubles reported twice its actual profit.
 *
 *    It then added that number to total_balance while separately adding the
 *    full sale proceeds to available_balance — double-counting equity, since
 *    cost basis had already been deducted at entry.
 */

/** Take a working copy. Never mutate the object the caller handed you. */
export function createPortfolioState(portfolio) {
  return {
    id: portfolio.id,
    available_balance: portfolio.available_balance || 0,
    positions: (portfolio.positions || []).map((p) => ({ ...p })),
    total_trades: portfolio.total_trades || 0,
    total_profit_loss: portfolio.total_profit_loss || 0,
    realized_pnl_this_run: 0,
    fees_paid_this_run: 0,
    _pendingTrades: [],
    _dirty: false,
  };
}

/**
 * Mark-to-market equity.
 *
 * Derived from cash plus current position values, NOT accumulated. The old
 * code incremented total_balance by each trade's P&L, which drifts from
 * reality the moment any single write is lost or double-applied.
 */
export function calculateEquity(state, pricesBySymbol) {
  let positionsValue = 0;
  for (const pos of state.positions) {
    const price = pricesBySymbol.get(pos.asset_symbol) ?? pos.last_known_price ?? pos.avg_entry_price;
    positionsValue += pos.quantity * price;
  }
  return {
    cash: state.available_balance,
    positionsValue,
    equity: state.available_balance + positionsValue,
  };
}

/** Unrealised P&L for one position, net of the fee paid on entry. */
export function positionPnL(position, currentPrice) {
  const grossPnL = position.quantity * (currentPrice - position.avg_entry_price);
  const entryFees = position.fees_paid || 0;
  const costBasis = position.quantity * position.avg_entry_price;
  return {
    grossPnL,
    netPnL: grossPnL - entryFees,
    percent: costBasis > 0 ? (grossPnL / costBasis) * 100 : 0,
    // The number that matters for a stop: what you keep after exit costs.
    netPercent: costBasis > 0 ? ((grossPnL - entryFees) / costBasis) * 100 : 0,
  };
}

/**
 * Open or add to a position.
 *
 * @param costs  result of applyCosts() — fillPrice and fee are used so the
 *               recorded entry reflects what was actually paid.
 */
export function applyBuy(state, { symbol, quantity, costs, strength, reason, timestamp }) {
  const fillPrice = costs.fillPrice;
  const notional = quantity * fillPrice;
  const fee = costs.fee;
  const totalDebit = notional + fee;

  if (totalDebit > state.available_balance) {
    return { ok: false, reason: 'insufficient_balance' };
  }

  state.available_balance -= totalDebit;
  state.fees_paid_this_run += fee;

  const existing = state.positions.find((p) => p.asset_symbol === symbol);

  if (existing) {
    // Weighted-average entry across the combined position.
    const newQuantity = existing.quantity + quantity;
    const newCostBasis = existing.quantity * existing.avg_entry_price + notional;
    existing.avg_entry_price = newCostBasis / newQuantity;
    existing.quantity = newQuantity;
    existing.current_value = newQuantity * fillPrice;
    existing.fees_paid = (existing.fees_paid || 0) + fee;
    existing.highest_price = Math.max(existing.highest_price || 0, fillPrice);
    existing.last_known_price = fillPrice;
    existing.dca_count = (existing.dca_count || 0) + 1;
  } else {
    state.positions.push({
      asset_symbol: symbol,
      quantity,
      avg_entry_price: fillPrice,
      current_value: notional,
      fees_paid: fee,
      profit_loss: 0,
      highest_price: fillPrice,
      last_known_price: fillPrice,
      opened_at: timestamp || new Date().toISOString(),
      dca_count: 0,
      breakeven_activated: false,
      trailing_stop_price: null,
      partial_profits_taken: [],
    });
  }

  state.total_trades += 1;
  state._dirty = true;
  state._pendingTrades.push({
    asset_symbol: symbol,
    trade_type: 'buy',
    quantity,
    price: fillPrice,
    total_value: notional,
    fee,
    slippage_percent: costs.slippagePercent * 100,
    profit_loss: 0,
    signal_strength: strength,
    reason,
    timestamp: timestamp || new Date().toISOString(),
  });

  return { ok: true, notional, fee, fillPrice };
}

/**
 * Close all or part of a position, with correct realised P&L.
 */
export function applySell(state, { symbol, quantity, costs, strength, reason, timestamp }) {
  const index = state.positions.findIndex((p) => p.asset_symbol === symbol);
  if (index === -1) return { ok: false, reason: 'position_not_found' };

  const position = state.positions[index];
  const sellQuantity = Math.min(quantity, position.quantity);
  if (sellQuantity <= 0) return { ok: false, reason: 'invalid_quantity' };

  const fillPrice = costs.fillPrice;
  const proceeds = sellQuantity * fillPrice;
  const fee = costs.fee;
  const netProceeds = proceeds - fee;

  // Realised P&L: quantity * (exit - entry), minus the fees attributable to
  // this portion of the position (entry fee pro-rated + this exit fee).
  const fraction = sellQuantity / position.quantity;
  const entryFeeShare = (position.fees_paid || 0) * fraction;
  const grossPnL = sellQuantity * (fillPrice - position.avg_entry_price);
  const netPnL = grossPnL - entryFeeShare - fee;

  state.available_balance += netProceeds;
  state.total_profit_loss += netPnL;
  state.realized_pnl_this_run += netPnL;
  state.fees_paid_this_run += fee;
  state.total_trades += 1;

  if (sellQuantity >= position.quantity - 1e-12) {
    state.positions.splice(index, 1);
  } else {
    position.quantity -= sellQuantity;
    position.fees_paid = (position.fees_paid || 0) - entryFeeShare;
    position.current_value = position.quantity * fillPrice;
    position.last_known_price = fillPrice;
  }

  state._dirty = true;
  state._pendingTrades.push({
    asset_symbol: symbol,
    trade_type: 'sell',
    quantity: sellQuantity,
    price: fillPrice,
    total_value: proceeds,
    fee,
    slippage_percent: costs.slippagePercent * 100,
    profit_loss: netPnL,
    gross_profit_loss: grossPnL,
    signal_strength: strength,
    reason,
    timestamp: timestamp || new Date().toISOString(),
  });

  return { ok: true, netPnL, grossPnL, proceeds, fee, fillPrice };
}

/** Refresh marks so equity and trailing stops use current prices. */
export function markToMarket(state, pricesBySymbol) {
  for (const pos of state.positions) {
    const price = pricesBySymbol.get(pos.asset_symbol);
    if (price === undefined) continue;
    pos.last_known_price = price;
    pos.current_value = pos.quantity * price;
    const pnl = positionPnL(pos, price);
    pos.profit_loss = pnl.netPnL;
    pos.highest_price = Math.max(pos.highest_price || pos.avg_entry_price, price);
  }
  state._dirty = true;
}

export function updateTrailingStop(state, symbol, { trailingStopPercent }) {
  const pos = state.positions.find((p) => p.asset_symbol === symbol);
  if (!pos) return { updated: false };

  const high = pos.highest_price || pos.avg_entry_price;
  const newStop = high * (1 - trailingStopPercent / 100);

  // Trailing stops ratchet upward only. Letting one fall would widen risk on a
  // losing position, which is the opposite of the point.
  if (pos.trailing_stop_price === null || newStop > pos.trailing_stop_price) {
    pos.trailing_stop_price = newStop;
    state._dirty = true;
    return { updated: true, trailingStopPrice: newStop };
  }
  return { updated: false, trailingStopPrice: pos.trailing_stop_price };
}

export function activateBreakeven(state, symbol, { offsetPercent = 0 }) {
  const pos = state.positions.find((p) => p.asset_symbol === symbol);
  if (!pos || pos.breakeven_activated) return { updated: false };

  pos.breakeven_activated = true;
  pos.breakeven_price = pos.avg_entry_price * (1 + offsetPercent / 100);
  state._dirty = true;
  return { updated: true, breakevenPrice: pos.breakeven_price };
}

/**
 * Everything that needs persisting, as ONE object for ONE write.
 */
export function toPersistablePortfolio(state, pricesBySymbol) {
  const { equity, positionsValue } = calculateEquity(state, pricesBySymbol);
  return {
    available_balance: round(state.available_balance),
    total_balance: round(equity),           // derived, never accumulated
    positions_value: round(positionsValue),
    positions: state.positions,
    total_trades: state.total_trades,
    total_profit_loss: round(state.total_profit_loss),
    last_updated: new Date().toISOString(),
  };
}

export function pendingTrades(state) {
  return state._pendingTrades;
}

function round(n, dp = 8) {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
