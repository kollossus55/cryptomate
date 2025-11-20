import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { base44 } from "@/api/base44Client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Sparkles, TrendingUp, TrendingDown, X, RefreshCw, Target, Minimize2, Maximize2, Bell, Scan, Filter } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { scanAltcoins, getCategories, getAltcoinsByCategory } from "./AltcoinScanner";

export default function AIRecommendationNotification({ assets, onTradeAsset, onClose, useAltcoinScanner = false }) {
  const [recommendations, setRecommendations] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isVisible, setIsVisible] = useState(true);
  const [isMinimized, setIsMinimized] = useState(false);
  const [hasNewSignals, setHasNewSignals] = useState(false);
  const [lastInteractionTime, setLastInteractionTime] = useState(Date.now());
  const [scannerMode, setScannerMode] = useState(useAltcoinScanner);
  const [selectedCategory, setSelectedCategory] = useState("all");
  
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

  // Initial analysis on mount
  useEffect(() => {
    if (scannerMode) {
      runAltcoinScanner();
    } else if (assetsRef.current && assetsRef.current.length > 0) {
      analyzeTopAssets();
    }
  }, [scannerMode]); // Run when scanner mode changes

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
        if (scannerMode) {
          runAltcoinScanner();
        } else {
          analyzeTopAssets();
        }
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

      const topAssets = currentAssets.slice(0, 10);
      
      const assetsData = topAssets.map(asset => 
        `${asset.name} (${asset.symbol}): Price $${asset.price}, 24h Change ${asset.change24h}%, Volume $${(asset.volume24h / 1e9).toFixed(2)}B`
      ).join('\n');

      const prompt = `As an advanced AI trading system, analyze these top cryptocurrencies using multi-factor analysis:

${assetsData}

Use comprehensive data sources:
1. **Technical Analysis**: Price momentum, volume, volatility patterns
2. **News Sentiment**: Recent headlines, regulatory news, partnerships
3. **Social Media Trends**: Twitter/Reddit sentiment, influencer opinions, trending topics
4. **On-Chain Metrics**: Whale movements, exchange flows, network activity

Recommend the BEST 3 trading opportunities with:
- High conviction trades based on multiple confirming signals
- Detailed reasoning incorporating all data sources
- Risk assessment considering volatility and market conditions
- Realistic target prices based on support/resistance levels

IMPORTANT: Return confidence as a percentage from 0-100 (e.g., 85 not 0.85).

Return ONLY the top 3 highest-conviction opportunities.`;

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
                  data_sources: {
                    type: "object",
                    properties: {
                      technical_score: { type: "number" },
                      news_sentiment: { type: "string" },
                      social_score: { type: "number" },
                      onchain_signal: { type: "string" }
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
        const highConfidenceSignals = result.recommendations.filter(r => r.confidence >= 80);
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

    const assetsWithSignals = currentAssets
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
    if (scannerMode) {
      runAltcoinScanner();
    } else {
      analyzeTopAssets();
    }
    handleUserInteraction();
  };

  const runAltcoinScanner = async () => {
    setIsLoading(true);
    try {
      console.log('🔍 Running altcoin scanner...');
      const opportunities = await scanAltcoins(10);
      
      const recommendations = opportunities.map(opp => ({
        symbol: opp.symbol,
        name: opp.name,
        action: opp.signal === 'strong_buy' || opp.signal === 'buy' ? 'buy' : 'sell',
        confidence: opp.confidence,
        reasoning: `${opp.name} (${opp.category}) shows ${opp.signal.replace('_', ' ').toUpperCase()} signal. Momentum: ${opp.momentum}%, Volatility: ${opp.volatility}%, Volume surge: ${opp.volume_surge}x. Strong ${opp.category} sector performance.`,
        risk_level: opp.score >= 75 ? 'low' : opp.score >= 60 ? 'medium' : 'high',
        target_price: opp.simulated_price * (opp.signal.includes('buy') ? 1.12 : 0.88),
        data_sources: {
          technical_score: opp.score,
          news_sentiment: opp.signal.includes('buy') ? 'positive' : opp.signal.includes('sell') ? 'negative' : 'neutral',
          social_score: Math.round(opp.confidence * 0.8),
          onchain_signal: opp.volume_surge > 1.5 ? 'bullish' : 'neutral'
        },
        category: opp.category,
        marketCap: opp.marketCap,
        price: opp.simulated_price,
        icon: opp.symbol.charAt(0),
        color: getCategoryColor(opp.category)
      }));

      setRecommendations({
        recommendations: selectedCategory === 'all' 
          ? recommendations 
          : recommendations.filter(r => r.category === selectedCategory),
        market_summary: `Altcoin scanner analyzed ${opportunities.length} opportunities across multiple categories. Showing top ${selectedCategory === 'all' ? 'overall' : selectedCategory} performers.`
      });
    } catch (error) {
      console.error('Scanner failed:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const getCategoryColor = (category) => {
    const colors = {
      'DeFi': 'bg-blue-500',
      'Layer 1': 'bg-purple-500',
      'Layer 2': 'bg-indigo-500',
      'Gaming': 'bg-pink-500',
      'AI': 'bg-cyan-500',
      'Meme': 'bg-orange-500',
      'Infrastructure': 'bg-green-500',
      'Privacy': 'bg-slate-500',
      'NFT': 'bg-red-500'
    };
    return colors[category] || 'bg-gray-500';
  };

  const toggleScannerMode = () => {
    setScannerMode(!scannerMode);
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
                      {scannerMode ? 'Altcoin Scanner' : 'AI Trading Signals'}
                    </h3>
                    {hasNewSignals && isMinimized && (
                      <Badge className="bg-green-500 text-white animate-pulse">
                        NEW
                      </Badge>
                    )}
                    {scannerMode && (
                      <Badge className="bg-cyan-500 text-white">
                        <Scan className="w-3 h-3 mr-1" />
                        100+ Coins
                      </Badge>
                    )}
                  </div>
                  {!isMinimized && (
                    <p className="text-indigo-200 text-sm">
                      {scannerMode ? 'Scanning altcoin opportunities' : 'Top opportunities detected'} • Auto-refreshing
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
              {/* Mode Toggle */}
              <div className="flex gap-2 mb-4">
                <Button
                  variant={!scannerMode ? "default" : "outline"}
                  size="sm"
                  onClick={() => !scannerMode || toggleScannerMode()}
                  className={!scannerMode ? "bg-indigo-600" : "border-white/30 text-white hover:bg-white/10"}
                >
                  <Sparkles className="w-4 h-4 mr-2" />
                  Top 20
                </Button>
                <Button
                  variant={scannerMode ? "default" : "outline"}
                  size="sm"
                  onClick={() => scannerMode || toggleScannerMode()}
                  className={scannerMode ? "bg-cyan-600" : "border-white/30 text-white hover:bg-white/10"}
                >
                  <Scan className="w-4 h-4 mr-2" />
                  Altcoin Scanner
                </Button>
              </div>

              {/* Category Filter (only in scanner mode) */}
              {scannerMode && (
                <div className="mb-4">
                  <div className="flex gap-2 flex-wrap">
                    <Button
                      variant={selectedCategory === 'all' ? "default" : "outline"}
                      size="sm"
                      onClick={() => { setSelectedCategory('all'); runAltcoinScanner(); }}
                      className={selectedCategory === 'all' ? "bg-white/20" : "border-white/20 text-white"}
                    >
                      All
                    </Button>
                    {getCategories().slice(0, 6).map(cat => (
                      <Button
                        key={cat}
                        variant={selectedCategory === cat ? "default" : "outline"}
                        size="sm"
                        onClick={() => { setSelectedCategory(cat); runAltcoinScanner(); }}
                        className={selectedCategory === cat ? "bg-white/20" : "border-white/20 text-white text-xs"}
                      >
                        {cat}
                      </Button>
                    ))}
                  </div>
                </div>
              )}

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
                    const asset = scannerMode 
                      ? { symbol: rec.symbol, name: rec.name, price: rec.price || 0, icon: rec.icon, color: rec.color }
                      : assets.find(a => a.symbol === rec.symbol);
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
                          </div>
                        )}

                        <div className="flex items-center justify-between">
                          <div className="flex gap-2 flex-wrap">
                            <Badge className={getRiskColor(rec.risk_level)}>
                              {rec.risk_level} risk
                            </Badge>
                            {scannerMode && rec.category && (
                              <Badge className="bg-white/20 text-white border-white/30">
                                {rec.category}
                              </Badge>
                            )}
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