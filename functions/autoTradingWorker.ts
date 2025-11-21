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
  return (settings.daily_loss || 0) >= (settings.max_daily_loss_percent || 0);
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
    
    // Get top assets with high confidence from scanner
    const opportunities = [];
    
    // Check if we have any positions to manage (stop loss, take profit)
    if (portfolio.positions && portfolio.positions.length > 0) {
      for (const position of portfolio.positions) {
        const assetSymbol = position.asset_symbol.replace('/USDT', '');
        
        // Simulate current price (in production, fetch real price)
        const priceChange = (Math.random() - 0.5) * 5; // -2.5% to +2.5%
        const currentPrice = position.avg_entry_price * (1 + priceChange / 100);
        
        const profitPercent = ((currentPrice - position.avg_entry_price) / position.avg_entry_price) * 100;
        
        // Check stop loss
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
        
        // Check take profit
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
    
    // If no position management needed, look for new buy opportunities
    // This would integrate with real market data API
    if (opportunities.length === 0) {
      return Response.json({ 
        success: true,
        executed: false,
        reason: 'no_opportunities'
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