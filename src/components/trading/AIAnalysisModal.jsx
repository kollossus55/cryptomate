import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { base44 } from "@/api/base44Client";
import { Sparkles, TrendingUp, TrendingDown, Activity, Target, AlertTriangle, BarChart3, Newspaper, MessageSquare, Database } from "lucide-react";
import { motion } from "framer-motion";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";

import AdvancedChart from "./AdvancedChart";
import { analyzeNewsSentiment, analyzeSocialTrends, analyzeOnChainData } from "./AdvancedSignalGenerator";

export default function AIAnalysisModal({ isOpen, onClose, asset }) {
  const [analysis, setAnalysis] = useState(null);
  const [advancedData, setAdvancedData] = useState(null);
  const [advancedLoading, setAdvancedLoading] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (isOpen && asset) {
      analyzeAsset();
    }
  }, [isOpen, asset]);

  // NEW: Generate basic analysis from cached signal data
  const generateBasicAnalysisFromSignal = (signalData) => {
    // Default values in case some signalData fields are missing or undefined
    const defaultSentiment = 'neutral';
    const defaultConfidence = 50;
    const defaultRecommendation = 'hold';
    const defaultRisk = 'medium';

    const sentiment = signalData.recommendation === 'buy' ? 'bullish' :
                      signalData.recommendation === 'sell' ? 'bearish' :
                      defaultSentiment;
    const confidence = signalData.confidence || defaultConfidence;
    const recommendation = signalData.recommendation || defaultRecommendation;

    const basicAnalysis = {
      sentiment: sentiment,
      confidence: confidence,
      recommendation: recommendation,
      technical_indicators: ['Price Momentum', 'Volume Analysis', 'Market Cap Assessment'], // Placeholder or derived from simple signals
      support_level: asset.price * 0.95, // Simple derivation
      resistance_level: asset.price * 1.05, // Simple derivation
      price_targets: {
        short_term: asset.price * (recommendation === 'buy' ? 1.05 : recommendation === 'sell' ? 0.95 : 1.0),
        medium_term: asset.price * (recommendation === 'buy' ? 1.12 : recommendation === 'sell' ? 0.88 : 1.0)
      },
      risk_level: signalData.riskLevel || defaultRisk,
      key_insights: [
        `AI confidence: ${confidence}% (derived from cached signal)`,
        `${signalData.signals?.strength || 'Moderate'} ${signalData.signals?.direction || 'neutral'} signal detected (from cached data)`,
        `Technical signal score: ${signalData.breakdown?.technical || 'N/A'}`,
        signalData.breakdown?.news ? `News sentiment: ${signalData.breakdown.news.sentiment_label}` : 'News data unavailable in cache'
      ].filter(Boolean), // Remove any null/undefined insights
      summary: `${asset.symbol} shows a ${recommendation.toUpperCase()} signal with ${confidence}% AI confidence based on multi-factor analysis (derived from cached signals). For a full, detailed AI analysis, please wait for the rate limit to reset.`
    };
    
    setAnalysis(basicAnalysis);
  };

  const analyzeAsset = async () => {
    setIsLoading(true);
    setAdvancedLoading(true);
    try {
      // Check if we have cached signal data first
      const cachedSignal = window.assetSignalData?.[asset.symbol];
      
      // Check if cached signal exists and has the detailed breakdown data we need
      // Many basic signals generated in the background don't have the full breakdown
      if (cachedSignal && cachedSignal.breakdown && cachedSignal.breakdown.news) {
        // Use cached data if available and complete
        setAdvancedData({
          news: cachedSignal.breakdown?.news,
          social: cachedSignal.breakdown?.social,
          onchain: cachedSignal.breakdown?.onchain
        });
        setAdvancedLoading(false);
      } else {
        // Fetch fresh real data via live web search
        setAdvancedLoading(true);
        const [newsData, socialData, onChainData] = await Promise.all([
          analyzeNewsSentiment(asset),
          analyzeSocialTrends(asset),
          analyzeOnChainData(asset)
        ]);

        setAdvancedData({
          news: newsData,
          social: socialData,
          onchain: onChainData
        });
        setAdvancedLoading(false);
      }

      // Check rate limiting before making LLM call
      const lastLLMCall = localStorage.getItem('last_llm_analysis_call');
      const MIN_TIME_BETWEEN_CALLS = 60 * 1000; // 1 minute
      
      if (lastLLMCall && (Date.now() - parseInt(lastLLMCall)) < MIN_TIME_BETWEEN_CALLS) {
        console.log('⚠️ Rate limit: Skipping full LLM analysis call. Displaying basic analysis from cached signals.');
        // Use cached data to generate basic analysis
        if (cachedSignal) {
          generateBasicAnalysisFromSignal(cachedSignal);
        } else {
          // If no cachedSignal, we can still set a message or default analysis if preferred.
          setAnalysis(null); // Explicitly clear if no fallback
        }
        setIsLoading(false);
        return;
      }

      // Run comprehensive analysis with all data sources
      const prompt = `Provide a comprehensive trading analysis for ${asset.name} (${asset.symbol}).
      
Current market data:
- Price: $${asset.price}
- 24h Change: ${asset.change24h}%
- Volume: $${asset.volume24h}
- Market Cap: $${asset.marketCap}

Analyze:
1. Technical indicators and chart patterns
2. Recent news and market sentiment
3. Social media trends and community sentiment
4. On-chain metrics and whale activity
5. Overall market conditions

Provide detailed trading recommendations with confidence scores.`;

      const aiAnalysis = await base44.integrations.Core.InvokeLLM({
        prompt,
        add_context_from_internet: false, // Disable to avoid rate limits / unnecessary costs
        response_json_schema: {
          type: "object",
          properties: {
            sentiment: { type: "string", enum: ["bullish", "bearish", "neutral"] },
            confidence: { type: "number" },
            recommendation: { type: "string", enum: ["buy", "sell", "hold"] },
            technical_indicators: { type: "array", items: { type: "string" } },
            support_level: { type: "number" },
            resistance_level: { type: "number" },
            price_targets: {
              type: "object",
              properties: {
                short_term: { type: "number" },
                medium_term: { type: "number" }
              }
            },
            risk_level: { type: "string", enum: ["low", "medium", "high"] },
            key_insights: { type: "array", items: { type: "string" } },
            summary: { type: "string" }
          }
        }
      });

      setAnalysis(aiAnalysis);
      localStorage.setItem('last_llm_analysis_call', Date.now().toString()); // Store timestamp after successful call
    } catch (error) {
      console.error("AI analysis failed:", error);
      
      // Handle rate limit error gracefully or any other LLM error
      if (error.message?.toLowerCase().includes('rate limit')) {
        console.warn('⚠️ Full LLM analysis failed due to rate limit. Displaying basic analysis from cached signals.');
      } else {
        console.warn('⚠️ Full LLM analysis failed for other reasons. Attempting to display basic analysis from cached signals.');
      }
      
      // Use cached data if available, even if LLM call failed
      const cachedSignal = window.assetSignalData?.[asset.symbol];
      if (cachedSignal) {
        setAdvancedData({ // Ensure advancedData is still set for other tabs
          news: cachedSignal.breakdown?.news,
          social: cachedSignal.breakdown?.social,
          onchain: cachedSignal.breakdown?.onchain
        });
        generateBasicAnalysisFromSignal(cachedSignal); // Fallback to basic analysis
      } else {
        // If no cachedSignal and LLM failed, clear analysis to show "No analysis available"
        setAnalysis(null);
      }
    } finally {
      setIsLoading(false);
      setAdvancedLoading(false);
    }
  };

  const getSentimentColor = (sentiment) => {
    switch(sentiment) {
      case 'bullish': return 'text-green-400';
      case 'bearish': return 'text-red-400';
      default: return 'text-yellow-400';
    }
  };

  const getRiskColor = (risk) => {
    switch(risk) {
      case 'low': return 'bg-green-500/20 text-green-400 border-green-500/30';
      case 'medium': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
      case 'high': return 'bg-red-500/20 text-red-400 border-red-500/30';
      default: return 'bg-slate-500/20 text-slate-400 border-slate-500/30';
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-6xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-xl flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-indigo-400" />
            Advanced Analysis: {asset?.symbol}
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="flex-1 px-1">
          <Tabs defaultValue="overview" className="w-full pr-4">
          <TabsList className="bg-slate-800 border-slate-700 w-full justify-start">
            <TabsTrigger value="overview" className="data-[state=active]:bg-indigo-600">
              <Sparkles className="w-4 h-4 mr-2" />
              AI Overview
            </TabsTrigger>
            <TabsTrigger value="news" className="data-[state=active]:bg-indigo-600">
              <Newspaper className="w-4 h-4 mr-2" />
              News Sentiment
            </TabsTrigger>
            <TabsTrigger value="social" className="data-[state=active]:bg-indigo-600">
              <MessageSquare className="w-4 h-4 mr-2" />
              Social Trends
            </TabsTrigger>
            <TabsTrigger value="onchain" className="data-[state=active]:bg-indigo-600">
              <Database className="w-4 h-4 mr-2" />
              On-Chain Data
            </TabsTrigger>
            <TabsTrigger value="charts" className="data-[state=active]:bg-indigo-600">
              <BarChart3 className="w-4 h-4 mr-2" />
              Charts
            </TabsTrigger>
          </TabsList>

          {/* AI Overview Tab */}
          <TabsContent value="overview" className="mt-4">
            {isLoading ? (
              <div className="py-12 text-center">
                <div className="inline-flex items-center gap-3">
                  <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
                  <span className="text-slate-400">Analyzing with advanced AI models...</span>
                </div>
              </div>
            ) : analysis ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="space-y-6 py-4"
              >
                {/* Summary Card */}
                <div className="bg-gradient-to-br from-indigo-500/10 to-purple-500/10 border border-indigo-500/30 rounded-xl p-4">
                  <p className="text-slate-300 leading-relaxed">{analysis.summary}</p>
                </div>

                {/* Key Metrics */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
                    <div className="flex items-center gap-2 mb-2">
                      <Activity className="w-4 h-4 text-slate-400" />
                      <span className="text-slate-400 text-sm">Sentiment</span>
                    </div>
                    <div className={`text-xl font-bold capitalize ${getSentimentColor(analysis.sentiment)}`}>
                      {analysis.sentiment}
                    </div>
                  </div>

                  <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
                    <div className="flex items-center gap-2 mb-2">
                      <Target className="w-4 h-4 text-slate-400" />
                      <span className="text-slate-400 text-sm">Confidence</span>
                    </div>
                    <div className="text-xl font-bold text-white">
                      {analysis.confidence}/100
                    </div>
                  </div>
                </div>

                {/* Recommendation */}
                <div className={`rounded-xl p-4 border ${
                  analysis.recommendation === 'buy' ? 'bg-green-500/10 border-green-500/30' :
                  analysis.recommendation === 'sell' ? 'bg-red-500/10 border-red-500/30' :
                  'bg-yellow-500/10 border-yellow-500/30'
                }`}>
                  <div className="flex items-center gap-2 mb-2">
                    {analysis.recommendation === 'buy' && <TrendingUp className="w-5 h-5 text-green-400" />}
                    {analysis.recommendation === 'sell' && <TrendingDown className="w-5 h-5 text-red-400" />}
                    {analysis.recommendation === 'hold' && <Activity className="w-5 h-5 text-yellow-400" />}
                    <span className="font-semibold text-white">Recommendation</span>
                  </div>
                  <div className={`text-2xl font-bold uppercase ${
                    analysis.recommendation === 'buy' ? 'text-green-400' :
                    analysis.recommendation === 'sell' ? 'text-red-400' :
                    'text-yellow-400'
                  }`}>
                    {analysis.recommendation}
                  </div>
                </div>

                {/* Price Targets */}
                <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
                  <h4 className="font-semibold text-white mb-3">Price Targets</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-slate-400 text-sm mb-1">Support</p>
                      <p className="text-white font-semibold">${analysis.support_level?.toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-slate-400 text-sm mb-1">Resistance</p>
                      <p className="text-white font-semibold">${analysis.resistance_level?.toLocaleString()}</p>
                    </div>
                    {analysis.price_targets && (
                      <>
                        <div>
                          <p className="text-slate-400 text-sm mb-1">Short Term Target</p>
                          <p className="text-green-400 font-semibold">${analysis.price_targets.short_term?.toLocaleString()}</p>
                        </div>
                        <div>
                          <p className="text-slate-400 text-sm mb-1">Medium Term Target</p>
                          <p className="text-green-400 font-semibold">${analysis.price_targets.medium_term?.toLocaleString()}</p>
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {/* Risk Assessment */}
                <div className={`rounded-xl p-4 border ${getRiskColor(analysis.risk_level)}`}>
                  <div className="flex items-center gap-2 mb-2">
                    <AlertTriangle className="w-5 h-5" />
                    <span className="font-semibold">Risk Level: {analysis.risk_level?.toUpperCase()}</span>
                  </div>
                </div>

                {/* Technical Indicators */}
                {analysis.technical_indicators && analysis.technical_indicators.length > 0 && (
                  <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
                    <h4 className="font-semibold text-white mb-3">Technical Indicators</h4>
                    <div className="flex flex-wrap gap-2">
                      {analysis.technical_indicators.map((indicator, idx) => (
                        <span
                          key={idx}
                          className="px-3 py-1 bg-slate-700 text-slate-300 rounded-full text-sm"
                        >
                          {indicator}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Key Insights */}
                {analysis.key_insights && analysis.key_insights.length > 0 && (
                  <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
                    <h4 className="font-semibold text-white mb-3">Key Insights</h4>
                    <ul className="space-y-2">
                      {analysis.key_insights.map((insight, idx) => (
                        <li key={idx} className="flex items-start gap-2 text-slate-300">
                          <span className="text-indigo-400 mt-1">•</span>
                          <span>{insight}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </motion.div>
            ) : (
              <div className="py-12 text-center text-slate-400">
                {isLoading ? "Loading analysis..." : "No analysis available. Please try again later."}
              </div>
            )}
          </TabsContent>

          {/* News Sentiment Tab */}
          <TabsContent value="news" className="mt-4">
            {advancedData?.news ? (
              <div className="space-y-6 py-4">
                <div className={`rounded-xl p-6 border-2 ${
                  advancedData.news.sentiment_score > 0.3 ? 'bg-green-500/10 border-green-500/30' :
                  advancedData.news.sentiment_score < -0.3 ? 'bg-red-500/10 border-red-500/30' :
                  'bg-yellow-500/10 border-yellow-500/30'
                }`}>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-xl font-bold text-white">News Sentiment Analysis</h3>
                    <Badge className={`text-lg ${
                      advancedData.news.sentiment_score > 0.3 ? 'bg-green-500 text-white' :
                      advancedData.news.sentiment_score < -0.3 ? 'bg-red-500 text-white' :
                      'bg-yellow-500 text-black'
                    }`}>
                      {advancedData.news.sentiment_label.replace('_', ' ').toUpperCase()}
                    </Badge>
                  </div>
                  
                  <div className="mb-4">
                    <div className="flex justify-between text-sm mb-2">
                      <span className="text-slate-400">Sentiment Score</span>
                      <span className="text-white font-bold">{(advancedData.news.sentiment_score * 100).toFixed(0)}%</span>
                    </div>
                    <Progress value={(advancedData.news.sentiment_score + 1) * 50} className="h-3" />
                  </div>

                  <p className="text-slate-300 mb-4">{advancedData.news.summary}</p>

                  <div className="bg-slate-800 rounded-lg p-4">
                    <h4 className="font-semibold text-white mb-3">Key Headlines</h4>
                    <ul className="space-y-2">
                      {advancedData.news.key_headlines?.map((headline, idx) => (
                        <li key={idx} className="flex items-start gap-2 text-slate-300">
                          <Newspaper className="w-4 h-4 text-indigo-400 mt-1 flex-shrink-0" />
                          <span>{headline}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            ) : (
              <div className="py-12 text-center text-slate-400">
                {advancedLoading ? "Loading live news sentiment..." : "No real-time news data available right now."}
              </div>
            )}
          </TabsContent>

          {/* Social Trends Tab */}
          <TabsContent value="social" className="mt-4">
            {advancedData?.social ? (
              <div className="space-y-6 py-4">
                <div className="bg-gradient-to-br from-purple-500/10 to-pink-500/10 border-2 border-purple-500/30 rounded-xl p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-xl font-bold text-white">Social Media Analysis</h3>
                    <Badge className="bg-purple-500 text-white text-lg">
                      {advancedData.social.engagement_level.toUpperCase()}
                    </Badge>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                    <div className="bg-slate-800 rounded-lg p-4">
                      <p className="text-slate-400 text-sm mb-1">Social Score</p>
                      <p className="text-2xl font-bold text-white">{advancedData.social.social_score.toFixed(0)}</p>
                    </div>
                    <div className="bg-slate-800 rounded-lg p-4">
                      <p className="text-slate-400 text-sm mb-1">Mentions</p>
                      <p className="text-2xl font-bold text-white">{advancedData.social.mention_volume}</p>
                    </div>
                    <div className="bg-slate-800 rounded-lg p-4">
                      <p className="text-slate-400 text-sm mb-1">Influencer</p>
                      <p className="text-2xl font-bold text-white capitalize">{advancedData.social.influencer_sentiment}</p>
                    </div>
                    <div className="bg-slate-800 rounded-lg p-4">
                      <p className="text-slate-400 text-sm mb-1">Engagement</p>
                      <p className="text-2xl font-bold text-white capitalize">{advancedData.social.engagement_level}</p>
                    </div>
                  </div>

                  <div className="bg-slate-800 rounded-lg p-4 mb-4">
                    <h4 className="font-semibold text-white mb-3">Sentiment Breakdown</h4>
                    <div className="space-y-3">
                      <div>
                        <div className="flex justify-between text-sm mb-1">
                          <span className="text-green-400">Positive</span>
                          <span className="text-white">{advancedData.social.sentiment_breakdown.positive}%</span>
                        </div>
                        <Progress value={advancedData.social.sentiment_breakdown.positive} className="h-2 bg-slate-700" />
                      </div>
                      <div>
                        <div className="flex justify-between text-sm mb-1">
                          <span className="text-slate-400">Neutral</span>
                          <span className="text-white">{advancedData.social.sentiment_breakdown.neutral}%</span>
                        </div>
                        <Progress value={advancedData.social.sentiment_breakdown.neutral} className="h-2 bg-slate-700" />
                      </div>
                      <div>
                        <div className="flex justify-between text-sm mb-1">
                          <span className="text-red-400">Negative</span>
                          <span className="text-white">{advancedData.social.sentiment_breakdown.negative}%</span>
                        </div>
                        <Progress value={advancedData.social.sentiment_breakdown.negative} className="h-2 bg-slate-700" />
                      </div>
                    </div>
                  </div>

                  <div className="bg-slate-800 rounded-lg p-4">
                    <h4 className="font-semibold text-white mb-3">Trending Topics</h4>
                    <div className="flex flex-wrap gap-2">
                      {advancedData.social.trending_topics?.map((topic, idx) => (
                        <Badge key={idx} className="bg-purple-500/20 text-purple-300 border-purple-500/30">
                          {topic}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="py-12 text-center text-slate-400">
                {advancedLoading ? "Loading live social trends..." : "No real-time social data available right now."}
              </div>
            )}
          </TabsContent>

          {/* On-Chain Data Tab */}
          <TabsContent value="onchain" className="mt-4">
            {advancedData?.onchain ? (
              <div className="space-y-6 py-4">
                <div className="bg-gradient-to-br from-cyan-500/10 to-blue-500/10 border-2 border-cyan-500/30 rounded-xl p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-xl font-bold text-white">On-Chain Metrics</h3>
                    <Badge className={`text-lg ${
                      advancedData.onchain.signal === 'bullish' ? 'bg-green-500 text-white' :
                      advancedData.onchain.signal === 'bearish' ? 'bg-red-500 text-white' :
                      'bg-yellow-500 text-black'
                    }`}>
                      {advancedData.onchain.signal.toUpperCase()}
                    </Badge>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
                    <div className="bg-slate-800 rounded-lg p-4">
                      <p className="text-slate-400 text-sm mb-1">On-Chain Score</p>
                      <p className="text-2xl font-bold text-cyan-400">{advancedData.onchain.onchain_score.toFixed(0)}</p>
                    </div>
                    <div className="bg-slate-800 rounded-lg p-4">
                      <p className="text-slate-400 text-sm mb-1">Whale Activity</p>
                      <p className="text-2xl font-bold text-white capitalize">{advancedData.onchain.whale_activity}</p>
                    </div>
                    <div className="bg-slate-800 rounded-lg p-4">
                      <p className="text-slate-400 text-sm mb-1">Exchange Flow</p>
                      <p className="text-2xl font-bold text-white capitalize">{advancedData.onchain.exchange_flow.replace('_', ' ')}</p>
                    </div>
                    <div className="bg-slate-800 rounded-lg p-4">
                      <p className="text-slate-400 text-sm mb-1">Network Health</p>
                      <p className="text-2xl font-bold text-cyan-400">{advancedData.onchain.network_health.toFixed(0)}%</p>
                    </div>
                    <div className="bg-slate-800 rounded-lg p-4">
                      <p className="text-slate-400 text-sm mb-1">Active Addresses</p>
                      <p className="text-2xl font-bold text-white">{advancedData.onchain.key_metrics.active_addresses.toLocaleString()}</p>
                    </div>
                    <div className="bg-slate-800 rounded-lg p-4">
                      <p className="text-slate-400 text-sm mb-1">Large Txs (24h)</p>
                      <p className="text-2xl font-bold text-white">{advancedData.onchain.key_metrics.large_transactions}</p>
                    </div>
                  </div>

                  <div className="bg-slate-800 rounded-lg p-4">
                    <h4 className="font-semibold text-white mb-2">Holder Distribution</h4>
                    <p className="text-slate-300">{advancedData.onchain.holder_distribution}</p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="py-12 text-center text-slate-400">
                {advancedLoading ? "Loading live on-chain data..." : "No real-time on-chain data available right now."}
              </div>
            )}
          </TabsContent>

          {/* Charts Tab */}
          <TabsContent value="charts" className="mt-4">
            {asset && <AdvancedChart asset={asset} />}
          </TabsContent>
        </Tabs>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}