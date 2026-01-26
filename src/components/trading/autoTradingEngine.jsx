/**
 * Auto-Trading Engine Core Logic
 * 
 * This module contains the core auto-trading logic that can be used both:
 * 1. Client-side (current browser-based implementation)
 * 2. Server-side (future backend functions implementation)
 * 
 * The logic is platform-agnostic and can be executed anywhere.
 */

/**
 * Check if circuit breaker should halt trading
 */
export function isCircuitBreakerTriggered(settings) {
  return (settings.daily_loss || 0) >= (settings.max_daily_loss_percent || 0);
}

/**
 * Check if daily trade limit has been reached
 */
export function hasReachedTradeLimit(settings) {
  return (settings.trades_today || 0) >= (settings.max_trades_per_day || 10);
}

/**
 * Determine risk level based on confidence score
 */
export function calculateRiskLevel(confidence) {
  if (confidence >= 80) return 'low';
  if (confidence >= 65) return 'medium';
  return 'high';
}

/**
 * Check if risk level is allowed in settings
 */
export function isRiskLevelAllowed(riskLevel, settings) {
  return settings.allowed_risk_levels?.includes(riskLevel);
}

/**
 * Determine trade action based on market conditions
 */
export function determineTradeAction(asset, confidence, settings, portfolio) {
  const priceChange = asset.change24h || 0;
  const minConfidence = settings.min_confidence || 70;

  // Buy Logic
  // 1. Momentum Buy: Price is moving up, but not overextended (>1% and <7%)
  if (priceChange > 1.0 && priceChange < 7.0 && confidence >= minConfidence) {
    return { action: 'buy', reason: 'positive_momentum_breakout' };
  }

  // 2. Dip Buy: Price is down (dip) but confidence is still high (smart money buying)
  // Only if DCA is enabled or user allows high risk, OR if confidence is very high (>80)
  if (priceChange < -2.0 && priceChange > -8.0 && confidence >= (minConfidence + 5)) {
    return { action: 'buy', reason: 'high_confidence_dip_buy' };
  }

  // Sell signal: check if we have a position first
  const assetSymbol = `${asset.symbol}/USDT`;
  const position = portfolio.positions?.find(p => p.asset_symbol === assetSymbol);
  
  if (position) {
    // Calculate profit percentage
    const profitPercent = ((asset.price - position.avg_entry_price) / position.avg_entry_price) * 100;
    
    // Stop loss
    if (profitPercent <= -(settings.stop_loss_percent || 3)) {
      return { action: 'sell', reason: 'stop_loss', profitPercent };
    }
    
    // Take profit
    if (profitPercent >= (settings.take_profit_percent || 8)) {
      return { action: 'sell', reason: 'take_profit', profitPercent };
    }
    
    // Negative signal sell (REMOVED - caused panic selling on dips)
    // Only sell on low confidence if it really crashes (-20%) or confidence collapses (<20)
    if (priceChange < -20 || confidence < 20) {
       return { action: 'sell', reason: 'confidence_collapse_or_crash', profitPercent };
    }
    }

    return { action: null, reason: 'no_signal' };
    }

/**
 * Advanced Risk Management: Check trailing stop loss
 */
export function checkTrailingStop(position, currentPrice, settings) {
  if (!settings.use_trailing_stop) return null;
  
  const profitPercent = ((currentPrice - position.avg_entry_price) / position.avg_entry_price) * 100;
  
  // Only activate trailing stop after minimum profit
  if (profitPercent < (settings.trailing_stop_activation || 3)) {
    return null;
  }
  
  // Update highest price if current price is higher
  const highestPrice = Math.max(position.highest_price || position.avg_entry_price, currentPrice);
  
  // Calculate trailing stop price
  const trailingStopPrice = highestPrice * (1 - (settings.trailing_stop_percent || 2) / 100);
  
  // Check if current price hit trailing stop
  if (currentPrice <= trailingStopPrice) {
    return {
      shouldSell: true,
      reason: 'trailing_stop_hit',
      stopPrice: trailingStopPrice,
      highestPrice: highestPrice,
      profitPercent: ((trailingStopPrice - position.avg_entry_price) / position.avg_entry_price) * 100
    };
  }
  
  return {
    shouldSell: false,
    highestPrice: highestPrice,
    trailingStopPrice: trailingStopPrice
  };
}

/**
 * Advanced Risk Management: Check break-even protection
 */
export function checkBreakeven(position, currentPrice, settings) {
  if (!settings.use_breakeven_protection) return null;
  
  const profitPercent = ((currentPrice - position.avg_entry_price) / position.avg_entry_price) * 100;
  
  // Activate break-even if profit threshold reached
  if (profitPercent >= (settings.breakeven_trigger_percent || 4)) {
    const breakevenPrice = position.avg_entry_price * (1 + (settings.breakeven_offset_percent || 0.5) / 100);
    
    return {
      shouldActivate: true,
      breakevenPrice: breakevenPrice,
      profitPercent: profitPercent
    };
  }
  
  return null;
}

/**
 * Advanced Risk Management: Check partial profit taking
 */
export function checkPartialProfits(position, currentPrice, settings) {
  if (!settings.use_partial_profits) return null;
  if (!settings.partial_profit_targets || settings.partial_profit_targets.length === 0) return null;
  
  const profitPercent = ((currentPrice - position.avg_entry_price) / position.avg_entry_price) * 100;
  const partialsTaken = position.partial_profits_taken || [];
  
  const opportunities = [];
  
  for (let i = 0; i < settings.partial_profit_targets.length; i++) {
    const target = settings.partial_profit_targets[i];
    
    // Skip if already taken
    if (partialsTaken.includes(i)) continue;
    
    // Check if profit target reached
    if (profitPercent >= target.profit_percent) {
      const sellQuantity = position.quantity * (target.sell_percent / 100);
      
      // Ensure sellQuantity is positive and less than or equal to current position quantity
      if (sellQuantity > 0 && sellQuantity <= position.quantity) {
        opportunities.push({
          targetIndex: i,
          profitPercent: target.profit_percent,
          sellPercent: target.sell_percent,
          sellQuantity: sellQuantity,
          remainingQuantity: position.quantity - sellQuantity
        });
      }
    }
  }
  
  return opportunities.length > 0 ? opportunities : null;
}

/**
 * Calculate market volatility
 */
export function calculateMarketVolatility(assets) {
  if (!assets || assets.length === 0) return 0;
  
  // Calculate average absolute price change across all assets
  const changes = assets.map(asset => Math.abs(asset.change24h || 0));
  const avgVolatility = changes.reduce((sum, change) => sum + change, 0) / changes.length;
  
  return avgVolatility;
}

/**
 * Detect extreme market conditions
 */
export function detectExtremeMarketConditions(assets, settings) {
  const volatility = calculateMarketVolatility(assets);
  const extremeThreshold = settings.extreme_volatility_threshold || 10;
  const highThreshold = settings.high_volatility_threshold || 5;
  
  // Count assets with extreme moves
  const extremeMoves = assets.filter(a => Math.abs(a.change24h || 0) > 15).length;
  const extremeMovePercent = (extremeMoves / assets.length) * 100;
  
  // Check for market-wide crash/pump
  const negativeAssets = assets.filter(a => (a.change24h || 0) < -10).length;
  const negativePercent = (negativeAssets / assets.length) * 100;
  
  let condition = 'normal';
  let reason = 'Market conditions are stable';
  
  if (volatility > extremeThreshold || extremeMovePercent > 30) {
    condition = 'extreme';
    reason = `Extreme volatility detected: ${volatility.toFixed(2)}% average, ${extremeMovePercent.toFixed(0)}% assets with extreme moves`;
  } else if (volatility > highThreshold || negativePercent > 50) {
    condition = 'volatile';
    reason = `High volatility detected: ${volatility.toFixed(2)}% average`;
  } else if (negativePercent > 70) {
    condition = 'extreme';
    reason = `Market crash detected: ${negativePercent.toFixed(0)}% of assets down >10%`;
  }
  
  return {
    condition,
    volatility,
    extremeMovePercent,
    negativePercent,
    reason,
    shouldHalt: condition === 'extreme'
  };
}

/**
 * Enhanced circuit breaker with market condition detection
 */
export function checkCircuitBreaker(settings, assets) {
  const results = {
    triggered: false,
    reason: null,
    cooldownRemaining: 0,
    marketCondition: 'normal'
  };
  
  // Check if circuit breaker is enabled
  if (!settings.use_circuit_breaker) {
    return results;
  }
  
  // Check cooldown period
  if (settings.circuit_breaker_triggered_at) {
    const triggeredTime = new Date(settings.circuit_breaker_triggered_at).getTime();
    const cooldownMs = (settings.circuit_breaker_cooldown_minutes || 60) * 60 * 1000;
    const elapsed = Date.now() - triggeredTime;
    
    if (elapsed < cooldownMs) {
      results.triggered = true;
      results.reason = 'circuit_breaker_cooldown';
      results.cooldownRemaining = Math.ceil((cooldownMs - elapsed) / 60000);
      return results;
    }
  }
  
  // Check daily loss limit
  const dailyLoss = settings.daily_loss || 0;
  const maxDailyLoss = settings.max_daily_loss_percent || 5;
  
  if (dailyLoss >= maxDailyLoss) {
    results.triggered = true;
    results.reason = 'daily_loss_limit';
    return results;
  }
  
  // Check extreme market conditions
  const marketAnalysis = detectExtremeMarketConditions(assets, settings);
  results.marketCondition = marketAnalysis.condition;
  
  if (marketAnalysis.shouldHalt) {
    results.triggered = true;
    results.reason = 'extreme_market_conditions';
    results.details = marketAnalysis;
    return results;
  }
  
  return results;
}

/**
 * Apply dynamic risk adjustments based on volatility
 */
export function applyDynamicRiskAdjustment(settings, marketCondition, volatility) {
  if (!settings.use_dynamic_risk) {
    return {
      adjusted: false,
      adjustments: {}
    };
  }
  
  const adjustments = {};
  let adjusted = false;
  
  const highVolatilityThreshold = settings.high_volatility_threshold || 5;
  const extremeVolatilityThreshold = settings.extreme_volatility_threshold || 10;
  
  // Adjust position size based on volatility
  if (volatility > extremeVolatilityThreshold) {
    const reductionPercent = settings.volatility_position_reduction || 50;
    adjustments.position_size_multiplier = (100 - reductionPercent) / 100;
    adjustments.min_confidence_increase = 15;
    adjustments.reason = 'Extreme volatility detected - reducing position size by 50% and increasing confidence requirement';
    adjusted = true;
  } else if (volatility > highVolatilityThreshold) {
    adjustments.position_size_multiplier = 0.7; // 30% reduction
    adjustments.min_confidence_increase = 10;
    adjustments.reason = 'High volatility detected - reducing position size by 30% and increasing confidence requirement';
    adjusted = true;
  }
  
  // Tighten stop loss in volatile conditions
  if (marketCondition === 'volatile' || marketCondition === 'extreme') {
    adjustments.stop_loss_tightening = 0.7; // Reduce stop loss distance by 30%
    adjustments.take_profit_extension = 1.2; // Increase take profit by 20%
    adjusted = true;
  }
  
  // In extreme conditions, only allow sells
  if (marketCondition === 'extreme') {
    adjustments.buy_disabled = true;
    adjustments.sell_only_mode = true;
    adjusted = true;
  }
  
  return {
    adjusted,
    adjustments,
    originalSettings: {
      max_position_size_percent: settings.max_position_size_percent,
      min_confidence: settings.min_confidence,
      stop_loss_percent: settings.stop_loss_percent
    }
  };
}

/**
 * Calculate position size with dynamic adjustments
 */
export function calculatePositionSizeDynamic(availableBalance, settings, assetPrice, riskAdjustments) {
  if (availableBalance <= 0 || !assetPrice || assetPrice === 0) {
    return { value: 0, quantity: 0, valid: false, reason: 'insufficient_balance' };
  }
  
  let maxPositionSize = (settings.max_position_size_percent || 10) / 100;
  
  // Apply dynamic risk adjustments
  if (riskAdjustments?.adjusted && riskAdjustments.adjustments.position_size_multiplier) {
    maxPositionSize *= riskAdjustments.adjustments.position_size_multiplier;
    console.log(`   ⚡ Dynamic risk: Position size reduced to ${(maxPositionSize * 100).toFixed(1)}%`);
  }
  
  const positionValue = Math.min(
    availableBalance * maxPositionSize,
    availableBalance * 0.2 // Max 20% per trade for safety
  );
  
  const quantity = positionValue / assetPrice;
  const minTradeValue = 10; // Minimum $10 trade
  
  if (positionValue < minTradeValue) {
    return { value: positionValue, quantity, valid: false, reason: 'position_too_small' };
  }
  
  return { 
    value: positionValue, 
    quantity, 
    valid: true,
    adjusted: riskAdjustments?.adjusted || false,
    adjustmentReason: riskAdjustments?.adjustments.reason
  };
}

/**
 * Check if asset has already been traded today (prevents duplicate trades on same asset)
 */
export function hasAssetBeenTradedToday(assetSymbol, settings) {
  const assetsTraded = settings.assets_traded_today || [];
  return assetsTraded.includes(assetSymbol);
}

/**
 * Enhanced trade action determination with advanced risk management
 */
export function determineTradeActionAdvanced(asset, confidence, settings, portfolio) {
  const priceChange = asset.change24h || 0;
  const minConfidence = settings.min_confidence || 70;
  
  // Check existing position first
  const assetSymbol = `${asset.symbol}/USDT`;
  const position = portfolio.positions?.find(p => p.asset_symbol === assetSymbol);
  
  if (position) {
    // Check trailing stop
    const trailingStop = checkTrailingStop(position, asset.price, settings);
    if (trailingStop?.shouldSell) {
      return {
        action: 'sell',
        reason: 'trailing_stop',
        quantity: position.quantity,
        details: trailingStop,
        profitPercent: trailingStop.profitPercent
      };
    }
    
    // Check break-even
    const breakeven = checkBreakeven(position, asset.price, settings);
    if (breakeven?.shouldActivate) {
      // If breakeven was already activated and price drops below it
      if (position.breakeven_activated && asset.price <= position.breakeven_price) {
        return {
          action: 'sell',
          reason: 'breakeven_protection',
          quantity: position.quantity,
          details: { ...breakeven, triggeredPrice: asset.price },
          profitPercent: ((asset.price - position.avg_entry_price) / position.avg_entry_price) * 100
        };
      }
      
      // If breakeven needs to be activated/updated
      if (!position.breakeven_activated || position.breakeven_price !== breakeven.breakevenPrice) {
        return {
          action: 'update_breakeven',
          reason: 'breakeven_activated',
          details: breakeven
        };
      }
    }
    
    // Check partial profit taking
    const partialProfits = checkPartialProfits(position, asset.price, settings);
    if (partialProfits && partialProfits.length > 0) {
      // Take the first available partial profit
      const bestPartial = partialProfits[0]; // Assuming targets are ordered or we take the first available
      return {
        action: 'partial_sell',
        reason: 'partial_profit',
        quantity: bestPartial.sellQuantity,
        details: { ...bestPartial, currentPrice: asset.price },
        profitPercent: ((asset.price - position.avg_entry_price) / position.avg_entry_price) * 100
      };
    }
    
    const profitPercent = ((asset.price - position.avg_entry_price) / position.avg_entry_price) * 100;
    
    // Standard stop loss
    if (profitPercent <= -(settings.stop_loss_percent || 3)) {
      return {
        action: 'sell',
        reason: 'stop_loss',
        quantity: position.quantity,
        profitPercent
      };
    }
    
    // Standard take profit
    if (profitPercent >= (settings.take_profit_percent || 8)) {
      return {
        action: 'sell',
        reason: 'take_profit',
        quantity: position.quantity,
        profitPercent
      };
    }
    
    // Check for opposite signal (sell signal on existing buy position)
    // Use signal data from window.assetSignalData to check if AI now recommends selling
    const signalData = typeof window !== 'undefined' ? window.assetSignalData?.[asset.symbol] : null;
    if (signalData && signalData.recommendation === 'sell' && signalData.confidence >= (settings.min_confidence || 70)) {
      console.log(`🔄 Opposite signal detected: ${asset.symbol} now shows SELL signal (${signalData.confidence}% confidence) - closing position`);
      return {
        action: 'sell',
        reason: 'opposite_signal_detected',
        quantity: position.quantity,
        profitPercent
      };
    }
    
    // Negative signal sell (RELAXED)
    // Only sell if confidence drastically drops or crash occurs
    if (priceChange < -20 || confidence < 20) {
      return {
        action: 'sell',
        reason: 'confidence_collapse_or_crash',
        quantity: position.quantity,
        profitPercent
      };
    }
    
    // Update trailing stop data if needed (only if no sell signal was triggered)
    if (settings.use_trailing_stop && trailingStop && !trailingStop.shouldSell && (position.highest_price || position.avg_entry_price) < trailingStop.highestPrice) {
      return {
        action: 'update_trailing',
        reason: 'update_highest_price',
        details: trailingStop
      };
    }

    // If we have a position but no sell/update action, we hold.
    // Do NOT fall through to buy logic (prevents duplicate positions)
    return { action: null, reason: 'position_exists_hold' };
    }

    // Buy Logic
      let buyReason = null;

      // 1. Momentum Buy: Rising (>0.1%) - Allow slightly lower confidence for strong momentum
      // We lower the strict confidence requirement by 5% to catch more moves in the demo
      if (priceChange > 0.1 && priceChange < 20.0 && confidence >= (minConfidence - 5)) {
        buyReason = 'positive_momentum_breakout';
      }
      // 2. Dip Buy: Dropping (Buying the dip) - Removed the +5 confidence premium
      // Catch smaller dips (starting from -0.5%) to be more active
      else if (priceChange < -0.5 && priceChange > -20.0 && confidence >= minConfidence) {
        buyReason = 'high_confidence_dip_buy';
      }

      if (buyReason) {
        // Check if already traded today
        if (hasAssetBeenTradedToday(asset.symbol, settings)) {
          return { 
            action: null, 
            reason: 'asset_already_traded_today',
            assetSymbol: asset.symbol
          };
        }
        return { action: 'buy', reason: buyReason };
      }

      return { action: null, reason: 'no_signal' };
    }

/**
 * Check if trade type is allowed in settings
 */
export function isTradeTypeAllowed(tradeType, settings) {
  return settings.trade_types?.includes(tradeType);
}

/**
 * Calculate position size for a trade
 */
export function calculatePositionSize(availableBalance, settings, assetPrice) {
  if (availableBalance <= 0 || !assetPrice || assetPrice === 0) {
    return { value: 0, quantity: 0, valid: false, reason: 'insufficient_balance' };
  }
  
  const maxPositionSize = (settings.max_position_size_percent || 10) / 100;
  const positionValue = Math.min(
    availableBalance * maxPositionSize,
    availableBalance * 0.2 // Max 20% per trade for safety
  );
  
  const quantity = positionValue / assetPrice;
  const minTradeValue = 10; // Minimum $10 trade
  
  if (positionValue < minTradeValue) {
    return { value: positionValue, quantity, valid: false, reason: 'position_too_small' };
  }
  
  return { value: positionValue, quantity, valid: true };
}

/**
 * Main opportunity scanning function
 * Returns a list of trading opportunities
 */
export function scanTradingOpportunities(assets, assetConfidence, settings, portfolio) {
  const opportunities = [];
  
  for (const asset of assets) {
    const confidence = assetConfidence[asset.symbol] || 0;

    // Check confidence threshold (allow slightly lower for potential dip buys)
    // We let determineTradeAction make the final call
    // Relaxed pre-filter: Allow -15 variance (was -10) to let more assets be evaluated
    if (confidence < ((settings.min_confidence || 70) - 15)) {
      continue;
    }

    // Determine risk level
    const riskLevel = calculateRiskLevel(confidence);
    
    // Check if risk level is allowed
    if (!isRiskLevelAllowed(riskLevel, settings)) {
      continue;
    }
    
    // Determine trade action
    const tradeDecision = determineTradeAction(asset, confidence, settings, portfolio);
    
    if (!tradeDecision.action) {
      continue;
    }
    
    // Check if trade type is allowed
    if (!isTradeTypeAllowed(tradeDecision.action, settings)) {
      continue;
    }
    
    // Calculate position size for buy orders
    if (tradeDecision.action === 'buy') {
      const positionSize = calculatePositionSize(
        portfolio.available_balance || 0,
        settings,
        asset.price
      );
      
      if (!positionSize.valid) {
        continue;
      }
      
      opportunities.push({
        asset,
        action: tradeDecision.action,
        reason: tradeDecision.reason,
        confidence,
        riskLevel,
        quantity: positionSize.quantity,
        value: positionSize.value
      });
    } else if (tradeDecision.action === 'sell') {
      // For sell orders, use existing position quantity
      const assetSymbol = `${asset.symbol}/USDT`;
      const position = portfolio.positions?.find(p => p.asset_symbol === assetSymbol);
      
      if (position && position.quantity > 0) {
        opportunities.push({
          asset,
          action: tradeDecision.action,
          reason: tradeDecision.reason,
          confidence,
          riskLevel,
          quantity: position.quantity,
          value: position.quantity * asset.price,
          profitPercent: tradeDecision.profitPercent
        });
      }
    }
  }
  
  return opportunities;
}

/**
 * Select the best opportunity from a list
 * Returns the highest confidence opportunity
 */
export function selectBestOpportunity(opportunities) {
  if (opportunities.length === 0) {
    return null;
  }
  
  // Sort by confidence (highest first)
  const sorted = [...opportunities].sort((a, b) => b.confidence - a.confidence);
  
  return sorted[0];
}

/**
 * Main auto-trading check function
 * This is the core logic that would run on backend
 */
export async function executeAutoTradingCheck(
  assets,
  assetConfidence,
  settings,
  portfolio,
  executeTradeCallback
) {
  const results = {
    success: false,
    executed: false,
    reason: null,
    opportunity: null,
    error: null
  };
  
  try {
    // Safety checks
    if (!settings?.is_enabled) {
      results.reason = 'auto_trading_disabled';
      return results;
    }
    
    if (!portfolio || !assets || assets.length === 0) {
      results.reason = 'missing_requirements';
      return results;
    }
    
    if (Object.keys(assetConfidence).length === 0) {
      results.reason = 'confidence_not_ready';
      return results;
    }
    
    // Circuit breaker check
    if (isCircuitBreakerTriggered(settings)) {
      results.reason = 'circuit_breaker_triggered';
      return results;
    }
    
    // Trade limit check
    if (hasReachedTradeLimit(settings)) {
      results.reason = 'trade_limit_reached';
      return results;
    }
    
    // Scan for opportunities
    const opportunities = scanTradingOpportunities(assets, assetConfidence, settings, portfolio);
    
    if (opportunities.length === 0) {
      results.reason = 'no_opportunities';
      results.success = true;
      return results;
    }
    
    // Select best opportunity
    const bestOpportunity = selectBestOpportunity(opportunities);
    
    if (!bestOpportunity) {
      results.reason = 'no_valid_opportunity';
      results.success = true;
      return results;
    }
    
    // Execute trade through callback
    await executeTradeCallback(bestOpportunity);
    
    results.success = true;
    results.executed = true;
    results.opportunity = bestOpportunity;
    results.reason = 'trade_executed';
    
    return results;
  } catch (error) {
    results.error = error.message;
    results.reason = 'execution_error';
    return results;
  }
}

/**
 * Enhanced opportunity scanning with dynamic risk management
 */
export function scanTradingOpportunitiesAdvanced(assets, assetConfidence, settings, portfolio) {
  const opportunities = [];
  
  console.log('🔎 SCANNING', assets.length, 'assets for opportunities...');
  
  // Calculate market volatility and conditions
  const volatility = calculateMarketVolatility(assets);
  const marketAnalysis = detectExtremeMarketConditions(assets, settings);
  
  console.log('📊 Market volatility:', volatility.toFixed(2) + '%');
  console.log('🌡️ Market condition:', marketAnalysis.condition);
  
  // Apply dynamic risk adjustments
  const riskAdjustments = applyDynamicRiskAdjustment(
    settings,
    marketAnalysis.condition,
    volatility
  );
  
  if (riskAdjustments.adjusted) {
    console.log(`🛡️ Dynamic Risk Adjustments Applied:`);
    console.log(`   Market Condition: ${marketAnalysis.condition.toUpperCase()}`);
    console.log(`   Volatility: ${volatility.toFixed(2)}%`);
    console.log(`   ${riskAdjustments.adjustments.reason}`);
    
    if (riskAdjustments.adjustments.sell_only_mode) {
      console.log(`   ⚠️ SELL-ONLY MODE ACTIVE - No new buy positions`);
    }
  }
  
  // Adjust minimum confidence if needed
  const adjustedMinConfidence = (settings.min_confidence || 70) + 
    (riskAdjustments.adjustments.min_confidence_increase || 0);
  
  console.log('🎯 Adjusted min confidence:', adjustedMinConfidence + '%');
  console.log('💵 Available balance:', portfolio.available_balance);
  console.log('\n🔍 Checking each asset...');
  
  let checkedCount = 0;
  for (const asset of assets) {
    const confidence = assetConfidence[asset.symbol] || 0;
    checkedCount++;
    
    if (checkedCount <= 5 || confidence >= adjustedMinConfidence) {
      console.log(`\n  ${asset.symbol}: price=$${asset.price.toFixed(2)}, change=${asset.change24h?.toFixed(2)}%, confidence=${confidence}%`);
    }
    
    // Use advanced trade action determination
    const tradeDecision = determineTradeActionAdvanced(asset, confidence, settings, portfolio);

    if (!tradeDecision.action) {
      if (tradeDecision.reason === 'position_exists_hold') {
         const assetSymbol = `${asset.symbol}/USDT`;
         const position = portfolio.positions?.find(p => p.asset_symbol === assetSymbol);
         const pnl = position ? ((asset.price - position.avg_entry_price) / position.avg_entry_price) * 100 : 0;
         console.log(`    💎 Holding ${asset.symbol}: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}% (Target: +${settings.take_profit_percent || 8}%)`);
      } else if (checkedCount <= 5 || confidence >= adjustedMinConfidence - 10) {
        console.log(`    ❌ No action: ${tradeDecision.reason}`);
      }
      continue;
    }
    
    console.log(`    ✅ Signal detected: ${tradeDecision.action} (${tradeDecision.reason})`);
    
    // Handle position updates (non-trade actions)
    if (tradeDecision.action === 'update_trailing' || tradeDecision.action === 'update_breakeven') {
      const assetSymbol = `${asset.symbol}/USDT`;
      const position = portfolio.positions?.find(p => p.asset_symbol === assetSymbol);

      if (position) {
        opportunities.push({
          asset,
          action: tradeDecision.action,
          reason: tradeDecision.reason,
          confidence,
          details: tradeDecision.details,
          isUpdate: true,
          position
        });
      }
      continue;
    }
    
    // Block buys in extreme conditions
    if (tradeDecision.action === 'buy' && riskAdjustments.adjustments.sell_only_mode) {
      console.log(`   ⛔ Blocking BUY for ${asset.symbol} - SELL-ONLY MODE active due to extreme conditions`);
      continue;
    }
    
    // Check adjusted confidence threshold for new buy trades
    if (tradeDecision.action === 'buy' && confidence < adjustedMinConfidence) {
      // Exception: Allow "Dip Buys" if they passed the logic in determineTradeActionAdvanced
      if (tradeDecision.reason !== 'high_confidence_dip_buy') {
         continue;
      }
    }
    
    // Determine risk level for buy orders
    if (tradeDecision.action === 'buy') {
      const riskLevel = calculateRiskLevel(confidence);
      
      // Check if risk level is allowed
      if (!isRiskLevelAllowed(riskLevel, settings)) {
        continue;
      }
      
      // Check if trade type is allowed
      if (!isTradeTypeAllowed('buy', settings)) {
        continue;
      }
      
      // Calculate position size with dynamic adjustments
      const positionSize = calculatePositionSizeDynamic(
        portfolio.available_balance || 0,
        settings,
        asset.price,
        riskAdjustments
      );
      
      if (!positionSize.valid) {
        continue;
      }
      
      opportunities.push({
        asset,
        action: 'buy',
        reason: tradeDecision.reason,
        confidence,
        riskLevel,
        quantity: positionSize.quantity,
        value: positionSize.value,
        isUpdate: false,
        dynamicRiskApplied: positionSize.adjusted,
        adjustmentReason: positionSize.adjustmentReason
      });
    } else if (tradeDecision.action === 'sell' || tradeDecision.action === 'partial_sell') {
      // Check if trade type is allowed
      if (!isTradeTypeAllowed('sell', settings)) {
        continue;
      }

      const assetSymbol = `${asset.symbol}/USDT`;
      const position = portfolio.positions?.find(p => p.asset_symbol === assetSymbol);
      
      // Ensure we have a position to sell from and quantity is valid
      if (position && tradeDecision.quantity > 0) {
        opportunities.push({
          asset,
          action: tradeDecision.action,
          reason: tradeDecision.reason,
          confidence,
          riskLevel: 'low',
          quantity: tradeDecision.quantity,
          value: tradeDecision.quantity * asset.price,
          profitPercent: tradeDecision.profitPercent,
          details: tradeDecision.details,
          isUpdate: false,
          position
        });
      }
    }
  }
  
  console.log(`\n✨ Found ${opportunities.length} total opportunities`);
  if (opportunities.length > 0) {
    opportunities.forEach((opp, i) => {
      console.log(`  ${i+1}. ${opp.asset.symbol} - ${opp.action.toUpperCase()} - ${opp.confidence}% confidence`);
    });
  }
  
  return opportunities;
}

/**
 * Enhanced auto-trading check with circuit breaker and dynamic risk
 */
export async function executeAutoTradingCheckAdvanced(
  assets,
  assetConfidence,
  settings,
  portfolio,
  executeTradeCallback,
  updatePositionCallback
) {
  const results = {
    success: false,
    executed: false,
    reason: null,
    opportunity: null,
    positionUpdates: [],
    executionDetails: null,
    error: null,
    marketCondition: 'normal',
    circuitBreakerStatus: null
  };
  
  try {
    // Safety checks
    if (!settings?.is_enabled) {
      results.reason = 'auto_trading_disabled';
      return results;
    }
    
    if (!portfolio || !assets || assets.length === 0) {
      results.reason = 'missing_requirements';
      return results;
    }
    
    if (Object.keys(assetConfidence).length === 0) {
      results.reason = 'confidence_not_ready';
      return results;
    }
    
    // Enhanced circuit breaker check
    const circuitBreakerStatus = checkCircuitBreaker(settings, assets);
    results.circuitBreakerStatus = circuitBreakerStatus;
    results.marketCondition = circuitBreakerStatus.marketCondition;
    
    if (circuitBreakerStatus.triggered) {
      console.log(`🛑 CIRCUIT BREAKER TRIGGERED: ${circuitBreakerStatus.reason}`);
      
      if (circuitBreakerStatus.reason === 'circuit_breaker_cooldown') {
        console.log(`   ⏱️ Cooldown: ${circuitBreakerStatus.cooldownRemaining} minutes remaining`);
      } else if (circuitBreakerStatus.reason === 'extreme_market_conditions') {
        console.log(`   ⚠️ ${circuitBreakerStatus.details.reason}`);
        console.log(`   📊 Market Volatility: ${circuitBreakerStatus.details.volatility.toFixed(2)}%`);
      }
      
      results.reason = circuitBreakerStatus.reason;
      results.success = true; // Still considered successful check, just no trade
      return results;
    }
    
    // Trade limit check
    if (hasReachedTradeLimit(settings)) {
      results.reason = 'trade_limit_reached';
      return results;
    }
    
    // Scan for opportunities with advanced risk management
    const opportunities = scanTradingOpportunitiesAdvanced(assets, assetConfidence, settings, portfolio);
    
    // Separate position updates from trades
    const positionUpdates = opportunities.filter(opp => opp.isUpdate);
    const tradeOpportunities = opportunities.filter(opp => !opp.isUpdate);
    
    // Process position updates
    if (positionUpdates.length > 0 && updatePositionCallback) {
      for (const update of positionUpdates) {
        try {
          await updatePositionCallback(update);
          results.positionUpdates.push(update);
        } catch (updateError) {
          console.error(`Failed to apply position update for ${update.asset.symbol}:`, updateError);
        }
      }
    }
    
    if (tradeOpportunities.length === 0) {
      results.reason = 'no_opportunities';
      results.success = true;
      return results;
    }
    
    // Select best opportunity (prioritize sells, then highest confidence)
    const sellOpportunities = tradeOpportunities.filter(opp => opp.action === 'sell' || opp.action === 'partial_sell');
    const buyOpportunities = tradeOpportunities.filter(opp => opp.action === 'buy');
    
    let bestOpportunity = null;
    if (sellOpportunities.length > 0) {
      // Sort sell opportunities by profit potential (highest profit first) or confidence
      bestOpportunity = sellOpportunities.sort((a, b) => (b.profitPercent || 0) - (a.profitPercent || 0))[0];
    } else if (buyOpportunities.length > 0) {
      // Sort buy opportunities by confidence (highest first)
      bestOpportunity = buyOpportunities.sort((a, b) => b.confidence - a.confidence)[0];
    }
    
    if (!bestOpportunity) {
      results.reason = 'no_valid_opportunity';
      results.success = true;
      return results;
    }
    
    // Log dynamic risk adjustment if applied
    if (bestOpportunity.dynamicRiskApplied) {
      console.log(`   🛡️ ${bestOpportunity.adjustmentReason}`);
    }
    
    // Execute trade through callback with smart execution details
    const executionResult = await executeTradeCallback(bestOpportunity);
    
    results.success = true;
    results.executed = true;
    results.opportunity = bestOpportunity;
    results.executionDetails = executionResult;
    results.reason = 'trade_executed';
    
    return results;
  } catch (error) {
    results.error = error.message;
    results.reason = 'execution_error';
    return results;
  }
}

/**
 * Format opportunity for logging
 */
export function formatOpportunityLog(opportunity) {
  if (!opportunity) return 'No opportunity';
  
  const { asset, action, reason, confidence, quantity, value, profitPercent, isUpdate, details } = opportunity;

  if (isUpdate) {
    if (action === 'update_trailing') {
      return `UPDATE ${asset.symbol}: Trailing stop new highest price $${details.highestPrice?.toLocaleString()} (TS price: $${details.trailingStopPrice?.toLocaleString()})`;
    }
    if (action === 'update_breakeven') {
      return `UPDATE ${asset.symbol}: Breakeven activated at $${details.breakevenPrice?.toLocaleString()} (${details.profitPercent?.toFixed(2)}% profit)`;
    }
  }
  
  let message = `${action.toUpperCase()} ${asset.symbol}: `;
  if (quantity) {
    message += `${quantity.toFixed(6)} @ $${asset.price.toLocaleString()} `;
  } else if (value) {
    message += `$${value.toLocaleString()} worth @ $${asset.price.toLocaleString()} `;
  }
  
  message += `(${confidence}% confidence, ${reason})`;
  
  if (profitPercent !== undefined) {
    message += ` [P&L: ${profitPercent.toFixed(2)}%]`;
  }
  if (details?.targetIndex !== undefined) {
    message += ` [Partial target ${details.targetIndex + 1}]`;
  }
  
  return message;
}

/**
 * State persistence helpers for browser environment
 */
export const BrowserState = {
  STORAGE_KEY: 'auto_trading_state',
  
  save(state) {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify({
        ...state,
        timestamp: Date.now()
      }));
    } catch (error) {
      console.error('Failed to save auto-trading state:', error);
    }
  },
  
  load() {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (!stored) return null;
      
      const state = JSON.parse(stored);
      const age = Date.now() - (state.timestamp || 0);
      
      // Expire state after 1 hour
      if (age > 60 * 60 * 1000) {
        this.clear();
        return null;
      }
      
      return state;
    } catch (error) {
      console.error('Failed to load auto-trading state:', error);
      return null;
    }
  },
  
  clear() {
    try {
      localStorage.removeItem(this.STORAGE_KEY);
    } catch (error) {
      console.error('Failed to clear auto-trading state:', error);
    }
  }
};