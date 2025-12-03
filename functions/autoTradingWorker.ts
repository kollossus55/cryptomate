import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

/**
 * Auto-Trading Worker V3 (Rebuilt)
 * 
 * aligned with Browser Mode logic for consistency.
 * Uses a momentum-based scoring system + AI Sentiment analysis.
 */

// Dynamic list - fetching top 250 by market cap
const TOP_ASSETS_COUNT = 250;

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

  // 6. Altcoin Bonus (Lower Market Cap = Higher Potential Volatility/Reward)
  // Give a small boost to mid-cap altcoins to ensure they surface
  if (mcap < 1000000000 && mcap > 50000000) score += 5; 

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

    // Schedule Check
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
    
    if ((settings.daily_loss || 0) >= (settings.max_daily_loss_percent || 5)) {
      console.log('🛑 Circuit breaker active');
      return Response.json({ success: true, reason: 'circuit_breaker' });
    }
    
    if ((settings.trades_today || 0) >= (settings.max_trades_per_day || 10)) {
      console.log('🛑 Daily trade limit reached');
      return Response.json({ success: true, reason: 'trade_limit' });
    }

    // 2. Market Data Fetching (Top 250)
    let marketData = [];
    let idToSymbolMap = {};
    
    try {
      // Combined scan: Top 250 by Market Cap + Top Gainers check logic via sorting later
      console.log(`🔍 Fetching top ${TOP_ASSETS_COUNT} crypto assets for opportunities...`);
      const resp = await fetch(
        `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${TOP_ASSETS_COUNT}&page=1&sparkline=false`,
        { headers: { 'Accept': 'application/json' } }
      );
      
      if (resp.ok) {
        marketData = await resp.json();
        console.log(`✅ Successfully fetched ${marketData.length} assets`);
      } else {
        throw new Error(`CoinGecko API error: ${resp.status}`);
      }
    } catch (e) {
      console.warn('⚠️ Live data failed, using simulation fallback:', e.message);
      // Fallback: Generate basic top coins if API fails
      ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'DOGE', 'AVAX'].forEach(sym => {
        marketData.push({
          id: sym.toLowerCase(),
          symbol: sym.toLowerCase(),
          current_price: 100 + Math.random() * 1000,
          price_change_percentage_24h: (Math.random() * 10) - 4,
          total_volume: 500000000,
          market_cap: 10000000000
        });
      });
    }

    // Create lookup map for position management
    const priceMap = {};
    marketData.forEach(coin => {
      const symbol = coin.symbol.toUpperCase();
      // Normalize data structure to match previous format for consistency
      priceMap[symbol] = {
        usd: coin.current_price,
        usd_24h_change: coin.price_change_percentage_24h,
        usd_24h_vol: coin.total_volume,
        usd_market_cap: coin.market_cap,
        id: coin.id
      };
    });

    // 3. SELL Logic (Manage existing positions)
    if (portfolio.positions && portfolio.positions.length > 0) {
      for (const position of portfolio.positions) {
        const symbol = position.asset_symbol.replace('/USDT', '');
        const data = priceMap[symbol];
        
        if (!data) {
          // If asset not in top 250, we might miss it. 
          // ideally we should fetch specific IDs for positions, but for now we skip if not in top 250.
          continue; 
        }
        
        const currentPrice = data.usd;
        const pnlPercent = ((currentPrice - position.avg_entry_price) / position.avg_entry_price) * 100;
        
        let sellReason = null;
        
        // 3.1 Trailing Stop Logic
        let trailingStopTriggered = false;
        let highestPrice = position.highest_price || position.avg_entry_price;
        
        // Update highest price if current is higher
        if (currentPrice > highestPrice) {
          highestPrice = currentPrice;
          // We'll update this in the DB via executeTrade (if selling) or position update logic (not implemented here yet for just update)
          // For now, we assume position update happens on sell or buy.
          // Ideally we should update position highest_price in DB periodically, but for serverless workers, we can just calculate it relative to 'highest_price' stored.
          // Limitation: If we don't write back highest_price, trailing stop resets every run.
          // FIX: We need to update the position record if new high is reached.
        }

        if (settings.use_trailing_stop && pnlPercent >= (settings.trailing_stop_activation || 3)) {
          const trailingStopPrice = highestPrice * (1 - (settings.trailing_stop_percent || 2) / 100);
          if (currentPrice < trailingStopPrice) {
            sellReason = 'trailing_stop';
            trailingStopTriggered = true;
          }
        }

        // Dynamic Take Profit based on market volatility (approximated by 24h change magnitude)
        let targetProfit = settings.take_profit_percent || 8;
        if (Math.abs(data.usd_24h_change) > 10) {
          // High volatility - aim higher
          targetProfit = targetProfit * 1.5; 
        }

        // Stop Loss
        if (pnlPercent <= -(settings.stop_loss_percent || 3)) sellReason = 'stop_loss';
        // Take Profit
        else if (pnlPercent >= targetProfit) sellReason = 'take_profit';
        
        if (sellReason) {
          console.log(`📉 SELLING ${symbol}: ${sellReason} (${pnlPercent.toFixed(2)}%)`);
          // Execute Sell
          await executeTrade(base44, user_email, portfolio, settings, {
            symbol, action: 'sell', quantity: position.quantity, price: currentPrice, reason: sellReason, pnl: pnlPercent
          });
          return Response.json({ success: true, executed: true, type: 'sell', symbol });
        }

        // 3.2 DCA Logic (Buy the dip on existing positions)
        if (settings.dca_enabled && !sellReason) {
          const dipThreshold = settings.dca_dip_threshold || 5;
          if (pnlPercent <= -dipThreshold) {
            const dcaCount = position.dca_count || 0;
            const maxDCA = settings.max_dca_buys || 3;
            
            if (dcaCount < maxDCA) {
              console.log(`📉 DCA Opportunity for ${symbol}: Down ${pnlPercent.toFixed(2)}%`);
              
              // Calculate DCA amount
              const multiplier = settings.dca_multiplier || 1.5;
              const lastBuyValue = position.current_value / (dcaCount + 1); // Approx
              const dcaValue = Math.min(portfolio.available_balance, 5000, (position.current_value * 0.5) * multiplier); // Safety cap
              
              if (dcaValue > 10) {
                const dcaQuantity = dcaValue / currentPrice;
                console.log(`🚀 DCA BUYING ${symbol}: ${dcaQuantity.toFixed(4)} @ $${currentPrice}`);
                
                await executeTrade(base44, user_email, portfolio, settings, {
                  symbol, 
                  action: 'buy', 
                  quantity: dcaQuantity, 
                  price: currentPrice, 
                  reason: `DCA Dip Buy #${dcaCount + 1} (Down ${pnlPercent.toFixed(2)}%)`,
                  confidence: 80, // High confidence for DCA usually
                  isDCA: true
                });
                return Response.json({ success: true, executed: true, type: 'dca_buy', symbol });
              }
            }
          }
        }

        // Update highest price in DB if changed (and no trade happened)
        if (highestPrice > (position.highest_price || 0)) {
           // Silent update of position high water mark
           const newPositions = portfolio.positions.map(p => 
             p.asset_symbol === position.asset_symbol ? { ...p, highest_price: highestPrice } : p
           );
           await base44.asServiceRole.entities.Portfolio.update(portfolio.id, { positions: newPositions });
        }
      }
    }

    // 4. BUY Logic (Scan ALL top 250 assets for opportunities)
    const tradedToday = settings.assets_traded_today || [];
    const opportunities = [];
    
    console.log('🧠 Scoring assets...');
    
    for (const coin of marketData) {
      const symbol = coin.symbol.toUpperCase();
      
      // Filter out stablecoins (approximate list)
      if (['USDT', 'USDC', 'DAI', 'FDUSD', 'TUSD'].includes(symbol)) continue;
      
      // Skip if already traded today or currently holding
      if (tradedToday.includes(symbol)) continue;
      if (portfolio.positions?.some(p => p.asset_symbol.includes(symbol))) continue;

      // Normalize data for scoring
      const data = {
        usd: coin.current_price,
        usd_24h_change: coin.price_change_percentage_24h,
        usd_24h_vol: coin.total_volume,
        usd_market_cap: coin.market_cap
      };

      // Calculate Momentum Score
      const score = calculateMomentumScore(data);
      const minScore = settings.min_confidence || 70;

      if (score >= minScore) {
        opportunities.push({ symbol, data, score, name: coin.name });
      }
    }

    // Sort by score and pick top 1
    opportunities.sort((a, b) => b.score - a.score);
    
    // Log top candidates for debugging
    console.log('📋 Top 3 Candidates:');
    opportunities.slice(0, 3).forEach((opp, i) => 
      console.log(`   #${i+1} ${opp.symbol}: Score ${opp.score}`)
    );

    const bestOpp = opportunities[0];

    if (bestOpp) {
      console.log(`🎯 Best Opportunity Selected: ${bestOpp.symbol} (Score: ${bestOpp.score})`);
      
      let confirmed = true;
      let tradeReason = "Strong Technicals";

      // 5. Deep Technical Analysis (RSI, MACD, Stochastic, OBV)
      // We perform this ONLY on the best candidate to ensure strongest signal without rate limiting
      try {
        console.log(`🔬 Running Deep Technical Analysis for ${bestOpp.symbol}...`);
        
        // Call technicalAnalysis function internally or via invoke
        const techRes = await base44.functions.invoke('technicalAnalysis', {
          coinId: bestOpp.data.id || bestOpp.symbol.toLowerCase(), // ID is needed for history
          symbol: bestOpp.symbol
        });
        
        if (techRes.data && techRes.data.success && techRes.data.signal) {
          const techSignal = techRes.data.signal;
          console.log(`📊 Technical Signal: ${techSignal.signal.toUpperCase()} (Conf: ${techSignal.confidence}%)`);
          console.log(`   Reasons: ${techSignal.reasons.join(', ')}`);
          
          if (techSignal.signal === 'sell' || techSignal.signal === 'strong_sell' || techSignal.confidence < 40) {
            confirmed = false;
            console.log(`⛔ Technical Analysis Vetoed: ${techSignal.signal}`);
          } else {
            // Append technical reasons
            tradeReason += ` + Tech: ${techSignal.signal} (${techSignal.confidence}%)`;
          }
        }
      } catch (err) {
        console.warn('Technical analysis check skipped/failed:', err.message);
      }

      // 6. AI Sentiment Confirmation (if still confirmed)
      if (confirmed && bestOpp.score < 85) {
        const aiRes = await analyzeAISentiment(base44, bestOpp.symbol, bestOpp.data);
        console.log(`🤖 AI Analysis for ${bestOpp.symbol}: ${aiRes.sentiment} (${aiRes.confidence}%)`);
        
        if (aiRes.sentiment === 'bearish' || aiRes.action === 'sell') {
          confirmed = false;
          console.log('⛔ AI Vetoed trade');
        } else {
          tradeReason += ` + AI: ${aiRes.sentiment}`;
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
            reason: `Score ${bestOpp.score} | ${tradeReason}`,
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
  const { symbol, action, quantity, price, reason, pnl, confidence, isDCA } = tradeDetails;
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
    const existingIndex = positions.findIndex(p => p.asset_symbol === assetSymbol);
    if (existingIndex >= 0) {
      // DCA / Adding to position
      const existing = positions[existingIndex];
      const newQuantity = existing.quantity + quantity;
      const newCostBasis = (existing.quantity * existing.avg_entry_price) + totalValue;
      const newAvgPrice = newCostBasis / newQuantity;
      
      positions[existingIndex] = {
        ...existing,
        quantity: newQuantity,
        avg_entry_price: newAvgPrice,
        current_value: newQuantity * price, // Updated valuation
        dca_count: (existing.dca_count || 0) + (isDCA ? 1 : 0),
        highest_price: Math.max(existing.highest_price || 0, price)
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
        dca_count: 0
      });
    }
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