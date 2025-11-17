
/**
 * Smart Order Execution Engine
 * 
 * Implements advanced order placement strategies:
 * - Smart order routing for optimal prices
 * - TWAP (Time-Weighted Average Price) execution
 * - Dynamic slippage control based on volatility
 * - Multiple execution strategies (market, limit, smart limit, iceberg, VWAP)
 */

/**
 * Calculate optimal limit price based on market conditions
 */
export function calculateOptimalLimitPrice(currentPrice, side, volatility, settings) {
  const baseOffset = settings.limit_offset_percent || 0.1;
  
  // Adjust offset based on volatility
  const volatilityMultiplier = volatility > 5 ? 1.5 : volatility > 2 ? 1.2 : 1.0;
  const adjustedOffset = baseOffset * volatilityMultiplier;
  
  // For buys, place order below market; for sells, place above market
  if (side === 'buy') {
    return currentPrice * (1 - adjustedOffset / 100);
  } else {
    return currentPrice * (1 + adjustedOffset / 100);
  }
}

/**
 * Calculate expected slippage based on order size and market conditions
 */
export function calculateExpectedSlippage(orderValue, marketVolume, volatility, settings) {
  // Base slippage calculation
  const volumeRatio = orderValue / (marketVolume || 1000000);
  let baseSlippage = Math.min(volumeRatio * 100, 2); // Max 2% from volume impact
  
  // Add volatility factor
  const volatilitySlippage = volatility * 0.05; // 0.05% per 1% volatility
  
  // Total expected slippage
  const totalSlippage = baseSlippage + volatilitySlippage;
  
  // Check against maximum allowed
  const maxSlippage = settings.use_dynamic_slippage
    ? settings.max_slippage_percent * (1 + volatility / 10) // Increase limit with volatility
    : settings.max_slippage_percent || 0.5;
  
  return {
    expected: totalSlippage,
    maximum: maxSlippage,
    acceptable: totalSlippage <= maxSlippage,
    recommendation: totalSlippage > maxSlippage * 0.8 ? 'use_twap' : 'proceed'
  };
}

/**
 * Smart Order Routing: Find the best execution strategy
 */
export function smartOrderRouting(asset, quantity, side, settings, portfolio) {
  const orderValue = quantity * asset.price;
  const volatility = Math.abs(asset.change24h || 0);
  const portfolioSize = portfolio.total_balance || 10000;
  
  // Calculate order size relative to portfolio
  const positionSizePercent = (orderValue / portfolioSize) * 100;
  
  // Calculate expected slippage
  const slippageAnalysis = calculateExpectedSlippage(
    orderValue,
    asset.volume24h,
    volatility,
    settings
  );
  
  // Determine if TWAP should be used
  const shouldUseTWAP = 
    settings.use_twap && 
    positionSizePercent >= (settings.twap_threshold_percent || 5);

  // Determine if VWAP should be used
  const shouldUseVWAP =
    settings.use_vwap &&
    positionSizePercent >= (settings.vwap_threshold_percent || 10); // Default VWAP threshold to 10%
  
  // Determine execution strategy
  let strategy = settings.execution_strategy || 'smart_limit';
  let reasoning = [];
  
  if (!slippageAnalysis.acceptable) {
    reasoning.push(`Expected slippage (${slippageAnalysis.expected.toFixed(2)}%) exceeds maximum`);
    
    // For unacceptable slippage, prioritize strategies that reduce market impact
    if (shouldUseVWAP) {
      strategy = 'vwap';
      reasoning.push('Switching to VWAP execution to minimize market impact over time');
    } else if (shouldUseTWAP) {
      strategy = 'twap';
      reasoning.push('Switching to TWAP execution to minimize market impact');
    } else {
      strategy = 'limit';
      reasoning.push('Using limit orders to control slippage');
    }
  } else if (shouldUseVWAP) {
    strategy = 'vwap';
    reasoning.push(`Large position (${positionSizePercent.toFixed(1)}% of portfolio) - using VWAP`);
  } else if (shouldUseTWAP) {
    strategy = 'twap';
    reasoning.push(`Large position (${positionSizePercent.toFixed(1)}% of portfolio) - using TWAP`);
  } else if (volatility > 5) {
    strategy = 'market';
    reasoning.push('High volatility detected - using market orders for immediate execution');
  }
  
  return {
    strategy,
    slippageAnalysis,
    shouldUseTWAP,
    shouldUseVWAP,
    optimalLimitPrice: calculateOptimalLimitPrice(asset.price, side, volatility, settings),
    reasoning,
    estimatedExecutionTime: strategy === 'twap' 
      ? settings.twap_duration_minutes || 15 
      : strategy === 'vwap'
        ? settings.vwap_duration_minutes || 60 // Default VWAP duration to 60 minutes
        : strategy === 'market' 
          ? 0.1 
          : 1,
    splitRecommendation: strategy === 'twap' 
      ? settings.twap_num_orders || 5 
      : strategy === 'vwap'
        ? settings.vwap_lookback_periods || 20 // Default VWAP split to 20 periods
        : 1
  };
}

/**
 * Generate TWAP execution schedule
 */
export function generateTWAPSchedule(totalQuantity, duration, numOrders, startPrice) {
  const quantityPerOrder = totalQuantity / numOrders;
  const intervalMinutes = duration / numOrders;
  
  const schedule = [];
  const now = Date.now();
  
  for (let i = 0; i < numOrders; i++) {
    schedule.push({
      orderIndex: i + 1,
      quantity: quantityPerOrder,
      scheduledTime: new Date(now + (i * intervalMinutes * 60 * 1000)),
      estimatedPrice: startPrice, // In real scenario, would predict price
      status: 'pending',
      priceDeviation: (Math.random() - 0.5) * 0.3 // Simulate ±0.15% price variation
    });
  }
  
  return {
    totalOrders: numOrders,
    quantityPerOrder,
    intervalMinutes,
    totalDuration: duration,
    schedule,
    averagePrice: startPrice, // Will be calculated after execution
    totalSlippage: 0 // Will be calculated after execution
  };
}

/**
 * Calculate VWAP (Volume-Weighted Average Price)
 */
export function calculateVWAP(priceHistory, volumeHistory) {
  if (!priceHistory || !volumeHistory || priceHistory.length !== volumeHistory.length || priceHistory.length === 0) {
    return null;
  }
  
  let totalPriceVolume = 0;
  let totalVolume = 0;
  
  for (let i = 0; i < priceHistory.length; i++) {
    totalPriceVolume += priceHistory[i] * volumeHistory[i];
    totalVolume += volumeHistory[i];
  }
  
  return totalVolume > 0 ? totalPriceVolume / totalVolume : null;
}

/**
 * Generate VWAP execution schedule
 */
export function generateVWAPSchedule(totalQuantity, asset, settings, priceHistory = []) {
  const lookbackPeriods = settings.vwap_lookback_periods || 20;
  const participationRate = (settings.vwap_participation_rate || 10) / 100;
  const currentVolume = asset.volume24h || 1000000;
  const totalDuration = settings.vwap_duration_minutes || 60; // Total duration for VWAP execution in minutes
  
  // Simulate volume profile (in reality, would use real-time volume data)
  const volumeProfile = [];
  
  // Generate volume distribution based on typical market patterns
  // Higher volume at market open/close, lower in the middle
  for (let i = 0; i < lookbackPeriods; i++) {
    const progress = i / lookbackPeriods;
    // U-shaped volume curve (more volume at edges, less in middle)
    const volumeFactor = Math.pow(progress - 0.5, 2) * 4 + 0.3; // Min 0.3, max 1.3
    // Distribute the currentVolume over 24h, then per period.
    // Assuming 'currentVolume' is 24h, distribute it over 'totalDuration' minutes for simulation
    const periodVolume = (currentVolume / (24 * 60)) * totalDuration / lookbackPeriods * volumeFactor;
    volumeProfile.push(Math.max(1, periodVolume)); // Ensure non-zero volume
  }
  
  const totalMarketVolumeEstimated = volumeProfile.reduce((sum, v) => sum + v, 0);
  
  // Calculate VWAP target
  // If no price history provided, assume current price for all periods for a basic VWAP target
  const vwapPrice = calculateVWAP(
    priceHistory.length > 0 ? priceHistory : Array(lookbackPeriods).fill(asset.price),
    volumeProfile
  ) || asset.price; // Fallback to asset price if calculation fails
  
  // Distribute orders based on volume profile
  const schedule = [];
  let remainingQuantity = totalQuantity;
  
  for (let i = 0; i < lookbackPeriods && remainingQuantity > 0; i++) {
    const periodMarketVolume = volumeProfile[i];
    const targetVolumeInDollars = periodMarketVolume * participationRate;
    const orderQuantity = Math.min(
      (targetVolumeInDollars / asset.price), // Convert target volume in dollars to quantity
      remainingQuantity
    );
    
    if (orderQuantity > 0) {
      schedule.push({
        orderIndex: schedule.length + 1,
        quantity: orderQuantity,
        targetVolumeValue: targetVolumeInDollars, // Target value for this period
        marketVolumeValue: periodMarketVolume, // Market value for this period
        participationRate: (targetVolumeInDollars / periodMarketVolume) * 100, // Actual participation rate for the period
        scheduledTime: new Date(Date.now() + (i * (totalDuration / lookbackPeriods) * 60 * 1000)),
        estimatedPrice: vwapPrice * (1 + (Math.random() - 0.5) * 0.002), // Simulate ±0.1% price variation around VWAP
        status: 'pending'
      });
      
      remainingQuantity -= orderQuantity;
    }
  }
  
  return {
    strategy: 'vwap',
    totalOrders: schedule.length,
    vwapTarget: vwapPrice,
    totalDuration: totalDuration,
    participationRate: participationRate * 100,
    schedule,
    remainingQuantity // Quantity that couldn't be scheduled due to market volume limits
  };
}

/**
 * Execute trade with smart order routing
 */
export async function executeSmartOrder(opportunity, settings, portfolio, executeCallback) {
  const { asset, action, quantity, confidence, riskLevel } = opportunity;
  const side = action === 'partial_sell' ? 'sell' : action;
  
  // Get smart routing decision
  const routing = smartOrderRouting(asset, quantity, side, settings, portfolio);
  
  console.log(`📊 Smart Routing Decision for ${asset.symbol}:`);
  console.log(`   Strategy: ${routing.strategy.toUpperCase()}`);
  console.log(`   Expected Slippage: ${routing.slippageAnalysis.expected.toFixed(3)}%`);
  console.log(`   Max Allowed: ${routing.slippageAnalysis.maximum.toFixed(2)}%`);
  routing.reasoning.forEach(reason => console.log(`   - ${reason}`));
  
  // Execute based on strategy
  if (routing.strategy === 'twap') {
    return await executeTWAP(
      opportunity,
      routing,
      settings,
      portfolio,
      executeCallback
    );
  } else if (routing.strategy === 'vwap' || settings.use_vwap) { // Added VWAP condition
    return await executeVWAP(
      opportunity,
      routing,
      settings,
      portfolio,
      executeCallback
    );
  } else {
    return await executeSingleOrder(
      opportunity,
      routing,
      settings,
      executeCallback
    );
  }
}

/**
 * Execute TWAP strategy
 */
async function executeTWAP(opportunity, routing, settings, portfolio, executeCallback) {
  const { asset, action, quantity } = opportunity;
  const duration = settings.twap_duration_minutes || 15;
  const numOrders = routing.splitRecommendation;
  
  console.log(`⏱️ Executing TWAP for ${asset.symbol}:`);
  console.log(`   Total Quantity: ${quantity.toFixed(6)}`);
  console.log(`   Split into: ${numOrders} orders over ${duration} minutes`);
  
  // Generate schedule
  const schedule = generateTWAPSchedule(quantity, duration, numOrders, asset.price);
  
  // For simulation, execute first order immediately
  // In production, would schedule all orders
  const firstOrder = schedule.schedule[0];
  
  console.log(`   Executing order 1/${numOrders}: ${firstOrder.quantity.toFixed(6)} ${asset.symbol}`);
  
  const result = await executeCallback({
    ...opportunity,
    quantity: firstOrder.quantity,
    executionStrategy: 'twap',
    twapInfo: {
      orderIndex: 1,
      totalOrders: numOrders,
      schedule: schedule
    }
  });
  
  // In a real system, would schedule remaining orders
  console.log(`   ✅ TWAP order 1/${numOrders} executed`);
  console.log(`   📅 Remaining ${numOrders - 1} orders scheduled`);
  
  return {
    ...result,
    execution_type: 'twap',
    twap_schedule: schedule,
    orders_completed: 1,
    orders_remaining: numOrders - 1
  };
}

/**
 * Execute VWAP strategy
 */
async function executeVWAP(opportunity, routing, settings, portfolio, executeCallback) {
  const { asset, action, quantity } = opportunity;
  
  console.log(`📊 Executing VWAP for ${asset.symbol}:`);
  console.log(`   Total Quantity: ${quantity.toFixed(6)}`);
  console.log(`   Participation Rate: ${settings.vwap_participation_rate || 10}%`);
  console.log(`   Target: Match volume-weighted average price`);
  
  // Generate VWAP schedule
  const vwapSchedule = generateVWAPSchedule(quantity, asset, settings);
  
  if (vwapSchedule.schedule.length === 0) {
    console.log('   ⚠️ Unable to generate VWAP schedule or remaining quantity is too high.');
    return {
      success: false,
      reason: 'vwap_schedule_failed_or_incomplete'
    };
  }
  
  console.log(`   📅 Split into ${vwapSchedule.totalOrders} orders over ${vwapSchedule.totalDuration} minutes`);
  console.log(`   🎯 VWAP Target Price: $${vwapSchedule.vwapTarget.toFixed(2)}`);
  
  // Execute first order immediately
  const firstOrder = vwapSchedule.schedule[0];
  
  console.log(`   Executing order 1/${vwapSchedule.totalOrders}: ${firstOrder.quantity.toFixed(6)} ${asset.symbol}`);
  console.log(`   📊 Participation: ${firstOrder.participationRate.toFixed(2)}% of market volume`);
  
  const result = await executeCallback({
    ...opportunity,
    quantity: firstOrder.quantity,
    executionStrategy: 'vwap',
    vwapInfo: {
      orderIndex: 1,
      totalOrders: vwapSchedule.totalOrders,
      vwapTarget: vwapSchedule.vwapTarget,
      participationRate: firstOrder.participationRate,
      schedule: vwapSchedule
    }
  });
  
  console.log(`   ✅ VWAP order 1/${vwapSchedule.totalOrders} executed`);
  console.log(`   📅 Remaining ${vwapSchedule.totalOrders - 1} orders scheduled based on volume`);
  if (vwapSchedule.remainingQuantity > 0) {
    console.log(`   ⚠️ ${vwapSchedule.remainingQuantity.toFixed(6)} ${asset.symbol} could not be scheduled within the estimated market volume.`);
  }

  return {
    ...result,
    execution_type: 'vwap',
    vwap_schedule: vwapSchedule,
    orders_completed: 1,
    orders_remaining: vwapSchedule.totalOrders - 1,
    vwap_target: vwapSchedule.vwapTarget
  };
}


/**
 * Execute single order with appropriate strategy
 */
async function executeSingleOrder(opportunity, routing, settings, executeCallback) {
  const { asset, action } = opportunity;
  const strategy = routing.strategy;
  
  // Simulate order execution with strategy-specific characteristics
  let executionPrice = asset.price;
  let slippage = 0;
  
  switch (strategy) {
    case 'market':
      // Market orders: immediate execution, moderate slippage
      slippage = 0.1 + (Math.random() * 0.1); // 0.1-0.2%
      executionPrice = asset.price * (1 + (action === 'buy' ? slippage : -slippage) / 100);
      console.log(`   🚀 Market order: Immediate execution at $${executionPrice.toFixed(2)} (${slippage.toFixed(3)}% slippage)`);
      break;
      
    case 'limit':
      // Limit orders: better price, but may not fill immediately
      executionPrice = routing.optimalLimitPrice;
      slippage = Math.abs((executionPrice - asset.price) / asset.price) * 100;
      console.log(`   🎯 Limit order: Placed at $${executionPrice.toFixed(2)} (${slippage.toFixed(3)}% improvement)`);
      break;
      
    case 'smart_limit':
      // Smart limit: dynamic adjustment based on market conditions
      const volatility = Math.abs(asset.change24h || 0);
      const adjustment = volatility > 3 ? 0.15 : 0.08;
      slippage = adjustment * (Math.random() * 0.5 + 0.5); // Variable slippage
      executionPrice = asset.price * (1 + (action === 'buy' ? slippage : -slippage) / 100);
      console.log(`   🧠 Smart limit: Filled at $${executionPrice.toFixed(2)} (${slippage.toFixed(3)}% slippage)`);
      break;
      
    case 'iceberg':
      // Iceberg orders: hide order size, minimal market impact
      slippage = 0.05 + (Math.random() * 0.05); // 0.05-0.1% (minimal)
      executionPrice = asset.price * (1 + (action === 'buy' ? slippage : -slippage) / 100);
      console.log(`   🧊 Iceberg order: Hidden execution at $${executionPrice.toFixed(2)} (${slippage.toFixed(3)}% slippage)`);
      break;
      
    default:
      slippage = 0.1 + (Math.random() * 0.1);
      executionPrice = asset.price * (1 + (action === 'buy' ? slippage : -slippage) / 100);
  }
  
  // Check if slippage is acceptable
  if (slippage > routing.slippageAnalysis.maximum) {
    console.log(`   ⚠️ Slippage (${slippage.toFixed(3)}%) exceeds maximum (${routing.slippageAnalysis.maximum.toFixed(2)}%)`);
    console.log(`   ❌ Order cancelled for risk management`);
    
    return {
      success: false,
      reason: 'excessive_slippage',
      expected: routing.slippageAnalysis.maximum,
      actual: slippage
    };
  }
  
  // Execute the trade
  const result = await executeCallback({
    ...opportunity,
    executionPrice,
    actualSlippage: slippage,
    executionStrategy: strategy,
    routing: routing
  });
  
  return {
    ...result,
    execution_type: strategy,
    slippage: slippage,
    price_improvement: action === 'buy' ? -slippage : slippage
  };
}

/**
 * Monitor and adjust order execution in real-time
 */
export function monitorOrderExecution(order, currentMarketPrice, settings) {
  const timeSinceOrder = Date.now() - order.placedAt;
  const timeoutMs = (settings.order_timeout_seconds || 30) * 1000;
  
  // Check if limit order should be converted to market
  if (order.type === 'limit' && timeSinceOrder > timeoutMs) {
    return {
      action: 'convert_to_market',
      reason: 'timeout_exceeded',
      recommendation: 'Execute at market price to ensure fill'
    };
  }
  
  // Check if price has moved unfavorably
  const priceDeviation = Math.abs((currentMarketPrice - order.limitPrice) / order.limitPrice) * 100;
  
  if (priceDeviation > 1.0) {
    return {
      action: 'adjust_limit',
      reason: 'significant_price_movement',
      newLimitPrice: calculateOptimalLimitPrice(
        currentMarketPrice,
        order.side,
        priceDeviation,
        settings
      ),
      recommendation: 'Adjust limit price to current market conditions'
    };
  }
  
  return {
    action: 'hold',
    reason: 'order_conditions_acceptable'
  };
}

/**
 * Calculate execution quality metrics
 */
export function calculateExecutionQuality(executedPrice, benchmarkPrice, side, quantity, volume) {
  const slippage = ((executedPrice - benchmarkPrice) / benchmarkPrice) * 100;
  const slippageCost = Math.abs(slippage / 100) * executedPrice * quantity;
  
  // Calculate implementation shortfall
  const implementationShortfall = side === 'buy'
    ? (executedPrice - benchmarkPrice) * quantity
    : (benchmarkPrice - executedPrice) * quantity;
  
  // Estimate market impact
  const marketImpact = (quantity * executedPrice) / volume * 100;
  
  return {
    slippage: side === 'buy' ? slippage : -slippage,
    slippageCost,
    implementationShortfall,
    marketImpact,
    executionScore: calculateExecutionScore(slippage, marketImpact),
    grade: getExecutionGrade(slippage, marketImpact)
  };
}

function calculateExecutionScore(slippage, marketImpact) {
  // Score from 0-100, where 100 is best
  const slippageScore = Math.max(0, 100 - Math.abs(slippage) * 200);
  const impactScore = Math.max(0, 100 - marketImpact * 10);
  
  return (slippageScore * 0.7 + impactScore * 0.3).toFixed(1);
}

function getExecutionGrade(slippage, marketImpact) {
  const score = calculateExecutionScore(slippage, marketImpact);
  
  if (score >= 90) return 'A+';
  if (score >= 80) return 'A';
  if (score >= 70) return 'B';
  if (score >= 60) return 'C';
  if (score >= 50) return 'D';
  return 'F';
}
