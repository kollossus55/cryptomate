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

// ============================================================================
// SP500 Full AI Indicator (Ported from Pine Script)
// Combines: Heikin Ashi + SSL Channel + CMO + AI RSI + AI Momentum (TMO) + AI Money Flow
// Returns: { longSignal, shortSignal, bullish, bearish, strength, components }
// ============================================================================

export const calculateSP500AIIndicator = (prices, highs = null, lows = null, volumes = null, options = {}) => {
  const n = prices.length;
  if (n < 34) return { longSignal: false, shortSignal: false, bullish: false, bearish: false, strength: 0, components: {} };

  // Use prices as both high/low when not provided (crypto OHLC simulation)
  const H = highs || prices;
  const L = lows || prices;
  const V = volumes || prices.map(() => 1000000);

  // --- Heikin Ashi ---
  const haClose = prices.map((c, i) => (H[i] + L[i] + c + c) / 4);
  const haOpen = [prices[0]];
  for (let i = 1; i < n; i++) haOpen.push((haOpen[i - 1] + haClose[i - 1]) / 2);
  const haBullish = haClose[n - 1] > haOpen[n - 1];
  const haBearish = haClose[n - 1] < haOpen[n - 1];

  // --- CMO (Chande Momentum Oscillator) ---
  const cmoLength = options.cmoLength || 14;
  const cmoOverboughtLevel = options.cmoOverbought || 50;
  const cmoOversoldLevel = options.cmoOversold || -50;
  let momUpSum = 0, momDownSum = 0;
  for (let i = n - cmoLength; i < n; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) momUpSum += change;
    else momDownSum += Math.abs(change);
  }
  const cmo = (momUpSum + momDownSum) === 0 ? 0 : ((momUpSum - momDownSum) / (momUpSum + momDownSum)) * 100;
  const cmoOverboughtCond = cmo > cmoOverboughtLevel;
  const cmoOversoldCond = cmo < cmoOversoldLevel;

  // --- SSL Channel ---
  const sslLength = options.sslLength || 9;
  const sslSliceH = H.slice(-sslLength);
  const sslSliceL = L.slice(-sslLength);
  const smaHigh = sslSliceH.reduce((a, b) => a + b, 0) / sslLength;
  const smaLow = sslSliceL.reduce((a, b) => a + b, 0) / sslLength;
  const currentPrice = prices[n - 1];
  const prevPrice = prices[n - 2];
  // Derive hlv from last two candles
  let hlv = currentPrice > smaHigh ? 1 : currentPrice < smaLow ? -1 : (prevPrice > smaHigh ? 1 : -1);
  const sslBullish = hlv > 0;
  const sslBearish = hlv < 0;

  // --- AI RSI (Dual RSI Divergence) ---
  const rsiShortLen = options.rsiShortLength || 5;
  const rsiLongLen = options.rsiLongLength || 13;
  const rsiSignalLen = options.rsiSignalLength || 9;

  const calcRSI = (p, period) => {
    if (p.length < period + 1) return 50;
    let g = 0, l = 0;
    for (let i = p.length - period; i < p.length; i++) {
      const d = p[i] - p[i - 1];
      if (d >= 0) g += d; else l -= d;
    }
    const ag = g / period, al = l / period;
    if (al === 0) return 100;
    return 100 - (100 / (1 + ag / al));
  };

  const RSIshort = calcRSI(prices, rsiShortLen);
  const RSIlong = calcRSI(prices, rsiLongLen);
  const aiRSIValue = RSIshort - RSIlong;
  // Approximate signal as SMA of aiRSIValue over last rsiSignalLen bars
  const aiRSIValues = [];
  for (let i = Math.max(0, n - rsiSignalLen); i < n; i++) {
    const rs = calcRSI(prices.slice(0, i + 1), rsiShortLen);
    const rl = calcRSI(prices.slice(0, i + 1), rsiLongLen);
    aiRSIValues.push(rs - rl);
  }
  const aiRSISignal = aiRSIValues.reduce((a, b) => a + b, 0) / aiRSIValues.length;
  const totalRSI = RSIshort + RSIlong;
  const aiRSIBullish = aiRSIValue > aiRSISignal && totalRSI > 100;
  const aiRSIBearish = aiRSIValue < aiRSISignal && totalRSI <= 100;

  // --- AI Momentum (TMO - True Momentum Oscillator) ---
  const tmoLength = options.tmoLength || 14;
  const tmoCalcLength = options.tmoCalcLength || 5;
  const tmoSmoothLength = options.tmoSmoothLength || 3;
  let tmoData = 0;
  for (let i = 0; i <= Math.min(tmoLength, n - 1); i++) {
    const idx = n - 1;
    const cmpIdx = Math.max(0, idx - i);
    tmoData += prices[idx] > prices[cmpIdx] ? 1 : prices[idx] < prices[cmpIdx] ? -1 : 0;
  }
  // Simple EMA chain approximation
  const calcEMA = (arr, period) => {
    if (arr.length === 0) return 0;
    const k = 2 / (period + 1);
    let e = arr[0];
    for (let i = 1; i < arr.length; i++) e = arr[i] * k + e * (1 - k);
    return e;
  };
  const tmoMain = calcEMA([tmoData], tmoCalcLength); // single-value approximation
  const tmoSignalVal = tmoMain * 0.9; // simplified
  const tmoBullish = tmoMain > tmoSignalVal && tmoMain > 0;
  const tmoBearish = tmoMain < tmoSignalVal && tmoMain < 0;

  // --- AI Money Flow ---
  const mfLength = options.mfLength || 9;
  let mfNumerator = 0, mfDenominator = 0;
  for (let i = Math.max(1, n - mfLength); i < n; i++) {
    const division = (H[i] - L[i - 1]) + (H[i - 1] - L[i]);
    let multiplier = 0;
    if (H[i] < L[i - 1]) multiplier = -1;
    else if (L[i] > H[i - 1]) multiplier = 1;
    else if (division !== 0) multiplier = ((H[i] - L[i - 1]) - (H[i - 1] - L[i])) / division;
    mfNumerator += multiplier * V[i];
    mfDenominator += V[i];
  }
  const moneyFlowOsc = mfDenominator === 0 ? 0 : mfNumerator / mfDenominator;
  const mfBullish = moneyFlowOsc > 0;
  const mfBearish = moneyFlowOsc < 0;

  // --- Signal Strength (0-6) ---
  const useAIRSI = options.useAIRSI !== false;
  const useAIMomentum = options.useAIMomentum !== false;
  const useAIMoneyFlow = options.useAIMoneyFlow !== false;

  // Long signal: HA bullish + SSL bullish + CMO not overbought + (optional filters)
  let longBasic = haBullish && sslBullish && !cmoOverboughtCond;
  let longWithRSI = useAIRSI ? (longBasic && aiRSIBullish) : longBasic;
  let longWithMomentum = useAIMomentum ? (longWithRSI && tmoBullish) : longWithRSI;
  const longSignal = useAIMoneyFlow ? (longWithMomentum && mfBullish) : longWithMomentum;

  let shortBasic = haBearish && sslBearish && !cmoOversoldCond;
  let shortWithRSI = useAIRSI ? (shortBasic && aiRSIBearish) : shortBasic;
  let shortWithMomentum = useAIMomentum ? (shortWithRSI && tmoBearish) : shortWithRSI;
  const shortSignal = useAIMoneyFlow ? (shortWithMomentum && mfBearish) : shortWithMomentum;

  // Strength score (how many sub-components confirm the direction)
  const bullStrength = (sslBullish ? 1 : 0) + (!cmoOverboughtCond ? 1 : 0) +
    (useAIRSI && aiRSIBullish ? 1 : 0) + (useAIMomentum && tmoBullish ? 1 : 0) +
    (useAIMoneyFlow && mfBullish ? 1 : 0) + (haBullish ? 1 : 0);
  const bearStrength = (sslBearish ? 1 : 0) + (!cmoOversoldCond ? 1 : 0) +
    (useAIRSI && aiRSIBearish ? 1 : 0) + (useAIMomentum && tmoBearish ? 1 : 0) +
    (useAIMoneyFlow && mfBearish ? 1 : 0) + (haBearish ? 1 : 0);

  const bullish = longSignal;
  const bearish = shortSignal;
  const strength = bullish ? bullStrength : bearish ? bearStrength : Math.max(bullStrength, bearStrength);

  return {
    longSignal,
    shortSignal,
    bullish,
    bearish,
    strength,
    maxStrength: 6,
    components: { haBullish, haBearish, sslBullish, sslBearish, cmo, cmoOverboughtCond, cmoOversoldCond, aiRSIBullish, aiRSIBearish, tmoBullish, tmoBearish, mfBullish, mfBearish }
  };
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

  if (enabledIndicators.sp500ai) {
    const sp500 = calculateSP500AIIndicator(prices);
    results.sp500ai = sp500;

    // FILTER: if enabled and neither long nor short signal fires, block the trade
    // This is communicated via a special flag on the result
    results.sp500ai_filter_pass = sp500.longSignal || sp500.shortSignal || sp500.strength >= 4;

    if (sp500.longSignal) {
      // Full signal: add significant confidence boost proportional to strength
      scoreModifier += 10 + Math.round((sp500.strength / sp500.maxStrength) * 12);
      signals.push(`SP500 AI Long Signal [${sp500.strength}/${sp500.maxStrength}]`);
    } else if (sp500.shortSignal) {
      scoreModifier -= 10 + Math.round((sp500.strength / sp500.maxStrength) * 12);
      signals.push(`SP500 AI Short Signal [${sp500.strength}/${sp500.maxStrength}]`);
    } else if (sp500.strength >= 4) {
      // Partial bullish confirmation even without full long/short
      const partialBoost = sp500.components.sslBullish ? 8 : -8;
      scoreModifier += partialBoost;
      signals.push(`SP500 AI Partial [${sp500.strength}/${sp500.maxStrength}]`);
    }
  }

  // Apply SP500 AI filter: if enabled and filter does NOT pass, hard-zero the score
  if (enabledIndicators.sp500ai && results.sp500ai && results.sp500ai_filter_pass === false) {
    return {
      results,
      scoreModifier: -30, // Penalty to push below confidence threshold
      signals: [...signals, 'SP500 AI Filter: No valid signal — trade blocked'],
      sp500ai_blocked: true
    };
  }

  return {
    results,
    scoreModifier,
    signals
  };
};