import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';

// ── Synthetic History ─────────────────────────────────────────────
const generateSyntheticHistory = (currentPrice, change24h, points = 100) => {
  const history = [];
  let price = currentPrice * (1 - (change24h / 100));
  const volatility = Math.abs(change24h / 100) / Math.sqrt(points);
  for (let i = 0; i < points; i++) {
    const drift = (currentPrice - price) / (points - i);
    const shock = (Math.random() - 0.5) * volatility * price;
    price += drift + shock;
    history.push(price);
  }
  history[history.length - 1] = currentPrice;
  return history;
};

// ── Core Indicators ───────────────────────────────────────────────
const calculateRSI = (prices, period = 14) => {
  if (prices.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = prices[prices.length - i] - prices[prices.length - i - 1];
    if (diff >= 0) gains += diff; else losses -= diff;
  }
  const avgGain = gains / period, avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  return 100 - (100 / (1 + avgGain / avgLoss));
};

const calculateEMA = (prices, period) => {
  if (prices.length < period) return prices[prices.length - 1];
  const k = 2 / (period + 1);
  let ema = prices[0];
  for (let i = 1; i < prices.length; i++) ema = (prices[i] * k) + (ema * (1 - k));
  return ema;
};

const calculateMACD = (prices) => {
  if (prices.length < 26) return { histogram: 0 };
  const macdLine = calculateEMA(prices, 12) - calculateEMA(prices, 26);
  return { histogram: macdLine - macdLine * 0.9 };
};

const calculateBollingerBands = (prices, period = 20, multiplier = 2) => {
  if (prices.length < period) return { upper: 0, middle: 0, lower: 0 };
  const slice = prices.slice(-period);
  const middle = slice.reduce((a, b) => a + b, 0) / period;
  const stdDev = Math.sqrt(slice.map(p => Math.pow(p - middle, 2)).reduce((a, b) => a + b, 0) / period);
  return { upper: middle + stdDev * multiplier, middle, lower: middle - stdDev * multiplier };
};

const calculateStochastic = (prices, period = 14) => {
  if (prices.length < period) return { k: 50 };
  const current = prices[prices.length - 1];
  const slice = prices.slice(-period);
  const low = Math.min(...slice), high = Math.max(...slice);
  if (high === low) return { k: 50 };
  return { k: ((current - low) / (high - low)) * 100 };
};

// ── SP500 AI helpers ──────────────────────────────────────────────
const emaOfArray = (arr, period) => {
  if (arr.length < period) return arr.slice();
  const k = 2 / (period + 1);
  let ema = arr.slice(0, period).reduce((s, v) => s + v, 0) / period;
  const result = [ema];
  for (let i = period; i < arr.length; i++) { ema = arr[i] * k + ema * (1 - k); result.push(ema); }
  return result;
};

const calcSSL = (prices, len = 9) => {
  const sma = prices.slice(-len).reduce((s, p) => s + p, 0) / len;
  return { sslBullish: prices[prices.length - 1] >= sma };
};

const calcCMO = (prices, len = 14) => {
  let up = 0, dn = 0;
  for (let i = prices.length - len; i < prices.length; i++) {
    const d = prices[i] - prices[i - 1];
    if (d > 0) up += d; else dn -= d;
  }
  const total = up + dn;
  const cmo = total === 0 ? 0 : ((up - dn) / total) * 100;
  return { cmo, overbought: cmo > 50, oversold: cmo < -50 };
};

const calcAIRSI = (prices, sLen = 5, lLen = 13, sigLen = 9) => {
  if (prices.length < lLen + sigLen + 5) return { aiRSIBullish: false, aiRSIBearish: false };
  const rs = calculateRSI(prices, sLen), rl = calculateRSI(prices, lLen);
  const val = rs - rl, total = rs + rl;
  const hist = [];
  const start = Math.max(lLen + 2, prices.length - sigLen - 10);
  for (let i = start; i < prices.length; i++) {
    const sub = prices.slice(0, i + 1);
    hist.push(calculateRSI(sub, sLen) - calculateRSI(sub, lLen));
  }
  const sig = hist.length > 0 ? hist.slice(-Math.min(sigLen, hist.length)).reduce((s, v) => s + v, 0) / Math.min(sigLen, hist.length) : 0;
  return { aiRSIBullish: val > sig && total > 100, aiRSIBearish: val < sig && total <= 100 };
};

const calcTMO = (prices, len = 14, calcLen = 5, smoothLen = 3) => {
  if (prices.length < len + calcLen + smoothLen * 2 + 2) return { tmoBullish: false, tmoBearish: false };
  const raw = [];
  for (let i = len; i < prices.length; i++) {
    let v = 0;
    for (let j = 0; j <= len; j++) {
      if (i - j >= 0) v += prices[i] > prices[i - j] ? 1 : prices[i] < prices[i - j] ? -1 : 0;
    }
    raw.push(v);
  }
  if (raw.length < calcLen + smoothLen * 2) return { tmoBullish: false, tmoBearish: false };
  const e1 = emaOfArray(raw, calcLen), e2 = emaOfArray(e1, smoothLen), sig = emaOfArray(e2, smoothLen);
  return {
    tmoBullish: e2[e2.length - 1] > sig[sig.length - 1] && e2[e2.length - 1] > 0,
    tmoBearish: e2[e2.length - 1] < sig[sig.length - 1] && e2[e2.length - 1] < 0
  };
};

const calcMF = (prices, len = 9) => {
  if (prices.length < len + 1) return { mfBullish: true };
  let sum = 0;
  for (let i = prices.length - len; i < prices.length; i++) {
    const avg = (prices[i] + prices[i - 1]) / 2;
    if (avg > 0) sum += (prices[i] - prices[i - 1]) / avg;
  }
  return { mfBullish: sum / len >= 0 };
};

// ── Indicator Analysis ────────────────────────────────────────────
const analyzeIndicators = (asset, enabledIndicators = {}) => {
  const prices = generateSyntheticHistory(asset.price, asset.change24h, 100);
  let scoreModifier = 0;
  const signals = [];

  if (enabledIndicators.rsi) {
    const rsi = calculateRSI(prices);
    if (rsi < 30) { scoreModifier += 15; signals.push("RSI Oversold"); }
    else if (rsi > 70) { scoreModifier -= 15; signals.push("RSI Overbought"); }
  }
  if (enabledIndicators.macd) {
    const { histogram } = calculateMACD(prices);
    scoreModifier += histogram > 0 ? 10 : -10;
    signals.push(histogram > 0 ? "MACD Bullish" : "MACD Bearish");
  }
  if (enabledIndicators.bollinger) {
    const { upper, lower } = calculateBollingerBands(prices);
    const current = prices[prices.length - 1];
    if (current < lower) { scoreModifier += 15; signals.push("BB Lower Bounce"); }
    else if (current > upper) { scoreModifier -= 15; signals.push("BB Upper Pullback"); }
  }
  if (enabledIndicators.ema) {
    const short = calculateEMA(prices, 12), long_ = calculateEMA(prices, 50);
    scoreModifier += short > long_ ? 10 : -10;
    signals.push(short > long_ ? "EMA Golden Trend" : "EMA Death Trend");
  }
  if (enabledIndicators.stoch) {
    const { k } = calculateStochastic(prices);
    if (k < 20) { scoreModifier += 10; signals.push("Stoch Oversold"); }
    else if (k > 80) { scoreModifier -= 10; signals.push("Stoch Overbought"); }
  }

  // SP500 AI Suite
  const ssl  = calcSSL(prices, 9);
  const cmo  = calcCMO(prices, 14);
  const aiRsi = enabledIndicators.sp500_ai_rsi    ? calcAIRSI(prices) : null;
  const tmo   = enabledIndicators.sp500_tmo        ? calcTMO(prices)   : null;
  const mf    = enabledIndicators.sp500_money_flow ? calcMF(prices)    : null;

  if (enabledIndicators.sp500_ssl) {
    scoreModifier += ssl.sslBullish ? 12 : -12;
    signals.push(ssl.sslBullish ? "SP500 SSL Bullish" : "SP500 SSL Bearish");
  }
  if (enabledIndicators.sp500_cmo) {
    if (!cmo.overbought && !cmo.oversold) { scoreModifier += cmo.cmo > 0 ? 10 : -10; }
    else { scoreModifier -= 15; signals.push(cmo.overbought ? "CMO Overbought" : "CMO Oversold"); }
  }
  if (aiRsi) {
    if (aiRsi.aiRSIBullish)      { scoreModifier += 10; signals.push("AI RSI Bullish"); }
    else if (aiRsi.aiRSIBearish) { scoreModifier -= 10; signals.push("AI RSI Bearish"); }
  }
  if (tmo) {
    if (tmo.tmoBullish)      { scoreModifier += 10; signals.push("AI Momentum Bullish"); }
    else if (tmo.tmoBearish) { scoreModifier -= 10; signals.push("AI Momentum Bearish"); }
  }
  if (mf) {
    scoreModifier += mf.mfBullish ? 8 : -8;
    signals.push(mf.mfBullish ? "Money Flow Bullish" : "Money Flow Bearish");
  }

  // SP500 Master Filter
  let filterBlock = { buy: false, sell: false };
  if (enabledIndicators.sp500_filter) {
    const buyOk  = ssl.sslBullish && !cmo.overbought && (!aiRsi || aiRsi.aiRSIBullish)  && (!tmo || tmo.tmoBullish)  && (!mf || mf.mfBullish);
    const sellOk = !ssl.sslBullish && !cmo.oversold  && (!aiRsi || aiRsi.aiRSIBearish) && (!tmo || tmo.tmoBearish) && (!mf || !mf.mfBullish);
    filterBlock.buy  = !buyOk;
    filterBlock.sell = !sellOk;
    if (filterBlock.buy)  signals.push("SP500 Filter: BUY blocked");
    if (filterBlock.sell) signals.push("SP500 Filter: SELL blocked");
  }

  return { scoreModifier, signals, filterBlock };
};

// ── Confidence Calculation ────────────────────────────────────────
const generateNewsSentiment = (asset) => {
  const priceChange = asset.change24h || 0;
  let s = (Math.random() * 1.2) - 0.6;
  if (priceChange > 5) s += 0.3;
  else if (priceChange > 2) s += 0.15;
  else if (priceChange < -5) s -= 0.3;
  else if (priceChange < -2) s -= 0.15;
  return Math.max(-1, Math.min(1, s));
};

const calculateConfidence = (asset, enabledIndicators = {}) => {
  let technicalScore = 60;
  const change = asset.change24h || 0;
  if (change > 2 && change <= 10) technicalScore += 20;
  else if (change > 10) technicalScore += 5;
  else if (change > 0) technicalScore += 10;
  else if (change > -3) technicalScore += 5;
  else if (change > -8) technicalScore -= 5;
  else technicalScore -= 20;

  const avgVolume = 1500000000;
  if (asset.volume24h > avgVolume * 2) technicalScore += 15;
  else if (asset.volume24h > avgVolume) technicalScore += 10;
  else if (asset.volume24h < avgVolume / 2) technicalScore -= 10;

  if (asset.marketCap > 100000000000) technicalScore += 10;
  else if (asset.marketCap > 10000000000) technicalScore += 5;

  const volatility = Math.abs(change);
  if (volatility > 10) technicalScore -= 10;
  else if (volatility < 2) technicalScore += 5;

  const { scoreModifier, signals, filterBlock } = analyzeIndicators(asset, enabledIndicators);
  technicalScore = Math.max(0, Math.min(100, technicalScore + scoreModifier));

  // SP500 filter caps confidence when no direction confirmed
  if (filterBlock?.buy && filterBlock?.sell) technicalScore = Math.min(technicalScore, 40);

  const newsScore = (generateNewsSentiment(asset) + 1) * 50;
  const composite = (technicalScore * 0.7) + (newsScore * 0.3);
  const finalScore = Math.max(30, Math.min(95, Math.round(composite)));

  if (signals.length > 0 && finalScore >= 65) {
    console.log(`  📊 ${asset.symbol}: Tech=${technicalScore}%, Final=${finalScore}% | ${signals.join(', ')}`);
  }
  return finalScore;
};

// ── Engine Core (inlined from autoTradingEngineBackend) ───────────
const calculateRiskLevel = (c) => c >= 80 ? 'low' : c >= 65 ? 'medium' : 'high';
const hasReachedTradeLimit = (s) => (s.trades_today || 0) >= (s.max_trades_per_day || 10);
const isRiskLevelAllowed = (r, s) => s.allowed_risk_levels?.includes(r);
const isTradeTypeAllowed = (t, s) => s.trade_types?.includes(t);
const hasAssetBeenTradedToday = (sym, s) => (s.assets_traded_today || []).includes(sym);

const checkTrailingStop = (position, currentPrice, settings) => {
  if (!settings.use_trailing_stop) return null;
  const profitPercent = ((currentPrice - position.avg_entry_price) / position.avg_entry_price) * 100;
  if (profitPercent < (settings.trailing_stop_activation || 3)) return null;
  const highestPrice = Math.max(position.highest_price || position.avg_entry_price, currentPrice);
  const trailingStopPrice = highestPrice * (1 - (settings.trailing_stop_percent || 2) / 100);
  if (currentPrice <= trailingStopPrice) {
    return { shouldSell: true, reason: 'trailing_stop_hit', stopPrice: trailingStopPrice, highestPrice, profitPercent: ((trailingStopPrice - position.avg_entry_price) / position.avg_entry_price) * 100 };
  }
  return { shouldSell: false, highestPrice, trailingStopPrice };
};

const checkBreakeven = (position, currentPrice, settings) => {
  if (!settings.use_breakeven_protection) return null;
  const profitPercent = ((currentPrice - position.avg_entry_price) / position.avg_entry_price) * 100;
  if (profitPercent >= (settings.breakeven_trigger_percent || 4)) {
    return { shouldActivate: true, breakevenPrice: position.avg_entry_price * (1 + (settings.breakeven_offset_percent || 0.5) / 100), profitPercent };
  }
  return null;
};

const checkPartialProfits = (position, currentPrice, settings) => {
  if (!settings.use_partial_profits || !settings.partial_profit_targets?.length) return null;
  const profitPercent = ((currentPrice - position.avg_entry_price) / position.avg_entry_price) * 100;
  const partialsTaken = position.partial_profits_taken || [];
  const opportunities = [];
  for (let i = 0; i < settings.partial_profit_targets.length; i++) {
    const target = settings.partial_profit_targets[i];
    if (partialsTaken.includes(i)) continue;
    if (profitPercent >= target.profit_percent) {
      const sellQuantity = position.quantity * (target.sell_percent / 100);
      if (sellQuantity > 0 && sellQuantity <= position.quantity) {
        opportunities.push({ targetIndex: i, profitPercent: target.profit_percent, sellPercent: target.sell_percent, sellQuantity, remainingQuantity: position.quantity - sellQuantity });
      }
    }
  }
  return opportunities.length > 0 ? opportunities : null;
};

const calculatePositionSizeDynamic = (availableBalance, settings, assetPrice, riskAdjustments) => {
  if (availableBalance <= 0 || !assetPrice || assetPrice === 0) return { value: 0, quantity: 0, valid: false, reason: 'insufficient_balance' };
  let maxPositionSize = (settings.max_position_size_percent || 10) / 100;
  if (riskAdjustments?.adjusted && riskAdjustments.adjustments.position_size_multiplier) maxPositionSize *= riskAdjustments.adjustments.position_size_multiplier;
  const positionValue = Math.min(availableBalance * maxPositionSize, availableBalance * 0.2);
  if (positionValue < 10) return { value: positionValue, quantity: positionValue / assetPrice, valid: false, reason: 'position_too_small' };
  return { value: positionValue, quantity: positionValue / assetPrice, valid: true, adjusted: riskAdjustments?.adjusted || false };
};

const calculateMarketVolatility = (assets) => {
  if (!assets?.length) return 0;
  return assets.map(a => Math.abs(a.change24h || 0)).reduce((s, c) => s + c, 0) / assets.length;
};

const detectExtremeMarketConditions = (assets, settings) => {
  const volatility = calculateMarketVolatility(assets);
  const extremeMoves = assets.filter(a => Math.abs(a.change24h || 0) > 15).length;
  const extremeMovePercent = (extremeMoves / assets.length) * 100;
  const negativePercent = (assets.filter(a => (a.change24h || 0) < -10).length / assets.length) * 100;
  let condition = 'normal';
  if (volatility > (settings.extreme_volatility_threshold || 10) || extremeMovePercent > 30) condition = 'extreme';
  else if (volatility > (settings.high_volatility_threshold || 5) || negativePercent > 50) condition = 'volatile';
  return { condition, volatility, shouldHalt: condition === 'extreme' };
};

const applyDynamicRiskAdjustment = (settings, marketCondition, volatility) => {
  if (!settings.use_dynamic_risk) return { adjusted: false, adjustments: {} };
  const adjustments = {};
  let adjusted = false;
  if (volatility > (settings.extreme_volatility_threshold || 10)) {
    adjustments.position_size_multiplier = (100 - (settings.volatility_position_reduction || 50)) / 100;
    adjustments.min_confidence_increase = 15;
    adjusted = true;
  } else if (volatility > (settings.high_volatility_threshold || 5)) {
    adjustments.position_size_multiplier = 0.7;
    adjustments.min_confidence_increase = 10;
    adjusted = true;
  }
  if (marketCondition === 'extreme') { adjustments.buy_disabled = true; adjustments.sell_only_mode = true; adjusted = true; }
  return { adjusted, adjustments };
};

const checkCircuitBreaker = (settings, assets) => {
  const results = { triggered: false, reason: null, marketCondition: 'normal' };
  if (!settings.use_circuit_breaker) return results;
  if (settings.circuit_breaker_triggered_at) {
    const elapsed = Date.now() - new Date(settings.circuit_breaker_triggered_at).getTime();
    if (elapsed < (settings.circuit_breaker_cooldown_minutes || 60) * 60000) {
      return { triggered: true, reason: 'circuit_breaker_cooldown', marketCondition: 'normal' };
    }
  }
  if ((settings.daily_loss || 0) >= (settings.max_daily_loss_percent || 5)) return { triggered: true, reason: 'daily_loss_limit', marketCondition: 'normal' };
  const market = detectExtremeMarketConditions(assets, settings);
  results.marketCondition = market.condition;
  if (market.shouldHalt) { results.triggered = true; results.reason = 'extreme_market_conditions'; }
  return results;
};

const determineTradeActionAdvanced = (asset, confidence, settings, portfolio) => {
  const priceChange = asset.change24h || 0;
  const minConfidence = settings.min_confidence || 70;
  const assetSymbol = `${asset.symbol}/USDT`;
  const position = portfolio.positions?.find(p => p.asset_symbol === assetSymbol);

  if (position) {
    const trailingStop = checkTrailingStop(position, asset.price, settings);
    if (trailingStop?.shouldSell) return { action: 'sell', reason: 'trailing_stop', quantity: position.quantity, details: trailingStop, profitPercent: trailingStop.profitPercent };
    const breakeven = checkBreakeven(position, asset.price, settings);
    if (breakeven?.shouldActivate) {
      if (position.breakeven_activated && asset.price <= position.breakeven_price) return { action: 'sell', reason: 'breakeven_protection', quantity: position.quantity, details: { ...breakeven, triggeredPrice: asset.price }, profitPercent: ((asset.price - position.avg_entry_price) / position.avg_entry_price) * 100 };
      if (!position.breakeven_activated || position.breakeven_price !== breakeven.breakevenPrice) return { action: 'update_breakeven', reason: 'breakeven_activated', details: breakeven };
    }
    const partialProfits = checkPartialProfits(position, asset.price, settings);
    if (partialProfits?.length > 0) return { action: 'partial_sell', reason: 'partial_profit', quantity: partialProfits[0].sellQuantity, details: { ...partialProfits[0], currentPrice: asset.price }, profitPercent: ((asset.price - position.avg_entry_price) / position.avg_entry_price) * 100 };
    const profitPercent = ((asset.price - position.avg_entry_price) / position.avg_entry_price) * 100;
    if (profitPercent <= -(settings.stop_loss_percent || 3)) return { action: 'sell', reason: 'stop_loss', quantity: position.quantity, profitPercent };
    if (profitPercent >= (settings.take_profit_percent || 8)) return { action: 'sell', reason: 'take_profit', quantity: position.quantity, profitPercent };
    if (priceChange < -20 || confidence < 20) return { action: 'sell', reason: 'confidence_collapse_or_crash', quantity: position.quantity, profitPercent };
    if (settings.use_trailing_stop && trailingStop && !trailingStop.shouldSell && (position.highest_price || position.avg_entry_price) < trailingStop.highestPrice) return { action: 'update_trailing', reason: 'update_highest_price', details: trailingStop };
    return { action: null, reason: 'position_exists_hold' };
  }

  let buyReason = null;
  if (priceChange > 0.1 && priceChange < 20.0 && confidence >= minConfidence) buyReason = 'positive_momentum_breakout';
  else if (priceChange < -0.5 && priceChange > -20.0 && confidence >= minConfidence) buyReason = 'high_confidence_dip_buy';

  if (buyReason) {
    if (hasAssetBeenTradedToday(asset.symbol, settings)) return { action: null, reason: 'asset_already_traded_today' };
    return { action: 'buy', reason: buyReason };
  }
  return { action: null, reason: 'no_signal' };
};

const scanTradingOpportunitiesAdvanced = (assets, assetConfidence, settings, portfolio) => {
  const opportunities = [];
  const volatility = calculateMarketVolatility(assets);
  const marketAnalysis = detectExtremeMarketConditions(assets, settings);
  const riskAdjustments = applyDynamicRiskAdjustment(settings, marketAnalysis.condition, volatility);
  const adjustedMinConfidence = (settings.min_confidence || 70) + (riskAdjustments.adjustments.min_confidence_increase || 0);

  console.log(`🔎 SCANNING ${assets.length} assets | Market: ${marketAnalysis.condition} | Min confidence: ${adjustedMinConfidence}%`);

  for (const asset of assets) {
    const confidence = assetConfidence[asset.symbol] || 0;
    const tradeDecision = determineTradeActionAdvanced(asset, confidence, settings, portfolio);
    if (!tradeDecision.action) continue;

    if (tradeDecision.action === 'update_trailing' || tradeDecision.action === 'update_breakeven') {
      const position = portfolio.positions?.find(p => p.asset_symbol === `${asset.symbol}/USDT`);
      if (position) opportunities.push({ asset, action: tradeDecision.action, reason: tradeDecision.reason, confidence, details: tradeDecision.details, isUpdate: true, position });
      continue;
    }
    if (tradeDecision.action === 'buy' && riskAdjustments.adjustments.sell_only_mode) continue;
    if (tradeDecision.action === 'buy' && confidence < adjustedMinConfidence) continue;

    if (tradeDecision.action === 'buy') {
      const riskLevel = calculateRiskLevel(confidence);
      if (!isRiskLevelAllowed(riskLevel, settings)) continue;
      if (!isTradeTypeAllowed('buy', settings)) continue;
      const positionSize = calculatePositionSizeDynamic(portfolio.available_balance || 0, settings, asset.price, riskAdjustments);
      if (!positionSize.valid) continue;
      opportunities.push({ asset, action: 'buy', reason: tradeDecision.reason, confidence, riskLevel, quantity: positionSize.quantity, value: positionSize.value, isUpdate: false });
    } else if (tradeDecision.action === 'sell' || tradeDecision.action === 'partial_sell') {
      if (!isTradeTypeAllowed('sell', settings)) continue;
      const position = portfolio.positions?.find(p => p.asset_symbol === `${asset.symbol}/USDT`);
      if (position && tradeDecision.quantity > 0) {
        opportunities.push({ asset, action: tradeDecision.action, reason: tradeDecision.reason, confidence, riskLevel: 'low', quantity: tradeDecision.quantity, value: tradeDecision.quantity * asset.price, profitPercent: tradeDecision.profitPercent, details: tradeDecision.details, isUpdate: false, position });
      }
    }
  }
  return opportunities;
};

const executeAutoTradingCheckAdvanced = async (assets, assetConfidence, settings, portfolio, executeTradeCallback, updatePositionCallback) => {
  const results = { success: false, executed: false, reason: null, opportunity: null, positionUpdates: [], executionDetails: null, error: null };
  try {
    if (!settings?.is_enabled) return { ...results, reason: 'auto_trading_disabled' };
    if (!portfolio || !assets?.length || !Object.keys(assetConfidence).length) return { ...results, reason: 'missing_requirements' };

    const cbStatus = checkCircuitBreaker(settings, assets);
    if (cbStatus.triggered) return { ...results, success: true, reason: cbStatus.reason };
    if (hasReachedTradeLimit(settings)) return { ...results, reason: 'trade_limit_reached' };

    const opportunities = scanTradingOpportunitiesAdvanced(assets, assetConfidence, settings, portfolio);
    const positionUpdates = opportunities.filter(o => o.isUpdate);
    const tradeOpportunities = opportunities.filter(o => !o.isUpdate);

    for (const update of positionUpdates) {
      try { await updatePositionCallback(update); results.positionUpdates.push(update); }
      catch (e) { console.error(`Failed position update for ${update.asset.symbol}:`, e); }
    }

    if (!tradeOpportunities.length) return { ...results, success: true, reason: 'no_opportunities' };

    const sells = tradeOpportunities.filter(o => o.action === 'sell' || o.action === 'partial_sell');
    const buys  = tradeOpportunities.filter(o => o.action === 'buy');
    const best  = sells.length ? sells.sort((a, b) => (b.profitPercent || 0) - (a.profitPercent || 0))[0]
                               : buys.sort((a, b) => b.confidence - a.confidence)[0];

    if (!best) return { ...results, success: true, reason: 'no_valid_opportunity' };

    const executionResult = await executeTradeCallback(best);
    return { success: true, executed: true, opportunity: best, executionDetails: executionResult, reason: 'trade_executed', positionUpdates: results.positionUpdates };
  } catch (error) {
    return { ...results, error: error.message, reason: 'execution_error' };
  }
};

// ── Main Handler ──────────────────────────────────────────────────
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { settings, portfolio, user_email, indicator_settings } = await req.json();

    if (!settings || !portfolio) return Response.json({ success: false, error: 'Missing parameters' }, { status: 400 });

    console.log(`\n🔄 SERVER-SIDE AUTO-TRADING V5 (${user_email})`);

    // Schedule check
    if (settings.trading_schedule?.enabled) {
      const now = new Date();
      const currentHour = now.getUTCHours();
      const currentDay = ['sun','mon','tue','wed','thu','fri','sat'][now.getUTCDay()];
      if (!settings.trading_schedule.days.includes(currentDay)) return Response.json({ success: true, reason: 'schedule_day_paused' });
      if (currentHour < settings.trading_schedule.start_hour || currentHour >= settings.trading_schedule.end_hour) return Response.json({ success: true, reason: 'schedule_hour_paused' });
    }

    // Fetch market data
    let marketAssets = [];
    try {
      const resp = await fetch('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=1&sparkline=false', { headers: { 'Accept': 'application/json' } });
      if (resp.ok) {
        const raw = await resp.json();
        marketAssets = raw.map(c => ({ symbol: c.symbol.toUpperCase(), name: c.name, price: c.current_price, change24h: c.price_change_percentage_24h || 0, volume24h: c.total_volume || 0, marketCap: c.market_cap || 0 }));
        console.log(`✅ Fetched ${marketAssets.length} assets`);
      } else throw new Error(`CoinGecko ${resp.status}`);
    } catch (e) {
      console.warn('⚠️ Live data failed, using fallback:', e.message);
      ['BTC','ETH','SOL','BNB','XRP','ADA','DOGE','AVAX','DOT','MATIC'].forEach(sym => {
        marketAssets.push({ symbol: sym, name: sym, price: 100 + Math.random() * 1000, change24h: (Math.random() * 10) - 4, volume24h: 500000000, marketCap: 10000000000 });
      });
    }

    // Calculate confidence scores
    const enabledIndicators = indicator_settings || { rsi: true, macd: true, bollinger: true, ema: true, stoch: true };
    const assetConfidence = {};
    marketAssets.forEach(asset => { assetConfidence[asset.symbol] = calculateConfidence(asset, enabledIndicators); });

    const minConfidence = settings.min_confidence || 70;
    const highConf = Object.values(assetConfidence).filter(c => c >= minConfidence).length;
    console.log(`✅ Signals ready: ${marketAssets.length} assets, ${highConf} at ${minConfidence}%+`);

    // Top opportunities log
    Object.entries(assetConfidence)
      .filter(([,c]) => c >= minConfidence)
      .sort(([,a],[,b]) => b - a)
      .slice(0, 5)
      .forEach(([sym, conf]) => {
        const a = marketAssets.find(x => x.symbol === sym);
        console.log(`   🎯 ${sym}: ${conf}% | ${a?.change24h?.toFixed(2)}% 24h`);
      });

    // Execute auto-trading check
    const result = await executeAutoTradingCheckAdvanced(
      marketAssets, assetConfidence, settings, portfolio,
      async (opp) => {
        console.log(`💰 EXECUTING: ${opp.action.toUpperCase()} ${opp.asset.symbol}`);
        return await executeTrade(base44, user_email, portfolio, settings, opp);
      },
      async (update) => {
        console.log(`📝 UPDATE POSITION: ${update.asset.symbol} - ${update.reason}`);
        return await updatePosition(base44, portfolio, update);
      }
    );

    return Response.json({ success: true, ...result });
  } catch (error) {
    console.error('❌ Worker Error:', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});

// ── Trade Execution ───────────────────────────────────────────────
async function executeTrade(base44, user_email, portfolio, settings, opportunity) {
  const { asset, action, quantity, reason, confidence, value, details } = opportunity;
  const price = asset.price;
  const totalValue = value || (quantity * price);
  const assetSymbol = `${asset.symbol}/USDT`;

  await base44.asServiceRole.entities.Trade.create({
    asset_symbol: assetSymbol, trade_type: action === 'partial_sell' ? 'sell' : action,
    quantity, price, total_value: totalValue, exchange: 'Paper Trading (Server)', status: 'completed',
    profit_loss: (action === 'sell' || action === 'partial_sell') ? (totalValue * ((opportunity.profitPercent || 0) / 100)) : 0,
    ai_signal: { confidence: confidence || 0, reasoning: reason + (details ? ` (${JSON.stringify(details)})` : ''), indicators: ['Server-Side Engine V5 + SP500 AI'] },
    created_by: user_email
  });

  let positions = [...(portfolio.positions || [])];
  if (action === 'buy') {
    const idx = positions.findIndex(p => p.asset_symbol === assetSymbol);
    if (idx >= 0) {
      const ex = positions[idx];
      const newQty = ex.quantity + quantity;
      positions[idx] = { ...ex, quantity: newQty, avg_entry_price: ((ex.quantity * ex.avg_entry_price) + totalValue) / newQty, current_value: newQty * price, highest_price: Math.max(ex.highest_price || 0, price), dca_count: (ex.dca_count || 0) + 1 };
    } else {
      positions.push({ asset_symbol: assetSymbol, quantity, avg_entry_price: price, current_value: totalValue, profit_loss: 0, highest_price: price, dca_count: 0, breakeven_activated: false, trailing_stop_price: null, partial_profits_taken: [] });
    }
  } else if (action === 'sell') {
    positions = positions.filter(p => p.asset_symbol !== assetSymbol);
  } else if (action === 'partial_sell') {
    const idx = positions.findIndex(p => p.asset_symbol === assetSymbol);
    if (idx >= 0) {
      const ex = positions[idx];
      const partialsTaken = [...(ex.partial_profits_taken || [])];
      if (details?.targetIndex !== undefined && !partialsTaken.includes(details.targetIndex)) partialsTaken.push(details.targetIndex);
      positions[idx] = { ...ex, quantity: ex.quantity - quantity, current_value: (ex.quantity - quantity) * price, partial_profits_taken: partialsTaken };
    }
  }

  const profitLoss = (action === 'sell' || action === 'partial_sell') ? (totalValue * ((opportunity.profitPercent || 0) / 100)) : 0;
  await base44.asServiceRole.entities.Portfolio.update(portfolio.id, {
    available_balance: action === 'buy' ? portfolio.available_balance - totalValue : portfolio.available_balance + totalValue,
    total_balance: portfolio.total_balance + profitLoss,
    positions, total_trades: (portfolio.total_trades || 0) + 1,
    total_profit_loss: (portfolio.total_profit_loss || 0) + profitLoss
  });

  const newAssetsTraded = [...(settings.assets_traded_today || [])];
  if (action === 'buy' && !newAssetsTraded.includes(asset.symbol)) newAssetsTraded.push(asset.symbol);
  await base44.asServiceRole.entities.AutoTradingSettings.update(settings.id, {
    trades_today: (settings.trades_today || 0) + 1, last_trade_date: new Date().toISOString(),
    assets_traded_today: newAssetsTraded,
    daily_loss: (settings.daily_loss || 0) + (profitLoss < 0 ? Math.abs(profitLoss) : 0)
  });

  await base44.asServiceRole.entities.Notification.create({
    notification_type: 'order_filled', priority: 'medium',
    title: `Auto-Trade: ${action.toUpperCase()} ${asset.symbol}`,
    message: `Server executed ${action} for ${quantity.toFixed(4)} ${asset.symbol} @ $${price.toFixed(2)}. Reason: ${reason}`,
    created_by: user_email
  });

  return { executed: true, price, quantity, action };
}

async function updatePosition(base44, portfolio, update) {
  const { asset, action, details } = update;
  const assetSymbol = `${asset.symbol}/USDT`;
  let positions = [...(portfolio.positions || [])];
  const index = positions.findIndex(p => p.asset_symbol === assetSymbol);
  if (index >= 0) {
    if (action === 'update_trailing') positions[index] = { ...positions[index], highest_price: details.highestPrice, trailing_stop_price: details.trailingStopPrice };
    else if (action === 'update_breakeven') positions[index] = { ...positions[index], breakeven_activated: true, breakeven_price: details.breakevenPrice };
    await base44.asServiceRole.entities.Portfolio.update(portfolio.id, { positions });
  }
}