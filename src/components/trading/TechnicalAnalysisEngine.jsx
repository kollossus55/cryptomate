/**
 * Technical Analysis Engine
 * Calculates key technical indicators for trading signals.
 * Generates synthetic price history for demo purposes if real history is unavailable.
 */

// Generate synthetic price history based on current price and 24h change
// to allow calculation of indicators without heavy API historical data calls
export const generateSyntheticHistory = (currentPrice, change24h, points = 100) => {
  const history = [];
  let price = currentPrice * (1 - (change24h / 100)); // Start roughly where 24h ago was
  const volatility = Math.abs(change24h / 100) / Math.sqrt(points); // Estimate volatility

  for (let i = 0; i < points; i++) {
    // Random walk with drift towards current price
    const drift = (currentPrice - price) / (points - i);
    const shock = (Math.random() - 0.5) * volatility * price;
    price += drift + shock;
    history.push(price);
  }
  // Ensure last point is exactly current price
  history[history.length - 1] = currentPrice;
  return history;
};

// 1. Relative Strength Index (RSI)
// Momentum oscillator (0-100). >70 overbought, <30 oversold.
export const calculateRSI = (prices, period = 14) => {
  if (prices.length < period + 1) return 50;

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const diff = prices[prices.length - i] - prices[prices.length - i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;

  if (avgLoss === 0) return 100;
  
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
};

// 2. Moving Average Convergence Divergence (MACD)
// Trend-following momentum indicator.
export const calculateMACD = (prices, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) => {
  if (prices.length < slowPeriod) return { macd: 0, signal: 0, histogram: 0 };

  const emaFast = calculateEMA(prices, fastPeriod);
  const emaSlow = calculateEMA(prices, slowPeriod);
  const macdLine = emaFast - emaSlow;
  
  // Note: True signal line requires history of MACD line, approximating for demo
  const signalLine = macdLine * 0.9; // Simplified approximation
  const histogram = macdLine - signalLine;

  return { macd: macdLine, signal: signalLine, histogram };
};

// 3. Bollinger Bands
// Volatility indicator.
export const calculateBollingerBands = (prices, period = 20, multiplier = 2) => {
  if (prices.length < period) return { upper: 0, middle: 0, lower: 0 };

  const slice = prices.slice(-period);
  const sum = slice.reduce((a, b) => a + b, 0);
  const middle = sum / period; // SMA

  const squaredDiffs = slice.map(p => Math.pow(p - middle, 2));
  const variance = squaredDiffs.reduce((a, b) => a + b, 0) / period;
  const stdDev = Math.sqrt(variance);

  return {
    upper: middle + (stdDev * multiplier),
    middle: middle,
    lower: middle - (stdDev * multiplier)
  };
};

// 4. Exponential Moving Average (EMA)
// Trend direction.
export const calculateEMA = (prices, period) => {
  if (prices.length < period) return prices[prices.length - 1];
  
  const k = 2 / (period + 1);
  let ema = prices[0];
  
  for (let i = 1; i < prices.length; i++) {
    ema = (prices[i] * k) + (ema * (1 - k));
  }
  
  return ema;
};

// 5. Stochastic Oscillator
// Momentum indicator comparing a particular closing price to a range of its prices.
export const calculateStochastic = (prices, period = 14) => {
  if (prices.length < period) return { k: 50, d: 50 };

  const current = prices[prices.length - 1];
  const slice = prices.slice(-period);
  const low = Math.min(...slice);
  const high = Math.max(...slice);

  if (high === low) return { k: 50, d: 50 };

  const k = ((current - low) / (high - low)) * 100;
  const d = k; // Simplified

  return { k, d };
};

// 6. Average Directional Index (ADX)
// Measures trend strength (0-100). >25 indicates strong trend.
export const calculateADX = (prices, period = 14) => {
  if (prices.length < period + 1) return { adx: 50, trend: 'neutral' };
  
  let plusDM = 0, minusDM = 0, tr = 0;
  for (let i = prices.length - period; i < prices.length; i++) {
    const high = Math.max(prices[i], prices[i - 1]);
    const low = Math.min(prices[i], prices[i - 1]);
    const upMove = high - prices[i - 1];
    const downMove = prices[i - 1] - low;
    
    if (upMove > downMove && upMove > 0) plusDM += upMove;
    if (downMove > upMove && downMove > 0) minusDM += downMove;
    tr += Math.abs(prices[i] - prices[i - 1]);
  }
  
  const plusDI = (plusDM / tr) * 100;
  const minusDI = (minusDM / tr) * 100;
  const adx = Math.abs(plusDI - minusDI) / (plusDI + minusDI) * 100;
  
  const trend = adx > 25 ? (plusDI > minusDI ? 'strong_uptrend' : 'strong_downtrend') : 'weak_trend';
  
  return { adx: Math.min(100, adx), plusDI, minusDI, trend };
};

// 7. Simple Moving Average (SMA)
export const calculateSMA = (prices, period) => {
  if (prices.length < period) return prices[prices.length - 1];
  const slice = prices.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
};

// 8. Awesome Oscillator
// Momentum indicator based on SMA difference.
export const calculateAwesomeOscillator = (prices) => {
  if (prices.length < 34) return { ao: 0, signal: 'neutral' };
  
  const sma5 = calculateSMA(prices, 5);
  const sma34 = calculateSMA(prices, 34);
  const ao = sma5 - sma34;
  
  const signal = ao > 0 ? 'bullish' : ao < 0 ? 'bearish' : 'neutral';
  
  return { ao, signal };
};

// 9. Aroon Indicator
// Identifies trend changes and strength.
export const calculateAroon = (prices, period = 25) => {
  if (prices.length < period) return { aroonUp: 50, aroonDown: 50, trend: 'neutral' };
  
  const slice = prices.slice(-period);
  const highIndex = slice.indexOf(Math.max(...slice));
  const lowIndex = slice.indexOf(Math.min(...slice));
  
  const aroonUp = ((period - (period - 1 - highIndex)) / period) * 100;
  const aroonDown = ((period - (period - 1 - lowIndex)) / period) * 100;
  
  let trend = 'neutral';
  if (aroonUp > 70 && aroonDown < 30) trend = 'strong_uptrend';
  else if (aroonDown > 70 && aroonUp < 30) trend = 'strong_downtrend';
  else if (aroonUp > aroonDown) trend = 'uptrend';
  else if (aroonDown > aroonUp) trend = 'downtrend';
  
  return { aroonUp, aroonDown, trend };
};

// 10. Candlestick Pattern Detection
// Recognizes common price action patterns.
export const detectCandlestickPattern = (prices) => {
  if (prices.length < 3) return { pattern: 'none', signal: 'neutral' };
  
  const current = prices[prices.length - 1];
  const prev = prices[prices.length - 2];
  const prev2 = prices[prices.length - 3];
  
  const body = Math.abs(current - prev);
  const prevBody = Math.abs(prev - prev2);
  
  // Bullish patterns
  if (current > prev && body > prevBody * 1.5) {
    return { pattern: 'bullish_engulfing', signal: 'buy' };
  }
  if (current > prev && prev < prev2 && current > prev2) {
    return { pattern: 'morning_star', signal: 'buy' };
  }
  
  // Bearish patterns
  if (current < prev && body > prevBody * 1.5) {
    return { pattern: 'bearish_engulfing', signal: 'sell' };
  }
  if (current < prev && prev > prev2 && current < prev2) {
    return { pattern: 'evening_star', signal: 'sell' };
  }
  
  // Doji
  if (body < (Math.max(current, prev) * 0.001)) {
    return { pattern: 'doji', signal: 'neutral' };
  }
  
  return { pattern: 'none', signal: 'neutral' };
};

// 11. Ichimoku Cloud
// Comprehensive trend and momentum indicator.
export const calculateIchimoku = (prices) => {
  if (prices.length < 52) return { signal: 'neutral', cloud: 'neutral' };
  
  // Tenkan-sen (Conversion Line): (9-period high + 9-period low)/2
  const tenkanPeriod = 9;
  const tenkanSlice = prices.slice(-tenkanPeriod);
  const tenkanSen = (Math.max(...tenkanSlice) + Math.min(...tenkanSlice)) / 2;
  
  // Kijun-sen (Base Line): (26-period high + 26-period low)/2
  const kijunPeriod = 26;
  const kijunSlice = prices.slice(-kijunPeriod);
  const kijunSen = (Math.max(...kijunSlice) + Math.min(...kijunSlice)) / 2;
  
  // Senkou Span A: (Conversion Line + Base Line)/2
  const senkouA = (tenkanSen + kijunSen) / 2;
  
  // Senkou Span B: (52-period high + 52-period low)/2
  const senkouSlice = prices.slice(-52);
  const senkouB = (Math.max(...senkouSlice) + Math.min(...senkouSlice)) / 2;
  
  const current = prices[prices.length - 1];
  
  // Determine cloud position and signal
  let cloud = 'neutral';
  let signal = 'neutral';
  
  if (senkouA > senkouB) {
    cloud = 'bullish';
    if (current > senkouA) signal = 'strong_buy';
    else if (current > senkouB) signal = 'buy';
  } else {
    cloud = 'bearish';
    if (current < senkouA) signal = 'strong_sell';
    else if (current < senkouB) signal = 'sell';
  }
  
  // TK Cross
  if (tenkanSen > kijunSen && cloud === 'bullish') signal = 'strong_buy';
  if (tenkanSen < kijunSen && cloud === 'bearish') signal = 'strong_sell';
  
  return { signal, cloud, tenkanSen, kijunSen, senkouA, senkouB };
};

// Helper: apply EMA over an array of values
const emaOfArray = (arr, period) => {
  if (arr.length < period) return arr.slice();
  const k = 2 / (period + 1);
  let ema = arr.slice(0, period).reduce((s, v) => s + v, 0) / period;
  const result = [ema];
  for (let i = period; i < arr.length; i++) {
    ema = arr[i] * k + ema * (1 - k);
    result.push(ema);
  }
  return result;
};

// SP500 AI Suite - Component 1: Heikin Ashi direction (close-only approximation)
export const calculateHeikinAshi = (prices) => {
  if (prices.length < 3) return { haBullish: true, haBearish: false };
  let haOpen = prices[0];
  let haClose = prices[0];
  for (let i = 1; i < prices.length; i++) {
    const prevHaOpen = haOpen;
    const prevHaClose = haClose;
    haClose = prices[i];
    haOpen = (prevHaOpen + prevHaClose) / 2;
  }
  return { haBullish: haClose > haOpen, haBearish: haClose <= haOpen };
};

// SP500 AI Suite - Component 2: SSL Channel (price vs SMA-based trend)
export const calculateSSLChannel = (prices, length = 9) => {
  if (prices.length < length) return { sslBullish: true, sslBearish: false };
  const sma = prices.slice(-length).reduce((s, p) => s + p, 0) / length;
  const current = prices[prices.length - 1];
  const sslBullish = current >= sma;
  return { sslBullish, sslBearish: !sslBullish };
};

// SP500 AI Suite - Component 3: Chande Momentum Oscillator (CMO)
export const calculateCMO = (prices, length = 14) => {
  if (prices.length < length + 1) return { cmo: 0, overbought: false, oversold: false };
  let sumUp = 0, sumDown = 0;
  for (let i = prices.length - length; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) sumUp += change;
    else sumDown -= change;
  }
  const total = sumUp + sumDown;
  const cmo = total === 0 ? 0 : ((sumUp - sumDown) / total) * 100;
  return { cmo, overbought: cmo > 50, oversold: cmo < -50 };
};

// SP500 AI Suite - Component 4: AI RSI (dual RSI crossover)
export const calculateAIRSI = (prices, shortLen = 5, longLen = 13, signalLen = 9) => {
  if (prices.length < longLen + signalLen + 5) return { aiRSIBullish: false, aiRSIBearish: false };
  const rsiShort = calculateRSI(prices, shortLen);
  const rsiLong = calculateRSI(prices, longLen);
  const aiRSIValue = rsiShort - rsiLong;
  const totalRSI = rsiShort + rsiLong;
  // Build signal line from recent windows
  const history = [];
  const start = Math.max(longLen + 2, prices.length - signalLen - 10);
  for (let i = start; i < prices.length; i++) {
    const sub = prices.slice(0, i + 1);
    const rs = calculateRSI(sub, shortLen);
    const rl = calculateRSI(sub, longLen);
    history.push(rs - rl);
  }
  const signal = history.length > 0
    ? history.slice(-Math.min(signalLen, history.length)).reduce((s, v) => s + v, 0) / Math.min(signalLen, history.length)
    : 0;
  return {
    aiRSIBullish: aiRSIValue > signal && totalRSI > 100,
    aiRSIBearish: aiRSIValue < signal && totalRSI <= 100
  };
};

// SP500 AI Suite - Component 5: AI Momentum (TMO - True Momentum Oscillator)
export const calculateTMO = (prices, length = 14, calcLen = 5, smoothLen = 3) => {
  if (prices.length < length + calcLen + smoothLen * 2 + 2) return { tmoBullish: false, tmoBearish: false };
  const tmoRaw = [];
  for (let i = length; i < prices.length; i++) {
    let val = 0;
    for (let j = 0; j <= length; j++) {
      if (i - j >= 0) {
        if (prices[i] > prices[i - j]) val += 1;
        else if (prices[i] < prices[i - j]) val -= 1;
      }
    }
    tmoRaw.push(val);
  }
  if (tmoRaw.length < calcLen + smoothLen * 2) return { tmoBullish: false, tmoBearish: false };
  const ema1 = emaOfArray(tmoRaw, calcLen);
  const ema2 = emaOfArray(ema1, smoothLen);
  const signalArr = emaOfArray(ema2, smoothLen);
  const tmoMain = ema2[ema2.length - 1];
  const tmoSignal = signalArr[signalArr.length - 1];
  return {
    tmoBullish: tmoMain > tmoSignal && tmoMain > 0,
    tmoBearish: tmoMain < tmoSignal && tmoMain < 0
  };
};

// SP500 AI Suite - Component 6: AI Money Flow
export const calculateMoneyFlow = (prices, length = 9) => {
  if (prices.length < length + 1) return { mfBullish: true, mfBearish: false, mfo: 0 };
  let mfSum = 0;
  for (let i = prices.length - length; i < prices.length; i++) {
    if (i > 0) {
      const avg = (prices[i] + prices[i - 1]) / 2;
      if (avg > 0) mfSum += (prices[i] - prices[i - 1]) / avg;
    }
  }
  const mfo = mfSum / length;
  return { mfBullish: mfo >= 0, mfBearish: mfo < 0, mfo };
};

export const analyzeIndicators = (asset, enabledIndicators) => {
  // Generate synthetic history based on asset's current state
  const prices = generateSyntheticHistory(asset.price, asset.change24h, 100);
  
  const results = {};
  let scoreModifier = 0;
  let signals = [];

  if (enabledIndicators.rsi) {
    const rsi = calculateRSI(prices);
    results.rsi = rsi;
    if (rsi < 30) {
      scoreModifier += 15;
      signals.push("RSI Oversold (Bullish)");
    } else if (rsi > 70) {
      scoreModifier -= 15;
      signals.push("RSI Overbought (Bearish)");
    }
  }

  if (enabledIndicators.macd) {
    const { histogram } = calculateMACD(prices);
    results.macd = histogram;
    if (histogram > 0) {
      scoreModifier += 10;
      signals.push("MACD Bullish Crossover");
    } else {
      scoreModifier -= 10;
      signals.push("MACD Bearish Trend");
    }
  }

  if (enabledIndicators.bollinger) {
    const { upper, lower } = calculateBollingerBands(prices);
    const current = prices[prices.length - 1];
    results.bb = { upper, lower };
    if (current < lower) {
      scoreModifier += 15;
      signals.push("Price below BB Lower (Bounce likely)");
    } else if (current > upper) {
      scoreModifier -= 15;
      signals.push("Price above BB Upper (Pullback likely)");
    }
  }

  if (enabledIndicators.ema) {
    const emaShort = calculateEMA(prices, 12);
    const emaLong = calculateEMA(prices, 50);
    results.ema = { short: emaShort, long: emaLong };
    if (emaShort > emaLong) {
      scoreModifier += 10;
      signals.push("EMA Golden Trend (Bullish)");
    } else {
      scoreModifier -= 10;
      signals.push("EMA Death Trend (Bearish)");
    }
  }

  if (enabledIndicators.stoch) {
    const { k } = calculateStochastic(prices);
    results.stoch = k;
    if (k < 20) {
      scoreModifier += 10;
      signals.push("Stoch Oversold");
    } else if (k > 80) {
      scoreModifier -= 10;
      signals.push("Stoch Overbought");
    }
  }

  if (enabledIndicators.adx) {
    const adx = calculateADX(prices);
    results.adx = adx;
    if (adx.trend === 'strong_uptrend') {
      scoreModifier += 15;
      signals.push(`ADX Strong Uptrend (${adx.adx.toFixed(0)})`);
    } else if (adx.trend === 'strong_downtrend') {
      scoreModifier -= 15;
      signals.push(`ADX Strong Downtrend (${adx.adx.toFixed(0)})`);
    }
  }

  if (enabledIndicators.sma) {
    const sma20 = calculateSMA(prices, 20);
    const sma50 = calculateSMA(prices, 50);
    const current = prices[prices.length - 1];
    results.sma = { sma20, sma50 };
    if (current > sma20 && sma20 > sma50) {
      scoreModifier += 12;
      signals.push("SMA Golden Cross");
    } else if (current < sma20 && sma20 < sma50) {
      scoreModifier -= 12;
      signals.push("SMA Death Cross");
    }
  }

  if (enabledIndicators.ao) {
    const ao = calculateAwesomeOscillator(prices);
    results.awesomeOscillator = ao;
    if (ao.signal === 'bullish') {
      scoreModifier += 10;
      signals.push("AO Bullish");
    } else if (ao.signal === 'bearish') {
      scoreModifier -= 10;
      signals.push("AO Bearish");
    }
  }

  if (enabledIndicators.aroon) {
    const aroon = calculateAroon(prices);
    results.aroon = aroon;
    if (aroon.trend === 'strong_uptrend') {
      scoreModifier += 15;
      signals.push("Aroon Strong Uptrend");
    } else if (aroon.trend === 'strong_downtrend') {
      scoreModifier -= 15;
      signals.push("Aroon Strong Downtrend");
    }
  }

  if (enabledIndicators.candlestick) {
    const pattern = detectCandlestickPattern(prices);
    results.candlestick = pattern;
    if (pattern.signal === 'buy') {
      scoreModifier += 12;
      signals.push(`${pattern.pattern.replace(/_/g, ' ').toUpperCase()}`);
    } else if (pattern.signal === 'sell') {
      scoreModifier -= 12;
      signals.push(`${pattern.pattern.replace(/_/g, ' ').toUpperCase()}`);
    }
  }

  if (enabledIndicators.ichimoku) {
    const ichimoku = calculateIchimoku(prices);
    results.ichimoku = ichimoku;
    if (ichimoku.signal === 'strong_buy') {
      scoreModifier += 18;
      signals.push("Ichimoku Strong Buy");
    } else if (ichimoku.signal === 'strong_sell') {
      scoreModifier -= 18;
      signals.push("Ichimoku Strong Sell");
    } else if (ichimoku.signal === 'buy') {
      scoreModifier += 10;
      signals.push("Ichimoku Buy");
    } else if (ichimoku.signal === 'sell') {
      scoreModifier -= 10;
      signals.push("Ichimoku Sell");
    }
  }

  // ── SP500 AI Suite ─────────────────────────────────────────────
  const ha   = calculateHeikinAshi(prices);
  const ssl  = calculateSSLChannel(prices, 9);
  const cmo  = calculateCMO(prices, 14);
  const aiRsi = enabledIndicators.sp500_ai_rsi ? calculateAIRSI(prices, 5, 13, 9) : null;
  const tmo   = enabledIndicators.sp500_tmo   ? calculateTMO(prices, 14, 5, 3)    : null;
  const mf    = enabledIndicators.sp500_money_flow ? calculateMoneyFlow(prices, 9) : null;

  if (enabledIndicators.sp500_ssl) {
    results.sp500_ssl = ssl;
    if (ssl.sslBullish) { scoreModifier += 12; signals.push("SP500 SSL Bullish"); }
    else                { scoreModifier -= 12; signals.push("SP500 SSL Bearish"); }
  }
  if (enabledIndicators.sp500_cmo) {
    results.sp500_cmo = cmo;
    if (!cmo.overbought && !cmo.oversold) {
      scoreModifier += cmo.cmo > 0 ? 10 : -10;
      signals.push(cmo.cmo > 0 ? "CMO Bullish" : "CMO Bearish");
    } else {
      scoreModifier -= 15;
      signals.push(cmo.overbought ? "CMO Overbought (Block)" : "CMO Oversold (Block)");
    }
  }
  if (enabledIndicators.sp500_ai_rsi && aiRsi) {
    results.sp500_ai_rsi = aiRsi;
    if (aiRsi.aiRSIBullish)      { scoreModifier += 10; signals.push("AI RSI Bullish"); }
    else if (aiRsi.aiRSIBearish) { scoreModifier -= 10; signals.push("AI RSI Bearish"); }
  }
  if (enabledIndicators.sp500_tmo && tmo) {
    results.sp500_tmo = tmo;
    if (tmo.tmoBullish)      { scoreModifier += 10; signals.push("AI Momentum (TMO) Bullish"); }
    else if (tmo.tmoBearish) { scoreModifier -= 10; signals.push("AI Momentum (TMO) Bearish"); }
  }
  if (enabledIndicators.sp500_money_flow && mf) {
    results.sp500_money_flow = mf;
    if (mf.mfBullish)      { scoreModifier += 8; signals.push("Money Flow Bullish"); }
    else if (mf.mfBearish) { scoreModifier -= 8; signals.push("Money Flow Bearish"); }
  }

  // SP500 Filter: all active SP500 sub-indicators must agree with trade direction
  let filterBlock = { buy: false, sell: false };
  if (enabledIndicators.sp500_filter) {
    const buyRequired  = [];
    const sellRequired = [];

    // Always check SSL and CMO when filter is on
    buyRequired.push(ssl.sslBullish && !cmo.overbought);
    sellRequired.push(ssl.sslBearish && !cmo.oversold);
    // HA direction
    buyRequired.push(ha.haBullish);
    sellRequired.push(ha.haBearish);
    if (aiRsi) { buyRequired.push(aiRsi.aiRSIBullish); sellRequired.push(aiRsi.aiRSIBearish); }
    if (tmo)   { buyRequired.push(tmo.tmoBullish);     sellRequired.push(tmo.tmoBearish); }
    if (mf)    { buyRequired.push(mf.mfBullish);       sellRequired.push(mf.mfBearish); }

    filterBlock.buy  = !buyRequired.every(Boolean);
    filterBlock.sell = !sellRequired.every(Boolean);
    if (filterBlock.buy)  signals.push("SP500 Filter: BUY blocked");
    if (filterBlock.sell) signals.push("SP500 Filter: SELL blocked");
  }

  return {
    results,
    scoreModifier,
    signals,
    filterBlock
  };
};