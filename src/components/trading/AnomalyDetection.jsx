/**
 * Advanced Anomaly Detection System
 * Detects unusual market behavior and potential manipulation
 */

/**
 * Detect volume anomalies
 */
export const detectVolumeAnomaly = (asset, historicalVolumes = []) => {
  const currentVolume = asset.volume24h;
  
  // Calculate average and standard deviation
  const avgVolume = historicalVolumes.length > 0
    ? historicalVolumes.reduce((sum, v) => sum + v, 0) / historicalVolumes.length
    : 1500000000; // Default average
  
  const stdDev = historicalVolumes.length > 0
    ? Math.sqrt(historicalVolumes.reduce((sum, v) => sum + Math.pow(v - avgVolume, 2), 0) / historicalVolumes.length)
    : avgVolume * 0.3;
  
  // Z-score calculation
  const zScore = (currentVolume - avgVolume) / stdDev;
  
  const isAnomaly = Math.abs(zScore) > 2.5; // 2.5 sigma threshold
  
  return {
    detected: isAnomaly,
    type: 'volume_spike',
    severity: Math.abs(zScore) > 3 ? 'high' : Math.abs(zScore) > 2.5 ? 'medium' : 'low',
    z_score: zScore,
    current_volume: currentVolume,
    avg_volume: avgVolume,
    change_percent: ((currentVolume - avgVolume) / avgVolume) * 100,
    description: zScore > 2.5 
      ? `Unusual volume spike detected: ${((currentVolume - avgVolume) / avgVolume * 100).toFixed(0)}% above average`
      : zScore < -2.5
      ? `Abnormally low volume: ${Math.abs((currentVolume - avgVolume) / avgVolume * 100).toFixed(0)}% below average`
      : 'Normal volume'
  };
};

/**
 * Detect price manipulation patterns
 */
export const detectPriceManipulation = (asset, priceHistory = []) => {
  const anomalies = [];
  
  // Pump and dump detection
  if (asset.change24h > 15) {
    // Check if volume is disproportionately high
    const volumeToMarketCapRatio = asset.volume24h / asset.marketCap;
    if (volumeToMarketCapRatio > 0.5) {
      anomalies.push({
        type: 'pump_dump',
        pattern: 'pump',
        severity: 'high',
        confidence: 75,
        description: `Potential pump detected: ${asset.change24h.toFixed(2)}% price increase with abnormally high volume`,
        indicators: {
          price_change: asset.change24h,
          volume_ratio: volumeToMarketCapRatio
        }
      });
    }
  }
  
  // Flash crash detection
  if (asset.change24h < -10) {
    anomalies.push({
      type: 'flash_crash',
      severity: asset.change24h < -20 ? 'high' : 'medium',
      confidence: 70,
      description: `Rapid price decline: ${Math.abs(asset.change24h).toFixed(2)}% drop in 24h`,
      indicators: {
        price_change: asset.change24h
      }
    });
  }
  
  // Wash trading detection (simplified)
  const avgVolume = 1500000000;
  if (asset.volume24h > avgVolume * 3 && Math.abs(asset.change24h) < 1) {
    anomalies.push({
      type: 'wash_trading',
      severity: 'medium',
      confidence: 60,
      description: 'High volume with minimal price movement suggests potential wash trading',
      indicators: {
        volume: asset.volume24h,
        price_change: asset.change24h
      }
    });
  }
  
  return {
    detected: anomalies.length > 0,
    anomalies,
    risk_level: anomalies.some(a => a.severity === 'high') ? 'high' : 
                anomalies.some(a => a.severity === 'medium') ? 'medium' : 'low'
  };
};

/**
 * Detect whale activity
 */
export const detectWhaleActivity = (asset, onChainData) => {
  // Simulate whale detection based on volume and price action
  const largeTransactionThreshold = 1000000; // $1M+
  
  // Estimate number of large transactions based on volume
  const estimatedLargeTxs = Math.floor((asset.volume24h / 100000000) * (Math.random() * 5 + 1));
  
  // Whale accumulation signals
  const isAccumulating = asset.change24h > 0 && asset.change24h < 3 && asset.volume24h > 1500000000;
  const isDistributing = asset.change24h < 0 && asset.change24h > -3 && asset.volume24h > 2000000000;
  
  if (estimatedLargeTxs > 10 || isAccumulating || isDistributing) {
    return {
      detected: true,
      activity_type: isAccumulating ? 'accumulation' : isDistributing ? 'distribution' : 'mixed',
      large_transactions: estimatedLargeTxs,
      confidence: Math.min(85, 60 + (estimatedLargeTxs * 2)),
      description: isAccumulating 
        ? 'Whale accumulation detected: Large wallets buying on dips'
        : isDistributing
        ? 'Whale distribution detected: Large wallets selling into strength'
        : 'Mixed whale activity: Multiple large transactions detected',
      implications: isAccumulating 
        ? 'Bullish signal - institutional interest'
        : isDistributing
        ? 'Bearish signal - profit taking by large holders'
        : 'Monitor closely for directional clarity'
    };
  }
  
  return {
    detected: false,
    activity_type: 'normal',
    description: 'No unusual whale activity detected'
  };
};

/**
 * Statistical anomaly detection using multiple methods
 */
export const detectStatisticalAnomalies = (asset, historicalData = []) => {
  const anomalies = [];
  
  // Moving average deviation
  const ma20 = historicalData.length >= 20
    ? historicalData.slice(-20).reduce((sum, v) => sum + v.price, 0) / 20
    : asset.price;
  
  const maDeviation = ((asset.price - ma20) / ma20) * 100;
  
  if (Math.abs(maDeviation) > 10) {
    anomalies.push({
      method: 'moving_average',
      type: maDeviation > 0 ? 'breakout_above' : 'breakdown_below',
      severity: Math.abs(maDeviation) > 20 ? 'high' : 'medium',
      value: maDeviation,
      description: `Price ${Math.abs(maDeviation).toFixed(1)}% ${maDeviation > 0 ? 'above' : 'below'} 20-period MA`
    });
  }
  
  // Bollinger Bands simulation
  const volatility = Math.abs(asset.change24h || 0);
  const upperBand = asset.price * (1 + (volatility / 100) * 2);
  const lowerBand = asset.price * (1 - (volatility / 100) * 2);
  
  // Price action anomalies
  if (asset.change24h > 0 && asset.change24h > volatility * 2) {
    anomalies.push({
      method: 'price_action',
      type: 'unusual_momentum',
      severity: 'medium',
      description: 'Price movement exceeds typical volatility range'
    });
  }
  
  return {
    detected: anomalies.length > 0,
    anomalies,
    statistical_summary: {
      ma_deviation: maDeviation,
      volatility: volatility,
      z_score: maDeviation / (volatility || 1)
    }
  };
};

/**
 * Comprehensive anomaly analysis
 */
export const detectAnomalies = (asset, allAssets, config) => {
  const results = {
    asset: asset.symbol,
    timestamp: Date.now(),
    anomalies_detected: [],
    overall_risk: 'normal',
    confidence: 0
  };
  
  // Volume anomalies
  if (config?.anomaly_types?.includes('volume_spike')) {
    const volumeAnomaly = detectVolumeAnomaly(asset);
    if (volumeAnomaly.detected) {
      results.anomalies_detected.push(volumeAnomaly);
    }
  }
  
  // Price manipulation
  if (config?.anomaly_types?.includes('pump_dump') || config?.anomaly_types?.includes('price_manipulation')) {
    const manipulation = detectPriceManipulation(asset);
    if (manipulation.detected) {
      results.anomalies_detected.push(...manipulation.anomalies);
    }
  }
  
  // Whale activity
  if (config?.anomaly_types?.includes('whale_activity')) {
    const whaleActivity = detectWhaleActivity(asset);
    if (whaleActivity.detected) {
      results.anomalies_detected.push(whaleActivity);
    }
  }
  
  // Statistical anomalies
  const statistical = detectStatisticalAnomalies(asset);
  if (statistical.detected) {
    results.anomalies_detected.push(...statistical.anomalies);
  }
  
  // Determine overall risk and confidence
  if (results.anomalies_detected.length > 0) {
    const severities = results.anomalies_detected.map(a => a.severity || 'medium');
    results.overall_risk = severities.includes('high') ? 'high' : severities.includes('medium') ? 'medium' : 'low';
    
    // Calculate average confidence
    const confidences = results.anomalies_detected
      .filter(a => a.confidence)
      .map(a => a.confidence);
    results.confidence = confidences.length > 0
      ? confidences.reduce((sum, c) => sum + c, 0) / confidences.length
      : 70;
  }
  
  return results;
};

/**
 * Correlation anomaly detection (market-wide)
 */
export const detectCorrelationAnomalies = (assets) => {
  // Detect when an asset moves contrary to market
  const marketChange = assets.reduce((sum, a) => sum + (a.change24h || 0), 0) / assets.length;
  
  const anomalies = assets.filter(asset => {
    const deviation = Math.abs((asset.change24h || 0) - marketChange);
    return deviation > 10; // 10% deviation from market average
  }).map(asset => ({
    asset: asset.symbol,
    type: 'correlation_break',
    market_change: marketChange,
    asset_change: asset.change24h,
    deviation: Math.abs((asset.change24h || 0) - marketChange),
    description: `${asset.symbol} moving independently from market (${asset.change24h > marketChange ? 'outperforming' : 'underperforming'})`
  }));
  
  return {
    detected: anomalies.length > 0,
    anomalies,
    market_correlation: 1 - (anomalies.length / assets.length)
  };
};