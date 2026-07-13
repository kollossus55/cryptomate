import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';

/**
 * Technical Analysis - Server-Side Port
 */
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

const calculateRSI = (prices, period = 14) => {
  if (prices.length < period + 1) return 50;
  let gains = 0, losses = 0;
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

const calculateEMA = (prices, period) => {
  if (prices.length < period) return prices[prices.length - 1];
  const k = 2 / (period + 1);
  let ema = prices[0];
  for (let i = 1; i < prices.length; i++) {
    ema = (prices[i] * k) + (ema * (1 - k));
  }
  return ema;
};

const calculateMACD = (prices) => {
  if (prices.length < 26) return { histogram: 0 };
  const emaFast = calculateEMA(prices, 12);
  const emaSlow = calculateEMA(prices, 26);
  const macdLine = emaFast - emaSlow;
  const signalLine = macdLine * 0.9;
  return { histogram: macdLine - signalLine };
};

const calculateBollingerBands = (prices, period = 20, multiplier = 2) => {
  if (prices.length < period) return { upper: 0, middle: 0, lower: 0 };
  const slice = prices.slice(-period);
  const middle = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.map(p => Math.pow(p - middle, 2)).reduce((a, b) => a + b, 0) / period;
  const stdDev = Math.sqrt(variance);
  return {
    upper: middle + (stdDev * multiplier),
    middle: middle,
    lower: middle - (stdDev * multiplier)
  };
};

const calculateStochastic = (prices, period = 14) => {
  if (prices.length < period) return { k: 50 };
  const current = prices[prices.length - 1];
  const slice = prices.slice(-period);
  const low = Math.min(...slice);
  const high = Math.max(...slice);
  if (high === low) return { k: 50 };
  return { k: ((current - low) / (high - low)) * 100 };
};

// ============================================================================
// SP500 Full AI Indicator (Server-Side Port)
// ============================================================================
const calculateSP500AIIndicator = (prices, options = {}) => {
  const n = prices.length;
  if (n < 34) return { longSignal: false, shortSignal: false, bullish: false, bearish: false, strength: 0, filter_pass: true };

  const H = prices, L = prices;

  // Heikin Ashi
  const haClose = prices.map((c, i) => (H[i] + L[i] + c + c) / 4);
  const haOpen = [prices[0]];
  for (let i = 1; i < n; i++) haOpen.push((haOpen[i - 1] + haClose[i - 1]) / 2);
  const haBullish = haClose[n - 1] > haOpen[n - 1];
  const haBearish = haClose[n - 1] < haOpen[n - 1];

  // CMO
  const cmoLength = 14;
  let momUpSum = 0, momDownSum = 0;
  for (let i = n - cmoLength; i < n; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) momUpSum += change; else momDownSum += Math.abs(change);
  }
  const cmo = (momUpSum + momDownSum) === 0 ? 0 : ((momUpSum - momDownSum) / (momUpSum + momDownSum)) * 100;
  const cmoOverboughtCond = cmo > 50;
  const cmoOversoldCond = cmo < -50;

  // SSL Channel
  const sslLength = 9;
  const smaHigh = H.slice(-sslLength).reduce((a, b) => a + b, 0) / sslLength;
  const smaLow = L.slice(-sslLength).reduce((a, b) => a + b, 0) / sslLength;
  const cp = prices[n - 1], pp = prices[n - 2];
  const hlv = cp > smaHigh ? 1 : cp < smaLow ? -1 : (pp > smaHigh ? 1 : -1);
  const sslBullish = hlv > 0;
  const sslBearish = hlv < 0;

  // AI RSI
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
  const RSIshort = calcRSI(prices, 5);
  const RSIlong = calcRSI(prices, 13);
  const aiRSIValue = RSIshort - RSIlong;
  const rsiSignalLen = 9;
  const aiRSIValues = [];
  for (let i = Math.max(1, n - rsiSignalLen); i < n; i++) {
    aiRSIValues.push(calcRSI(prices.slice(0, i + 1), 5) - calcRSI(prices.slice(0, i + 1), 13));
  }
  const aiRSISignal = aiRSIValues.reduce((a, b) => a + b, 0) / aiRSIValues.length;
  const totalRSI = RSIshort + RSIlong;
  const aiRSIBullish = aiRSIValue > aiRSISignal && totalRSI > 100;
  const aiRSIBearish = aiRSIValue < aiRSISignal && totalRSI <= 100;

  // TMO
  let tmoData = 0;
  const tmoLength = 14;
  for (let i = 0; i <= Math.min(tmoLength, n - 1); i++) {
    const cmpIdx = Math.max(0, n - 1 - i);
    tmoData += prices[n - 1] > prices[cmpIdx] ? 1 : prices[n - 1] < prices[cmpIdx] ? -1 : 0;
  }
  const tmoBullish = tmoData > 0;
  const tmoBearish = tmoData < 0;

  // Money Flow (simplified without volume)
  const mfLength = 9;
  let mfSum = 0;
  for (let i = Math.max(1, n - mfLength); i < n; i++) {
    const d = prices[i] - prices[i - 1];
    mfSum += d > 0 ? 1 : d < 0 ? -1 : 0;
  }
  const mfBullish = mfSum > 0;
  const mfBearish = mfSum < 0;

  const longBasic = haBullish && sslBullish && !cmoOverboughtCond;
  const longSignal = longBasic && aiRSIBullish && tmoBullish && mfBullish;
  const shortBasic = haBearish && sslBearish && !cmoOversoldCond;
  const shortSignal = shortBasic && aiRSIBearish && tmoBearish && mfBearish;

  const strength = (sslBullish ? 1 : 0) + (!cmoOverboughtCond ? 1 : 0) +
    (aiRSIBullish ? 1 : 0) + (tmoBullish ? 1 : 0) + (mfBullish ? 1 : 0) + (haBullish ? 1 : 0);
  
  const filter_pass = longSignal || shortSignal || strength >= 4;

  return { longSignal, shortSignal, bullish: longSignal, bearish: shortSignal, strength, filter_pass };
};

const analyzeIndicators = (asset, enabledIndicators = { rsi: true, macd: true, bollinger: true, ema: true, stoch: true }) => {
  const prices = generateSyntheticHistory(asset.price, asset.change24h, 100);
  let scoreModifier = 0;
  const signals = [];

  if (enabledIndicators.rsi) {
    const rsi = calculateRSI(prices);
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
    if (histogram > 0) {
      scoreModifier += 10;
      signals.push("MACD Bullish");
    } else {
      scoreModifier -= 10;
      signals.push("MACD Bearish");
    }
  }

  if (enabledIndicators.bollinger) {
    const { upper, lower } = calculateBollingerBands(prices);
    const current = prices[prices.length - 1];
    if (current < lower) {
      scoreModifier += 15;
      signals.push("BB Lower Bounce");
    } else if (current > upper) {
      scoreModifier -= 15;
      signals.push("BB Upper Pullback");
    }
  }

  if (enabledIndicators.ema) {
    const emaShort = calculateEMA(prices, 12);
    const emaLong = calculateEMA(prices, 50);
    if (emaShort > emaLong) {
      scoreModifier += 10;
      signals.push("EMA Golden Trend");
    } else {
      scoreModifier -= 10;
      signals.push("EMA Death Trend");
    }
  }

  if (enabledIndicators.stoch) {
    const { k } = calculateStochastic(prices);
    if (k < 20) {
      scoreModifier += 10;
      signals.push("Stoch Oversold");
    } else if (k > 80) {
      scoreModifier -= 10;
      signals.push("Stoch Overbought");
    }
  }

  if (enabledIndicators.sp500ai) {
    const sp500 = calculateSP500AIIndicator(prices);
    if (sp500.longSignal) {
      scoreModifier += 10 + Math.round((sp500.strength / 6) * 12);
      signals.push(`SP500 AI Long [${sp500.strength}/6]`);
    } else if (sp500.shortSignal) {
      scoreModifier -= 10 + Math.round((sp500.strength / 6) * 12);
      signals.push(`SP500 AI Short [${sp500.strength}/6]`);
    } else if (sp500.strength >= 4) {
      scoreModifier += sp500.bullish ? 8 : -8;
      signals.push(`SP500 AI Partial [${sp500.strength}/6]`);
    }
    // Filter: if signal doesn't pass, apply penalty to push below threshold
    if (!sp500.filter_pass) {
      scoreModifier -= 30;
      signals.push('SP500 AI Filter: blocked');
    }
  }

  return { scoreModifier, signals };
};

/**
 * Auto-Trading Worker V4 (Rebuilt)
 * 
 * Uses the exact same core logic as the browser-based engine
 * via the ported autoTradingEngineBackend.js module.
 */

// Dynamic list - fetching top 250 by market cap
const TOP_ASSETS_COUNT = 250;

/**
 * Generate simulated news sentiment (matching browser logic)
 */
function generateNewsSentiment(asset) {
  const priceChange = asset.change24h || 0;
  let sentimentValue = (Math.random() * 1.2) - 0.6;
  
  if (priceChange > 5) sentimentValue += 0.3;
  else if (priceChange > 2) sentimentValue += 0.15;
  else if (priceChange < -5) sentimentValue -= 0.3;
  else if (priceChange < -2) sentimentValue -= 0.15;
  
  sentimentValue = Math.max(-1, Math.min(1, sentimentValue));
  return sentimentValue;
}

/**
 * Calculate ADVANCED confidence score (matching browser's generateAdvancedSignal)
 */
function calculateConfidence(asset, enabledIndicators = { rsi: true, macd: true, bollinger: true, ema: true, stoch: true }) {
  // Base technical score (matching browser)
  let technicalScore = 60;

  // Price momentum (matching browser V4 logic exactly)
  const change = asset.change24h || 0;
  if (change > 2 && change <= 10) technicalScore += 20;
  else if (change > 10) technicalScore += 5;
  else if (change > 0) technicalScore += 10;
  else if (change > -3) technicalScore += 5;
  else if (change > -8) technicalScore -= 5;
  else technicalScore -= 20;

  // Volume
  const avgVolume = 1500000000;
  if (asset.volume24h > avgVolume * 2) technicalScore += 15;
  else if (asset.volume24h > avgVolume) technicalScore += 10;
  else if (asset.volume24h < avgVolume / 2) technicalScore -= 10;

  // Market Cap
  if (asset.marketCap > 100000000000) technicalScore += 10;
  else if (asset.marketCap > 10000000000) technicalScore += 5;

  // Volatility
  const volatility = Math.abs(change);
  if (volatility > 10) technicalScore -= 10;
  else if (volatility < 2) technicalScore += 5;

  // APPLY TECHNICAL INDICATORS
  const { scoreModifier, signals } = analyzeIndicators(asset, enabledIndicators);
  technicalScore = Math.max(0, Math.min(100, technicalScore + scoreModifier));

  // NEWS SENTIMENT (70% Technical + 30% News = matching browser default weights)
  const newsSentiment = generateNewsSentiment(asset);
  const newsScore = (newsSentiment + 1) * 50; // Convert -1 to 1 into 0-100

  // COMPOSITE SCORE (matching browser's 70/30 split)
  const compositeScore = (technicalScore * 0.7) + (newsScore * 0.3);
  
  const finalScore = Math.max(30, Math.min(95, Math.round(compositeScore)));
  
  if (signals.length > 0 && finalScore >= 65) {
    console.log(`  📊 ${asset.symbol}: Tech=${technicalScore}%, News=${newsScore.toFixed(0)}%, Composite=${finalScore}% | ${signals.join(', ')}`);
  }

  return finalScore;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { settings, portfolio, user_email, indicator_settings } = await req.json();

    if (!settings || !portfolio) {
      return Response.json({ success: false, error: 'Missing parameters' }, { status: 400 });
    }

    console.log(`\n🔄 SERVER-SIDE AUTO-TRADING V4 (${user_email})`);

    // 1. Schedule Check
    if (settings.trading_schedule?.enabled) {
      const now = new Date();
      const currentHour = now.getUTCHours();
      const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
      const currentDay = days[now.getUTCDay()];

      if (!settings.trading_schedule.days.includes(currentDay)) {
        console.log(`🛑 Trading paused: ${currentDay} not in schedule`);
        return Response.json({ success: true, reason: 'schedule_day_paused' });
      }

      if (currentHour < settings.trading_schedule.start_hour || currentHour >= settings.trading_schedule.end_hour) {
        console.log(`🛑 Trading paused: Outside hours (${currentHour} UTC)`);
        return Response.json({ success: true, reason: 'schedule_hour_paused' });
      }
    }

    // 2. Fetch Market Data (Top 250)
    let marketAssets = [];
    
    try {
      console.log(`🔍 Fetching top ${TOP_ASSETS_COUNT} crypto assets...`);
      const resp = await fetch(
        `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${TOP_ASSETS_COUNT}&page=1&sparkline=false`,
        { headers: { 'Accept': 'application/json' } }
      );
      
      if (resp.ok) {
        const rawData = await resp.json();
        marketAssets = rawData.map(coin => ({
          symbol: coin.symbol.toUpperCase(),
          name: coin.name,
          price: coin.current_price,
          change24h: coin.price_change_percentage_24h || 0,
          volume24h: coin.total_volume || 0,
          marketCap: coin.market_cap || 0,
          id: coin.id
        }));
        console.log(`✅ Successfully fetched ${marketAssets.length} assets`);
      } else {
        throw new Error(`CoinGecko API error: ${resp.status}`);
      }
    } catch (e) {
      console.warn('⚠️ Live data failed, using simulation fallback:', e.message);
      // Fallback: Generate basic top coins
      ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'DOGE', 'AVAX', 'DOT', 'MATIC'].forEach(sym => {
        marketAssets.push({
          symbol: sym,
          name: sym,
          price: 100 + Math.random() * 1000,
          change24h: (Math.random() * 10) - 4,
          volume24h: 500000000,
          marketCap: 10000000000,
          id: sym.toLowerCase()
        });
      });
    }

    // 3. Generate ADVANCED Confidence Scores (70% Technical + 30% News Sentiment)
    // Use user's indicator preferences or default to all enabled
    const enabledIndicators = indicator_settings || { rsi: true, macd: true, bollinger: true, ema: true, stoch: true };
    const assetConfidence = {};
    const activeIndicators = Object.entries(enabledIndicators).filter(([_, enabled]) => enabled).map(([name]) => name);
    console.log(`📊 Calculating ADVANCED AI signals with indicators: ${activeIndicators.join(', ')}...`);
    marketAssets.forEach(asset => {
      assetConfidence[asset.symbol] = calculateConfidence(asset, enabledIndicators);
    });
    
    const minConfidence = settings.min_confidence || 70;
    const highConfidenceCount = Object.values(assetConfidence).filter(c => c >= minConfidence).length;
    console.log(`✅ Generated signals for ${marketAssets.length} assets (${highConfidenceCount} with ${minConfidence}%+ confidence)`);
    
    // Log top 10 opportunities for debugging
    const topOpps = Object.entries(assetConfidence)
      .map(([symbol, conf]) => ({ symbol, conf, asset: marketAssets.find(a => a.symbol === symbol) }))
      .filter(o => o.conf >= minConfidence)
      .sort((a, b) => b.conf - a.conf)
      .slice(0, 10);
    
    if (topOpps.length > 0) {
      console.log(`🎯 Top ${topOpps.length} opportunities:`);
      topOpps.forEach(o => {
        console.log(`   ${o.symbol}: ${o.conf}% confidence, ${o.asset?.change24h?.toFixed(2)}% 24h change`);
      });
    } else {
      console.log(`⚠️ NO assets meet ${minConfidence}% confidence threshold`);
    }

    // 4. Execute Auto-Trading Check (using ported Engine)
    const result = await executeAutoTradingCheckAdvanced(
      marketAssets,
      assetConfidence,
      settings,
      portfolio,
      // Callback for Trade Execution
      async (opportunity) => {
        console.log(`💰 EXECUTING TRADE: ${opportunity.action.toUpperCase()} ${opportunity.asset.symbol}`);
        return await executeTrade(base44, user_email, portfolio, settings, opportunity);
      },
      // Callback for Position Updates (Trailing Stop / Breakeven)
      async (update) => {
        console.log(`📝 UPDATING POSITION: ${update.asset.symbol} - ${update.reason}`);
        return await updatePosition(base44, portfolio, update);
      }
    );

    return Response.json({ success: true, data: result });

  } catch (error) {
    console.error('❌ Worker Error:', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});

// Helper to Execute Trade & Update DB
async function executeTrade(base44, user_email, portfolio, settings, opportunity) {
  const { asset, action, quantity, reason, confidence, value, details } = opportunity;
  const price = asset.price;
  // Use value if provided (for buys), otherwise calc from quantity
  const totalValue = value || (quantity * price);
  const assetSymbol = `${asset.symbol}/USDT`;
  
  // 1. Create Trade Record
  const tradeData = {
    asset_symbol: assetSymbol,
    trade_type: action === 'partial_sell' ? 'sell' : action,
    quantity: quantity,
    price: price,
    total_value: totalValue,
    exchange: 'Paper Trading (Server)',
    status: 'completed',
    profit_loss: (action === 'sell' || action === 'partial_sell') ? (totalValue * (opportunity.profitPercent / 100)) : 0,
    ai_signal: {
      confidence: confidence || 0,
      reasoning: reason + (details ? ` (${JSON.stringify(details)})` : ''),
      indicators: ['Server-Side Engine V4']
    },
    created_by: user_email
  };
  
  await base44.asServiceRole.entities.Trade.create(tradeData);
  
  // 2. Update Portfolio
  let positions = [...(portfolio.positions || [])];
  
  if (action === 'buy') {
    const existingIndex = positions.findIndex(p => p.asset_symbol === assetSymbol);
    if (existingIndex >= 0) {
      // DCA / Add to position
      const existing = positions[existingIndex];
      const newQuantity = existing.quantity + quantity;
      const newCostBasis = (existing.quantity * existing.avg_entry_price) + totalValue;
      const newAvgPrice = newCostBasis / newQuantity;
      
      positions[existingIndex] = {
        ...existing,
        quantity: newQuantity,
        avg_entry_price: newAvgPrice,
        current_value: newQuantity * price,
        highest_price: Math.max(existing.highest_price || 0, price),
        dca_count: (existing.dca_count || 0) + 1
      };
    } else {
      // New Position
      positions.push({
        asset_symbol: assetSymbol,
        quantity,
        avg_entry_price: price,
        current_value: totalValue,
        profit_loss: 0,
        highest_price: price,
        dca_count: 0,
        breakeven_activated: false,
        trailing_stop_price: null,
        partial_profits_taken: []
      });
    }
  } else if (action === 'sell') {
    // Full sell
    positions = positions.filter(p => p.asset_symbol !== assetSymbol);
  } else if (action === 'partial_sell') {
    // Partial sell
    const existingIndex = positions.findIndex(p => p.asset_symbol === assetSymbol);
    if (existingIndex >= 0) {
      const existing = positions[existingIndex];
      const remainingQty = existing.quantity - quantity;
      
      // Record that we took this profit target
      const partialsTaken = [...(existing.partial_profits_taken || [])];
      if (details?.targetIndex !== undefined && !partialsTaken.includes(details.targetIndex)) {
        partialsTaken.push(details.targetIndex);
      }
      
      positions[existingIndex] = {
        ...existing,
        quantity: remainingQty,
        current_value: remainingQty * price,
        partial_profits_taken: partialsTaken
      };
    }
  }
  
  const newBalance = action === 'buy' 
    ? portfolio.available_balance - totalValue 
    : portfolio.available_balance + totalValue;
    
  await base44.asServiceRole.entities.Portfolio.update(portfolio.id, {
    available_balance: newBalance,
    total_balance: portfolio.total_balance + (tradeData.profit_loss || 0),
    positions,
    total_trades: (portfolio.total_trades || 0) + 1,
    total_profit_loss: (portfolio.total_profit_loss || 0) + (tradeData.profit_loss || 0)
  });
  
  // 3. Update Settings (Counters)
  const newAssetsTraded = [...(settings.assets_traded_today || [])];
  if (action === 'buy' && !newAssetsTraded.includes(asset.symbol)) {
    newAssetsTraded.push(asset.symbol);
  }
  
  await base44.asServiceRole.entities.AutoTradingSettings.update(settings.id, {
    trades_today: (settings.trades_today || 0) + 1,
    last_trade_date: new Date().toISOString(),
    assets_traded_today: newAssetsTraded,
    daily_loss: (settings.daily_loss || 0) + (tradeData.profit_loss < 0 ? Math.abs(tradeData.profit_loss) : 0)
  });
  
  // 4. Create Notification
  await base44.asServiceRole.entities.Notification.create({
    notification_type: 'order_filled',
    priority: 'medium',
    title: `Auto-Trade: ${action.toUpperCase()} ${asset.symbol}`,
    message: `Server executed ${action} for ${quantity.toFixed(4)} ${asset.symbol} @ $${price.toFixed(2)}. Reason: ${reason}`,
    created_by: user_email
  });
  
  return {
    executed: true,
    price,
    quantity,
    action
  };
}

// Helper to Update Position (Non-Trade)
async function updatePosition(base44, portfolio, update) {
  const { asset, action, details, position } = update;
  const assetSymbol = `${asset.symbol}/USDT`;
  
  let positions = [...(portfolio.positions || [])];
  const index = positions.findIndex(p => p.asset_symbol === assetSymbol);
  
  if (index >= 0) {
    if (action === 'update_trailing') {
      positions[index] = {
        ...positions[index],
        highest_price: details.highestPrice,
        trailing_stop_price: details.trailingStopPrice
      };
    } else if (action === 'update_breakeven') {
      positions[index] = {
        ...positions[index],
        breakeven_activated: true,
        breakeven_price: details.breakevenPrice
      };
    }
    
    await base44.asServiceRole.entities.Portfolio.update(portfolio.id, {
      positions
    });
  }
}