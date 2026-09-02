import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Sparkles,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Target,
  Settings,
  CheckCircle,
  RefreshCw,
  Lightbulb,
  Award,
  Activity,
  ChevronDown,
  ChevronUp
} from "lucide-react";

import {
  analyzePerformance,
  identifyIssues,
  analyzeAssetPerformance,
  generateParameterRecommendations,
  enhanceRecommendationsWithPreferences,
  filterAssetsByPreferences,
  generatePersonalizedPrompt
} from "./PerformanceAnalyzer";

export default function AITradingAdvisor({
  trades,
  portfolio,
  autoTradingSettings,
  onApplyRecommendation
}) {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [aiInsights, setAiInsights] = useState(null);
  const [performanceMetrics, setPerformanceMetrics] = useState(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const queryClient = useQueryClient();

  const { data: preferences } = useQuery({
    queryKey: ['trading-preferences'],
    queryFn: async () => {
      const result = await base44.entities.TradingPreferences.list();
      return result[0] || null; // Assuming one set of preferences per user or taking the first one
    },
  });

  const { data: savedInsights = [] } = useQuery({
    queryKey: ['ai-advisor-insights'],
    queryFn: () => base44.entities.AIAdvisorInsight.list('-created_date', 5),
  });

  const createInsightMutation = useMutation({
    mutationFn: (data) => base44.entities.AIAdvisorInsight.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-advisor-insights'] });
    },
  });

  const updateInsightMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.AIAdvisorInsight.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-advisor-insights'] });
    },
  });

  // Recompute performance metrics whenever trades/portfolio/settings change
  // so the displayed figures always reflect the latest trading data, not a
  // snapshot frozen after the first analysis.
  useEffect(() => {
    if (trades && trades.length > 0) {
      const metrics = analyzePerformance(trades, portfolio, autoTradingSettings);
      setPerformanceMetrics(metrics);
    } else {
      setPerformanceMetrics(null);
    }
  }, [trades, portfolio, autoTradingSettings]);

  // Run the full AI narrative analysis (LLM) once per mount/reset when enough
  // trades exist. This refreshes the AI insights every time the app is reset,
  // without re-running the expensive LLM call on every individual trade change.
  useEffect(() => {
    if (trades && trades.length >= 5 && !aiInsights) {
      handleAnalyze();
    }
  }, [trades]);

  const handleAnalyze = async () => {
    setIsAnalyzing(true);

    try {
      // Step 1: Analyze performance metrics
      const metrics = analyzePerformance(trades, portfolio, autoTradingSettings);
      setPerformanceMetrics(metrics);

      if (!metrics.hasData) {
        setIsAnalyzing(false);
        return;
      }

      // Step 2: Identify issues
      const issues = identifyIssues(metrics);

      // Step 3: Analyze asset performance - filter by preferences for LLM context
      // Note: analyzeAssetPerformance still runs on all metrics.allAssets by default.
      // The `filteredByPreferences` and `preferredAssets` flags are for the LLM.
      const filteredAssetsForLLM = preferences
        ? filterAssetsByPreferences(metrics.allAssets || [], preferences)
        : metrics.allAssets || [];

      const assetAnalysis = {
        ...analyzeAssetPerformance(metrics),
        filteredByPreferences: preferences ? true : false,
        preferredAssets: preferences?.preferred_assets || []
      };

      // Step 4: Generate parameter recommendations
      const baseRecommendations = generateParameterRecommendations(
        metrics,
        issues,
        autoTradingSettings
      );

      // Step 5: Enhance recommendations with user preferences
      const paramRecommendations = preferences
        ? enhanceRecommendationsWithPreferences(baseRecommendations, metrics, preferences)
        : baseRecommendations;

      // Step 6: Get AI-powered insights with personalized context
      const aiAnalysis = await generateAIInsights(
        metrics,
        issues,
        assetAnalysis,
        paramRecommendations,
        autoTradingSettings,
        preferences
      );

      setAiInsights({
        metrics,
        issues,
        assetAnalysis,
        paramRecommendations,
        aiAnalysis,
        preferences
      });

      // Step 6: Save insights to database
      if (aiAnalysis) {
        await createInsightMutation.mutateAsync({
          insight_type: 'strategy_optimization',
          priority: issues.some(i => i.severity === 'critical') ? 'high' : 'medium',
          title: aiAnalysis.title || 'Trading Performance Analysis',
          description: aiAnalysis.summary || 'AI-powered analysis of your trading performance',
          current_performance: {
            win_rate: metrics.winRate,
            profit_factor: metrics.profitFactor,
            total_trades: metrics.totalTrades,
            total_pnl: metrics.netPnL,
            avg_win: metrics.avgWin,
            avg_loss: metrics.avgLoss,
            max_drawdown: metrics.maxDrawdown
          },
          recommendations: paramRecommendations,
          asset_insights: assetAnalysis.allAssets.slice(0, 5).map(a => ({
            asset: a.symbol,
            performance: a.totalPnL > 0 ? 'profitable' : 'unprofitable',
            trades: a.trades,
            pnl: a.totalPnL,
            recommendation: a.totalPnL < -50 ? 'avoid' : a.totalPnL > 100 ? 'focus' : 'monitor'
          })),
          market_opportunities: aiAnalysis.opportunities || [],
          analysis_period: {
            start_date: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
            end_date: new Date().toISOString(),
            trades_analyzed: metrics.totalTrades
          }
        });
      }

    } catch (error) {
      console.error('Analysis failed:', error);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const generateAIInsights = async (metrics, issues, assetAnalysis, paramRecommendations, settings, preferences) => {
    try {
      // Generate personalized context
      const personalizedContext = preferences
        ? generatePersonalizedPrompt(metrics, issues, assetAnalysis, preferences)
        : '';

      const prompt = `As an expert trading advisor, analyze this trader's performance and provide actionable insights:

**Performance Metrics:**
- Total Trades: ${metrics.totalTrades}
- Win Rate: ${metrics.winRate}%
- Profit Factor: ${metrics.profitFactor}
- Net P&L: $${metrics.netPnL}
- Max Drawdown: ${metrics.maxDrawdown}%
- Average Win: $${metrics.avgWin}
- Average Loss: $${metrics.avgLoss}

**Current Issues:**
${issues.map(i => `- ${i.description}`).join('\n')}

**Top Performing Assets:**
${assetAnalysis.bestPerformers.map(a => `- ${a.symbol}: ${a.trades} trades, $${a.totalPnL.toFixed(2)} P&L, ${a.winRate.toFixed(0)}% win rate`).join('\n')}

**Worst Performing Assets:**
${assetAnalysis.worstPerformers.map(a => `- ${a.symbol}: ${a.trades} trades, $${a.totalPnL.toFixed(2)} P&L, ${a.winRate.toFixed(0)}% win rate`).join('\n')}

**Current Settings:**
- Min Confidence: ${settings?.min_confidence || 70}%
- Stop Loss: ${settings?.stop_loss_percent || 3}%
- Take Profit: ${settings?.take_profit_percent || 8}%
- Position Size: ${settings?.max_position_size_percent || 10}%
- Trailing Stop: ${settings?.use_trailing_stop ? 'Enabled' : 'Disabled'}

${personalizedContext ? `**User Preferences:**\n${personalizedContext}` : ''}

Provide:
1. A clear assessment of trading performance (2-3 sentences) - tailor it to their trading style and preferences
2. Top 3 specific actions to improve results - aligned with their risk tolerance and goals
3. Asset allocation recommendations - consider their preferred and excluded assets
4. Risk management advice - match their risk tolerance level
5. New market opportunities - filtered by their preferences (market cap, volatility, etc.)`;

      const result = await base44.integrations.Core.InvokeLLM({
        prompt,
        add_context_from_internet: false,
        response_json_schema: {
          type: "object",
          properties: {
            title: { type: "string" },
            summary: { type: "string" },
            performance_grade: { type: "string", enum: ["excellent", "good", "fair", "poor", "critical"] },
            key_strengths: { type: "array", items: { type: "string" } },
            critical_issues: { type: "array", items: { type: "string" } },
            top_3_actions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  action: { type: "string" },
                  reason: { type: "string" },
                  expected_impact: { type: "string" }
                }
              }
            },
            asset_recommendations: {
              type: "object",
              properties: {
                focus_on: { type: "array", items: { type: "string" } },
                avoid: { type: "array", items: { type: "string" } },
                reasoning: { type: "string" }
              }
            },
            risk_advice: { type: "string" },
            opportunities: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  asset: { type: "string" },
                  opportunity_type: { type: "string" },
                  confidence: { type: "number" },
                  reasoning: { type: "string" }
                }
              }
            },
            personalization_note: {
              type: "string",
              description: "A note about how recommendations were tailored to user preferences"
            }
          }
        }
      });

      return result;
    } catch (error) {
      console.error('AI insights generation failed:', error);
      return null;
    }
  };

  const handleApplyRecommendation = async (recommendation) => {
    if (onApplyRecommendation) {
      onApplyRecommendation(recommendation);
    }
  };

  const handleDismissInsight = async (insightId) => {
    await updateInsightMutation.mutateAsync({
      id: insightId,
      data: { is_dismissed: true }
    });
  };

  const getGradeColor = (grade) => {
    switch(grade) {
      case 'excellent': return 'text-green-400 bg-green-500/20 border-green-500/30';
      case 'good': return 'text-blue-400 bg-blue-500/20 border-blue-500/30';
      case 'fair': return 'text-yellow-400 bg-yellow-500/20 border-yellow-500/30';
      case 'poor': return 'text-orange-400 bg-orange-500/20 border-orange-500/30';
      case 'critical': return 'text-red-400 bg-red-500/20 border-red-500/30';
      default: return 'text-slate-400 bg-slate-500/20 border-slate-500/30';
    }
  };

  const getSeverityColor = (severity) => {
    switch(severity) {
      case 'critical': return 'bg-red-500/20 text-red-400 border-red-500/40';
      case 'high': return 'bg-orange-500/20 text-orange-400 border-orange-500/40';
      case 'medium': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/40';
      case 'low': return 'bg-blue-500/20 text-blue-400 border-blue-500/40';
      default: return 'bg-slate-500/20 text-slate-400 border-slate-500/40';
    }
  };

  if (!trades || trades.length < 5) {
    return (
      <Card className="bg-gradient-to-br from-slate-900 to-slate-800 border-slate-700">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-white">
            <Sparkles className="w-5 h-5 text-indigo-400" />
            AI Trading Advisor
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <Lightbulb className="w-12 h-12 text-indigo-400 mx-auto mb-4" />
            <p className="text-slate-300 mb-2">Complete at least 5 trades to unlock AI-powered insights</p>
            <p className="text-slate-400 text-sm">
              The advisor will analyze your performance and provide personalized recommendations
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-gradient-to-br from-slate-900 to-slate-800 border-indigo-500/40 hover:border-indigo-500/60 transition-all">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-white">
            <Sparkles className="w-5 h-5 text-indigo-400 animate-pulse" />
            AI Trading Advisor
            {aiInsights?.aiAnalysis && (
              <Badge className={getGradeColor(aiInsights.aiAnalysis.performance_grade)}>
                {aiInsights.aiAnalysis.performance_grade?.toUpperCase()}
              </Badge>
            )}
            {preferences && (
              <Badge className="bg-purple-500/20 text-purple-300 border-purple-500/30">
                Personalized
              </Badge>
            )}
          </CardTitle>
          <div className="flex gap-2">
            <Button
              onClick={handleAnalyze}
              disabled={isAnalyzing}
              size="sm"
              className="bg-indigo-600 hover:bg-indigo-700"
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${isAnalyzing ? 'animate-spin' : ''}`} />
              {isAnalyzing ? 'Analyzing...' : 'Refresh Analysis'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsExpanded(!isExpanded)}
              className="text-white hover:bg-white/10"
            >
              {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        {isAnalyzing ? (
          <div className="py-12 text-center">
            <div className="inline-flex items-center gap-3 mb-4">
              <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
              <span className="text-indigo-200 text-lg font-semibold">
                {preferences ? 'Personalizing your insights...' : 'Analyzing your trading performance...'}
              </span>
            </div>
            <p className="text-indigo-300 text-sm">
              {preferences
                ? `Tailoring analysis to your ${preferences.trading_style.replace(/_/g, ' ')} trading style and ${preferences.risk_tolerance.replace(/_/g, ' ')} risk tolerance`
                : 'Evaluating metrics and generating recommendations'
              }
            </p>
          </div>
        ) : aiInsights?.aiAnalysis ? (
          <>
            {/* Personalization Note */}
            {aiInsights.aiAnalysis.personalization_note && preferences && (
              <div className="bg-purple-500/10 border border-purple-500/30 rounded-xl p-4 mb-4">
                <div className="flex items-start gap-2">
                  <Sparkles className="w-5 h-5 text-purple-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <h4 className="text-purple-300 font-semibold mb-1">Personalized for You</h4>
                    <p className="text-purple-200 text-sm">{aiInsights.aiAnalysis.personalization_note}</p>
                  </div>
                </div>
              </div>
            )}

            <Tabs defaultValue="overview" className="w-full">
              <TabsList className="bg-slate-800/50 border-slate-700 w-full justify-start mb-4">
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="issues">Issues ({aiInsights.issues.length})</TabsTrigger>
                <TabsTrigger value="recommendations">Recommendations</TabsTrigger>
                <TabsTrigger value="assets">Asset Analysis</TabsTrigger>
                {isExpanded && <TabsTrigger value="metrics">Detailed Metrics</TabsTrigger>}
                {preferences && <TabsTrigger value="preferences">Your Preferences</TabsTrigger>}
              </TabsList>

              {/* Overview Tab */}
              <TabsContent value="overview" className="space-y-4">
                {/* AI Summary */}
                <div className="bg-indigo-500/10 border border-indigo-500/30 rounded-xl p-4">
                  <h3 className="text-lg font-semibold text-white mb-2">{aiInsights.aiAnalysis.title}</h3>
                  <p className="text-slate-300 leading-relaxed">{aiInsights.aiAnalysis.summary}</p>
                </div>

                {/* Key Metrics Grid */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700">
                    <p className="text-slate-400 text-xs mb-1">Win Rate</p>
                    <p className="text-xl font-bold text-white">{performanceMetrics.winRate}%</p>
                    <Progress value={performanceMetrics.winRate} className="h-1 mt-2" />
                  </div>
                  <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700">
                    <p className="text-slate-400 text-xs mb-1">Profit Factor</p>
                    <p className="text-xl font-bold text-white">{performanceMetrics.profitFactor}</p>
                  </div>
                  <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700">
                    <p className="text-slate-400 text-xs mb-1">Net P&L</p>
                    <p className={`text-xl font-bold ${performanceMetrics.netPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      ${performanceMetrics.netPnL}
                    </p>
                  </div>
                  <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700">
                    <p className="text-slate-400 text-xs mb-1">Max Drawdown</p>
                    <p className="text-xl font-bold text-red-400">{performanceMetrics.maxDrawdown}%</p>
                  </div>
                </div>

                {/* Top 3 Actions */}
                <div>
                  <h4 className="text-white font-semibold mb-3 flex items-center gap-2">
                    <Target className="w-4 h-4 text-indigo-400" />
                    Top 3 Actions to Improve
                  </h4>
                  <div className="space-y-3">
                    {aiInsights.aiAnalysis.top_3_actions?.map((action, idx) => (
                      <motion.div
                        key={idx}
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: idx * 0.1 }}
                        className="bg-slate-800/50 border border-slate-700 rounded-lg p-4"
                      >
                        <div className="flex items-start gap-3">
                          <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center flex-shrink-0">
                            <span className="text-white font-bold">{idx + 1}</span>
                          </div>
                          <div className="flex-1">
                            <h5 className="text-white font-semibold mb-1">{action.action}</h5>
                            <p className="text-slate-300 text-sm mb-2">{action.reason}</p>
                            <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
                              Expected: {action.expected_impact}
                            </Badge>
                          </div>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                </div>
              </TabsContent>

              {/* Issues Tab */}
              <TabsContent value="issues" className="space-y-3">
                {aiInsights.issues.length === 0 ? (
                  <div className="text-center py-8">
                    <CheckCircle className="w-12 h-12 text-green-400 mx-auto mb-3" />
                    <p className="text-green-300 font-semibold">No critical issues detected!</p>
                    <p className="text-slate-400 text-sm">Your trading strategy is performing well</p>
                  </div>
                ) : (
                  aiInsights.issues.map((issue, idx) => (
                    <motion.div
                      key={idx}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: idx * 0.1 }}
                      className={`rounded-xl p-4 border ${getSeverityColor(issue.severity)}`}
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="flex items-center gap-2 mb-2">
                            <AlertTriangle className="w-5 h-5" />
                            <h4 className="font-semibold">{issue.metric}</h4>
                            <Badge className={getSeverityColor(issue.severity)}>
                              {issue.severity.toUpperCase()}
                            </Badge>
                          </div>
                          <p className="text-sm mb-2">{issue.description}</p>
                          <div className="flex gap-4 text-xs">
                            <span>Current: <strong>{issue.value}</strong></span>
                            <span>Target: <strong>{issue.threshold}</strong></span>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  ))
                )}
              </TabsContent>

              {/* Recommendations Tab */}
              <TabsContent value="recommendations" className="space-y-3">
                {aiInsights.paramRecommendations.length === 0 ? (
                  <div className="text-center py-8">
                    <Award className="w-12 h-12 text-indigo-400 mx-auto mb-3" />
                    <p className="text-indigo-300 font-semibold">Your settings are optimized!</p>
                    <p className="text-slate-400 text-sm">No parameter adjustments needed at this time</p>
                  </div>
                ) : (
                  aiInsights.paramRecommendations.map((rec, idx) => (
                    <motion.div
                      key={idx}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: idx * 0.1 }}
                      className="bg-slate-800/50 border border-slate-700 rounded-xl p-4"
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <h4 className="text-white font-semibold mb-1 capitalize">
                            {rec.parameter.replace(/_/g, ' ')}
                          </h4>
                          <p className="text-slate-300 text-sm mb-2">{rec.reason}</p>
                        </div>
                        <Button
                          size="sm"
                          onClick={() => handleApplyRecommendation(rec)}
                          className="bg-indigo-600 hover:bg-indigo-700"
                        >
                          Apply
                        </Button>
                      </div>
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div className="bg-slate-900/50 rounded p-2">
                          <p className="text-slate-400 text-xs mb-1">Current</p>
                          <p className="text-white font-semibold">{rec.current_value}</p>
                        </div>
                        <div className="bg-indigo-900/30 rounded p-2">
                          <p className="text-indigo-300 text-xs mb-1">Suggested</p>
                          <p className="text-indigo-200 font-semibold">{rec.suggested_value}</p>
                        </div>
                      </div>
                      <div className="mt-2 p-2 bg-green-500/10 rounded">
                        <p className="text-green-300 text-xs">
                          <Lightbulb className="w-3 h-3 inline mr-1" />
                          {rec.expected_improvement}
                        </p>
                      </div>
                    </motion.div>
                  ))
                )}
              </TabsContent>

              {/* Asset Analysis Tab */}
              <TabsContent value="assets" className="space-y-4">
                {/* Best Performers */}
                {aiInsights.assetAnalysis.bestPerformers.length > 0 && (
                  <div>
                    <h4 className="text-white font-semibold mb-3 flex items-center gap-2">
                      <TrendingUp className="w-4 h-4 text-green-400" />
                      Top Performers
                    </h4>
                    <div className="space-y-2">
                      {aiInsights.assetAnalysis.bestPerformers.map((asset, idx) => (
                        <div key={idx} className="bg-green-500/10 border border-green-500/30 rounded-lg p-3">
                          <div className="flex items-center justify-between">
                            <div>
                              <h5 className="text-white font-semibold">{asset.symbol}</h5>
                              <p className="text-green-300 text-sm">{asset.trades} trades • {asset.winRate.toFixed(0)}% win rate</p>
                            </div>
                            <div className="text-right">
                              <p className="text-green-400 font-bold text-lg">+${asset.totalPnL.toFixed(2)}</p>
                              <Badge className="bg-green-500/20 text-green-400 border-green-500/30 text-xs">
                                Continue Trading
                              </Badge>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Underperformers */}
                {aiInsights.assetAnalysis.worstPerformers.length > 0 && (
                  <div>
                    <h4 className="text-white font-semibold mb-3 flex items-center gap-2">
                      <TrendingDown className="w-4 h-4 text-red-400" />
                      Underperformers
                    </h4>
                    <div className="space-y-2">
                      {aiInsights.assetAnalysis.worstPerformers.map((asset, idx) => (
                        <div key={idx} className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                          <div className="flex items-center justify-between">
                            <div>
                              <h5 className="text-white font-semibold">{asset.symbol}</h5>
                              <p className="text-red-300 text-sm">{asset.trades} trades • {asset.winRate.toFixed(0)}% win rate</p>
                            </div>
                            <div className="text-right">
                              <p className="text-red-400 font-bold text-lg">${asset.totalPnL.toFixed(2)}</p>
                              <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-xs">
                                Consider Avoiding
                              </Badge>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Asset Recommendations */}
                {aiInsights.aiAnalysis.asset_recommendations && (
                  <div className="bg-indigo-500/10 border border-indigo-500/30 rounded-xl p-4">
                    <h4 className="text-white font-semibold mb-2">AI Asset Recommendations</h4>
                    <p className="text-slate-300 text-sm mb-3">{aiInsights.aiAnalysis.asset_recommendations.reasoning}</p>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-green-400 font-semibold text-sm mb-2">Focus On:</p>
                        <div className="flex flex-wrap gap-1">
                          {aiInsights.aiAnalysis.asset_recommendations.focus_on?.map((asset, idx) => (
                            <Badge key={idx} className="bg-green-500/20 text-green-400 border-green-500/30">
                              {asset}
                            </Badge>
                          ))}
                        </div>
                      </div>
                      <div>
                        <p className="text-red-400 font-semibold text-sm mb-2">Avoid:</p>
                        <div className="flex flex-wrap gap-1">
                          {aiInsights.aiAnalysis.asset_recommendations.avoid?.map((asset, idx) => (
                            <Badge key={idx} className="bg-red-500/20 text-red-400 border-red-500/30">
                              {asset}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </TabsContent>

              {/* Detailed Metrics Tab */}
              {isExpanded && (
                <TabsContent value="metrics" className="space-y-4">
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700">
                      <p className="text-slate-400 text-xs mb-1">Total Trades</p>
                      <p className="text-xl font-bold text-white">{performanceMetrics.totalTrades}</p>
                    </div>
                    <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700">
                      <p className="text-slate-400 text-xs mb-1">Winning Trades</p>
                      <p className="text-xl font-bold text-green-400">{performanceMetrics.winningTrades}</p>
                    </div>
                    <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700">
                      <p className="text-slate-400 text-xs mb-1">Losing Trades</p>
                      <p className="text-xl font-bold text-red-400">{performanceMetrics.losingTrades}</p>
                    </div>
                    <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700">
                      <p className="text-slate-400 text-xs mb-1">Total Profit</p>
                      <p className="text-xl font-bold text-green-400">${performanceMetrics.totalProfit}</p>
                    </div>
                    <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700">
                      <p className="text-slate-400 text-xs mb-1">Total Loss</p>
                      <p className="text-xl font-bold text-red-400">${performanceMetrics.totalLoss}</p>
                    </div>
                    <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700">
                      <p className="text-slate-400 text-xs mb-1">Avg Win</p>
                      <p className="text-xl font-bold text-white">${performanceMetrics.avgWin}</p>
                    </div>
                    <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700">
                      <p className="text-slate-400 text-xs mb-1">Avg Loss</p>
                      <p className="text-xl font-bold text-white">${performanceMetrics.avgLoss}</p>
                    </div>
                    <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700">
                      <p className="text-slate-400 text-xs mb-1">Recent Win Rate</p>
                      <p className="text-xl font-bold text-white">{performanceMetrics.recentWinRate}%</p>
                    </div>
                    <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700">
                      <p className="text-slate-400 text-xs mb-1">Auto-Trade Win Rate</p>
                      <p className="text-xl font-bold text-white">{performanceMetrics.autoTradeWinRate}%</p>
                    </div>
                  </div>
                </TabsContent>
              )}

              {/* New Preferences Tab */}
              {preferences && (
                <TabsContent value="preferences" className="space-y-4">
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700">
                      <p className="text-slate-400 text-xs mb-1">Trading Style</p>
                      <p className="text-white font-semibold capitalize">{preferences.trading_style.replace(/_/g, ' ')}</p>
                    </div>
                    <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700">
                      <p className="text-slate-400 text-xs mb-1">Risk Tolerance</p>
                      <p className="text-white font-semibold capitalize">{preferences.risk_tolerance.replace(/_/g, ' ')}</p>
                    </div>
                    <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700">
                      <p className="text-slate-400 text-xs mb-1">Timeframe</p>
                      <p className="text-white font-semibold capitalize">{preferences.investment_timeframe.replace(/_/g, ' ')}</p>
                    </div>
                  </div>

                  {preferences.preferred_assets && preferences.preferred_assets.length > 0 && (
                    <div className="bg-indigo-500/10 border border-indigo-500/30 rounded-xl p-4">
                      <h4 className="text-white font-semibold mb-2">Preferred Assets</h4>
                      <div className="flex flex-wrap gap-2">
                        {preferences.preferred_assets.map(asset => (
                          <Badge key={asset} className="bg-indigo-500/20 text-indigo-300 border-indigo-500/30">
                            {asset}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {preferences.goals && (
                    <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-4">
                      <h4 className="text-white font-semibold mb-3">Your Goals</h4>
                      <div className="grid grid-cols-2 gap-4">
                        {preferences.goals.target_monthly_return && (
                          <div>
                            <p className="text-slate-400 text-sm">Monthly Target</p>
                            <p className="text-green-400 font-bold text-lg">{preferences.goals.target_monthly_return}%</p>
                          </div>
                        )}
                        {preferences.goals.target_annual_return && (
                          <div>
                            <p className="text-slate-400 text-sm">Annual Target</p>
                            <p className="text-green-400 font-bold text-lg">{preferences.goals.target_annual_return}%</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="text-center pt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => window.location.href = '/Insights'}
                      className="border-indigo-500/50 text-indigo-400 hover:bg-indigo-500/10"
                    >
                      <Settings className="w-4 h-4 mr-2" />
                      Edit Preferences
                    </Button>
                  </div>
                </TabsContent>
              )}
            </Tabs>
          </>
        ) : (
          <div className="text-center py-8">
            <Activity className="w-12 h-12 text-indigo-400 mx-auto mb-3" />
            <p className="text-slate-300 mb-3">
              {preferences ? 'Ready to analyze with your personalized preferences' : 'Ready to analyze your trading performance'}
            </p>
            <Button onClick={handleAnalyze} className="bg-indigo-600 hover:bg-indigo-700">
              <Sparkles className="w-4 h-4 mr-2" />
              Start Analysis
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}