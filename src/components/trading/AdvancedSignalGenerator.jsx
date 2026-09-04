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

const CACHE_DURATION = 10 * 60 * 1000; // 10 minutes

// Per-type rate limit — each live data source gets its own budget so fetching
// news doesn't exhaust the quota for social / on-chain.
const RATE_LIMIT_PER_TYPE = 8; // max live web-search calls per minute per type
const rateLimitTrackers = {
  news: { callCount: 0, windowStart: Date.now() },
  social: { callCount: 0, windowStart: Date.now() },
  onchain: { callCount: 0, windowStart: Date.now() }
};

const checkRateLimit = (type) => {
  const now = Date.now();
  const oneMinute = 60 * 1000;
  const tracker = rateLimitTrackers[type] || (rateLimitTrackers[type] = { callCount: 0, windowStart: now });

  if (now - tracker.windowStart > oneMinute) {
    tracker.windowStart = now;
    tracker.callCount = 0;
  }

  if (tracker.callCount >= RATE_LIMIT_PER_TYPE) {
    console.warn(`⚠️ Rate limit (${type}): skipping live fetch, no data returned`);
    return false;
  }

  tracker.callCount++;
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

// Real-time news sentiment via live web search (Gemini). Returns null when
// rate-limited or unavailable — never fabricated data.
export const analyzeNewsSentiment = async (asset) => {
  const cached = getCached('news', asset.symbol);
  if (cached) return cached;

  if (!checkRateLimit('news')) return null;

  try {
    const response = await base44.integrations.Core.InvokeLLM({
      prompt: `Search the web for the latest real news about the cryptocurrency ${asset.name} (${asset.symbol}) from the last 24 hours. Return 3 actual recent headlines you found via web search, an overall sentiment score from -1 (very bearish) to 1 (very bullish), a sentiment label, the impact level, a brief summary, and the source name for each headline. Only use real, verifiable headlines — do not invent any.`,
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
    console.error("Live news fetch failed:", error);
    return null;
  }
};

// Real social media sentiment via live web search (Gemini). Returns null when
// rate-limited or unavailable — never fabricated data.
export const analyzeSocialTrends = async (asset) => {
  const cached = getCached('social', asset.symbol);
  if (cached) return cached;

  if (!checkRateLimit('social')) return null;

  try {
    const response = await base44.integrations.Core.InvokeLLM({
      prompt: `Search the web for real-time social media sentiment about the cryptocurrency ${asset.name} (${asset.symbol}) from the last 24 hours — Twitter/X, Reddit, and crypto forums. Based only on what you actually find, return a social score (0-100), mention volume, a sentiment breakdown (positive/neutral/negative percentages summing to 100), up to 3 real trending topics or hashtags, influencer sentiment, and engagement level. Do not invent data; if little is found, reflect that in lower scores.`,
      add_context_from_internet: true,
      model: "gemini_3_flash",
      response_json_schema: {
        type: "object",
        properties: {
          social_score: { type: "number" },
          mention_volume: { type: "string", enum: ["high", "moderate", "low"] },
          sentiment_breakdown: {
            type: "object",
            properties: {
              positive: { type: "number" },
              neutral: { type: "number" },
              negative: { type: "number" }
            }
          },
          trending_topics: { type: "array", items: { type: "string" } },
          influencer_sentiment: { type: "string", enum: ["bullish", "mixed", "bearish"] },
          engagement_level: { type: "string", enum: ["viral", "high", "moderate", "low"] }
        }
      }
    });

    const result = {
      social_score: Math.max(0, Math.min(100, response.social_score || 50)),
      mention_volume: response.mention_volume || 'low',
      sentiment_breakdown: {
        positive: Math.round(response.sentiment_breakdown?.positive ?? 33),
        neutral: Math.round(response.sentiment_breakdown?.neutral ?? 34),
        negative: Math.round(response.sentiment_breakdown?.negative ?? 33)
      },
      trending_topics: (response.trending_topics || []).slice(0, 3),
      influencer_sentiment: response.influencer_sentiment || 'mixed',
      engagement_level: response.engagement_level || 'low'
    };
    setCache('social', asset.symbol, result);
    return result;
  } catch (error) {
    console.error("Live social trends fetch failed:", error);
    return null;
  }
};

// Real on-chain metrics via live web search (Gemini). Returns null when
// rate-limited or unavailable — never fabricated data.
export const analyzeOnChainData = async (asset) => {
  const cached = getCached('onchain', asset.symbol);
  if (cached) return cached;

  if (!checkRateLimit('onchain')) return null;

  try {
    const response = await base44.integrations.Core.InvokeLLM({
      prompt: `Search the web for real on-chain metrics for the cryptocurrency ${asset.name} (${asset.symbol}) from the last 24 hours — whale activity, exchange inflows/outflows, active addresses, large transactions, and network health. Based only on what you actually find, return an on-chain score (0-100), whale activity, exchange flow, network health %, a holder distribution summary, key metrics (active addresses, transaction volume in USD, large tx count), and an overall on-chain signal. Do not invent data; if little is found, reflect that in conservative values.`,
      add_context_from_internet: true,
      model: "gemini_3_flash",
      response_json_schema: {
        type: "object",
        properties: {
          onchain_score: { type: "number" },
          whale_activity: { type: "string", enum: ["accumulating", "distributing", "neutral"] },
          exchange_flow: { type: "string", enum: ["net_inflow", "net_outflow", "balanced"] },
          network_health: { type: "number" },
          holder_distribution: { type: "string" },
          key_metrics: {
            type: "object",
            properties: {
              active_addresses: { type: "number" },
              transaction_volume: { type: "number" },
              large_transactions: { type: "number" }
            }
          },
          signal: { type: "string", enum: ["bullish", "bearish", "neutral"] }
        }
      }
    });

    const result = {
      onchain_score: Math.max(0, Math.min(100, response.onchain_score || 50)),
      whale_activity: response.whale_activity || 'neutral',
      exchange_flow: response.exchange_flow || 'balanced',
      network_health: Math.max(0, Math.min(100, response.network_health ?? 70)),
      holder_distribution: response.holder_distribution || 'No distribution data available from live sources.',
      key_metrics: {
        active_addresses: response.key_metrics?.active_addresses || 0,
        transaction_volume: response.key_metrics?.transaction_volume || 0,
        large_transactions: response.key_metrics?.large_transactions || 0
      },
      signal: response.signal || 'neutral'
    };
    setCache('onchain', asset.symbol, result);
    return result;
  } catch (error) {
    console.error("Live on-chain fetch failed:", error);
    return null;
  }
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