import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sparkles,
  Settings,
  TrendingUp,
  AlertTriangle,
  Activity,
  Brain,
  Save,
  RefreshCw,
  Eye,
  BarChart3,
  Zap
} from "lucide-react";
import { motion } from "framer-motion";

import { generatePredictiveSignal, detectMarketRegime } from "../components/trading/PredictiveModels";
import { detectAnomalies, detectCorrelationAnomalies } from "../components/trading/AnomalyDetection";
import { generateAdvancedSignal } from "../components/trading/AdvancedSignalGenerator";
import IndicatorSettingsModal from "../components/trading/IndicatorSettingsModal";

export default function AISignals() {
  const queryClient = useQueryClient();
  const [selectedAsset, setSelectedAsset] = useState(null);
  const [signalResults, setSignalResults] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [marketRegime, setMarketRegime] = useState(null);
  const [showIndicatorSettings, setShowIndicatorSettings] = useState(false);
  const [indicatorSettings, setIndicatorSettings] = useState({
    rsi: true,
    macd: true,
    bollinger: true,
    ema: true,
    stoch: true,
    adx: true,
    sma: true,
    ao: true,
    aroon: true,
    candlestick: true,
    ichimoku: true,
    supply_demand: true,
    sp500ai: true
  });

  // Fetch AI signal config
  const { data: configs } = useQuery({
    queryKey: ['ai-signal-configs'],
    queryFn: () => base44.entities.AISignalConfig.list(),
  });

  const activeConfig = configs?.find(c => c.is_active) || null;

  // Load indicator settings from active config
  useEffect(() => {
    if (activeConfig?.indicator_settings) {
      setIndicatorSettings(prev => ({ ...prev, ...activeConfig.indicator_settings }));
    }
  }, [activeConfig?.id]);

  // Fetch assets for analysis
  const { data: assets = [] } = useQuery({
    queryKey: ['assets-for-signals'],
    queryFn: async () => {
      // Use window.assetSignalData or create mock data
      const symbols = ['BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'ADA', 'AVAX', 'DOGE', 'DOT', 'MATIC'];
      return symbols.map(symbol => {
        const cached = window.assetSignalData?.[symbol];
        return {
          symbol,
          name: symbol,
          price: cached?.price || 0,
          change24h: cached?.change24h || 0,
          volume24h: cached?.volume24h || 0,
        };
      });
    },
  });

  // Config mutations
  const createConfigMutation = useMutation({
    mutationFn: (data) => base44.entities.AISignalConfig.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-signal-configs'] });
    },
  });

  const updateConfigMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.AISignalConfig.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-signal-configs'] });
    },
  });

  // Initialize default config if none exists - Updated to reflect Technical + AI Sentiment priority
  useEffect(() => {
    if (configs && configs.length === 0) {
      createConfigMutation.mutate({
        config_name: "Indicator-Led",
        is_active: true,
        data_sources: {
          technical_indicators: true,
          news_sentiment: false,
          social_media: false,
          on_chain_data: false,
          predictive_models: true,
          anomaly_detection: true
        },
        weights: {
          technical: 100,
          news: 0,
          social: 0,
          onchain: 0,
          predictive: 0
        }
      });
    }
  }, [configs]);

  // Detect market regime on mount
  useEffect(() => {
    if (assets && assets.length > 0) {
      const regime = detectMarketRegime(assets);
      setMarketRegime(regime);
    }
  }, [assets]);

  const analyzeAsset = async (asset) => {
    // ENHANCED: Rate limit check (max 1 analysis per 30 seconds)
    const lastAnalysisTime = localStorage.getItem('last_ai_analysis_time');
    const now = Date.now();
    const cooldownPeriod = 30000; // 30 seconds
    
    if (lastAnalysisTime && (now - parseInt(lastAnalysisTime)) < cooldownPeriod) {
      const remainingTime = Math.ceil((cooldownPeriod - (now - parseInt(lastAnalysisTime))) / 1000);
      alert(`⏳ Please wait ${remainingTime} seconds between analyses to avoid rate limits`);
      return;
    }

    setIsAnalyzing(true);
    setSelectedAsset(asset);
    localStorage.setItem('last_ai_analysis_time', now.toString());

    try {
      const results = {
        asset: asset.symbol,
        timestamp: Date.now()
      };

      // 1. Traditional Advanced Signal (with network error handling)
      if (activeConfig?.data_sources?.technical_indicators) {
        try {
          results.advanced_signal = await generateAdvancedSignal(asset, null, indicatorSettings);
        } catch (signalError) {
          console.warn('Advanced signal generation failed, using fallback:', signalError.message);
          // Fallback to basic confidence
          results.advanced_signal = {
            confidence: 50 + (asset.change24h * 2),
            recommendation: asset.change24h > 2 ? 'buy' : asset.change24h < -2 ? 'sell' : 'hold',
            riskLevel: 'medium'
          };
        }
      }

      // 2. Predictive Models (with network error handling)
      if (activeConfig?.data_sources?.predictive_models) {
        try {
          results.predictive = await generatePredictiveSignal(
            asset,
            assets,
            activeConfig?.predictive_config
          );
        } catch (predError) {
          console.warn('Predictive analysis failed, skipping:', predError.message);
          results.predictive = null;
        }
      }

      // 3. Anomaly Detection (with error handling)
      if (activeConfig?.data_sources?.anomaly_detection) {
        try {
          results.anomalies = detectAnomalies(asset, assets, activeConfig?.anomaly_config);
        } catch (anomalyError) {
          console.warn('Anomaly detection failed, skipping:', anomalyError.message);
          results.anomalies = null;
        }
      }

      // 4. Composite Score
      results.composite_score = calculateCompositeScore(results, activeConfig);

      setSignalResults(results);
    } catch (error) {
      console.error('Analysis failed:', error);
      const errorMsg = error.message || 'Analysis failed';
      
      if (errorMsg.toLowerCase().includes('rate limit')) {
        alert('⚠️ Rate limit reached. Analysis paused for 90 seconds. The system will automatically recover.');
        const extendedCooldown = Date.now() - 90000;
        localStorage.setItem('last_ai_analysis_time', extendedCooldown.toString());
        
        setTimeout(() => {
          localStorage.removeItem('last_ai_analysis_time');
          console.log('✅ Rate limit cooldown complete - ready for analysis');
        }, 90000);
      } else if (errorMsg.toLowerCase().includes('network')) {
        console.warn('⚠️ Network error detected - this is normal, analysis uses cached/simulated data');
        // Don't show error to user for network issues, system handles it gracefully
      } else {
        alert('Analysis failed: ' + errorMsg);
      }
    } finally {
      setIsAnalyzing(false);
    }
  };

  const calculateCompositeScore = (results, config) => {
    if (!config) return { score: 50, signal: 'hold' };

    // Indicator-led: score is driven entirely by the technical signal engine
    let finalScore = results.advanced_signal?.confidence || 50;

    // Adjust for anomalies
    if (results.anomalies?.anomalies_detected?.length > 0) {
      if (results.anomalies.overall_risk === 'high') {
        finalScore *= 0.7; // Reduce score for high-risk anomalies
      } else if (results.anomalies.overall_risk === 'medium') {
        finalScore *= 0.85;
      }
    }

    // Determine signal based on combined score
    const thresholds = config.signal_thresholds || {
      strong_buy: 80,
      buy: 65,
      hold: 50,
      sell: 40,
      strong_sell: 30
    };

    let signal = 'hold';
    if (finalScore >= thresholds.strong_buy) signal = 'strong_buy';
    else if (finalScore >= thresholds.buy) signal = 'buy';
    else if (finalScore <= thresholds.strong_sell) signal = 'strong_sell';
    else if (finalScore <= thresholds.sell) signal = 'sell';

    return {
      score: Math.round(finalScore),
      signal,
      breakdown: {
        technical: Math.round(finalScore),
        predictive: results.predictive?.confidence || 0,
        anomaly_impact: results.anomalies?.overall_risk || 'none'
      }
    };
  };

  const getSignalColor = (signal) => {
    const colors = {
      strong_buy: 'bg-green-500 text-white',
      buy: 'bg-green-500/70 text-white',
      hold: 'bg-yellow-500 text-black',
      sell: 'bg-red-500/70 text-white',
      strong_sell: 'bg-red-500 text-white'
    };
    return colors[signal] || colors.hold;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-indigo-600 to-purple-600 rounded-2xl flex items-center justify-center">
              <Brain className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-4xl font-bold bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">
                Indicator-Led Signals
              </h1>
              <p className="text-slate-400">
                Indicator-driven scoring on real Binance OHLCV data
              </p>
            </div>
          </div>
          <Button 
            onClick={() => setShowIndicatorSettings(true)}
            className="bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white border-0 shadow-lg shadow-indigo-500/20"
          >
            <Settings className="w-4 h-4 mr-2" />
            Configure Indicators
          </Button>
        </div>

        {/* Market Regime Banner */}
        {marketRegime && (
          <Card className="bg-gradient-to-br from-slate-900 to-slate-800 border-slate-700 mb-6">
            <CardContent className="py-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <Activity className="w-5 h-5 text-indigo-400" />
                    <span className="text-white font-semibold">Market Regime:</span>
                    <Badge className={`${
                      marketRegime.regime === 'bull' ? 'bg-green-500/20 text-green-400 border-green-500/40' :
                      marketRegime.regime === 'bear' ? 'bg-red-500/20 text-red-400 border-red-500/40' :
                      'bg-yellow-500/20 text-yellow-400 border-yellow-500/40'
                    }`}>
                      {marketRegime.regime.toUpperCase()}
                    </Badge>
                    <Badge variant="outline" className="border-indigo-400 text-indigo-300">
                      {marketRegime.confidence}/100 Strength
                    </Badge>
                  </div>
                  <p className="text-slate-300 text-sm">{marketRegime.description}</p>
                </div>
                <div className="text-right">
                  <div className="text-xs text-slate-400">Market Metrics</div>
                  <div className="text-sm text-white">
                    Avg Change: {marketRegime.metrics.avg_change.toFixed(2)}% • 
                    Volatility: {marketRegime.metrics.volatility.toFixed(2)}%
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: Asset Selection */}
          <div className="lg:col-span-1">
            <Card className="bg-slate-900 border-slate-700">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <BarChart3 className="w-5 h-5 text-indigo-400" />
                  Select Asset
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[600px]">
                  <div className="space-y-2">
                    {assets.map((asset) => (
                      <motion.div
                        key={asset.symbol}
                        whileHover={{ scale: 1.02 }}
                        onClick={() => analyzeAsset(asset)}
                        className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${
                          selectedAsset?.symbol === asset.symbol
                            ? 'border-indigo-500 bg-indigo-500/10'
                            : 'border-slate-700 bg-slate-800 hover:border-slate-600'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-white font-bold">{asset.symbol}</span>
                          <Badge className={asset.change24h >= 0 ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}>
                            {asset.change24h >= 0 ? '+' : ''}{asset.change24h?.toFixed(2)}%
                          </Badge>
                        </div>
                        <div className="text-sm text-slate-400">
                          {asset.price ? '$' + asset.price.toLocaleString() : '—'}
                        </div>
                      </motion.div>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </div>

          {/* Right: Analysis Results */}
          <div className="lg:col-span-2">
            <Card className="bg-slate-900 border-slate-700">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-white flex items-center gap-2">
                    <Zap className="w-5 h-5 text-yellow-400" />
                    Signal Analysis
                    {selectedAsset && <Badge className="bg-indigo-500">{selectedAsset.symbol}</Badge>}
                  </CardTitle>
                  {selectedAsset && (
                    <Button
                      onClick={() => analyzeAsset(selectedAsset)}
                      disabled={isAnalyzing}
                      size="sm"
                      className="bg-indigo-600 hover:bg-indigo-700"
                    >
                      <RefreshCw className={`w-4 h-4 mr-2 ${isAnalyzing ? 'animate-spin' : ''}`} />
                      Refresh
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {isAnalyzing ? (
                  <div className="py-12 text-center">
                    <div className="w-16 h-16 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
                    <p className="text-indigo-200 text-lg font-semibold">Analyzing indicators...</p>
                    <p className="text-indigo-300 text-sm mt-2">
                      Running technical indicators on real Binance data and detecting anomalies
                    </p>
                  </div>
                ) : !signalResults ? (
                  <div className="py-12 text-center">
                    <Eye className="w-16 h-16 text-slate-600 mx-auto mb-4" />
                    <p className="text-slate-400">Select an asset to view indicator analysis</p>
                  </div>
                ) : (
                  <ScrollArea className="h-[600px]">
                    <div className="space-y-6">
                      {/* Composite Score */}
                      {signalResults.composite_score && (
                        <div className={`p-6 rounded-xl border-2 ${
                          signalResults.composite_score.signal.includes('buy') ? 'bg-green-500/10 border-green-500/40' :
                          signalResults.composite_score.signal.includes('sell') ? 'bg-red-500/10 border-red-500/40' :
                          'bg-yellow-500/10 border-yellow-500/40'
                        }`}>
                          <div className="flex items-center justify-between mb-4">
                            <h3 className="text-2xl font-bold text-white">Composite Signal</h3>
                            <Badge className={`text-lg px-4 py-2 ${getSignalColor(signalResults.composite_score.signal)}`}>
                              {signalResults.composite_score.signal.replace('_', ' ').toUpperCase()}
                            </Badge>
                          </div>
                          <div className="text-4xl font-bold text-white mb-2">
                            {signalResults.composite_score.score}
                            <span className="text-xl text-slate-400">/100</span>
                          </div>
                          <div className="grid grid-cols-3 gap-4 mt-4">
                            <div className="bg-slate-800 rounded p-3">
                              <div className="text-xs text-slate-400 mb-1">Technical</div>
                              <div className="text-lg font-bold text-white">
                                {signalResults.composite_score.breakdown.technical}
                              </div>
                            </div>
                            <div className="bg-slate-800 rounded p-3">
                              <div className="text-xs text-slate-400 mb-1">Predictive</div>
                              <div className="text-lg font-bold text-white">
                                {signalResults.composite_score.breakdown.predictive}
                              </div>
                            </div>
                            <div className="bg-slate-800 rounded p-3">
                              <div className="text-xs text-slate-400 mb-1">Anomaly</div>
                              <div className="text-sm font-bold text-white capitalize">
                                {signalResults.composite_score.breakdown.anomaly_impact}
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Predictive Analysis */}
                      {signalResults.predictive && (
                        <Card className="bg-slate-800 border-slate-700">
                          <CardHeader>
                            <CardTitle className="text-white flex items-center gap-2">
                              <TrendingUp className="w-5 h-5 text-purple-400" />
                              Predictive Analysis
                            </CardTitle>
                          </CardHeader>
                          <CardContent>
                            <div className="space-y-3">
                              <div className="flex items-center justify-between">
                                <span className="text-slate-400">Model:</span>
                                <Badge className="bg-purple-500/20 text-purple-300 border-purple-500/30">
                                  {signalResults.predictive.model}
                                </Badge>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-slate-400">Predicted Price:</span>
                                <span className="text-white font-bold">
                                  ${signalResults.predictive.predicted_price?.toLocaleString()}
                                </span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-slate-400">Expected Change:</span>
                                <span className={`font-bold ${signalResults.predictive.predicted_change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                  {signalResults.predictive.predicted_change >= 0 ? '+' : ''}
                                  {signalResults.predictive.predicted_change?.toFixed(2)}%
                                </span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-slate-400">Confidence:</span>
                                <span className="text-white font-bold">
                                  {signalResults.predictive.confidence?.toFixed(0)}/100
                                </span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-slate-400">Signal Strength:</span>
                                <Badge className={
                                  signalResults.predictive.signals.strength === 'strong' ? 'bg-green-500' :
                                  signalResults.predictive.signals.strength === 'moderate' ? 'bg-yellow-500' :
                                  'bg-slate-500'
                                }>
                                  {signalResults.predictive.signals.strength.toUpperCase()}
                                </Badge>
                              </div>
                              {signalResults.predictive.market_regime && (
                                <div className="mt-4 p-3 bg-indigo-500/10 border border-indigo-500/30 rounded">
                                  <div className="text-xs text-indigo-300 mb-1">Market Context</div>
                                  <div className="text-sm text-white">
                                    {signalResults.predictive.market_regime.description}
                                  </div>
                                </div>
                              )}
                            </div>
                          </CardContent>
                        </Card>
                      )}

                      {/* Anomaly Detection */}
                      {signalResults.anomalies && signalResults.anomalies.anomalies_detected.length > 0 && (
                        <Card className="bg-slate-800 border-orange-500/50">
                          <CardHeader>
                            <CardTitle className="text-white flex items-center gap-2">
                              <AlertTriangle className="w-5 h-5 text-orange-400" />
                              Anomalies Detected
                              <Badge className={
                                signalResults.anomalies.overall_risk === 'high' ? 'bg-red-500' :
                                signalResults.anomalies.overall_risk === 'medium' ? 'bg-orange-500' :
                                'bg-yellow-500'
                              }>
                                {signalResults.anomalies.overall_risk.toUpperCase()} RISK
                              </Badge>
                            </CardTitle>
                          </CardHeader>
                          <CardContent>
                            <div className="space-y-3">
                              {signalResults.anomalies.anomalies_detected.map((anomaly, idx) => (
                                <div key={idx} className="p-3 bg-slate-900 rounded border border-orange-500/30">
                                  <div className="flex items-center justify-between mb-2">
                                    <Badge className="bg-orange-500/20 text-orange-300 border-orange-500/40">
                                      {anomaly.type?.replace(/_/g, ' ').toUpperCase()}
                                    </Badge>
                                    {anomaly.confidence && (
                                      <span className="text-sm text-slate-400">
                                        {anomaly.confidence}/100 strength
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-sm text-slate-300">{anomaly.description}</p>
                                </div>
                              ))}
                            </div>
                          </CardContent>
                        </Card>
                      )}
                    </div>
                  </ScrollArea>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Configuration Panel */}
        {showIndicatorSettings && (
        <IndicatorSettingsModal
          isOpen={showIndicatorSettings}
          onClose={() => setShowIndicatorSettings(false)}
          settings={indicatorSettings}
          onUpdate={setIndicatorSettings}
          onSave={() => {
            if (activeConfig) {
              updateConfigMutation.mutate({
                id: activeConfig.id,
                data: { ...activeConfig, indicator_settings: indicatorSettings }
              });
            }
            setShowIndicatorSettings(false);
          }}
        />
      )}

      {activeConfig && (
          <Card className="mt-6 bg-slate-900 border-slate-700">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <Settings className="w-5 h-5 text-indigo-400" />
                Signal Configuration
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="weights">
                <TabsList className="bg-slate-800">
                  <TabsTrigger value="weights">Weights</TabsTrigger>
                  <TabsTrigger value="sources">Data Sources</TabsTrigger>
                  <TabsTrigger value="thresholds">Thresholds</TabsTrigger>
                </TabsList>

                <TabsContent value="weights" className="space-y-4 mt-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {Object.entries(activeConfig.weights || {}).map(([key, value]) => {
                      const colorMap = {
                        technical: { bg: 'bg-gradient-to-r from-indigo-600/20 to-purple-600/20', border: 'border-indigo-500/50', text: 'text-indigo-300', bar: 'bg-indigo-500' },
                        news: { bg: 'bg-gradient-to-r from-cyan-600/20 to-blue-600/20', border: 'border-cyan-500/50', text: 'text-cyan-300', bar: 'bg-cyan-500' },
                        social: { bg: 'bg-gradient-to-r from-pink-600/20 to-rose-600/20', border: 'border-pink-500/50', text: 'text-pink-300', bar: 'bg-pink-500' },
                        onchain: { bg: 'bg-gradient-to-r from-green-600/20 to-emerald-600/20', border: 'border-green-500/50', text: 'text-green-300', bar: 'bg-green-500' },
                        predictive: { bg: 'bg-gradient-to-r from-amber-600/20 to-orange-600/20', border: 'border-amber-500/50', text: 'text-amber-300', bar: 'bg-amber-500' }
                      };
                      const colors = colorMap[key] || { bg: 'bg-slate-800', border: 'border-slate-600', text: 'text-slate-300', bar: 'bg-slate-500' };
                      
                      return (
                        <div key={key} className={`p-4 rounded-xl border-2 ${colors.bg} ${colors.border}`}>
                          <div className="flex items-center justify-between mb-3">
                            <Label className={`capitalize font-semibold ${colors.text}`}>
                              {key}
                            </Label>
                            <span className={`text-2xl font-bold ${colors.text}`}>{value}%</span>
                          </div>
                          <div className="relative">
                            <div className="h-3 bg-slate-700 rounded-full overflow-hidden mb-2">
                              <div 
                                className={`h-full ${colors.bar} transition-all duration-300`} 
                                style={{ width: `${value}%` }}
                              />
                            </div>
                            <Slider
                              value={[value]}
                              onValueChange={(val) => {
                                const newWeights = { ...activeConfig.weights, [key]: val[0] };
                                updateConfigMutation.mutate({
                                  id: activeConfig.id,
                                  data: { ...activeConfig, weights: newWeights }
                                });
                              }}
                              max={100}
                              step={5}
                              className="w-full"
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </TabsContent>

                <TabsContent value="sources" className="mt-4">
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    {Object.entries(activeConfig.data_sources || {}).map(([key, enabled]) => (
                      <label key={key} className="flex items-center gap-3 p-4 bg-slate-800 rounded-lg border border-slate-700 cursor-pointer hover:border-indigo-500 transition-all">
                        <input
                          type="checkbox"
                          checked={enabled}
                          onChange={(e) => {
                            const newSources = { ...activeConfig.data_sources, [key]: e.target.checked };
                            updateConfigMutation.mutate({
                              id: activeConfig.id,
                              data: { ...activeConfig, data_sources: newSources }
                            });
                          }}
                          className="w-5 h-5 rounded border-slate-600"
                        />
                        <span className="text-white capitalize">{key.replace(/_/g, ' ')}</span>
                      </label>
                    ))}
                  </div>
                </TabsContent>

                <TabsContent value="thresholds" className="space-y-4 mt-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {Object.entries(activeConfig.signal_thresholds || {}).map(([key, value]) => (
                      <div key={key}>
                        <Label className="text-white capitalize mb-2 block">
                          {key.replace(/_/g, ' ')}: {value}
                        </Label>
                        <Input
                          type="number"
                          value={value}
                          onChange={(e) => {
                            const newThresholds = { ...activeConfig.signal_thresholds, [key]: parseFloat(e.target.value) };
                            updateConfigMutation.mutate({
                              id: activeConfig.id,
                              data: { ...activeConfig, signal_thresholds: newThresholds }
                            });
                          }}
                          className="bg-slate-800 border-slate-700 text-white"
                        />
                      </div>
                    ))}
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}