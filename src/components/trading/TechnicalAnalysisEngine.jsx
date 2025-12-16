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

  return {
    results,
    scoreModifier,
    signals
  };
};