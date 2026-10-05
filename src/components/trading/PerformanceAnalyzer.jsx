/**
 * Performance Analyzer Utility
 * Analyzes trading performance and calculates key metrics
 */

/**
 * Calculate comprehensive performance metrics from trade history
 */
export function analyzePerformance(trades, portfolio, autoTradingSettings) {
  if (!trades || trades.length === 0) {
    return {
      hasData: false,
      totalTrades: 0,
      message: "No trades to analyze yet"
    };
  }

  const completedTrades = trades.filter(t => t.status === 'completed');
  
  if (completedTrades.length === 0) {
    return {
      hasData: false,
      totalTrades: 0,
      message: "No completed trades to analyze"
    };
  }

  // Calculate basic metrics
  const totalTrades = completedTrades.length;
  const winningTrades = completedTrades.filter(t => (t.profit_loss || 0) > 0);
  const losingTrades = completedTrades.filter(t => (t.profit_loss || 0) < 0);
  const breakEvenTrades = completedTrades.filter(t => (t.profit_loss || 0) === 0);

  const totalProfit = winningTrades.reduce((sum, t) => sum + (t.profit_loss || 0), 0);
  const totalLoss = Math.abs(losingTrades.reduce((sum, t) => sum + (t.profit_loss || 0), 0));
  const netPnL = totalProfit - totalLoss;

  const winRate = totalTrades > 0 ? (winningTrades.length / totalTrades) * 100 : 0;
  const profitFactor = totalLoss > 0 ? totalProfit / totalLoss : totalProfit > 0 ? 999 : 0;

  const avgWin = winningTrades.length > 0 
    ? totalProfit / winningTrades.length 
    : 0;
  const avgLoss = losingTrades.length > 0 
    ? totalLoss / losingTrades.length 
    : 0;

  // Calculate max drawdown
  let maxDrawdown = 0;
  let peak = portfolio?.total_balance || 10000;
  let runningBalance = 10000; // Initial balance

  completedTrades.forEach(trade => {
    runningBalance += (trade.profit_loss || 0);
    if (runningBalance > peak) {
      peak = runningBalance;
    }
    const drawdown = ((peak - runningBalance) / peak) * 100;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
    }
  });

  // Analyze by asset
  const assetPerformance = {};
  completedTrades.forEach(trade => {
    const asset = trade.asset_symbol;
    if (!assetPerformance[asset]) {
      assetPerformance[asset] = {
        trades: 0,
        wins: 0,
        losses: 0,
        totalPnL: 0,
        avgPnL: 0
      };
    }
    assetPerformance[asset].trades++;
    if ((trade.profit_loss || 0) > 0) assetPerformance[asset].wins++;
    if ((trade.profit_loss || 0) < 0) assetPerformance[asset].losses++;
    assetPerformance[asset].totalPnL += (trade.profit_loss || 0);
  });

  // Calculate avg PnL for each asset
  Object.keys(assetPerformance).forEach(asset => {
    assetPerformance[asset].avgPnL = 
      assetPerformance[asset].totalPnL / assetPerformance[asset].trades;
    assetPerformance[asset].winRate = 
      (assetPerformance[asset].wins / assetPerformance[asset].trades) * 100;
  });

  // Analyze by trade type
  const buyTrades = completedTrades.filter(t => t.trade_type === 'buy');
  const sellTrades = completedTrades.filter(t => t.trade_type === 'sell');

  // Recent performance (last 10 trades)
  const recentTrades = completedTrades.slice(-10);
  const recentWinRate = recentTrades.length > 0
    ? (recentTrades.filter(t => (t.profit_loss || 0) > 0).length / recentTrades.length) * 100
    : 0;
  const recentPnL = recentTrades.reduce((sum, t) => sum + (t.profit_loss || 0), 0);

  // Auto-trading specific metrics
  const autoTrades = completedTrades.filter(t => 
    t.ai_signal || t.exchange === "Paper Trading"
  );
  const autoTradeWinRate = autoTrades.length > 0
    ? (autoTrades.filter(t => (t.profit_loss || 0) > 0).length / autoTrades.length) * 100
    : 0;

  return {
    hasData: true,
    totalTrades,
    winningTrades: winningTrades.length,
    losingTrades: losingTrades.length,
    breakEvenTrades: breakEvenTrades.length,
    winRate: Math.round(winRate * 100) / 100,
    profitFactor: Math.round(profitFactor * 100) / 100,
    netPnL: Math.round(netPnL * 100) / 100,
    totalProfit: Math.round(totalProfit * 100) / 100,
    totalLoss: Math.round(totalLoss * 100) / 100,
    avgWin: Math.round(avgWin * 100) / 100,
    avgLoss: Math.round(avgLoss * 100) / 100,
    maxDrawdown: Math.round(maxDrawdown * 100) / 100,
    assetPerformance,
    buyTrades: buyTrades.length,
    sellTrades: sellTrades.length,
    recentWinRate: Math.round(recentWinRate * 100) / 100,
    recentPnL: Math.round(recentPnL * 100) / 100,
    autoTrades: autoTrades.length,
    autoTradeWinRate: Math.round(autoTradeWinRate * 100) / 100,
    currentSettings: autoTradingSettings
  };
}

/**
 * Identify performance issues and areas for improvement
 */
export function identifyIssues(metrics) {
  const issues = [];

  // Low win rate
  if (metrics.winRate < 50 && metrics.totalTrades >= 10) {
    issues.push({
      type: 'low_win_rate',
      severity: 'high',
      metric: 'Win Rate',
      value: metrics.winRate,
      threshold: 50,
      description: `Your win rate is ${metrics.winRate}%, which is below the healthy 50% threshold`
    });
  }

  // Poor profit factor
  if (metrics.profitFactor < 1.5 && metrics.totalTrades >= 10) {
    issues.push({
      type: 'poor_profit_factor',
      severity: 'high',
      metric: 'Profit Factor',
      value: metrics.profitFactor,
      threshold: 1.5,
      description: `Profit factor of ${metrics.profitFactor} indicates losses are too large relative to wins`
    });
  }

  // High drawdown
  if (metrics.maxDrawdown > 15) {
    issues.push({
      type: 'high_drawdown',
      severity: 'critical',
      metric: 'Max Drawdown',
      value: metrics.maxDrawdown,
      threshold: 15,
      description: `Maximum drawdown of ${metrics.maxDrawdown}% is concerning - better risk management needed`
    });
  }

  // Negative net P&L
  if (metrics.netPnL < 0) {
    issues.push({
      type: 'negative_pnl',
      severity: 'critical',
      metric: 'Net P&L',
      value: metrics.netPnL,
      threshold: 0,
      description: `Overall negative P&L of $${metrics.netPnL} - strategy needs adjustment`
    });
  }

  // Recent performance decline
  if (metrics.recentWinRate < metrics.winRate - 15 && metrics.totalTrades >= 20) {
    issues.push({
      type: 'recent_decline',
      severity: 'medium',
      metric: 'Recent Performance',
      value: metrics.recentWinRate,
      threshold: metrics.winRate,
      description: `Recent win rate (${metrics.recentWinRate}%) is significantly lower than overall average`
    });
  }

  // Avg loss too large relative to avg win
  if (metrics.avgLoss > metrics.avgWin * 1.5) {
    issues.push({
      type: 'poor_risk_reward',
      severity: 'medium',
      metric: 'Risk/Reward Ratio',
      value: metrics.avgLoss / metrics.avgWin,
      threshold: 1.5,
      description: `Average loss ($${metrics.avgLoss}) is too large compared to average win ($${metrics.avgWin})`
    });
  }

  return issues;
}

/**
 * Identify best and worst performing assets
 */
export function analyzeAssetPerformance(metrics) {
  const assets = Object.entries(metrics.assetPerformance).map(([symbol, perf]) => ({
    symbol,
    ...perf
  }));

  // Sort by total P&L
  const sorted = assets.sort((a, b) => b.totalPnL - a.totalPnL);

  return {
    bestPerformers: sorted.slice(0, 3).filter(a => a.totalPnL > 0),
    worstPerformers: sorted.slice(-3).reverse().filter(a => a.totalPnL < 0),
    allAssets: sorted
  };
}

/**
 * Generate recommended parameter adjustments
 */
export function generateParameterRecommendations(metrics, issues, currentSettings) {
  const recommendations = [];

  // Stop loss recommendations
  if (issues.some(i => i.type === 'poor_risk_reward' || i.type === 'high_drawdown')) {
    const currentStopLoss = currentSettings?.stop_loss_percent || 3;
    const suggestedStopLoss = Math.max(2, currentStopLoss - 0.5);
    
    recommendations.push({
      parameter: 'stop_loss_percent',
      current_value: currentStopLoss,
      suggested_value: suggestedStopLoss,
      reason: 'Tighten stop loss to reduce average loss size and drawdown',
      expected_improvement: `Could reduce average loss by ${((currentStopLoss - suggestedStopLoss) / currentStopLoss * 100).toFixed(0)}%`
    });
  }

  // Confidence threshold
  if (issues.some(i => i.type === 'low_win_rate')) {
    const currentConfidence = currentSettings?.min_confidence || 70;
    const suggestedConfidence = Math.min(85, currentConfidence + 5);
    
    recommendations.push({
      parameter: 'min_confidence',
      current_value: currentConfidence,
      suggested_value: suggestedConfidence,
      reason: 'Increase confidence threshold to take only higher-quality signals',
      expected_improvement: `Win rate could improve by 5-10% with more selective trades`
    });
  }

  // Position size
  if (issues.some(i => i.type === 'high_drawdown' || i.type === 'negative_pnl')) {
    const currentPositionSize = currentSettings?.max_position_size_percent || 10;
    const suggestedPositionSize = Math.max(5, currentPositionSize - 2);
    
    recommendations.push({
      parameter: 'max_position_size_percent',
      current_value: currentPositionSize,
      suggested_value: suggestedPositionSize,
      reason: 'Reduce position size to lower risk exposure per trade',
      expected_improvement: `Drawdown could be reduced by ${((currentPositionSize - suggestedPositionSize) / currentPositionSize * 100).toFixed(0)}%`
    });
  }

  // Take profit
  if (metrics.profitFactor > 2 && metrics.avgWin < metrics.avgLoss) {
    const currentTakeProfit = currentSettings?.take_profit_percent || 8;
    const suggestedTakeProfit = currentTakeProfit + 2;
    
    recommendations.push({
      parameter: 'take_profit_percent',
      current_value: currentTakeProfit,
      suggested_value: suggestedTakeProfit,
      reason: 'Increase take profit target to let winners run longer',
      expected_improvement: `Average win could increase by 15-20%`
    });
  }

  // Trailing stop recommendation
  if (!currentSettings?.use_trailing_stop && metrics.winRate > 55) {
    recommendations.push({
      parameter: 'use_trailing_stop',
      current_value: 0,
      suggested_value: 1,
      reason: 'Enable trailing stop to lock in profits during strong trends',
      expected_improvement: `Could capture 20-30% more profit from winning trades`
    });
  }

  // Risk level filtering
  if (issues.some(i => i.type === 'high_drawdown')) {
    recommendations.push({
      parameter: 'allowed_risk_levels',
      current_value: currentSettings?.allowed_risk_levels?.length || 2,
      suggested_value: 1,
      reason: 'Trade only low-risk opportunities to reduce volatility',
      expected_improvement: `Drawdown could be reduced by 30-40%`
    });
  }

  return recommendations;
}

/**
 * Enhance recommendations based on user preferences
 */
export function enhanceRecommendationsWithPreferences(
  baseRecommendations,
  metrics,
  preferences
) {
  if (!preferences) return baseRecommendations;

  const enhanced = [...baseRecommendations];

  // Adjust based on trading style
  if (preferences.trading_style === 'conservative') {
    // Suggest more conservative parameters
    const conservativeRec = {
      parameter: 'max_position_size_percent',
      current_value: metrics.avgPositionSize || 10,
      suggested_value: Math.min(metrics.avgPositionSize || 10, 5),
      reason: 'Your conservative trading style suggests smaller position sizes for better risk management',
      expected_improvement: 'Reduced risk exposure and more stable returns'
    };
    if (conservativeRec.suggested_value < conservativeRec.current_value) {
      enhanced.push(conservativeRec);
    }
  }

  if (preferences.trading_style === 'aggressive') {
    // Suggest more aggressive parameters if performance is good
    if (metrics.winRate >= 60 && metrics.profitFactor > 1.5) {
      enhanced.push({
        parameter: 'max_position_size_percent',
        current_value: metrics.avgPositionSize || 10,
        suggested_value: Math.min((metrics.avgPositionSize || 10) * 1.5, 20),
        reason: 'Your aggressive style and strong performance support larger position sizes',
        expected_improvement: 'Accelerated profit growth while managing risk'
      });
    }
  }

  // Adjust based on risk tolerance
  if (preferences.risk_tolerance === 'very_low' || preferences.risk_tolerance === 'low') {
    enhanced.push({
      parameter: 'stop_loss_percent',
      current_value: 3,
      suggested_value: 2,
      reason: 'Your low risk tolerance suggests tighter stop losses',
      expected_improvement: 'Better capital preservation'
    });
  }

  if (preferences.risk_tolerance === 'high' || preferences.risk_tolerance === 'very_high') {
    // Enable advanced features for high risk tolerance
    if (metrics.winRate >= 55) {
      enhanced.push({
        parameter: 'use_trailing_stop',
        current_value: 0,
        suggested_value: 1,
        reason: 'Your high risk tolerance and performance support trailing stops to maximize gains',
        expected_improvement: 'Capture larger profits on winning trades'
      });
    }
  }

  // Recommendations based on preferred assets
  if (preferences.preferred_assets && preferences.preferred_assets.length > 0) {
    // This would be used in asset recommendations section
    // The AI will prioritize these assets
  }

  // Adjust based on goals
  if (preferences.goals) {
    if (preferences.goals.capital_preservation) {
      enhanced.push({
        parameter: 'max_daily_loss_percent',
        current_value: 5,
        suggested_value: 3,
        reason: 'Capital preservation goal suggests stricter daily loss limits',
        expected_improvement: 'Better protection of capital'
      });
    }

    if (preferences.goals.target_monthly_return && preferences.goals.target_monthly_return > 10) {
      enhanced.push({
        parameter: 'min_confidence',
        current_value: 70,
        suggested_value: 65,
        reason: 'Higher return target requires taking more opportunities',
        expected_improvement: 'More trades to reach target returns'
      });
    }
  }

  // Remove duplicates
  const uniqueEnhanced = enhanced.filter((rec, index, self) =>
    index === self.findIndex((r) => r.parameter === rec.parameter)
  );

  return uniqueEnhanced;
}

/**
 * Filter assets based on user preferences
 */
export function filterAssetsByPreferences(assets, preferences) {
  if (!preferences) return assets;

  let filtered = [...assets];

  // Filter by preferred assets
  if (preferences.preferred_assets && preferences.preferred_assets.length > 0) {
    const preferred = filtered.filter(a => 
      preferences.preferred_assets.includes(a.symbol)
    );
    const others = filtered.filter(a => 
      !preferences.preferred_assets.includes(a.symbol)
    );
    // Prioritize preferred assets but include others
    filtered = [...preferred, ...others];
  }

  // Exclude unwanted assets
  if (preferences.excluded_assets && preferences.excluded_assets.length > 0) {
    filtered = filtered.filter(a => 
      !preferences.excluded_assets.includes(a.symbol)
    );
  }

  // Market-cap and volatility filters are intentionally not applied here:
  // trade-derived asset rows carry no marketCap/change24h, so those filters
  // would drop every asset. Preferred/excluded lists are the meaningful ones.

  return filtered;
}

/**
 * Generate personalized AI prompt based on preferences
 */
export function generatePersonalizedPrompt(metrics, issues, assetAnalysis, preferences) {
  let styleContext = '';
  
  if (preferences?.trading_style) {
    const styleDescriptions = {
      conservative: 'The user is a conservative trader who prioritizes capital preservation and steady growth over aggressive returns.',
      balanced: 'The user prefers a balanced approach, mixing growth opportunities with risk management.',
      aggressive: 'The user is an aggressive trader seeking high growth potential and willing to accept higher risk.',
      day_trader: 'The user is a day trader who prefers quick in-and-out trades and short holding periods.',
      swing_trader: 'The user is a swing trader who holds positions for multiple days to capture larger price movements.'
    };
    styleContext = styleDescriptions[preferences.trading_style] || '';
  }

  let riskContext = '';
  if (preferences?.risk_tolerance) {
    riskContext = `Risk tolerance: ${preferences.risk_tolerance.replace('_', ' ')}. `;
  }

  let goalsContext = '';
  if (preferences?.goals) {
    if (preferences.goals.target_monthly_return) {
      goalsContext += `Target monthly return: ${preferences.goals.target_monthly_return}%. `;
    }
    if (preferences.goals.capital_preservation) {
      goalsContext += 'Capital preservation is a priority. ';
    }
  }

  let assetContext = '';
  if (preferences?.preferred_assets && preferences.preferred_assets.length > 0) {
    assetContext = `Preferred assets: ${preferences.preferred_assets.join(', ')}. `;
  }
  if (preferences?.excluded_assets && preferences.excluded_assets.length > 0) {
    assetContext += `Avoid: ${preferences.excluded_assets.join(', ')}. `;
  }

  let analysisContext = '';
  if (preferences?.use_technical_analysis !== false) {
    analysisContext = `Analysis methods to emphasize: technical analysis (real-data-only engine; sentiment and on-chain data are not used). `;
  }

  return `
${styleContext}
${riskContext}
${goalsContext}
${assetContext}
${analysisContext}

Given these preferences, provide tailored recommendations that align with the user's trading style, risk tolerance, and goals.
`;
}