import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { base44 } from "@/api/base44Client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Sparkles, TrendingUp, TrendingDown, X, RefreshCw, Target, Minimize2, Maximize2, Bell } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";


export default function AIRecommendationNotification({ assets, onTradeAsset, onExecuteTrade, portfolio, autoTradingSettings, onClose, useAltcoinScanner = false }) {
  const [recommendations, setRecommendations] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isVisible, setIsVisible] = useState(true);
  const [isMinimized, setIsMinimized] = useState(false);
  const [hasNewSignals, setHasNewSignals] = useState(false);
  const [lastInteractionTime, setLastInteractionTime] = useState(Date.now());
  const [userPreferences, setUserPreferences] = useState(null);
  const [selectedTrades, setSelectedTrades] = useState(new Set());
  
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
      console.log('🎬 AI Signals popup opened');
      console.log('📊 Main assets available:', assetsRef.current.length);
      console.log('🔍 Altcoin opportunities:', window.altcoinOpportunities?.length || 0);
      if (window.altcoinOpportunities?.length > 0) {
        console.log('🪙 Altcoins found:', window.altcoinOpportunities.map(a => `${a.symbol} (${a.confidence}%)`).join(', '));
      }
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

  // Inactivity auto-close timer - DISABLED for continuous monitoring
  useEffect(() => {
    // We want the popup to stay open for passive monitoring
    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current);
    }
  }, []);

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
        console.log('🔍 Checking for altcoin opportunities:', window.altcoinOpportunities?.length || 0, 'found');
        // ALWAYS generate fresh recommendations with latest altcoin data
        console.log('📊 Generating basic recommendations with latest data...');
        generateBasicRecommendations();
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
      const altcoinSymbols = new Set();
      
      if (window.altcoinOpportunities && window.altcoinOpportunities.length > 0) {
        window.altcoinOpportunities.forEach(opp => {
          altcoinSymbols.add(opp.symbol);
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

      // Filter by user preferences FIRST to remove unwanted assets
      if (userPreferences?.excluded_assets?.length > 0) {
        combinedAssets = combinedAssets.filter(a => !userPreferences.excluded_assets.includes(a.symbol));
      }

      // Score and sort assets to find best candidates for AI analysis
      // We want to mix major coins with high-potential altcoins
      const scoredAssets = combinedAssets.map(asset => {
        let score = 0;
        
        // Base score for volatility/momentum (absolute change)
        score += Math.abs(asset.change24h || 0) * 2;
        
        // Boost for altcoin opportunities
        if (altcoinSymbols.has(asset.symbol)) {
          score += 50; // High priority for scanned opportunities
        }
        
        // Boost for preferred assets
        if (userPreferences?.preferred_assets?.includes(asset.symbol)) {
          score += 30;
        }
        
        // Boost for high volume (logarithmic to avoid skewing too much)
        if (asset.volume24h > 0) {
          score += Math.log10(asset.volume24h);
        }

        return { asset, score };
      });

      // Sort by score descending and take top 10
      let topAssets = scoredAssets
        .sort((a, b) => b.score - a.score)
        .slice(0, 10)
        .map(item => item.asset);
      
      const assetsData = topAssets.map(asset => {
        const signalData = window.assetSignalData?.[asset.symbol];
        const prediction = signalData?.prediction;
        return `${asset.name} (${asset.symbol}): Price $${asset.price}, 24h Change ${asset.change24h}%, Volume $${(asset.volume24h / 1e9).toFixed(2)}B${prediction ? `, Predicted 24h: ${prediction.predicted_change > 0 ? '+' : ''}${prediction.predicted_change.toFixed(2)}%` : ''}`;
      }).join('\n');

      // Get current positions for sell analysis
      const positionsData = portfolio?.positions?.map(pos => {
        const symbol = pos.asset_symbol.replace('/USDT', '');
        const asset = topAssets.find(a => a.symbol === symbol);
        const currentPrice = asset?.price || 0;
        const profitPercent = pos.avg_entry_price > 0 ? ((currentPrice - pos.avg_entry_price) / pos.avg_entry_price * 100).toFixed(2) : 0;
        return `${symbol}: Holding ${pos.quantity.toFixed(6)} @ $${pos.avg_entry_price.toFixed(2)} entry, Current $${currentPrice.toFixed(2)} (${profitPercent >= 0 ? '+' : ''}${profitPercent}% P&L)`;
      }).join('\n') || 'No open positions';

      // Get user thresholds
      const minConfidenceBuy = userPreferences?.signal_alert_thresholds?.min_confidence_buy ?? 70;
      const minConfidenceSell = userPreferences?.signal_alert_thresholds?.min_confidence_sell ?? 65;
      const minPredictedGain = userPreferences?.signal_alert_thresholds?.min_predicted_gain ?? 5;

      const prompt = `As an advanced AI trading system, analyze these top cryptocurrencies using multi-factor analysis:

      CURRENT PORTFOLIO POSITIONS:
      ${positionsData}

      MARKET DATA:

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
      - PRIORITIZE: Sell signals for assets user currently holds if they show weakness or profit-taking opportunity
      - High conviction trades based on multiple confirming signals
      - Detailed reasoning incorporating all data sources including predictive analysis
      - For held positions: Consider profit targets, risk of reversal, and optimal exit timing
      - For new positions: Only recommend buy signals with predicted gains above ${minPredictedGain}%
      - Risk assessment considering volatility and market conditions
      - Realistic target prices based on support/resistance levels and predictions
      - Ensure confidence levels meet user thresholds (${minConfidenceBuy}% for buys, ${minConfidenceSell}% for sells)

      IMPORTANT: 
      - Include SELL opportunities for held positions if technical/sentiment signals indicate exits
      - Return confidence as a percentage from 0-100 (e.g., 85 not 0.85)
      - Balance recommendations between buy/sell based on market conditions and portfolio

      Return ONLY the top 3 highest-conviction opportunities (can be mix of buy/sell).`;

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
      
      // 🔥 SYNC SIGNALS TO AUTO-TRADING ENGINE
      if (result?.recommendations) {
        result.recommendations.forEach(rec => {
          if (!window.assetSignalData) window.assetSignalData = {};
          window.assetSignalData[rec.symbol] = {
            confidence: rec.confidence,
            recommendation: rec.action,
            riskLevel: rec.risk_level,
            timestamp: Date.now(),
            source: 'ai_popup',
            reasoning: rec.reasoning,
            breakdown: {
              technical: rec.data_sources?.technical_score || 0,
              news: { sentiment_label: rec.data_sources?.news_sentiment || 'neutral' },
              social: { social_score: rec.data_sources?.social_score || 0 },
              onchain: { signal: rec.data_sources?.onchain_signal || 'neutral' }
            }
          };
        });
        console.log('✅ Synced', result.recommendations.length, 'signals to auto-trading engine');
      }
      
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
      .map(asset => {
        // Check if we have signal data from assetSignalData
        let signalData = window.assetSignalData?.[asset.symbol];
        
        // If not, check if this is an altcoin opportunity
        if (!signalData && window.altcoinOpportunities) {
          const altcoin = window.altcoinOpportunities.find(a => a.symbol === asset.symbol);
          if (altcoin && altcoin.confidence) {
            console.log(`✅ Found altcoin opportunity: ${altcoin.symbol} - ${altcoin.confidence}% confidence`);
            signalData = {
              confidence: altcoin.confidence,
              recommendation: altcoin.signal === 'strong_buy' || altcoin.signal === 'buy' ? 'buy' : 
                             altcoin.signal === 'strong_sell' || altcoin.signal === 'sell' ? 'sell' : 'hold',
              timestamp: Date.now(),
              source: 'altcoin_scanner',
              breakdown: {
                technical: altcoin.opportunity_score || 0,
                news: { sentiment_label: 'positive' },
                social: { social_score: 75 }
              },
              riskLevel: altcoin.risk_level || 'medium'
            };
          }
        }
        
        return { asset, signalData };
      })
      .filter(({ signalData }) => signalData && signalData.confidence >= 70)
      .sort((a, b) => b.signalData.confidence - a.signalData.confidence)
      .slice(0, 10);

    console.log(`📋 Assets with signals (>= 70% confidence): ${assetsWithSignals.length}`);

    if (assetsWithSignals.length === 0) {
      console.log('⚠️ No signals found with >= 70% confidence');
      setRecommendations(null);
      return;
    }

    const recommendations = assetsWithSignals.map(({ asset, signalData }) => {
      const rec = {
        symbol: asset.symbol,
        action: signalData.recommendation === 'sell' ? 'sell' : 'buy',
        confidence: signalData.confidence,
        reasoning: `${asset.symbol} shows ${signalData.recommendation.toUpperCase()} signal with ${signalData.confidence}% confidence based on ${signalData.source === 'altcoin_scanner' ? 'altcoin scanner analysis' : 'technical analysis'}${signalData.breakdown?.news ? `, ${signalData.breakdown.news.sentiment_label} news sentiment` : ''}${signalData.breakdown?.social ? `, and strong social engagement` : ''}.`,
        risk_level: signalData.riskLevel || 'medium',
        target_price: asset.price * (signalData.recommendation === 'buy' ? 1.08 : 0.92),
        data_sources: {
          technical_score: signalData.breakdown?.technical || 0,
          news_sentiment: signalData.breakdown?.news?.sentiment_label || 'neutral',
          social_score: signalData.breakdown?.social?.social_score || 0,
          onchain_signal: signalData.breakdown?.onchain?.signal || 'neutral'
        }
      };
      console.log(`✅ Created recommendation for ${rec.symbol}: ${rec.action} at ${rec.confidence}%`);
      return rec;
    });

    const result = {
      recommendations,
      market_summary: `Market analysis based on cached signal data${window.altcoinOpportunities?.length ? ' including altcoin scanner' : ''}. ${recommendations.length} opportunities identified.`
    };
    
    // 🔥 SYNC SIGNALS TO AUTO-TRADING ENGINE
    if (recommendations) {
      recommendations.forEach(rec => {
        if (!window.assetSignalData) window.assetSignalData = {};
        window.assetSignalData[rec.symbol] = {
          confidence: rec.confidence,
          recommendation: rec.action,
          riskLevel: rec.risk_level,
          timestamp: Date.now(),
          source: 'basic_analysis',
          reasoning: rec.reasoning,
          breakdown: {
            technical: rec.data_sources?.technical_score || 0,
            news: { sentiment_label: rec.data_sources?.news_sentiment || 'neutral' },
            social: { social_score: rec.data_sources?.social_score || 0 },
            onchain: { signal: rec.data_sources?.onchain_signal || 'neutral' }
          }
        };
      });
      console.log('✅ Synced', recommendations.length, 'basic signals to auto-trading engine');
    }
    
    setRecommendations(result);
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
    setSelectedTrades(new Set());
    handleUserInteraction();
  };

  const toggleTradeSelection = (symbol) => {
    setSelectedTrades(prev => {
      const next = new Set(prev);
      if (next.has(symbol)) {
        next.delete(symbol);
      } else {
        next.add(symbol);
      }
      return next;
    });
  };

  const handleExecuteSelected = async () => {
    if (selectedTrades.size === 0) return;
    if (!onExecuteTrade) return;
    
    const selectedRecs = recommendations.recommendations.filter(rec => selectedTrades.has(rec.symbol));
    
    console.log(`🎯 Executing ${selectedRecs.length} trades directly...`);
    
    for (const rec of selectedRecs) {
      let asset = assets.find(a => a.symbol === rec.symbol);
      
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
      
      if (asset) {
        let quantity = 0;
        
        if (rec.action === 'buy' && portfolio) {
          const positionSizePercent = (autoTradingSettings?.max_position_size_percent || 10) / 100;
          const maxPositionSize = portfolio.available_balance * positionSizePercent;
          quantity = maxPositionSize / asset.price;
        } else if (rec.action === 'sell') {
          const assetSymbol = `${asset.symbol}/USDT`;
          const position = portfolio?.positions?.find(p => p.asset_symbol === assetSymbol);
          if (position) {
            quantity = position.quantity;
          }
        }
        
        if (quantity > 0) {
          try {
            console.log(`📊 Executing ${rec.action.toUpperCase()} ${quantity.toFixed(6)} ${asset.symbol}`);
            await onExecuteTrade({
              asset,
              tradeType: rec.action,
              quantity,
              price: asset.price,
              totalValue: quantity * asset.price
            });
            await new Promise(resolve => setTimeout(resolve, 800));
          } catch (error) {
            console.error(`Failed to execute ${rec.action} for ${asset.symbol}:`, error);
          }
        }
      }
    }
    
    console.log(`✅ Batch execution complete`);
    setSelectedTrades(new Set());
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
                  size="sm"
                  onClick={toggleMinimize}
                  className="text-white/80 hover:text-white hover:bg-white/15 gap-1.5 font-medium"
                  title={isMinimized ? "Expand signals" : "Minimize"}
                >
                  {isMinimized ? (
                    <>
                      <Maximize2 className="w-4 h-4" />
                      <span className="text-xs">Expand</span>
                    </>
                  ) : (
                    <>
                      <Minimize2 className="w-4 h-4" />
                      <span className="text-xs">Minimize</span>
                    </>
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

                  {selectedTrades.size > 0 && (
                    <div className="bg-gradient-to-r from-indigo-600 to-purple-600 rounded-lg p-4 mb-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-white font-bold">{selectedTrades.size} trade{selectedTrades.size > 1 ? 's' : ''} selected</p>
                          <p className="text-indigo-200 text-sm">Execute multiple trades at once</p>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setSelectedTrades(new Set())}
                            className="border-white/30 text-white hover:bg-white/10"
                          >
                            Clear
                          </Button>
                          <Button
                            size="sm"
                            onClick={handleExecuteSelected}
                            className="bg-white text-indigo-600 hover:bg-white/90 font-bold"
                          >
                            Execute {selectedTrades.size} Trade{selectedTrades.size > 1 ? 's' : ''}
                          </Button>
                        </div>
                      </div>
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
                        className={`bg-white/5 backdrop-blur-sm rounded-xl p-4 border transition-all ${
                          selectedTrades.has(rec.symbol) 
                            ? 'border-indigo-400 bg-indigo-500/10' 
                            : 'border-white/10 hover:border-white/20'
                        }`}
                      >
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center gap-3">
                            <input
                              type="checkbox"
                              checked={selectedTrades.has(rec.symbol)}
                              onChange={() => toggleTradeSelection(rec.symbol)}
                              className="w-5 h-5 rounded bg-white/10 border-white/30 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                            />
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