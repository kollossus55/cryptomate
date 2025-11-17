/**
 * Predictive AI Models for Short-term Price Movements
 * Simulates LSTM, Transformer, and Ensemble models
 */


/**
 * LSTM-based price prediction
 * Long Short-Term Memory networks for time series forecasting
 */
export const predictWithLSTM = (asset, historicalData, horizon = '24h') => {
  // Simulate LSTM prediction based on recent trends
  const recentTrend = asset.change24h || 0;
  const volatility = Math.abs(recentTrend);
  
  // LSTM captures non-linear patterns
  const trendMomentum = recentTrend * 0.7; // Momentum continuation
  const meanReversion = -recentTrend * 0.2; // Mean reversion component
  const randomWalk = (Math.random() - 0.5) * volatility * 0.3;
  
  const prediction = trendMomentum + meanReversion + randomWalk;
  
  // Confidence based on data quality and volatility
  const confidence = Math.max(50, Math.min(90, 75 - (volatility * 2)));
  
  return {
    model: 'LSTM',
    predicted_change: prediction,
    predicted_price: asset.price * (1 + prediction / 100),
    confidence: confidence,
    horizon: horizon,
    signals: {
      direction: prediction > 0.5 ? 'bullish' : prediction < -0.5 ? 'bearish' : 'neutral',
      strength: Math.abs(prediction) > 2 ? 'strong' : Math.abs(prediction) > 1 ? 'moderate' : 'weak'
    }
  };
};

/**
 * Transformer-based prediction
 * Attention mechanism for better context understanding
 */
export const predictWithTransformer = (asset, marketContext, horizon = '24h') => {
  // Transformers excel at understanding market context
  const priceChange = asset.change24h || 0;
  const volumeChange = asset.volume24h > 1500000000 ? 1 : -1;
  
  // Attention to market-wide movements
  const marketSentiment = marketContext?.sentiment || 0;
  
  // Transformer weighs multiple factors with attention
  const priceFactor = priceChange * 0.4;
  const volumeFactor = volumeChange * 0.3;
  const sentimentFactor = marketSentiment * 0.3;
  
  const prediction = priceFactor + volumeFactor + sentimentFactor;
  
  // Higher confidence due to multi-factor attention
  const confidence = Math.max(60, Math.min(95, 80 - (Math.abs(priceChange) * 1.5)));
  
  return {
    model: 'Transformer',
    predicted_change: prediction,
    predicted_price: asset.price * (1 + prediction / 100),
    confidence: confidence,
    horizon: horizon,
    attention_weights: {
      price: 0.4,
      volume: 0.3,
      sentiment: 0.3
    },
    signals: {
      direction: prediction > 0.5 ? 'bullish' : prediction < -0.5 ? 'bearish' : 'neutral',
      strength: Math.abs(prediction) > 3 ? 'strong' : Math.abs(prediction) > 1.5 ? 'moderate' : 'weak'
    }
  };
};

/**
 * Ensemble model combining multiple predictions
 */
export const predictWithEnsemble = async (asset, marketData, config) => {
  const horizon = config?.prediction_horizon || '24h';
  
  // Get predictions from multiple models
  const lstmPrediction = predictWithLSTM(asset, marketData?.historical, horizon);
  const transformerPrediction = predictWithTransformer(asset, marketData?.context, horizon);
  
  // Simple ensemble: weighted average
  const weights = {
    lstm: 0.4,
    transformer: 0.6 // Transformers typically perform better with context
  };
  
  const ensemblePrediction = 
    (lstmPrediction.predicted_change * weights.lstm) +
    (transformerPrediction.predicted_change * weights.transformer);
  
  const ensembleConfidence = 
    (lstmPrediction.confidence * weights.lstm) +
    (transformerPrediction.confidence * weights.transformer);
  
  return {
    model: 'Ensemble',
    predicted_change: ensemblePrediction,
    predicted_price: asset.price * (1 + ensemblePrediction / 100),
    confidence: ensembleConfidence,
    horizon: horizon,
    component_predictions: {
      lstm: lstmPrediction,
      transformer: transformerPrediction
    },
    signals: {
      direction: ensemblePrediction > 0.5 ? 'bullish' : ensemblePrediction < -0.5 ? 'bearish' : 'neutral',
      strength: Math.abs(ensemblePrediction) > 2.5 ? 'strong' : Math.abs(ensemblePrediction) > 1 ? 'moderate' : 'weak',
      agreement: Math.sign(lstmPrediction.predicted_change) === Math.sign(transformerPrediction.predicted_change) ? 'high' : 'low'
    }
  };
};

/**
 * Market regime detection
 * Identifies current market conditions (bull, bear, sideways)
 */
export const detectMarketRegime = (assets) => {
  if (!assets || assets.length === 0) return { regime: 'unknown', confidence: 0 };
  
  // Analyze overall market movement
  const avgChange = assets.reduce((sum, a) => sum + (a.change24h || 0), 0) / assets.length;
  const positiveAssets = assets.filter(a => (a.change24h || 0) > 0).length;
  const positivePercent = (positiveAssets / assets.length) * 100;
  
  // Calculate volatility
  const changes = assets.map(a => Math.abs(a.change24h || 0));
  const avgVolatility = changes.reduce((sum, v) => sum + v, 0) / changes.length;
  
  let regime = 'sideways';
  let confidence = 50;
  
  if (avgChange > 2 && positivePercent > 60) {
    regime = 'bull';
    confidence = Math.min(90, 60 + (avgChange * 5));
  } else if (avgChange < -2 && positivePercent < 40) {
    regime = 'bear';
    confidence = Math.min(90, 60 + (Math.abs(avgChange) * 5));
  } else if (avgVolatility < 2) {
    regime = 'sideways';
    confidence = 70;
  } else {
    regime = 'volatile';
    confidence = Math.min(85, 50 + (avgVolatility * 5));
  }
  
  return {
    regime,
    confidence,
    metrics: {
      avg_change: avgChange,
      positive_percent: positivePercent,
      volatility: avgVolatility
    },
    description: getRegimeDescription(regime)
  };
};

const getRegimeDescription = (regime) => {
  const descriptions = {
    bull: 'Strong uptrend across the market. Favor long positions and momentum strategies.',
    bear: 'Downtrend dominates. Consider short positions or cash preservation.',
    sideways: 'Range-bound market. Focus on mean reversion and support/resistance trading.',
    volatile: 'High volatility with no clear direction. Use tighter stops and smaller positions.',
    unknown: 'Insufficient data to determine market regime.'
  };
  return descriptions[regime] || descriptions.unknown;
};

/**
 * Generate comprehensive predictive signal
 */
export const generatePredictiveSignal = async (asset, allAssets, config) => {
  try {
    // Detect current market regime
    const marketRegime = detectMarketRegime(allAssets);
    
    // Get ensemble prediction
    const marketData = {
      historical: allAssets.map(a => ({ price: a.price, change: a.change24h })),
      context: {
        sentiment: marketRegime.metrics.avg_change / 10, // Normalize to -1 to 1
        regime: marketRegime.regime
      }
    };
    
    const prediction = await predictWithEnsemble(asset, marketData, config);
    
    // Adjust prediction based on market regime
    if (config?.use_market_regime) {
      if (marketRegime.regime === 'bear' && prediction.predicted_change > 0) {
        prediction.confidence *= 0.8; // Reduce confidence for bullish signals in bear market
      } else if (marketRegime.regime === 'bull' && prediction.predicted_change < 0) {
        prediction.confidence *= 0.8; // Reduce confidence for bearish signals in bull market
      }
    }
    
    return {
      ...prediction,
      market_regime: marketRegime,
      timestamp: Date.now()
    };
  } catch (error) {
    console.error('Predictive signal generation failed:', error);
    return null;
  }
};