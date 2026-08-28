// GENERATED FILE — DO NOT EDIT.
// Copied from /shared/trading by scripts/sync-shared.mjs.
// Edit the source in /shared/trading and re-run: npm run sync:functions
/**
 * Trading costs — fees, spread and slippage.
 *
 * The original codebase had none of this. `grep -i "fee\|slippage"` on the
 * worker returned nothing, so a simulated 8% take-profit banked the full 8%.
 * Live, a round trip on Binance spot costs roughly 0.20–0.40% once taker fees,
 * spread and slippage are counted — about 10% of that 8% target, and it turns
 * a 3% stop into a 3.3%+ real loss.
 *
 * The asymmetry is what matters. With SL 3% / TP 8% and no costs you break
 * even at a 27% win rate; with costs you need meaningfully more. A strategy
 * that looks marginally profitable without this model is losing money live.
 */

/** Published spot fee tiers. Verify against your own account before trusting. */
export const FEE_SCHEDULE = {
  binance: { maker: 0.001, taker: 0.001, bnbDiscount: 0.25 },
  coinbase: { maker: 0.004, taker: 0.006, bnbDiscount: 0 },
  kraken:   { maker: 0.0016, taker: 0.0026, bnbDiscount: 0 },
  bybit:    { maker: 0.001, taker: 0.001, bnbDiscount: 0 },
  default:  { maker: 0.001, taker: 0.001, bnbDiscount: 0 },
};

export function getFeeRate(exchange = 'binance', { isMaker = false, useBnbDiscount = false } = {}) {
  const schedule = FEE_SCHEDULE[exchange] || FEE_SCHEDULE.default;
  const base = isMaker ? schedule.maker : schedule.taker;
  return useBnbDiscount && schedule.bnbDiscount ? base * (1 - schedule.bnbDiscount) : base;
}

/**
 * Walk the order book to find the true average fill price for a given size.
 *
 * This is the honest way to estimate slippage: a $10k market buy does not
 * fill at the best ask, it eats through the book. A flat percentage guess
 * understates cost badly on thin alts, which is exactly where a top-N-by-volume
 * scanner will send you.
 *
 * Returns null if the book cannot absorb the order — the correct response to
 * which is to skip the trade, not to fill it at a made-up price.
 */
export function estimateFillFromBook(book, side, quoteAmount) {
  if (!book) return null;
  const levels = side === 'buy' ? book.asks : book.bids;
  if (!levels || levels.length === 0) return null;

  const bestPrice = levels[0][0];
  let remaining = quoteAmount;
  let baseFilled = 0;
  let quoteSpent = 0;

  for (const [price, qty] of levels) {
    const levelQuote = price * qty;
    if (remaining <= levelQuote) {
      baseFilled += remaining / price;
      quoteSpent += remaining;
      remaining = 0;
      break;
    }
    baseFilled += qty;
    quoteSpent += levelQuote;
    remaining -= levelQuote;
  }

  if (remaining > 0) {
    return { insufficientLiquidity: true, avgPrice: null, slippagePercent: null, bestPrice };
  }

  const avgPrice = quoteSpent / baseFilled;
  const slippage = side === 'buy'
    ? (avgPrice - bestPrice) / bestPrice
    : (bestPrice - avgPrice) / bestPrice;

  return {
    insufficientLiquidity: false,
    avgPrice,
    baseFilled,
    bestPrice,
    slippagePercent: slippage * 100,
  };
}

/**
 * Fallback slippage estimate when no order book is available.
 *
 * Scales with order size relative to 24h volume and with volatility. Crude,
 * but it is at least monotonic in the things that actually drive slippage,
 * which a flat constant is not. Prefer estimateFillFromBook when you can.
 */
export function estimateSlippage({ quoteAmount, quoteVolume24h, atrPercent = 0.02 }) {
  if (!quoteVolume24h || quoteVolume24h <= 0) return 0.005; // 0.5% if unknown

  const participation = quoteAmount / quoteVolume24h;
  const base = 0.0005;                                  // ~5 bps of spread
  const impact = Math.sqrt(participation) * 0.5;        // square-root impact law
  const volAdjustment = Math.max(0, atrPercent - 0.01); // extra in fast markets

  return Math.min(base + impact + volAdjustment, 0.05); // cap at 5%
}

/**
 * Full cost of one fill.
 *
 * @returns { fillPrice, fee, slippageCost, totalCost, effectivePrice }
 *   effectivePrice is what your P&L should actually use.
 */
export function applyCosts({
  side,
  intendedPrice,
  quoteAmount,
  exchange = 'binance',
  isMaker = false,
  useBnbDiscount = false,
  book = null,
  quoteVolume24h = null,
  atrPercent = 0.02,
}) {
  let fillPrice = intendedPrice;
  let slippagePercent;
  let insufficientLiquidity = false;

  const fromBook = book ? estimateFillFromBook(book, side, quoteAmount) : null;

  if (fromBook && !fromBook.insufficientLiquidity) {
    fillPrice = fromBook.avgPrice;
    slippagePercent = fromBook.slippagePercent / 100;
  } else if (fromBook?.insufficientLiquidity) {
    insufficientLiquidity = true;
    slippagePercent = estimateSlippage({ quoteAmount, quoteVolume24h, atrPercent });
    fillPrice = side === 'buy'
      ? intendedPrice * (1 + slippagePercent)
      : intendedPrice * (1 - slippagePercent);
  } else {
    slippagePercent = estimateSlippage({ quoteAmount, quoteVolume24h, atrPercent });
    fillPrice = side === 'buy'
      ? intendedPrice * (1 + slippagePercent)
      : intendedPrice * (1 - slippagePercent);
  }

  const feeRate = getFeeRate(exchange, { isMaker, useBnbDiscount });
  const notional = quoteAmount;
  const fee = notional * feeRate;
  const slippageCost = notional * slippagePercent;

  return {
    fillPrice,
    feeRate,
    fee,
    slippagePercent,
    slippageCost,
    totalCost: fee + slippageCost,
    insufficientLiquidity,
    // Price including fee — use THIS for entry/exit in P&L, not intendedPrice.
    effectivePrice: side === 'buy'
      ? fillPrice * (1 + feeRate)
      : fillPrice * (1 - feeRate),
  };
}

/**
 * Round-trip cost as a fraction of notional. Compare this against your
 * take-profit target before trading: if TP is 8% and this is 0.4%, costs eat
 * 5% of gross edge. If TP is 0.5%, there is no strategy here at all.
 */
export function roundTripCostPercent({
  exchange = 'binance',
  isMaker = false,
  useBnbDiscount = false,
  estimatedSlippagePercent = 0.001,
} = {}) {
  const feeRate = getFeeRate(exchange, { isMaker, useBnbDiscount });
  return (feeRate * 2 + estimatedSlippagePercent * 2) * 100;
}

/**
 * Does this trade clear its own costs?
 *
 * Guards against the classic failure of a scalping target smaller than the
 * spread. Requires gross expected edge to be at least `minRatio` times the
 * round-trip cost.
 */
export function isEdgeSufficient({
  takeProfitPercent,
  stopLossPercent,
  assumedWinRate = 0.5,
  costPercent,
  minRatio = 3,
}) {
  const grossEdge = takeProfitPercent * assumedWinRate - stopLossPercent * (1 - assumedWinRate);
  return {
    grossEdge,
    netEdge: grossEdge - costPercent,
    costPercent,
    sufficient: grossEdge >= costPercent * minRatio,
  };
}
