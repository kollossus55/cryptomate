import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

/**
 * Auto-Trading Worker V3 (Rebuilt)
 * 
 * aligned with Browser Mode logic for consistency.
 * Uses a momentum-based scoring system + AI Sentiment analysis.
 */

const COINGECKO_IDS = {
  'BTC': 'bitcoin', 'ETH': 'ethereum', 'BNB': 'binancecoin', 'SOL': 'solana',
  'XRP': 'ripple', 'ADA': 'cardano', 'AVAX': 'avalanche-2', 'DOGE': 'dogecoin',
  'DOT': 'polkadot', 'MATIC': 'matic-network', 'LTC': 'litecoin', 'LINK': 'chainlink',
  'UNI': 'uniswap', 'ATOM': 'cosmos', 'XLM': 'stellar', 'ALGO': 'algorand',
  'NEAR': 'near', 'APT': 'aptos', 'ARB': 'arbitrum', 'OP': 'optimism',
  'INJ': 'injective-protocol', 'SUI': 'sui', 'SEI': 'sei-network',
  'PEPE': 'pepe', 'WIF': 'dogwifcoin', 'RUNE': 'thorchain', 'FTM': 'fantom'
};

// Calculate score similar to Browser Mode's calculateBasicConfidence
function calculateMomentumScore(asset) {
  let score = 50; // Base score

  // 1. Price Momentum (24h change)
  const change = asset.usd_24h_change || 0;
  if (change > 10) score += 25;       // Strong pump
  else if (change > 5) score += 15;   // Strong uptrend
  else if (change > 2) score += 10;   // Uptrend
  else if (change > 0) score += 5;    // Slight uptrend
  else if (change < -10) score -= 25; // Strong dump
  else if (change < -5) score -= 15;  // Strong downtrend
  else if (change < -2) score -= 10;  // Downtrend
  else score -= 5;                    // Slight downtrend

  // 2. Volume Factor (Simulated vs Average)
  // We don't always have hist volume here, so we use 24h volume magnitude
  const volume = asset.usd_24h_vol || 0;
  if (volume > 1000000000) score += 10;      // High volume (>1B)
  else if (volume > 100000000) score += 5;   // Good volume (>100M)
  else if (volume < 1000000) score -= 10;    // Low volume (<1M)

  // 3. Market Cap Stability
  const mcap = asset.usd_market_cap || 0;
  if (mcap > 50000000000) score += 5; // Mega cap bonus

  // 4. Volatility Penalty/Bonus
  const volatility = Math.abs(change);
  if (volatility > 15) score -= 10; // Too volatile/risky
  else if (volatility > 5 && change > 0) score += 5; // Good volatility for trading

  // 5. Random Market Noise (Simulation of minor fluctuations)
  // This ensures we don't get stuck with identical scores every run
  score += (Math.random() * 10) - 5;

  return Math.min(95, Math.max(20, Math.round(score)));
}

// AI Sentiment Analysis using LLM
async function analyzeAISentiment(base44, symbol, priceData) {
  try {
    // Fast fail if no API key (usually handled by SDK but good to be safe)
    // We skip check here as we assume env is set up or it throws

    const prompt = `Analyze crypto sentiment for ${symbol}. 
    Data: Price $${priceData.usd}, 24h Change ${priceData.usd_24h_change}%.
    Return JSON: { "sentiment": "bullish"|"bearish"|"neutral", "confidence": 0-100, "action": "buy"|"sell"|"hold" }`;

    const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt,
      response_json_schema: {
        type: "object",
        properties: {
          sentiment: { type: "string", enum: ["bullish", "bearish", "neutral"] },
          confidence: { type: "number" },
          action: { type: "string", enum: ["buy", "sell", "hold"] }
        }
      }
    });
    return result;
  } catch (e) {
    console.warn(`AI Sentiment failed for ${symbol}:`, e.message);
    return { sentiment: 'neutral', confidence: 50, action: 'hold' }; // Fallback
  }
}

// Calculate Position Size
function calculatePositionSize(balance, settings, price) {
  if (balance <= 0 || !price) return { valid: false };
  
  // Default to 10% if not set
  const maxPercent = settings.max_position_size_percent || 10;
  const amount = balance * (maxPercent / 100);
  
  // Cap at $5000 or balance, whichever is lower (safety)
  const safeAmount = Math.min(amount, 5000, balance);
  
  if (safeAmount < 10) return { valid: false, reason: 'too_small' }; // Min $10 trade
  
  return {
    valid: true,
    value: safeAmount,
    quantity: safeAmount / price
  };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { settings, portfolio, user_email } = await req.json();

    if (!settings || !portfolio) {
      return Response.json({ success: false, error: 'Missing parameters' }, { status: 400 });
    }

    console.log(`\n🔄 SERVER-SIDE AUTO-TRADING (${user_email})`);
    
    // 1. Circuit Breaker & Limits
    if (!settings.is_enabled) return Response.json({ success: true, reason: 'disabled' });
    
    if ((settings.daily_loss || 0) >= (settings.max_daily_loss_percent || 5)) {
      console.log('🛑 Circuit breaker active');
      return Response.json({ success: true, reason: 'circuit_breaker' });
    }
    
    if ((settings.trades_today || 0) >= (settings.max_trades_per_day || 10)) {
      console.log('🛑 Daily trade limit reached');
      return Response.json({ success: true, reason: 'trade_limit' });
    }

    // 2. Market Data Fetching
    const ids = Object.values(COINGECKO_IDS).join(',');
    let marketData = {};
    
    try {
      const resp = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true&include_market_cap=true`,
        { headers: { 'Accept': 'application/json' } }
      );
      if (resp.ok) marketData = await resp.json();
      else throw new Error('CoinGecko API non-200');
    } catch (e) {
      console.warn('⚠️ Live data failed, using simulation fallback');
      // Generate realistic simulation data if API fails
      Object.values(COINGECKO_IDS).forEach(id => {
        marketData[id] = {
          usd: 100 + Math.random() * 1000,
          usd_24h_change: (Math.random() * 10) - 4, // Bias slightly positive
          usd_24h_vol: 500000000,
          usd_market_cap: 10000000000
        };
      });
    }

    // 3. SELL Logic (Manage existing positions)
    if (portfolio.positions && portfolio.positions.length > 0) {
      for (const position of portfolio.positions) {
        const symbol = position.asset_symbol.replace('/USDT', '');
        const coinId = COINGECKO_IDS[symbol];
        const data = marketData[coinId];
        
        if (!data) continue;
        
        const currentPrice = data.usd;
        const pnlPercent = ((currentPrice - position.avg_entry_price) / position.avg_entry_price) * 100;
        
        let sellReason = null;
        
        // Stop Loss
        if (pnlPercent <= -(settings.stop_loss_percent || 3)) sellReason = 'stop_loss';
        // Take Profit
        else if (pnlPercent >= (settings.take_profit_percent || 8)) sellReason = 'take_profit';
        
        if (sellReason) {
          console.log(`📉 SELLING ${symbol}: ${sellReason} (${pnlPercent.toFixed(2)}%)`);
          // Execute Sell
          await executeTrade(base44, user_email, portfolio, settings, {
            symbol, action: 'sell', quantity: position.quantity, price: currentPrice, reason: sellReason, pnl: pnlPercent
          });
          return Response.json({ success: true, executed: true, type: 'sell', symbol });
        }
      }
    }

    // 4. BUY Logic (Scan for opportunities)
    // Filter assets already traded today to prevent over-trading same pair
    const tradedToday = settings.assets_traded_today || [];
    
    // Score all assets
    const opportunities = [];
    
    for (const [symbol, coinId] of Object.entries(COINGECKO_IDS)) {
      const data = marketData[coinId];
      if (!data) continue;
      
      // Skip if already traded today or currently holding
      if (tradedToday.includes(symbol)) continue;
      if (portfolio.positions?.some(p => p.asset_symbol.includes(symbol))) continue;

      // Calculate Momentum Score
      const score = calculateMomentumScore(data);
      const minScore = settings.min_confidence || 70;

      if (score >= minScore) {
        opportunities.push({ symbol, data, score });
      }
    }

    // Sort by score and pick top 1
    opportunities.sort((a, b) => b.score - a.score);
    const bestOpp = opportunities[0];

    if (bestOpp) {
      console.log(`🎯 Best Opportunity: ${bestOpp.symbol} (Score: ${bestOpp.score})`);
      
      // 5. AI Confirmation (Optional but recommended)
      // We only use AI if score is borderline (e.g. 70-80). If >85, we just buy.
      let confirmed = true;
      let aiReason = "Strong Technicals";
      
      if (bestOpp.score < 85) {
        const aiRes = await analyzeAISentiment(base44, bestOpp.symbol, bestOpp.data);
        console.log(`🤖 AI Analysis for ${bestOpp.symbol}: ${aiRes.sentiment} (${aiRes.confidence}%)`);
        
        if (aiRes.sentiment === 'bearish' || aiRes.action === 'sell') {
          confirmed = false;
          console.log('⛔ AI Vetoed trade');
        } else {
          aiReason = `AI: ${aiRes.sentiment} (${aiRes.confidence}%)`;
        }
      }

      if (confirmed) {
        const posSize = calculatePositionSize(portfolio.available_balance, settings, bestOpp.data.usd);
        
        if (posSize.valid) {
          console.log(`🚀 BUYING ${bestOpp.symbol}`);
          await executeTrade(base44, user_email, portfolio, settings, {
            symbol: bestOpp.symbol,
            action: 'buy',
            quantity: posSize.quantity,
            price: bestOpp.data.usd,
            reason: `Score ${bestOpp.score} | ${aiReason}`,
            confidence: bestOpp.score
          });
          return Response.json({ success: true, executed: true, type: 'buy', symbol: bestOpp.symbol });
        } else {
          console.log(`⚠️ Insufficient funds for ${bestOpp.symbol}`);
        }
      }
    }

    return Response.json({ success: true, executed: false, reason: 'no_opportunities' });

  } catch (error) {
    console.error('❌ Worker Error:', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});

// Helper to Execute Trade & Update DB
async function executeTrade(base44, user_email, portfolio, settings, tradeDetails) {
  const { symbol, action, quantity, price, reason, pnl, confidence } = tradeDetails;
  const totalValue = quantity * price;
  const assetSymbol = `${symbol}/USDT`;
  
  // 1. Create Trade Record
  const tradeData = {
    asset_symbol: assetSymbol,
    trade_type: action,
    quantity: quantity,
    price: price,
    total_value: totalValue,
    exchange: 'Paper Trading (Server)',
    status: 'completed',
    profit_loss: action === 'sell' ? (totalValue * (pnl / 100)) : 0,
    ai_signal: {
      confidence: confidence || 0,
      reasoning: reason,
      indicators: ['Server-Side Auto-Trade']
    },
    created_by: user_email
  };
  await base44.asServiceRole.entities.Trade.create(tradeData);
  
  // 2. Update Portfolio
  let positions = [...(portfolio.positions || [])];
  if (action === 'buy') {
    positions.push({
      asset_symbol: assetSymbol,
      quantity,
      avg_entry_price: price,
      current_value: totalValue,
      profit_loss: 0,
      highest_price: price
    });
  } else {
    positions = positions.filter(p => p.asset_symbol !== assetSymbol);
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
  if (action === 'buy' && !newAssetsTraded.includes(symbol)) {
    newAssetsTraded.push(symbol);
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
    title: `Auto-Trade: ${action.toUpperCase()} ${symbol}`,
    message: `Server executed ${action} for ${quantity.toFixed(4)} ${symbol} @ $${price.toFixed(2)}. Reason: ${reason}`,
    created_by: user_email
  });
}