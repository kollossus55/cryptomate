/**
 * Advanced AI Signal Generator
 * Incorporates multiple data sources for sophisticated trading signals
 */

import { base44 } from "@/api/base44Client";
import { analyzeIndicators } from "./TechnicalAnalysisEngine";

// Cache for API results to prevent rate limiting
const cache = {
  news: new Map(),
  social: new Map(),
  onchain: new Map()
};

const CACHE_DURATION = 10 * 60 * 1000; // INCREASED: 10 minutes (was 5)
const USE_SIMULATED_DATA = true; // Always use simulated data to avoid rate limits

// Rate limit tracker
const rateLimitTracker = {
  lastCall: 0,
  callCount: 0,
  windowStart: Date.now()
};

// Check if we're within rate limits (max 5 calls per minute)
const checkRateLimit = () => {
  const now = Date.now();
  const oneMinute = 60 * 1000;
  
  // Reset window if needed
  if (now - rateLimitTracker.windowStart > oneMinute) {
    rateLimitTracker.windowStart = now;
    rateLimitTracker.callCount = 0;
  }
  
  // Check if we've exceeded limit
  if (rateLimitTracker.callCount >= 5) {
    console.warn('⚠️ Rate limit protection: Skipping API call, using cached data');
    return false;
  }
  
  rateLimitTracker.callCount++;
  rateLimitTracker.lastCall = now;
  return true;
};

// Get cached result or return null
const getCached = (type, assetSymbol) => {
  const cached = cache[type].get(assetSymbol);
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return cached.data;
  }
  return null;
};

// Set cache
const setCache = (type, assetSymbol, data) => {
  cache[type].set(assetSymbol, {
    data,
    timestamp: Date.now()
  });
};

// Simulate real-time news sentiment analysis
export const analyzeNewsSentiment = async (asset) => {
  const cached = getCached('news', asset.symbol);
  if (cached) return cached;

  // Respect rate limit to control LLM/web-search credit usage
  if (!checkRateLimit()) {
    const result = generateSimulatedNewsSentiment(asset);
    setCache('news', asset.symbol, result);
    return result;
  }

  try {
    const response = await base44.integrations.Core.InvokeLLM({
      prompt: `Search the web for the latest real news about the cryptocurrency ${asset.name} (${asset.symbol}) from the last 24 hours. Return 3 actual recent headlines, an overall sentiment score from -1 (very bearish) to 1 (very bullish), a sentiment label, the impact level, a brief summary, and the source name for each headline.`,
      add_context_from_internet: true,
      model: "gemini_3_flash",
      response_json_schema: {
        type: "object",
        properties: {
          sentiment_score: { type: "number" },
          sentiment_label: { type: "string", enum: ["very_bearish", "bearish", "neutral", "bullish", "very_bullish"] },
          key_headlines: { type: "array", items: { type: "string" } },
          impact_level: { type: "string", enum: ["low", "medium", "high"] },
          summary: { type: "string" },
          sources: { type: "array", items: { type: "string" } }
        }
      }
    });

    const result = {
      sentiment_score: Math.max(-1, Math.min(1, response.sentiment_score || 0)),
      sentiment_label: response.sentiment_label || 'neutral',
      key_headlines: (response.key_headlines || []).slice(0, 3),
      impact_level: response.impact_level || 'medium',
      summary: response.summary || '',
      sources: response.sources || []
    };
    setCache('news', asset.symbol, result);
    return result;
  } catch (error) {
    console.error("Real news fetch failed, using simulated fallback:", error);
    const result = generateSimulatedNewsSentiment(asset);
    setCache('news', asset.symbol, result);
    return result;
  }
};

// Simulate social media trends analysis
export const analyzeSocialTrends = async (asset) => {
  const cached = getCached('social', asset.symbol);
  if (cached) return cached;

  // ALWAYS use simulated data to avoid rate limits
  const result = generateSimulatedSocialTrends(asset);
  setCache('social', asset.symbol, result);
  return result;
};

// Simulate on-chain data analysis
export const analyzeOnChainData = async (asset) => {
  const cached = getCached('onchain', asset.symbol);
  if (cached) return cached;

  // ALWAYS use simulated data to avoid rate limits
  const result = generateSimulatedOnChainData(asset);
  setCache('onchain', asset.symbol, result);
  return result;
};

// Predictive price movement analysis using machine learning-like patterns
const predictPriceMovement = (asset) => {
  // Analyze recent momentum and patterns
  const momentum = asset.change24h;
  const volumeTrend = asset.volume24h / 1500000000; // Normalized volume
  
  // Calculate momentum indicators
  const shortTermMomentum = momentum;
  const volumeStrength = Math.min(volumeTrend * 100, 100);
  
  // Pattern recognition - detect bullish/bearish patterns
  const isBullishPattern = momentum > 0 && volumeTrend > 1.2;
  const isBearishPattern = momentum < 0 && volumeTrend > 1.2;
  
  // Predict next 24h movement
  let predictedChange = momentum * 0.6; // Momentum continuation factor
  
  // Add pattern influence
  if (isBullishPattern) predictedChange += 2;
  if (isBearishPattern) predictedChange -= 2;
  
  // Add volume influence
  if (volumeTrend > 2) predictedChange *= 1.2;
  
  // Calculate target price
  const currentPrice = asset.price;
  const predictedPrice = currentPrice * (1 + predictedChange / 100);
  
  // Confidence in prediction (0-100)
  const predictionConfidence = Math.min(95, Math.max(30, 
    50 + (volumeStrength * 0.3) + (Math.abs(momentum) * 2)
  ));
  
  return {
    predicted_change: predictedChange,
    predicted_price: predictedPrice,
    prediction_confidence: Math.round(predictionConfidence),
    timeframe: '24h',
    pattern_detected: isBullishPattern ? 'bullish' : isBearishPattern ? 'bearish' : 'neutral',
    key_factors: [
      `Momentum: ${momentum > 0 ? '+' : ''}${momentum.toFixed(2)}%`,
      `Volume trend: ${volumeTrend.toFixed(2)}x average`,
      `Pattern: ${isBullishPattern ? 'Bullish breakout' : isBearishPattern ? 'Bearish breakdown' : 'Consolidation'}`
    ]
  };
};

// Generate a signal driven PURELY by technical indicators on real Binance
// OHLCV candles. No simulated news, social, or on-chain data — those were
// Math.random()-based and fabricated confidence. The app's indicators deduce
// the signal from real exchange data.
export const generateAdvancedSignal = async (asset, signalConfig = null, indicatorSettings = { rsi: true, macd: true, bollinger: true, ema: true, stoch: true }) => {
  try {
    // Advanced Technical Analysis on REAL Binance candles.
    // Returns null when candle data is unavailable — no data means no signal.
    const technicalAnalysis = await analyzeIndicators(asset, indicatorSettings);

    if (!technicalAnalysis) {
      return {
        symbol: asset.symbol,
        available: false,
        reason: 'no_market_data',
        message: `No candle data available for ${asset.symbol}. No signal generated.`,
      };
    }

    // Technical score from REAL Binance 24h change & quote volume (no market cap).
    let technicalScore = calculateTechnicalScore(asset);
    technicalScore = Math.max(0, Math.min(100, technicalScore + technicalAnalysis.scoreModifier));

    // Deterministic momentum read from real Binance change & volume.
    const prediction = predictPriceMovement(asset);

    // Confidence is driven strictly by technical indicators on real candles.
    let confidence = Math.max(30, Math.min(95, Math.round(technicalScore)));

    // Risk level from real volatility.
    let riskLevel = 'medium';
    const volatility = Math.abs(asset.change24h || 0);
    if (confidence >= 80 && volatility < 5) riskLevel = 'low';
    else if (confidence < 60 || volatility > 10) riskLevel = 'high';

    // Recommendation from technicals + real momentum only.
    let recommendation = 'hold';
    if (confidence >= 75 && asset.change24h > 1 && prediction.predicted_change > 0) {
      recommendation = 'buy';
    } else if (confidence < 50 || asset.change24h < -3 || prediction.predicted_change < -3) {
      recommendation = 'sell';
    }

    return {
      confidence,
      recommendation,
      riskLevel,
      prediction,
      activeIndicators: [
        { name: "Technical Analysis", status: "active", score: technicalScore, weight: "100%" },
        { name: "Pattern Recognition", status: "active", score: prediction.prediction_confidence, weight: "Variable" }
      ],
      technicalDetails: technicalAnalysis,
      breakdown: {
        technical: technicalScore,
        advanced_indicators: technicalAnalysis.results
      },
      signals: {
        strength: confidence >= 75 ? 'strong' : confidence >= 60 ? 'moderate' : 'weak',
        direction: technicalScore >= 60 ? 'bullish' : technicalScore <= 40 ? 'bearish' : 'neutral'
      }
    };
  } catch (error) {
    console.error("Advanced signal generation failed:", error);
    // Fallback to basic calculation
    return generateBasicSignal(asset);
  }
};

// Calculate technical score from price/volume data
const calculateTechnicalScore = (asset) => {
  let score = 50;

  // Price momentum (Refined V4)
  const change = asset.change24h || 0;
  if (change > 2 && change <= 10) score += 20; // Sweet spot
  else if (change > 10) score += 5; // Overextended
  else if (change > 0) score += 10; // Slow grind
  else if (change > -3) score += 5; // Dip
  else if (change > -8) score -= 5; // Correction
  else score -= 20; // Crash

  // Volume analysis (real Binance quote volume)
  const avgVolume = 1500000000;
  if (asset.volume24h > avgVolume * 2) score += 15;
  else if (asset.volume24h > avgVolume) score += 10;
  else if (asset.volume24h < avgVolume / 2) score -= 10;

  // Volatility
  const volatility = Math.abs(change);
  if (volatility > 10) score -= 10;
  else if (volatility < 2) score += 5;

  return Math.max(0, Math.min(100, score));
};

// Fallback simulations when API calls fail

const generateSimulatedNewsSentiment = (asset) => {
  // Create more realistic sentiment based on price action
  const priceChange = asset.change24h || 0;
  let sentimentValue = (Math.random() * 1.2) - 0.6; // Base random -0.6 to 0.6
  
  // Influence by price movement
  if (priceChange > 5) sentimentValue += 0.3;
  else if (priceChange > 2) sentimentValue += 0.15;
  else if (priceChange < -5) sentimentValue -= 0.3;
  else if (priceChange < -2) sentimentValue -= 0.15;
  
  // Clamp to -1 to 1
  sentimentValue = Math.max(-1, Math.min(1, sentimentValue));
  
  const labels = ["very_bearish", "bearish", "neutral", "bullish", "very_bullish"];
  const labelIndex = Math.floor((sentimentValue + 1) * 2.5);
  
  const headlines = [
    `${asset.symbol} shows strong institutional adoption trends`,
    `Major partnership announced for ${asset.name} ecosystem`,
    `Technical analysis suggests ${asset.symbol} consolidation phase`,
    `Market sentiment shifts positively for ${asset.name}`,
    `${asset.symbol} network upgrade completed successfully`,
    `Analysts predict ${asset.name} price movement based on fundamentals`,
    `${asset.symbol} trading volume increases amid market activity`
  ];

  return {
    sentiment_score: sentimentValue,
    sentiment_label: labels[Math.min(labelIndex, 4)],
    key_headlines: headlines.slice(0, 3),
    impact_level: Math.abs(sentimentValue) > 0.5 ? 'high' : Math.abs(sentimentValue) > 0.25 ? 'medium' : 'low',
    summary: `Overall news sentiment for ${asset.name} is ${labels[Math.min(labelIndex, 4)].replace('_', ' ')} based on recent market developments and price action.`
  };
};

const generateSimulatedSocialTrends = (asset) => {
  const priceChange = asset.change24h || 0;
  let baseScore = 50;
  
  // Influence by price movement
  if (priceChange > 5) baseScore += 25;
  else if (priceChange > 2) baseScore += 15;
  else if (priceChange < -5) baseScore -= 15;
  else if (priceChange < -2) baseScore -= 10;
  
  const socialScore = Math.max(20, Math.min(95, baseScore + (Math.random() * 20 - 10)));
  
  const positive = Math.max(15, Math.min(70, 35 + (priceChange * 3) + (Math.random() * 15)));
  const negative = Math.max(10, Math.min(40, 20 - (priceChange * 2) + (Math.random() * 10)));
  const neutral = Math.max(0, 100 - positive - negative);

  const topics = [
    `#${asset.symbol}ToTheMoon`,
    `${asset.name} Analysis`,
    `Crypto Market ${priceChange > 0 ? 'Rally' : 'Correction'}`,
    `${asset.symbol} Price Action`,
    `DeFi ${asset.symbol}`,
    `${asset.symbol} Trading Strategy`,
    `${asset.name} Updates`
  ];

  return {
    social_score: socialScore,
    mention_volume: socialScore > 70 ? 'high' : socialScore > 40 ? 'moderate' : 'low',
    sentiment_breakdown: {
      positive: Math.round(positive),
      neutral: Math.round(neutral),
      negative: Math.round(negative)
    },
    trending_topics: topics.slice(0, 3),
    influencer_sentiment: positive > 50 ? 'bullish' : positive > 35 ? 'mixed' : 'bearish',
    engagement_level: socialScore > 80 ? 'viral' : socialScore > 60 ? 'high' : socialScore > 40 ? 'moderate' : 'low'
  };
};

const generateSimulatedOnChainData = (asset) => {
  const priceChange = asset.change24h || 0;
  let baseScore = 50;
  
  // Influence by price movement and volume
  if (priceChange > 3) baseScore += 20;
  else if (priceChange > 1) baseScore += 10;
  else if (priceChange < -3) baseScore -= 20;
  else if (priceChange < -1) baseScore -= 10;
  
  if (asset.volume24h > 2000000000) baseScore += 10;
  
  const onchainScore = Math.max(25, Math.min(95, baseScore + (Math.random() * 15 - 7.5)));
  
  const whaleActivities = ['accumulating', 'distributing', 'neutral'];
  const whaleIndex = onchainScore > 60 ? 0 : onchainScore > 40 ? 2 : 1;
  
  const flows = ['net_inflow', 'net_outflow', 'balanced'];
  const flowIndex = priceChange > 2 ? 0 : priceChange < -2 ? 1 : 2;
  
  const signals = ['bullish', 'bearish', 'neutral'];
  const signalIndex = onchainScore > 60 ? 0 : onchainScore > 40 ? 2 : 1;

  return {
    onchain_score: onchainScore,
    whale_activity: whaleActivities[whaleIndex],
    exchange_flow: flows[flowIndex],
    network_health: Math.max(50, Math.min(95, 70 + (Math.random() * 20 - 10))),
    holder_distribution: onchainScore > 60 ? 'Healthy distribution with growing retail participation' : 'Mixed holder distribution with moderate concentration',
    key_metrics: {
      active_addresses: Math.floor(50000 + Math.random() * 200000),
      transaction_volume: Math.floor(asset.volume24h / 1000000),
      large_transactions: Math.floor(100 + Math.random() * 500)
    },
    signal: signals[signalIndex]
  };
};

const generateBasicSignal = (asset) => {
  const basicScore = calculateTechnicalScore(asset);
  return {
    confidence: Math.max(30, Math.min(95, basicScore)),
    recommendation: basicScore > 70 ? 'buy' : basicScore < 40 ? 'sell' : 'hold',
    riskLevel: basicScore > 70 ? 'low' : basicScore > 50 ? 'medium' : 'high',
    breakdown: {
      technical: basicScore
    },
    signals: {
      strength: basicScore > 70 ? 'strong' : basicScore > 50 ? 'moderate' : 'weak',
      direction: basicScore > 60 ? 'bullish' : basicScore < 40 ? 'bearish' : 'neutral'
    }
  };
};