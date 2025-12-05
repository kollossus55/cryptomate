import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';
import { executeAutoTradingCheckAdvanced } from './autoTradingEngineBackend.js';

/**
 * Auto-Trading Worker V4 (Rebuilt)
 * 
 * Uses the exact same core logic as the browser-based engine
 * via the ported autoTradingEngineBackend.js module.
 */

// Dynamic list - fetching top 250 by market cap
const TOP_ASSETS_COUNT = 250;

/**
 * Calculate basic confidence score (Ported from Trading.js)
 */
function calculateConfidence(asset) {
  let score = 50;

  // 24h Change impact
  if (asset.change24h > 5) score += 15;
  else if (asset.change24h > 2) score += 10;
  else if (asset.change24h > 0) score += 5;
  else if (asset.change24h < -5) score -= 15;
  else if (asset.change24h < -2) score -= 10;
  else score -= 5;

  // Volume impact
  const avgVolume = 1500000000;
  if (asset.volume24h > avgVolume * 2) score += 10;
  else if (asset.volume24h > avgVolume) score += 5;
  else if (asset.volume24h < avgVolume / 2) score -= 5;

  // Market Cap impact
  if (asset.marketCap > 100000000000) score += 10;
  else if (asset.marketCap > 10000000000) score += 5;

  // Volatility impact
  const volatility = Math.abs(asset.change24h);
  if (volatility > 10) score -= 5;
  else if (volatility < 2) score += 5;

  // Small random variation to simulate AI fluctuation
  const aiBonus = Math.random() * 10 - 5;
  score += aiBonus;

  return Math.max(30, Math.min(95, Math.round(score)));
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { settings, portfolio, user_email } = await req.json();

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

    // 3. Generate Confidence Scores
    const assetConfidence = {};
    marketAssets.forEach(asset => {
      assetConfidence[asset.symbol] = calculateConfidence(asset);
    });

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