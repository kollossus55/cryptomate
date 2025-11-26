import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

/**
 * Auto-Trading Worker
 * Executes auto-trading logic for a single user
 * Called by tradingScheduler for each user
 */

// Import core trading logic (copy of the engine for server-side use)
function calculateRiskLevel(confidence) {
  // More lenient risk levels to allow more trades
  if (confidence >= 70) return 'low';
  if (confidence >= 55) return 'medium';
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
      // FUNDAMENTALS-FIRST APPROACH: Lower threshold, prioritize momentum + volume
      const minConfidence = Math.min(settings.min_confidence || 70, 55); // Cap at 55% max

      console.log(`🔍 FUNDAMENTALS-FIRST SCAN: ${Object.keys(marketData).length} assets`);
      console.log(`📋 Using lowered threshold: minConfidence=${minConfidence}%`);

      const candidates = [];

      for (const [geckoId, data] of Object.entries(marketData)) {
        const symbol = symbolMap[geckoId];
        if (!symbol || !data.usd) continue;

        // Skip if already traded today
        if (hasAssetBeenTradedToday(symbol, settings)) {
          continue;
        }

        // Skip if already have position
        if (portfolio.positions?.find(p => p.asset_symbol === `${symbol}/USDT`)) {
          continue;
        }

        const change24h = data.usd_24h_change || 0;
        const price = data.usd;
        const volume = data.usd_24h_vol || 0;

        // FUNDAMENTALS-BASED SCORING - More aggressive to find trades
        let score = 55; // Higher base score

        // PRIMARY: Momentum (strongest weight)
        if (change24h > 10) score += 35;
        else if (change24h > 7) score += 30;
        else if (change24h > 5) score += 25;
        else if (change24h > 3) score += 22;
        else if (change24h > 2) score += 18;
        else if (change24h > 1) score += 14;
        else if (change24h > 0) score += 10;
        else if (change24h > -1) score += 5; // Small dip OK
        else if (change24h > -2) score += 0;
        else if (change24h > -5) score -= 5;
        else score -= 10; // Big drops penalized less

        // SECONDARY: Volume (liquidity matters)
        if (volume > 5000000000) score += 18;      // $5B+ volume
        else if (volume > 2000000000) score += 15; // $2B+ volume
        else if (volume > 1000000000) score += 12; // $1B+ volume
        else if (volume > 500000000) score += 10;  // $500M+ volume
        else if (volume > 100000000) score += 7;   // $100M+ volume
        else score += 3; // Low volume still OK

        // Small variance
        score += Math.floor(Math.random() * 6) - 3;
        score = Math.max(40, Math.min(95, score));
        
        console.log(`   📊 ${symbol}: 24h=${change24h.toFixed(2)}%, vol=$${(volume/1e9).toFixed(2)}B, score=${score}%`);

        const riskLevel = calculateRiskLevel(score);
        const riskAllowed = isRiskLevelAllowed(riskLevel, settings);

        // RELAXED CRITERIA: Just needs score threshold + risk allowed
        // No strict momentum requirement - dips can be opportunities
        if (score >= minConfidence && riskAllowed) {
          const positionSize = calculatePositionSize(portfolio.available_balance, settings, price);

          if (positionSize.valid) {
            candidates.push({
              asset: { symbol, price },
              action: 'buy',
              reason: change24h > 2 ? 'strong_momentum' : change24h > 0 ? 'positive_momentum' : 'dip_opportunity',
              quantity: positionSize.quantity,
              confidence: score,
              riskLevel,
              change24h,
              volume
            });
            console.log(`   ✅ ${symbol}: score=${score}%, 24h=${change24h.toFixed(2)}%, vol=$${(volume/1e9).toFixed(2)}B`);
          }
        }
      }

      console.log(`📈 Found ${candidates.length} candidates`);

      if (candidates.length > 0) {
        // Sort by: momentum first, then volume, then score
        candidates.sort((a, b) => {
          // Prefer positive momentum
          if (a.change24h > 0 && b.change24h <= 0) return -1;
          if (b.change24h > 0 && a.change24h <= 0) return 1;
          // Then by change magnitude
          if (Math.abs(a.change24h - b.change24h) > 2) {
            return b.change24h - a.change24h;
          }
          // Then by volume
          return b.volume - a.volume;
        });

        opportunities.push(candidates[0]);
        console.log(`🎯 SELECTED: ${candidates[0].asset.symbol} - ${candidates[0].reason} (${candidates[0].confidence}%, ${candidates[0].change24h.toFixed(2)}%)`);
      } else {
        console.log(`❌ No candidates met criteria`);
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