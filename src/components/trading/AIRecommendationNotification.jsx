import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { base44 } from "@/api/base44Client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Sparkles, TrendingUp, TrendingDown, X, RefreshCw, Target, Minimize2, Maximize2, Bell } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";


export default function AIRecommendationNotification({ assets, onTradeAsset, onClose, useAltcoinScanner = false }) {
  const [recommendations, setRecommendations] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isVisible, setIsVisible] = useState(true);
  const [isMinimized, setIsMinimized] = useState(false);
  const [hasNewSignals, setHasNewSignals] = useState(false);
  const [lastInteractionTime, setLastInteractionTime] = useState(Date.now());
  const [userPreferences, setUserPreferences] = useState(null);
  
  const autoRefreshIntervalRef = useRef(null);
  const inactivityTimerRef = useRef(null);
  const backgroundMonitorRef = useRef(null);
  const assetsRef = useRef(assets); // Store latest assets in ref

  const AUTO_REFRESH_INTERVAL = 10 * 60 * 1000; // INCREASED: 10 minutes (was 3 minutes)
  const INACTIVITY_TIMEOUT = 5 * 60 * 1000; // INCREASED: 5 minutes (was 3 minutes)
  const BACKGROUND_CHECK_INTERVAL = 5 * 60 * 1000; // INCREASED: Check every 5 minutes (was 2 minutes)
  const MIN_TIME_BETWEEN_LLM_CALLS = 2 * 60 * 1000; // NEW: Minimum 2 minutes between LLM calls

  // Update assets ref when assets change (without triggering re-renders)
  useEffect(() => {
    assetsRef.current = assets;
  }, [assets]);

  // Fetch user preferences
  useEffect(() => {
    const fetchPreferences = async () => {
      try {
        const prefs = await base44.entities.TradingPreferences.list();
        if (prefs && prefs.length > 0) {
          setUserPreferences(prefs[0]);
        }
      } catch (error) {
        console.log('No user preferences found, using defaults');
      }
    };
    fetchPreferences();
  }, []);

  // Initial analysis on mount
  useEffect(() => {
    if (assetsRef.current && assetsRef.current.length > 0) {
      analyzeTopAssets();
    }
  }, []);

  // Setup intervals based on minimized state
  useEffect(() => {
    // Clear any existing intervals
    if (autoRefreshIntervalRef.current) {
      clearInterval(autoRefreshIntervalRef.current);
      autoRefreshIntervalRef.current = null;
    }
    if (backgroundMonitorRef.current) {
      clearInterval(backgroundMonitorRef.current);
      backgroundMonitorRef.current = null;
    }

    // Setup auto-refresh when not minimized
    if (!isMinimized) {
      console.log('🔄 Setting up auto-refresh every 10 minutes');
      autoRefreshIntervalRef.current = setInterval(() => {
        console.log('🔄 Auto-refreshing AI signals... (10 min interval)');
        analyzeTopAssets();
      }, AUTO_REFRESH_INTERVAL);
    }

    // Setup background monitoring when minimized
    if (isMinimized) {
      console.log('🔍 Setting up background monitoring every 5 minutes');
      backgroundMonitorRef.current = setInterval(() => {
        console.log('🔍 Background check for new signals... (5 min interval)');
        checkForNewSignals();
      }, BACKGROUND_CHECK_INTERVAL);
    }

    return () => {
      if (autoRefreshIntervalRef.current) {
        clearInterval(autoRefreshIntervalRef.current);
      }
      if (backgroundMonitorRef.current) {
        clearInterval(backgroundMonitorRef.current);
      }
    };
  }, [isMinimized]); // Only re-run when minimize state changes

  // Inactivity auto-close timer
  useEffect(() => {
    const resetInactivityTimer = () => {
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current);
      }

      inactivityTimerRef.current = setTimeout(() => {
        console.log('⏰ Auto-closing due to inactivity');
        handleClose();
      }, INACTIVITY_TIMEOUT);
    };

    resetInactivityTimer();
    setLastInteractionTime(Date.now());

    return () => {
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current);
      }
    };
  }, [lastInteractionTime]);

  const handleUserInteraction = () => {
    setLastInteractionTime(Date.now());
  };

  const analyzeTopAssets = async () => {
    // Check if we've called LLM too recently (rate limiting)
    const lastLLMCall = localStorage.getItem('last_llm_recommendation_call');
    if (lastLLMCall) {
      const timeSinceLastCall = Date.now() - parseInt(lastLLMCall);
      if (timeSinceLastCall < MIN_TIME_BETWEEN_LLM_CALLS) {
        console.log(`⏳ Rate limit: Skipping LLM call. Last call was ${Math.round(timeSinceLastCall / 1000)}s ago`);
        // Use cached recommendations if available
        const cachedRecs = localStorage.getItem('cached_ai_recommendations');
        if (cachedRecs) {
          setRecommendations(JSON.parse(cachedRecs));
        } else {
          // Generate basic recommendations if no cache
          generateBasicRecommendations();
        }
        setIsLoading(false);
        return;
      }
    }

    setIsLoading(true);
    try {
      // Use assetsRef to always get latest assets without dependency issues
      const currentAssets = assetsRef.current;
      if (!currentAssets || currentAssets.length === 0) {
        console.warn('No assets available for analysis');
        setIsLoading(false);
        return;
      }

      // Combine main assets with altcoin opportunities
      let combinedAssets = [...currentAssets];
      if (window.altcoinOpportunities && window.altcoinOpportunities.length > 0) {
        window.altcoinOpportunities.forEach(opp => {
          if (!combinedAssets.find(a => a.symbol === opp.symbol)) {
            combinedAssets.push({
              symbol: opp.symbol,
              name: opp.name,
              price: opp.simulated_price,
              change24h: opp.momentum,
              volume24h: opp.marketCap * 0.1,
              marketCap: opp.marketCap,
              icon: opp.symbol.substring(0, 2),
              color: "bg-cyan-500"
            });
          }
        });
      }

      // Apply user preference filters
      let topAssets = combinedAssets.slice(0, 10);

      // Filter by user preferences if available
      if (userPreferences) {
        const prefs = userPreferences;

        // Exclude assets the user doesn't want
        if (prefs.excluded_assets && prefs.excluded_assets.length > 0) {
          topAssets = topAssets.filter(a => !prefs.excluded_assets.includes(a.symbol));
        }

        // Prioritize preferred assets
        if (prefs.preferred_assets && prefs.preferred_assets.length > 0) {
          const preferred = topAssets.filter(a => prefs.preferred_assets.includes(a.symbol));
          const others = topAssets.filter(a => !prefs.preferred_assets.includes(a.symbol));
          topAssets = [...preferred, ...others].slice(0, 10);
        }
      }
      
      const assetsData = topAssets.map(asset => {
        const signalData = window.assetSignalData?.[asset.symbol];
        const prediction = signalData?.prediction;
        return `${asset.name} (${asset.symbol}): Price $${asset.price}, 24h Change ${asset.change24h}%, Volume $${(asset.volume24h / 1e9).toFixed(2)}B${prediction ? `, Predicted 24h: ${prediction.predicted_change > 0 ? '+' : ''}${prediction.predicted_change.toFixed(2)}%` : ''}`;
      }).join('\n');

      // Get user thresholds
      const minConfidenceBuy = userPreferences?.signal_alert_thresholds?.min_confidence_buy ?? 70;
      const minConfidenceSell = userPreferences?.signal_alert_thresholds?.min_confidence_sell ?? 65;
      const minPredictedGain = userPreferences?.signal_alert_thresholds?.min_predicted_gain ?? 5;

      const prompt = `As an advanced AI trading system, analyze these top cryptocurrencies using multi-factor analysis:

      ${assetsData}

      User Risk Tolerance: ${userPreferences?.risk_tolerance || 'moderate'}
      User Trading Style: ${userPreferences?.trading_style || 'balanced'}
      Alert Thresholds: Buy signals minimum ${minConfidenceBuy}% confidence, Sell signals minimum ${minConfidenceSell}% confidence

      Use comprehensive data sources:
      1. **Technical Analysis**: Price momentum, volume, volatility patterns
      2. **Predictive Analysis**: 24-hour price movement forecasts (minimum ${minPredictedGain}% gain for buy signals)
      3. **News Sentiment**: Recent headlines, regulatory news, partnerships
      4. **Social Media Trends**: Twitter/Reddit sentiment, influencer opinions, trending topics
      5. **On-Chain Metrics**: Whale movements, exchange flows, network activity

      Recommend the BEST 3 trading opportunities with:
      - High conviction trades based on multiple confirming signals
      - Detailed reasoning incorporating all data sources including predictive analysis
      - Risk assessment considering volatility and market conditions
      - Realistic target prices based on support/resistance levels and predictions
      - Only recommend buy signals with predicted gains above ${minPredictedGain}%
      - Ensure confidence levels meet user thresholds (${minConfidenceBuy}% for buys, ${minConfidenceSell}% for sells)

      IMPORTANT: Return confidence as a percentage from 0-100 (e.g., 85 not 0.85).

      Return ONLY the top 3 highest-conviction opportunities that meet the user's criteria.`;

      const result = await base44.integrations.Core.InvokeLLM({
        prompt,
        add_context_from_internet: false, // CHANGED: Disable to reduce rate limit usage
        response_json_schema: {
          type: "object",
          properties: {
            recommendations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  symbol: { type: "string" },
                  action: { type: "string", enum: ["buy", "sell"] },
                  confidence: { type: "number" },
                  reasoning: { type: "string" },
                  risk_level: { type: "string", enum: ["low", "medium", "high"] },
                  target_price: { type: "number" },
                  predicted_change_24h: { type: "number" },
                  prediction_confidence: { type: "number" },
                  data_sources: {
                    type: "object",
                    properties: {
                      technical_score: { type: "number" },
                      news_sentiment: { type: "string" },
                      social_score: { type: "number" },
                      onchain_signal: { type: "string" },
                      predictive_score: { type: "number" }
                    }
                  }
                }
              }
            },
            market_summary: { type: "string" }
          }
        }
      });

      // Normalize confidence values - if they're decimals (< 1), convert to percentage
      if (result?.recommendations) {
        result.recommendations = result.recommendations.map(rec => ({
          ...rec,
          confidence: rec.confidence < 1 ? Math.round(rec.confidence * 100) : Math.round(rec.confidence)
        }));
      }

      setRecommendations(result);
      
      // Cache the recommendations
      localStorage.setItem('cached_ai_recommendations', JSON.stringify(result));
      localStorage.setItem('last_llm_recommendation_call', Date.now().toString());
      
      // Check if there are new high-confidence signals when minimized
      if (isMinimized && result?.recommendations) {
        const minConfidenceBuy = userPreferences?.signal_alert_thresholds?.min_confidence_buy ?? 70;
        const minConfidenceSell = userPreferences?.signal_alert_thresholds?.min_confidence_sell ?? 65;

        const highConfidenceSignals = result.recommendations.filter(r => 
          (r.action === 'buy' && r.confidence >= minConfidenceBuy) ||
          (r.action === 'sell' && r.confidence >= minConfidenceSell)
        );

        if (highConfidenceSignals.length > 0) {
          setHasNewSignals(true);
        }
      }
    } catch (error) {
      console.error("Failed to analyze assets:", error);
      
      // Show user-friendly error message
      if (error.message?.includes('rate limit') || error.message?.includes('Rate limit')) {
        console.warn('⚠️ Rate limit reached. Using cached data.');
        
        // Try to use cached recommendations
        const cachedRecs = localStorage.getItem('cached_ai_recommendations');
        if (cachedRecs) {
          setRecommendations(JSON.parse(cachedRecs));
        } else {
          // Generate basic recommendations from signal data
          generateBasicRecommendations();
        }
      }
    } finally {
      setIsLoading(false);
    }
  };

  // NEW: Generate basic recommendations using existing signal data (fallback)
  const generateBasicRecommendations = () => {
    const currentAssets = assetsRef.current;
    if (!currentAssets || currentAssets.length === 0) return;

    // Combine main assets with altcoin opportunities
    let combinedAssets = [...currentAssets];
    if (window.altcoinOpportunities && window.altcoinOpportunities.length > 0) {
      window.altcoinOpportunities.forEach(opp => {
        if (!combinedAssets.find(a => a.symbol === opp.symbol)) {
          combinedAssets.push({
            symbol: opp.symbol,
            name: opp.name,
            price: opp.simulated_price,
            change24h: opp.momentum,
            volume24h: opp.marketCap * 0.1,
            marketCap: opp.marketCap,
            icon: opp.symbol.substring(0, 2),
            color: "bg-cyan-500"
          });
        }
      });
    }

    const assetsWithSignals = combinedAssets
      .filter(asset => window.assetSignalData?.[asset.symbol])
      .map(asset => ({
        asset,
        signalData: window.assetSignalData[asset.symbol]
      }))
      .filter(({ signalData }) => signalData.confidence >= 70)
      .sort((a, b) => b.signalData.confidence - a.signalData.confidence)
      .slice(0, 3);

    if (assetsWithSignals.length === 0) {
      setRecommendations(null); // Clear recommendations if no signals found
      return;
    }

    const recommendations = assetsWithSignals.map(({ asset, signalData }) => ({
      symbol: asset.symbol,
      action: signalData.recommendation === 'sell' ? 'sell' : 'buy',
      confidence: signalData.confidence,
      reasoning: `${asset.symbol} shows ${signalData.recommendation.toUpperCase()} signal with ${signalData.confidence}% confidence based on technical analysis${signalData.breakdown?.news ? `, ${signalData.breakdown.news.sentiment_label} news sentiment` : ''}${signalData.breakdown?.social ? `, and ${signalData.breakdown.social.engagement_level} social engagement` : ''}.`,
      risk_level: signalData.riskLevel || 'medium',
      target_price: asset.price * (signalData.recommendation === 'buy' ? 1.08 : 0.92), // Placeholder target price
      data_sources: {
        technical_score: signalData.breakdown?.technical || 0,
        news_sentiment: signalData.breakdown?.news?.sentiment_label || 'neutral',
        social_score: signalData.breakdown?.social?.social_score || 0,
        onchain_signal: signalData.breakdown?.onchain?.signal || 'neutral'
      }
    }));

    setRecommendations({
      recommendations,
      market_summary: `Market analysis based on cached signal data. ${recommendations.length} opportunities identified.`
    });
  };

  const checkForNewSignals = async () => {
    // Quick background check for new high-confidence opportunities
    try {
      const currentAssets = assetsRef.current;
      if (!currentAssets || currentAssets.length === 0) return;

      const topAssets = currentAssets.slice(0, 5); // Check fewer assets for speed
      const highConfidenceAssets = topAssets.filter(asset => {
        const confidence = window.assetSignalData?.[asset.symbol]?.confidence || 0;
        return confidence >= 80 && Math.abs(asset.change24h) > 3; // High confidence + significant movement
      });

      if (highConfidenceAssets.length > 0) {
        setHasNewSignals(true);
        console.log(`🔔 ${highConfidenceAssets.length} new high-confidence signals detected!`);
      }
    } catch (error) {
      console.error("Background check failed:", error);
    }
  };

  const handleClose = () => {
    setIsVisible(false);
    setTimeout(() => {
      onClose();
    }, 300);
  };

  const toggleMinimize = () => {
    setIsMinimized(!isMinimized);
    if (!isMinimized) {
      setHasNewSignals(false); // Clear badge when expanding
    }
    handleUserInteraction();
  };

  const handleRefresh = () => {
    analyzeTopAssets();
    handleUserInteraction();
  };



  const getConfidenceColor = (confidence) => {
    if (confidence >= 80) return "text-green-400";
    if (confidence >= 60) return "text-yellow-400";
    return "text-orange-400";
  };

  const getRiskColor = (risk) => {
    switch(risk) {
      case 'low': return 'bg-green-500/20 text-green-400 border-green-500/30';
      case 'medium': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
      case 'high': return 'bg-red-500/20 text-red-400 border-red-500/30';
      default: return 'bg-slate-500/20 text-slate-400 border-slate-500/30';
    }
  };

  if (!isVisible) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ 
          opacity: 1, 
          scale: 1, 
          y: 0,
          width: isMinimized ? "auto" : "32rem"
        }}
        exit={{ opacity: 0, scale: 0.9, y: 20 }}
        className="fixed bottom-6 right-6 z-50"
        style={{ maxWidth: isMinimized ? "320px" : "32rem" }}
        onMouseMove={handleUserInteraction}
        onClick={handleUserInteraction}
      >
        <Card className="bg-gradient-to-br from-indigo-900 to-purple-900 border-indigo-500/50 shadow-2xl overflow-hidden" style={{ maxHeight: isMinimized ? "auto" : "85vh" }}>
          {/* Header - Always visible */}
          <div className="p-4 flex-shrink-0">
            <div className="flex items-start justify-between">
              <div 
                className="flex items-center gap-2 cursor-pointer flex-1" 
                onClick={isMinimized ? toggleMinimize : undefined}
              >
                <div className="w-10 h-10 bg-indigo-500 rounded-xl flex items-center justify-center relative">
                  <Sparkles className="w-5 h-5 text-white animate-pulse" />
                  {hasNewSignals && isMinimized && (
                    <motion.div
                      animate={{ scale: [1, 1.2, 1] }}
                      transition={{ repeat: Infinity, duration: 1.5 }}
                      className="absolute -top-1 -right-1 w-3 h-3 bg-green-400 rounded-full"
                    />
                  )}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-white text-lg">
                      AI Trading Signals
                    </h3>
                    {hasNewSignals && isMinimized && (
                      <Badge className="bg-green-500 text-white animate-pulse">
                        NEW
                      </Badge>
                    )}
                  </div>
                  {!isMinimized && (
                    <p className="text-indigo-200 text-sm">
                      Top opportunities detected • Auto-refreshing
                    </p>
                  )}
                  {isMinimized && recommendations?.recommendations && (
                    <p className="text-indigo-200 text-xs">
                      {recommendations.recommendations.length} signals • Click to expand
                    </p>
                  )}
                </div>
              </div>
              <div className="flex gap-1 flex-shrink-0">
                {hasNewSignals && isMinimized && (
                  <motion.div
                    animate={{ scale: [1, 1.1, 1] }}
                    transition={{ repeat: Infinity, duration: 2 }}
                  >
                    <Bell className="w-5 h-5 text-green-400" />
                  </motion.div>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={toggleMinimize}
                  className="text-white/70 hover:text-white hover:bg-white/10"
                  title={isMinimized ? "Expand" : "Minimize"}
                >
                  {isMinimized ? (
                    <Maximize2 className="w-4 h-4" />
                  ) : (
                    <Minimize2 className="w-4 h-4" />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleClose}
                  className="text-white/70 hover:text-white hover:bg-white/10"
                  title="Close"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>

          {/* Content - Scrollable with visible scrollbar */}
          {!isMinimized && (
            <div className="overflow-y-auto px-4 pb-4" style={{ maxHeight: "calc(85vh - 100px)" }}>

              {isLoading ? (
                <div className="py-8 text-center">
                  <div className="inline-flex items-center gap-3">
                    <RefreshCw className="w-6 h-6 text-indigo-300 animate-spin" />
                    <span className="text-indigo-200">Analyzing with advanced AI...</span>
                  </div>
                  <p className="text-xs text-indigo-300 mt-2">
                    Processing news, social media, and on-chain data...
                  </p>
                </div>
              ) : recommendations ? (
                <div className="space-y-3">
                  {recommendations.market_summary && (
                    <div className="bg-white/10 backdrop-blur-sm rounded-lg p-3 mb-4">
                      <p className="text-indigo-100 text-sm">{recommendations.market_summary}</p>
                    </div>
                  )}

                  {recommendations.recommendations?.map((rec, idx) => {
                    // Look for asset in both main assets and altcoin opportunities
                    let asset = assets.find(a => a.symbol === rec.symbol);

                    // If not found in main assets, check altcoin opportunities
                    if (!asset && window.altcoinOpportunities) {
                      const altcoin = window.altcoinOpportunities.find(a => a.symbol === rec.symbol);
                      if (altcoin) {
                        asset = {
                          symbol: altcoin.symbol,
                          name: altcoin.name,
                          price: altcoin.simulated_price,
                          change24h: altcoin.momentum,
                          volume24h: altcoin.marketCap * 0.1,
                          marketCap: altcoin.marketCap,
                          icon: altcoin.symbol.substring(0, 2),
                          color: "bg-cyan-500"
                        };
                      }
                    }

                    if (!asset || !asset.price) return null;

                    return (
                      <motion.div
                        key={rec.symbol}
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: idx * 0.1 }}
                        className="bg-white/5 backdrop-blur-sm rounded-xl p-4 border border-white/10 hover:border-white/20 transition-all"
                      >
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center gap-3">
                            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${asset.color}`}>
                              <span className="text-lg font-bold">{asset.icon}</span>
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <h4 className="font-bold text-white">{rec.symbol}</h4>
                                <Badge className={
                                  rec.action === 'buy' 
                                    ? 'bg-green-500/20 text-green-300 border-green-500/30' 
                                    : 'bg-red-500/20 text-red-300 border-red-500/30'
                                }>
                                  {rec.action === 'buy' ? <TrendingUp className="w-3 h-3 mr-1" /> : <TrendingDown className="w-3 h-3 mr-1" />}
                                  {rec.action.toUpperCase()}
                                </Badge>
                              </div>
                              <p className="text-indigo-200 text-sm">${asset.price.toLocaleString()}</p>
                            </div>
                          </div>
                          
                          <div className="text-right">
                            <div className={`text-2xl font-bold ${getConfidenceColor(rec.confidence)}`}>
                              {rec.confidence}%
                            </div>
                            <p className="text-indigo-300 text-xs">AI Confidence</p>
                          </div>
                        </div>

                        <p className="text-indigo-200 text-sm mb-3">{rec.reasoning}</p>

                        {/* Prediction Display */}
                        {rec.predicted_change_24h != null && (
                          <div className="bg-gradient-to-r from-purple-500/20 to-blue-500/20 border border-purple-500/30 rounded-lg p-3 mb-3">
                            <div className="flex items-center justify-between">
                              <div>
                                <span className="text-xs text-purple-300">24h Prediction</span>
                                <div className={`text-lg font-bold ${rec.predicted_change_24h > 0 ? 'text-green-400' : 'text-red-400'}`}>
                                  {rec.predicted_change_24h > 0 ? '+' : ''}{rec.predicted_change_24h.toFixed(2)}%
                                </div>
                              </div>
                              {rec.prediction_confidence && (
                                <div className="text-right">
                                  <span className="text-xs text-purple-300">Confidence</span>
                                  <div className="text-lg font-bold text-purple-400">
                                    {rec.prediction_confidence}%
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Data Sources Breakdown */}
                        {rec.data_sources && (
                          <div className="grid grid-cols-2 gap-2 mb-3 text-xs">
                            <div className="bg-black/20 rounded p-2">
                              <span className="text-slate-400">Technical: </span>
                              <span className="text-white font-bold">{rec.data_sources.technical_score}/100</span>
                            </div>
                            <div className="bg-black/20 rounded p-2">
                              <span className="text-slate-400">News: </span>
                              <span className="text-white font-bold capitalize">{rec.data_sources.news_sentiment}</span>
                            </div>
                            <div className="bg-black/20 rounded p-2">
                              <span className="text-slate-400">Social: </span>
                              <span className="text-white font-bold">{rec.data_sources.social_score}/100</span>
                            </div>
                            <div className="bg-black/20 rounded p-2">
                              <span className="text-slate-400">On-Chain: </span>
                              <span className="text-white font-bold capitalize">{rec.data_sources.onchain_signal}</span>
                            </div>
                            {rec.data_sources.predictive_score != null && (
                              <div className="bg-purple-500/20 rounded p-2 col-span-2">
                                <span className="text-purple-300">Predictive: </span>
                                <span className="text-white font-bold">{rec.data_sources.predictive_score}/100</span>
                              </div>
                            )}
                          </div>
                        )}

                        <div className="flex items-center justify-between">
                          <div className="flex gap-2 flex-wrap">
                            <Badge className={getRiskColor(rec.risk_level)}>
                              {rec.risk_level} risk
                            </Badge>
                            {rec.target_price && typeof rec.target_price === 'number' && (
                              <Badge variant="outline" className="border-indigo-400 text-indigo-300">
                                <Target className="w-3 h-3 mr-1" />
                                ${rec.target_price.toLocaleString()}
                              </Badge>
                            )}
                          </div>
                          
                          <Button
                            size="sm"
                            onClick={() => {
                              onTradeAsset(asset, rec.action);
                              handleClose();
                            }}
                            className={rec.action === 'buy' 
                              ? 'bg-green-600 hover:bg-green-700' 
                              : 'bg-red-600 hover:bg-red-700'
                            }
                          >
                            Trade Now
                          </Button>
                        </div>
                      </motion.div>
                    );
                  })}

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRefresh}
                    disabled={isLoading}
                    className="w-full border-white/30 bg-white/10 text-white hover:bg-white/20 hover:border-white/50 mt-2 font-semibold"
                  >
                    <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
                    {isLoading ? 'Analyzing...' : 'Refresh AI Signals'}
                  </Button>

                  {/* Auto-refresh & inactivity info */}
                  <div className="mt-3 p-2 bg-black/20 rounded-lg text-center">
                    <p className="text-xs text-indigo-300">
                      🔄 Auto-refreshing every 10 minutes • ⏰ Auto-closes after 5 min of inactivity
                    </p>
                  </div>
                </div>
              ) : (
                <div className="text-center py-4">
                  <p className="text-indigo-200">No recommendations available</p>
                </div>
              )}
            </div>
          )}
        </Card>
      </motion.div>
    </AnimatePresence>
  );
}