import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

/**
 * Auto-Trading Worker
 * Executes auto-trading logic for a single user
 * Called by tradingScheduler for each user
 */

// Import core trading logic (copy of the engine for server-side use)
function calculateRiskLevel(confidence) {
  if (confidence >= 80) return 'low';
  if (confidence >= 65) return 'medium';
  return 'high';
}

function isRiskLevelAllowed(riskLevel, settings) {
  return settings.allowed_risk_levels?.includes(riskLevel);
}

function hasReachedTradeLimit(settings) {
  return (settings.trades_today || 0) >= (settings.max_trades_per_day || 10);
}

function isCircuitBreakerTriggered(settings) {
  const dailyLoss = settings.daily_loss || 0;
  const maxLoss = settings.max_daily_loss_percent || 5;
  // Only trigger if max loss is set to something meaningful and we've exceeded it
  return maxLoss > 0 && dailyLoss >= maxLoss;
}

function hasAssetBeenTradedToday(assetSymbol, settings) {
  const assetsTraded = settings.assets_traded_today || [];
  return assetsTraded.includes(assetSymbol);
}

function calculatePositionSize(availableBalance, settings, assetPrice) {
  if (availableBalance <= 0 || !assetPrice || assetPrice === 0) {
    return { value: 0, quantity: 0, valid: false, reason: 'insufficient_balance' };
  }
  
  const maxPositionSize = (settings.max_position_size_percent || 10) / 100;
  const positionValue = Math.min(
    availableBalance * maxPositionSize,
    availableBalance * 0.2
  );
  
  const quantity = positionValue / assetPrice;
  const minTradeValue = 10;
  
  if (positionValue < minTradeValue) {
    return { value: positionValue, quantity, valid: false, reason: 'position_too_small' };
  }
  
  return { value: positionValue, quantity, valid: true };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    // Get request payload
    const { settings, portfolio, user_email } = await req.json();
    
    if (!settings || !portfolio || !user_email) {
      return Response.json({ 
        success: false, 
        error: 'Missing required parameters' 
      }, { status: 400 });
    }
    
    console.log(`🤖 Auto-Trading Worker: Processing user ${user_email}`);
    
    // Check if we need to reset daily counters (new day)
    const lastTradeDate = settings.last_trade_date ? new Date(settings.last_trade_date).toDateString() : null;
    const today = new Date().toDateString();
    
    if (lastTradeDate && lastTradeDate !== today) {
      console.log(`📅 New day detected - resetting daily counters`);
      settings.trades_today = 0;
      settings.daily_loss = 0;
      settings.assets_traded_today = [];
      
      // Persist the reset
      await base44.asServiceRole.entities.AutoTradingSettings.update(settings.id, {
        trades_today: 0,
        daily_loss: 0,
        assets_traded_today: []
      });
    }
    
    // Safety checks
    if (!settings.is_enabled) {
      return Response.json({ 
        success: true,
        executed: false,
        reason: 'auto_trading_disabled'
      });
    }
    
    if (isCircuitBreakerTriggered(settings)) {
      return Response.json({ 
        success: true,
        executed: false,
        reason: 'circuit_breaker_triggered'
      });
    }
    
    if (hasReachedTradeLimit(settings)) {
      return Response.json({ 
        success: true,
        executed: false,
        reason: 'trade_limit_reached'
      });
    }
    
    // Fetch market data and signals (using global signal data)
    // In production, this would fetch from a market data API
    // For now, we'll generate simulated opportunities based on stored signal data
    
    // Fetch real market data from CoinGecko
    const coinGeckoIds = 'bitcoin,ethereum,binancecoin,solana,ripple,cardano,avalanche-2,dogecoin,polkadot,matic-network,litecoin,chainlink,uniswap,cosmos,stellar,algorand,vechain,filecoin,near,aptos,arbitrum,optimism,injective-protocol,celestia,sui,sei-network';
    const symbolMap = {
      'bitcoin': 'BTC', 'ethereum': 'ETH', 'binancecoin': 'BNB', 'solana': 'SOL',
      'ripple': 'XRP', 'cardano': 'ADA', 'avalanche-2': 'AVAX', 'dogecoin': 'DOGE',
      'polkadot': 'DOT', 'matic-network': 'MATIC', 'litecoin': 'LTC', 'chainlink': 'LINK',
      'uniswap': 'UNI', 'cosmos': 'ATOM', 'stellar': 'XLM', 'algorand': 'ALGO',
      'vechain': 'VET', 'filecoin': 'FIL', 'near': 'NEAR', 'aptos': 'APT',
      'arbitrum': 'ARB', 'optimism': 'OP', 'injective-protocol': 'INJ', 'celestia': 'TIA',
      'sui': 'SUI', 'sei-network': 'SEI'
    };
    
    let marketData = {};
    try {
      const response = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${coinGeckoIds}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true`,
        { headers: { 'Accept': 'application/json' } }
      );
      if (response.ok) {
        marketData = await response.json();
        console.log('📊 Fetched market data for', Object.keys(marketData).length, 'assets');
      }
    } catch (e) {
      console.warn('⚠️ Failed to fetch market data:', e.message);
    }
    
    const opportunities = [];
    
    // Check existing positions for stop loss / take profit
    if (portfolio.positions && portfolio.positions.length > 0) {
      for (const position of portfolio.positions) {
        const assetSymbol = position.asset_symbol.replace('/USDT', '');
        const geckoId = Object.keys(symbolMap).find(k => symbolMap[k] === assetSymbol);
        const liveData = geckoId ? marketData[geckoId] : null;
        const currentPrice = liveData?.usd || position.avg_entry_price;
        
        const profitPercent = ((currentPrice - position.avg_entry_price) / position.avg_entry_price) * 100;
        
        if (profitPercent <= -(settings.stop_loss_percent || 3)) {
          opportunities.push({
            asset: { symbol: assetSymbol, price: currentPrice },
            action: 'sell',
            reason: 'stop_loss',
            quantity: position.quantity,
            confidence: 100,
            profitPercent
          });
          break;
        }
        
        if (profitPercent >= (settings.take_profit_percent || 8)) {
          opportunities.push({
            asset: { symbol: assetSymbol, price: currentPrice },
            action: 'sell',
            reason: 'take_profit',
            quantity: position.quantity,
            confidence: 100,
            profitPercent
          });
          break;
        }
      }
    }
    
    // Scan for NEW buy opportunities if no sell signals and balance available
    if (opportunities.length === 0 && portfolio.available_balance > 50 && Object.keys(marketData).length > 0) {
      const minConfidence = settings.min_confidence || 70;
      
      console.log(`🔍 Scanning ${Object.keys(marketData).length} assets for buy opportunities...`);
      
      const candidates = [];
      
      console.log(`📋 Checking criteria: minConfidence=${minConfidence}, allowedRisk=${JSON.stringify(settings.allowed_risk_levels)}`);
      
      for (const [geckoId, data] of Object.entries(marketData)) {
        const symbol = symbolMap[geckoId];
        if (!symbol || !data.usd) continue;
        
        // Skip if already traded today
        if (hasAssetBeenTradedToday(symbol, settings)) {
          console.log(`   ⏭️ ${symbol}: Already traded today`);
          continue;
        }
        
        // Skip if already have position
        if (portfolio.positions?.find(p => p.asset_symbol === `${symbol}/USDT`)) {
          console.log(`   ⏭️ ${symbol}: Already have position`);
          continue;
        }
        
        const change24h = data.usd_24h_change || 0;
        const price = data.usd;
        const volume = data.usd_24h_vol || 0;
        
        // Calculate confidence score based on momentum and volume
        let confidence = 55; // Start higher base
        
        // Momentum scoring (more aggressive to find trades)
        if (change24h > 8) confidence += 30;
        else if (change24h > 5) confidence += 25;
        else if (change24h > 3) confidence += 20;
        else if (change24h > 1) confidence += 15;
        else if (change24h > 0) confidence += 10;
        else if (change24h > -1) confidence += 5;
        else if (change24h > -3) confidence += 0;
        else if (change24h > -5) confidence -= 5;
        else confidence -= 10;
        
        // Volume bonus (high volume = more reliable signal)
        if (volume > 2000000000) confidence += 15;
        else if (volume > 1000000000) confidence += 10;
        else if (volume > 500000000) confidence += 5;
        
        // Small variance for randomness
        confidence += Math.floor(Math.random() * 6) - 3;
        confidence = Math.max(30, Math.min(95, confidence));
        
        const riskLevel = calculateRiskLevel(confidence);
        
        console.log(`   📊 ${symbol}: price=$${price.toFixed(2)}, 24h=${change24h.toFixed(2)}%, conf=${confidence}%, risk=${riskLevel}`);
        
        // Check if meets criteria - needs confidence threshold AND positive change
        const meetsConfidence = confidence >= minConfidence;
        const hasPositiveMomentum = change24h > 0;
        const riskAllowed = isRiskLevelAllowed(riskLevel, settings);
        
        console.log(`   🔍 ${symbol}: conf=${confidence}>=${minConfidence}? ${meetsConfidence}, momentum=${change24h.toFixed(2)}>0? ${hasPositiveMomentum}, risk=${riskLevel} allowed? ${riskAllowed}`);
        
        if (meetsConfidence && hasPositiveMomentum && riskAllowed) {
          const positionSize = calculatePositionSize(portfolio.available_balance, settings, price);
          
          if (positionSize.valid) {
            candidates.push({
              asset: { symbol, price },
              action: 'buy',
              reason: 'positive_momentum',
              quantity: positionSize.quantity,
              confidence,
              riskLevel,
              change24h
            });
            console.log(`   ✅ ${symbol}: CANDIDATE - conf=${confidence}%, change=${change24h.toFixed(2)}%`);
          }
        }
      }
      
      console.log(`📈 Found ${candidates.length} buy candidates`);
      
      // Sort by confidence and take best
      if (candidates.length > 0) {
        candidates.sort((a, b) => b.confidence - a.confidence);
        opportunities.push(candidates[0]);
        console.log(`🎯 Best opportunity: ${candidates[0].asset.symbol} (${candidates[0].confidence}% confidence)`);
      }
    }
    
    if (opportunities.length === 0) {
      console.log(`📊 No opportunities found for ${user_email}`);
      console.log(`   Settings: min_confidence=${settings.min_confidence}%, allowed_risk=${JSON.stringify(settings.allowed_risk_levels)}`);
      console.log(`   Portfolio: balance=$${portfolio.available_balance}, positions=${portfolio.positions?.length || 0}`);
      console.log(`   Market data fetched: ${Object.keys(marketData).length} assets`);
      return Response.json({ 
        success: true,
        executed: false,
        reason: 'no_opportunities',
        debug: {
          min_confidence: settings.min_confidence,
          allowed_risk_levels: settings.allowed_risk_levels,
          available_balance: portfolio.available_balance,
          market_data_count: Object.keys(marketData).length
        }
      });
    }
    
    // Execute the best opportunity
    const opportunity = opportunities[0];
    
    if (opportunity.action === 'buy' && hasAssetBeenTradedToday(opportunity.asset.symbol, settings)) {
      return Response.json({ 
        success: true,
        executed: false,
        reason: 'asset_already_traded_today'
      });
    }
    
    // Execute trade
    const tradeData = {
      asset_symbol: `${opportunity.asset.symbol}/USDT`,
      trade_type: opportunity.action,
      quantity: opportunity.quantity,
      price: opportunity.asset.price,
      total_value: opportunity.quantity * opportunity.asset.price,
      exchange: "Paper Trading (Server)",
      status: "completed",
      profit_loss: opportunity.profitPercent ? 
        (opportunity.asset.price - (opportunity.quantity * opportunity.asset.price / opportunity.quantity)) * opportunity.quantity : 0,
      created_by: user_email
    };
    
    await base44.asServiceRole.entities.Trade.create(tradeData);
    
    // Update portfolio
    let updatedPositions = [...(portfolio.positions || [])];
    const assetSymbol = `${opportunity.asset.symbol}/USDT`;
    
    if (opportunity.action === 'sell') {
      updatedPositions = updatedPositions.filter(p => p.asset_symbol !== assetSymbol);
    } else if (opportunity.action === 'buy') {
      const positionSize = calculatePositionSize(
        portfolio.available_balance,
        settings,
        opportunity.asset.price
      );
      
      if (positionSize.valid) {
        updatedPositions.push({
          asset_symbol: assetSymbol,
          quantity: positionSize.quantity,
          avg_entry_price: opportunity.asset.price,
          current_value: positionSize.value,
          profit_loss: 0,
          highest_price: opportunity.asset.price
        });
      }
    }
    
    const newBalance = opportunity.action === 'buy'
      ? portfolio.available_balance - tradeData.total_value
      : portfolio.available_balance + tradeData.total_value;
    
    await base44.asServiceRole.entities.Portfolio.update(portfolio.id, {
      available_balance: newBalance,
      total_balance: portfolio.total_balance + (tradeData.profit_loss || 0),
      positions: updatedPositions,
      total_trades: (portfolio.total_trades || 0) + 1,
      total_profit_loss: (portfolio.total_profit_loss || 0) + (tradeData.profit_loss || 0)
    });
    
    // Update settings
    const newTradesCount = (settings.trades_today || 0) + 1;
    const assetsTraded = [...(settings.assets_traded_today || [])];
    if (opportunity.action === 'buy' && !assetsTraded.includes(opportunity.asset.symbol)) {
      assetsTraded.push(opportunity.asset.symbol);
    }
    
    await base44.asServiceRole.entities.AutoTradingSettings.update(settings.id, {
      trades_today: newTradesCount,
      last_trade_date: new Date().toISOString(),
      assets_traded_today: assetsTraded
    });
    
    console.log(`✅ Trade executed: ${opportunity.action.toUpperCase()} ${opportunity.asset.symbol}`);
    
    return Response.json({
      success: true,
      executed: true,
      opportunity: {
        asset: { symbol: opportunity.asset.symbol },
        action: opportunity.action,
        reason: opportunity.reason
      }
    });
    
  } catch (error) {
    console.error('❌ Auto-Trading Worker Error:', error);
    return Response.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
});