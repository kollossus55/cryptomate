/**
 * Auto-Trading Worker - Server-Side Trading Execution
 * Runs 24/7 on the server to execute automated trades
 * 
 * This function is triggered by a scheduler and executes trading logic
 * for all users with auto-trading enabled.
 */

import { base44 } from '@/api/base44Client';
import { 
  executeAutoTradingCheckAdvanced,
  BrowserState 
} from '../components/trading/autoTradingEngine';
import { executeSmartOrder } from '../components/trading/smartOrderExecution';

/**
 * Main worker function - processes auto-trading for all active users
 */
export default async function autoTradingWorker({ user_email }) {
  console.log(`[AutoTrading Worker] Starting check for user: ${user_email}`);
  
  try {
    // Fetch user's auto-trading settings
    const settings = await base44.entities.AutoTradingSettings.filter({ 
      created_by: user_email 
    });
    
    if (!settings || settings.length === 0) {
      console.log(`[AutoTrading Worker] No settings found for ${user_email}`);
      return { success: false, message: 'No auto-trading settings found' };
    }
    
    const autoTradingSettings = settings[0];
    
    // Check if auto-trading is enabled
    if (!autoTradingSettings.is_enabled) {
      console.log(`[AutoTrading Worker] Auto-trading disabled for ${user_email}`);
      return { success: false, message: 'Auto-trading is disabled' };
    }
    
    // Fetch user's portfolio
    const portfolios = await base44.entities.Portfolio.filter({ 
      created_by: user_email 
    });
    
    if (!portfolios || portfolios.length === 0) {
      console.log(`[AutoTrading Worker] No portfolio found for ${user_email}`);
      return { success: false, message: 'No portfolio found' };
    }
    
    const portfolio = portfolios[0];
    
    // Fetch current market data
    const assets = await fetchMarketData();
    
    // Fetch AI confidence data
    const assetConfidence = await fetchAIConfidence(assets);
    
    console.log(`[AutoTrading Worker] Processing ${assets.length} assets for ${user_email}`);
    
    // Execute auto-trading check
    const result = await executeAutoTradingCheckAdvanced(
      assets,
      assetConfidence,
      autoTradingSettings,
      portfolio,
      async (opportunity) => {
        console.log(`[AutoTrading Worker] Opportunity identified: ${opportunity.asset.symbol} ${opportunity.action}`);
        
        // Execute trade with smart routing if enabled
        if (autoTradingSettings.use_smart_routing) {
          const smartResult = await executeSmartOrder(
            opportunity,
            autoTradingSettings,
            portfolio,
            async (enhancedOpportunity) => {
              return await executeTrade(
                enhancedOpportunity,
                user_email,
                portfolio,
                autoTradingSettings
              );
            }
          );
          return smartResult;
        } else {
          return await executeTrade(
            opportunity,
            user_email,
            portfolio,
            autoTradingSettings
          );
        }
      },
      async (update) => {
        console.log(`[AutoTrading Worker] Position update: ${update.asset.symbol}`);
        await updatePosition(update, portfolio, user_email);
      }
    );
    
    console.log(`[AutoTrading Worker] Completed for ${user_email}:`, result);
    
    return {
      success: true,
      executed: result.executed,
      reason: result.reason,
      opportunity: result.opportunity,
      timestamp: new Date().toISOString()
    };
    
  } catch (error) {
    console.error(`[AutoTrading Worker] Error for ${user_email}:`, error);
    
    // Send error notification to user
    await base44.entities.Notification.create({
      created_by: user_email,
      notification_type: 'system',
      priority: 'high',
      title: 'Auto-Trading Error',
      message: `An error occurred during automated trading: ${error.message}`,
      data: { error: error.message }
    });
    
    return {
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * Fetch current market data from CoinGecko or use cached data
 */
async function fetchMarketData() {
  const coinGeckoIds = {
    BTC: "bitcoin", ETH: "ethereum", BNB: "binancecoin", SOL: "solana",
    XRP: "ripple", ADA: "cardano", AVAX: "avalanche-2", DOGE: "dogecoin",
    DOT: "polkadot", MATIC: "matic-network", LTC: "litecoin", LINK: "chainlink",
    UNI: "uniswap", ATOM: "cosmos", XLM: "stellar", ALGO: "algorand",
    VET: "vechain", FIL: "filecoin", NEAR: "near", APT: "aptos"
  };
  
  try {
    const ids = Object.values(coinGeckoIds).join(',');
    const response = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true&include_market_cap=true`
    );
    
    if (!response.ok) {
      throw new Error('Failed to fetch market data');
    }
    
    const data = await response.json();
    
    // Transform data into asset format
    const assets = Object.entries(coinGeckoIds).map(([symbol, id]) => {
      const liveData = data[id];
      return {
        symbol,
        name: symbol,
        price: liveData?.usd || 0,
        change24h: liveData?.usd_24h_change || 0,
        volume24h: liveData?.usd_24h_vol || 0,
        marketCap: liveData?.usd_market_cap || 0
      };
    });
    
    return assets;
  } catch (error) {
    console.error('[AutoTrading Worker] Failed to fetch market data:', error);
    // Return default/cached data if API fails
    return getDefaultAssets();
  }
}

/**
 * Fetch or calculate AI confidence for assets
 */
async function fetchAIConfidence(assets) {
  const confidence = {};
  
  // For server-side, use simplified confidence calculation
  // In production, this would call your AI model
  assets.forEach(asset => {
    let score = 50;
    
    if (asset.change24h > 5) score += 20;
    else if (asset.change24h > 2) score += 10;
    else if (asset.change24h > 0) score += 5;
    else if (asset.change24h < -5) score -= 20;
    else if (asset.change24h < -2) score -= 10;
    else score -= 5;
    
    const avgVolume = 1500000000;
    if (asset.volume24h > avgVolume * 2) score += 10;
    else if (asset.volume24h > avgVolume) score += 5;
    
    confidence[asset.symbol] = Math.max(30, Math.min(95, Math.round(score)));
  });
  
  return confidence;
}

/**
 * Execute a trade on the server
 */
async function executeTrade(opportunity, user_email, portfolio, settings) {
  const { asset, action, quantity } = opportunity;
  
  console.log(`[AutoTrading Worker] Executing trade: ${action} ${quantity} ${asset.symbol}`);
  
  // Calculate execution details
  const slippage = 0.001 + (Math.random() * 0.001);
  const slippageAmount = action === 'buy' ? slippage : -slippage;
  const executionPrice = asset.price * (1 + slippageAmount);
  const actualTotal = quantity * executionPrice;
  
  // Calculate profit/loss
  let profitLoss = 0;
  let updatedPositions = [...(portfolio.positions || [])];
  const assetSymbol = `${asset.symbol}/USDT`;
  const positionIndex = updatedPositions.findIndex(p => p.asset_symbol === assetSymbol);
  const existingPosition = positionIndex >= 0 ? updatedPositions[positionIndex] : null;
  
  if (action === 'buy') {
    if (existingPosition) {
      const totalQuantity = existingPosition.quantity + quantity;
      const totalCost = (existingPosition.quantity * existingPosition.avg_entry_price) + actualTotal;
      const newAvgPrice = totalCost / totalQuantity;
      
      updatedPositions[positionIndex] = {
        ...existingPosition,
        quantity: totalQuantity,
        avg_entry_price: newAvgPrice,
        current_value: totalQuantity * executionPrice,
        profit_loss: (executionPrice - newAvgPrice) * totalQuantity,
        highest_price: Math.max(existingPosition.highest_price || executionPrice, executionPrice)
      };
    } else {
      updatedPositions.push({
        asset_symbol: assetSymbol,
        quantity: quantity,
        avg_entry_price: executionPrice,
        current_value: actualTotal,
        profit_loss: 0,
        highest_price: executionPrice,
        trailing_stop_price: null,
        breakeven_activated: false
      });
    }
  } else {
    if (existingPosition) {
      const sellQuantity = Math.min(quantity, existingPosition.quantity);
      profitLoss = (executionPrice - existingPosition.avg_entry_price) * sellQuantity;
      
      if (sellQuantity >= existingPosition.quantity) {
        updatedPositions.splice(positionIndex, 1);
      } else {
        const remainingQuantity = existingPosition.quantity - sellQuantity;
        updatedPositions[positionIndex] = {
          ...existingPosition,
          quantity: remainingQuantity,
          current_value: remainingQuantity * executionPrice,
          profit_loss: (executionPrice - existingPosition.avg_entry_price) * remainingQuantity
        };
      }
    }
  }
  
  // Create trade record
  await base44.entities.Trade.create({
    created_by: user_email,
    asset_symbol: assetSymbol,
    trade_type: action,
    quantity: quantity,
    price: executionPrice,
    total_value: actualTotal,
    exchange: "Paper Trading (Server)",
    status: "completed",
    profit_loss: profitLoss
  });
  
  // Update portfolio
  const newBalance = action === 'buy'
    ? portfolio.available_balance - actualTotal
    : portfolio.available_balance + actualTotal;
  
  await base44.entities.Portfolio.update(portfolio.id, {
    total_balance: portfolio.total_balance + profitLoss,
    available_balance: newBalance,
    positions: updatedPositions,
    total_profit_loss: (portfolio.total_profit_loss || 0) + profitLoss,
    total_trades: (portfolio.total_trades || 0) + 1
  });
  
  // Update auto-trading settings
  const newTradesCount = (settings.trades_today || 0) + 1;
  const assetsTraded = [...(settings.assets_traded_today || [])];
  if (action === 'buy' && !assetsTraded.includes(asset.symbol)) {
    assetsTraded.push(asset.symbol);
  }
  
  await base44.entities.AutoTradingSettings.update(settings.id, {
    trades_today: newTradesCount,
    last_trade_date: new Date().toISOString(),
    assets_traded_today: assetsTraded
  });
  
  // Create notification
  await base44.entities.Notification.create({
    created_by: user_email,
    notification_type: 'order_filled',
    priority: 'high',
    title: '🤖 Server Auto-Trade Executed',
    message: `Automatically ${action === 'buy' ? 'bought' : 'sold'} ${quantity.toFixed(6)} ${asset.symbol} at $${executionPrice.toLocaleString()}`,
    data: {
      asset: asset.symbol,
      type: action,
      quantity: quantity,
      price: executionPrice,
      profit_loss: profitLoss,
      server_side: true
    }
  });
  
  return { success: true, executionPrice, actualSlippage: Math.abs(slippage * 100) };
}

/**
 * Update position (trailing stops, break-even, etc.)
 */
async function updatePosition(update, portfolio, user_email) {
  const updatedPositions = portfolio.positions.map(pos => {
    if (pos.asset_symbol === `${update.asset.symbol}/USDT`) {
      if (update.action === 'update_trailing' && update.details) {
        return {
          ...pos,
          highest_price: update.details.highestPrice,
          trailing_stop_price: update.details.trailingStopPrice
        };
      }
      if (update.action === 'update_breakeven') {
        return { ...pos, breakeven_activated: true };
      }
    }
    return pos;
  });
  
  await base44.entities.Portfolio.update(portfolio.id, {
    positions: updatedPositions
  });
}

/**
 * Default asset data (fallback)
 */
function getDefaultAssets() {
  return [
    { symbol: "BTC", name: "Bitcoin", price: 44084, change24h: 2.45, volume24h: 28000000000, marketCap: 860000000000 },
    { symbol: "ETH", name: "Ethereum", price: 2316, change24h: -1.23, volume24h: 15000000000, marketCap: 278000000000 },
    { symbol: "SOL", name: "Solana", price: 99.24, change24h: 5.67, volume24h: 2400000000, marketCap: 42000000000 }
  ];
}