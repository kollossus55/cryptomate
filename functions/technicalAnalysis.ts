import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

/**
 * Technical Analysis Module
 * Fetches historical data and calculates real technical indicators
 */

// Fetch historical OHLCV data from CoinGecko
async function fetchHistoricalData(coinId, days = 30) {
  try {
    // Fetch Market Chart (Prices/Volumes)
    const marketChartPromise = fetch(
      `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?vs_currency=usd&days=${days}&interval=daily`,
      { headers: { 'Accept': 'application/json' } }
    );

    // Fetch OHLC (Open, High, Low, Close) for better precision
    const ohlcPromise = fetch(
      `https://api.coingecko.com/api/v3/coins/${coinId}/ohlc?vs_currency=usd&days=${days}`,
      { headers: { 'Accept': 'application/json' } }
    );

    const [marketRes, ohlcRes] = await Promise.all([marketChartPromise, ohlcPromise]);
    
    if (!marketRes.ok) return null;
    const marketData = await marketRes.json();

    let ohlcData = [];
    if (ohlcRes.ok) {
      ohlcData = await ohlcRes.json();
    }

    return {
      prices: marketData.prices || [],
      volumes: marketData.total_volumes || [],
      ohlc: ohlcData // [time, open, high, low, close]
    };
  } catch (error) {
    console.error(`Error fetching historical data for ${coinId}:`, error.message);
    return null;
  }
}

// Calculate Simple Moving Average
function calculateSMA(prices, period) {
  if (prices.length < period) return null;
  const slice = prices.slice(-period);
  return slice.reduce((sum, p) => sum + p, 0) / period;
}

// Calculate Exponential Moving Average
function calculateEMA(prices, period) {
  if (prices.length < period) return null;
  
  const multiplier = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((sum, p) => sum + p, 0) / period;
  
  for (let i = period; i < prices.length; i++) {
    ema = (prices[i] - ema) * multiplier + ema;
  }
  
  return ema;
}

// Calculate Stochastic Oscillator
function calculateStochastic(ohlc, period = 14) {
  if (!ohlc || ohlc.length < period) return null;
  
  // OHLC format: [time, open, high, low, close]
  // We need the last 'period' candles
  const recent = ohlc.slice(-period);
  const current = recent[recent.length - 1];
  const currentClose = current[4];
  
  // Find Lowest Low and Highest High in period
  const lowestLow = Math.min(...recent.map(c => c[3]));
  const highestHigh = Math.max(...recent.map(c => c[2]));
  
  if (highestHigh === lowestLow) return 50;
  
  const k = ((currentClose - lowestLow) / (highestHigh - lowestLow)) * 100;
  return k;
}

// Calculate On-Balance Volume (OBV)
function calculateOBV(prices, volumes) {
  if (!prices || !volumes || prices.length !== volumes.length) return null;
  if (prices.length < 2) return 0;
  
  let obv = 0;
  // Start from index 1
  for (let i = 1; i < prices.length; i++) {
    const currentPrice = prices[i];
    const prevPrice = prices[i-1];
    const volume = volumes[i]; // Assuming volumes aligned
    
    if (currentPrice > prevPrice) {
      obv += volume;
    } else if (currentPrice < prevPrice) {
      obv -= volume;
    }
    // If equal, obv stays same
  }
  return obv;
}

// Calculate RSI (Relative Strength Index)
function calculateRSI(prices, period = 14) {
  if (prices.length < period + 1) return null;
  
  const changes = [];
  for (let i = 1; i < prices.length; i++) {
    changes.push(prices[i] - prices[i - 1]);
  }
  
  const recentChanges = changes.slice(-period);
  let gains = 0, losses = 0;
  
  recentChanges.forEach(change => {
    if (change > 0) gains += change;
    else losses += Math.abs(change);
  });
  
  const avgGain = gains / period;
  const avgLoss = losses / period;
  
  if (avgLoss === 0) return 100;
  
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

// Calculate MACD
function calculateMACD(prices) {
  const ema12 = calculateEMA(prices, 12);
  const ema26 = calculateEMA(prices, 26);
  
  if (!ema12 || !ema26) return null;
  
  const macdLine = ema12 - ema26;
  
  // Signal line would need more data points for accuracy
  // Simplified: positive MACD = bullish, negative = bearish
  return {
    macd: macdLine,
    signal: macdLine > 0 ? 'bullish' : 'bearish'
  };
}

// Calculate Bollinger Bands
function calculateBollingerBands(prices, period = 20, stdDev = 2) {
  if (prices.length < period) return null;
  
  const sma = calculateSMA(prices, period);
  const slice = prices.slice(-period);
  
  const squaredDiffs = slice.map(p => Math.pow(p - sma, 2));
  const variance = squaredDiffs.reduce((sum, d) => sum + d, 0) / period;
  const standardDeviation = Math.sqrt(variance);
  
  return {
    middle: sma,
    upper: sma + (standardDeviation * stdDev),
    lower: sma - (standardDeviation * stdDev),
    bandwidth: (standardDeviation * stdDev * 2) / sma * 100
  };
}

// Calculate Average True Range (volatility)
function calculateATR(highs, lows, closes, period = 14) {
  if (closes.length < period + 1) return null;
  
  const trueRanges = [];
  for (let i = 1; i < closes.length; i++) {
    const high = highs ? highs[i] : closes[i] * 1.02;
    const low = lows ? lows[i] : closes[i] * 0.98;
    const prevClose = closes[i - 1];
    
    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    trueRanges.push(tr);
  }
  
  const recentTR = trueRanges.slice(-period);
  return recentTR.reduce((sum, tr) => sum + tr, 0) / period;
}

// Detect support and resistance levels
function detectSupportResistance(prices) {
  if (prices.length < 20) return null;
  
  const recentPrices = prices.slice(-30);
  const currentPrice = recentPrices[recentPrices.length - 1];
  
  // Find local minima (support) and maxima (resistance)
  const supports = [];
  const resistances = [];
  
  for (let i = 2; i < recentPrices.length - 2; i++) {
    const price = recentPrices[i];
    
    // Local minimum (support)
    if (price < recentPrices[i-1] && price < recentPrices[i-2] &&
        price < recentPrices[i+1] && price < recentPrices[i+2]) {
      if (price < currentPrice) supports.push(price);
    }
    
    // Local maximum (resistance)
    if (price > recentPrices[i-1] && price > recentPrices[i-2] &&
        price > recentPrices[i+1] && price > recentPrices[i+2]) {
      if (price > currentPrice) resistances.push(price);
    }
  }
  
  // Get nearest support and resistance
  const nearestSupport = supports.length > 0 ? Math.max(...supports) : currentPrice * 0.95;
  const nearestResistance = resistances.length > 0 ? Math.min(...resistances) : currentPrice * 1.05;
  
  return {
    support: nearestSupport,
    resistance: nearestResistance,
    supportDistance: ((currentPrice - nearestSupport) / currentPrice) * 100,
    resistanceDistance: ((nearestResistance - currentPrice) / currentPrice) * 100
  };
}

// Determine trend direction
function determineTrend(prices) {
  if (prices.length < 20) return 'neutral';
  
  const sma7 = calculateSMA(prices, 7);
  const sma20 = calculateSMA(prices, 20);
  const currentPrice = prices[prices.length - 1];
  
  // Price above both MAs = uptrend
  // Price below both MAs = downtrend
  if (currentPrice > sma7 && sma7 > sma20) return 'strong_uptrend';
  if (currentPrice > sma7 && currentPrice > sma20) return 'uptrend';
  if (currentPrice < sma7 && sma7 < sma20) return 'strong_downtrend';
  if (currentPrice < sma7 && currentPrice < sma20) return 'downtrend';
  
  return 'neutral';
}

// Calculate volume trend
function analyzeVolume(volumes) {
  if (volumes.length < 10) return null;
  
  const recentVolumes = volumes.slice(-7);
  const olderVolumes = volumes.slice(-14, -7);
  
  const recentAvg = recentVolumes.reduce((sum, v) => sum + v, 0) / recentVolumes.length;
  const olderAvg = olderVolumes.reduce((sum, v) => sum + v, 0) / olderVolumes.length;
  
  const volumeChange = ((recentAvg - olderAvg) / olderAvg) * 100;
  
  return {
    current: recentVolumes[recentVolumes.length - 1],
    avgRecent: recentAvg,
    avgOlder: olderAvg,
    trend: volumeChange > 20 ? 'increasing' : volumeChange < -20 ? 'decreasing' : 'stable',
    changePercent: volumeChange
  };
}

// Main technical analysis function
export async function analyzeAsset(coinId, symbol) {
  console.log(`📊 Analyzing ${symbol} (${coinId})...`);
  
  const historical = await fetchHistoricalData(coinId, 30);
  
  if (!historical || !historical.prices || historical.prices.length < 14) {
    console.warn(`Insufficient data for ${symbol}`);
    return {
      symbol,
      valid: false,
      reason: 'insufficient_data'
    };
  }
  
  // Extract price array (CoinGecko returns [timestamp, price])
  const prices = historical.prices.map(p => p[1]);
  const volumes = historical.volumes.map(v => v[1]);
  const currentPrice = prices[prices.length - 1];
  
  // Calculate all indicators
  const sma7 = calculateSMA(prices, 7);
  const sma20 = calculateSMA(prices, 20);
  const sma50 = calculateSMA(prices, Math.min(50, prices.length));
  const ema12 = calculateEMA(prices, 12);
  const rsi = calculateRSI(prices, 14);
  const macd = calculateMACD(prices);
  const bollinger = calculateBollingerBands(prices, 20);
  const atr = calculateATR(
    historical.ohlc?.map(c => c[2]), // Highs
    historical.ohlc?.map(c => c[3]), // Lows
    prices, 
    14
  );
  const supportResistance = detectSupportResistance(prices);
  const trend = determineTrend(prices);
  const volumeAnalysis = analyzeVolume(volumes);
  
  // New Indicators
  const stochastic = calculateStochastic(historical.ohlc, 14);
  const obv = calculateOBV(prices, volumes);

  // Calculate momentum (7-day price change)
  const priceChange7d = prices.length >= 7 
    ? ((currentPrice - prices[prices.length - 7]) / prices[prices.length - 7]) * 100 
    : 0;
  
  // Calculate volatility (ATR as % of price)
  const volatilityPercent = atr ? (atr / currentPrice) * 100 : 5;
  
  return {
    symbol,
    coinId,
    valid: true,
    currentPrice,
    
    // Moving Averages
    sma7,
    sma20,
    sma50,
    ema12,
    priceVsSma20: sma20 ? ((currentPrice - sma20) / sma20) * 100 : 0,
    
    // Momentum Indicators
    rsi,
    macd,
    priceChange7d,
    
    // Volatility
    atr,
    volatilityPercent,
    bollinger,

    // Advanced
    stochastic,
    obv,
    
    // Support/Resistance
    supportResistance,
    
    // Trend
    trend,
    
    // Volume
    volumeAnalysis,
    
    // Timestamp
    analyzedAt: new Date().toISOString()
  };
}

// Generate trading signal from technical analysis
export function generateSignal(analysis) {
  if (!analysis || !analysis.valid) {
    return { signal: 'no_trade', confidence: 0, reasons: ['Invalid analysis data'] };
  }
  
  let buyScore = 0;
  let sellScore = 0;
  const reasons = [];
  
  // 1. TREND ANALYSIS (Weight: 25%)
  if (analysis.trend === 'strong_uptrend') {
    buyScore += 25;
    reasons.push('Strong uptrend confirmed');
  } else if (analysis.trend === 'uptrend') {
    buyScore += 15;
    reasons.push('Uptrend present');
  } else if (analysis.trend === 'strong_downtrend') {
    sellScore += 25;
    reasons.push('Strong downtrend - avoid buying');
  } else if (analysis.trend === 'downtrend') {
    sellScore += 15;
    reasons.push('Downtrend present');
  }
  
  // 2. RSI ANALYSIS (Weight: 20%)
  if (analysis.rsi !== null) {
    if (analysis.rsi < 30) {
      buyScore += 20;
      reasons.push(`RSI oversold (${analysis.rsi.toFixed(1)})`);
    } else if (analysis.rsi < 40) {
      buyScore += 10;
      reasons.push(`RSI approaching oversold (${analysis.rsi.toFixed(1)})`);
    } else if (analysis.rsi > 70) {
      sellScore += 20;
      reasons.push(`RSI overbought (${analysis.rsi.toFixed(1)}) - avoid buying`);
    } else if (analysis.rsi > 60) {
      sellScore += 5;
      reasons.push(`RSI elevated (${analysis.rsi.toFixed(1)})`);
    } else {
      buyScore += 5; // Neutral RSI is slightly positive
    }
  }
  
  // 3. MACD ANALYSIS (Weight: 15%)
  if (analysis.macd) {
    if (analysis.macd.signal === 'bullish' && analysis.macd.macd > 0) {
      buyScore += 15;
      reasons.push('MACD bullish');
    } else if (analysis.macd.signal === 'bearish') {
      sellScore += 15;
      reasons.push('MACD bearish');
    }
  }
  
  // 4. SUPPORT/RESISTANCE (Weight: 15%)
  if (analysis.supportResistance) {
    const sr = analysis.supportResistance;
    // Close to support = good buy opportunity
    if (sr.supportDistance < 3) {
      buyScore += 15;
      reasons.push(`Near support level (${sr.supportDistance.toFixed(1)}% above)`);
    } else if (sr.supportDistance < 5) {
      buyScore += 10;
      reasons.push(`Approaching support`);
    }
    // Close to resistance = risky buy
    if (sr.resistanceDistance < 3) {
      sellScore += 10;
      reasons.push(`Near resistance (${sr.resistanceDistance.toFixed(1)}% below)`);
    }
  }
  
  // 5. VOLUME ANALYSIS (Weight: 10%)
  if (analysis.volumeAnalysis) {
    if (analysis.volumeAnalysis.trend === 'increasing' && analysis.trend?.includes('uptrend')) {
      buyScore += 10;
      reasons.push('Volume confirming uptrend');
    } else if (analysis.volumeAnalysis.trend === 'decreasing' && analysis.trend?.includes('uptrend')) {
      sellScore += 5;
      reasons.push('Volume diverging from price');
    }
  }
  
  // 6. BOLLINGER BANDS (Weight: 10%)
  if (analysis.bollinger) {
    const bb = analysis.bollinger;
    const pricePosition = (analysis.currentPrice - bb.lower) / (bb.upper - bb.lower);
    
    if (pricePosition < 0.2) {
      buyScore += 10;
      reasons.push('Price near lower Bollinger Band');
    } else if (pricePosition > 0.8) {
      sellScore += 10;
      reasons.push('Price near upper Bollinger Band');
    }
  }
  
  // 7. VOLATILITY CHECK (Weight: 5%)
  if (analysis.volatilityPercent > 8) {
    sellScore += 10;
    reasons.push(`High volatility (${analysis.volatilityPercent.toFixed(1)}%) - risky`);
  } else if (analysis.volatilityPercent < 3) {
    buyScore += 5;
    reasons.push('Low volatility environment');
  }

  // 8. STOCHASTIC OSCILLATOR (Weight: 10%)
  if (analysis.stochastic !== null) {
    if (analysis.stochastic < 20) {
      buyScore += 15;
      reasons.push(`Stochastic oversold (${analysis.stochastic.toFixed(0)})`);
    } else if (analysis.stochastic > 80) {
      sellScore += 15;
      reasons.push(`Stochastic overbought (${analysis.stochastic.toFixed(0)})`);
    }
  }

  // 9. ON-BALANCE VOLUME (Weight: 5%)
  if (analysis.obv !== null && analysis.trend === 'uptrend') {
    // Checking if OBV is trending up would require historical OBV, 
    // simplified check: if positive volume flow matches price
    if (analysis.volumeAnalysis?.trend === 'increasing') {
      buyScore += 5;
      reasons.push('Strong volume support (OBV)');
    }
  }
  
  // Calculate final scores
  const netScore = buyScore - sellScore;
  const totalWeight = buyScore + sellScore;
  
  // Determine signal
  let signal = 'hold';
  let confidence = 50;
  
  if (netScore >= 30) {
    signal = 'strong_buy';
    confidence = Math.min(90, 60 + netScore);
  } else if (netScore >= 15) {
    signal = 'buy';
    confidence = Math.min(80, 55 + netScore);
  } else if (netScore <= -30) {
    signal = 'strong_sell';
    confidence = Math.min(90, 60 + Math.abs(netScore));
  } else if (netScore <= -15) {
    signal = 'sell';
    confidence = Math.min(80, 55 + Math.abs(netScore));
  } else {
    signal = 'hold';
    confidence = 50 - Math.abs(netScore);
  }
  
  return {
    signal,
    confidence: Math.round(confidence),
    buyScore,
    sellScore,
    netScore,
    reasons,
    riskLevel: analysis.volatilityPercent > 6 ? 'high' : analysis.volatilityPercent > 3 ? 'medium' : 'low'
  };
}

// API endpoint
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const { coinId, symbol } = await req.json();
    
    if (!coinId || !symbol) {
      return Response.json({ error: 'coinId and symbol required' }, { status: 400 });
    }
    
    const analysis = await analyzeAsset(coinId, symbol);
    const signal = generateSignal(analysis);
    
    return Response.json({
      success: true,
      analysis,
      signal
    });
    
  } catch (error) {
    console.error('Technical Analysis Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});