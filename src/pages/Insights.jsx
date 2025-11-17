
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles, TrendingUp, AlertCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import AITradingAdvisor from "../components/trading/AITradingAdvisor";
import TradingPreferencesForm from "../components/trading/TradingPreferencesForm";

export default function Insights() {
  const queryClient = useQueryClient();

  const { data: portfolio } = useQuery({
    queryKey: ['portfolio'],
    queryFn: async () => {
      const result = await base44.entities.Portfolio.list();
      return result[0] || null;
    },
  });

  const { data: trades } = useQuery({
    queryKey: ['trades'],
    queryFn: () => base44.entities.Trade.list('-created_date', 100),
    initialData: [],
  });

  const { data: autoTradingSettings } = useQuery({
    queryKey: ['auto-trading-settings'],
    queryFn: async () => {
      const result = await base44.entities.AutoTradingSettings.list();
      return result[0];
    },
  });

  const handleApplyAdvisorRecommendation = async (recommendation) => {
    if (!autoTradingSettings?.id) {
      alert('Auto-trading settings not found');
      return;
    }

    try {
      const updatedSettings = { ...autoTradingSettings };
      
      if (recommendation.parameter === 'use_trailing_stop' || 
          recommendation.parameter === 'use_breakeven_protection') {
        updatedSettings[recommendation.parameter] = recommendation.suggested_value === 1;
      } else if (recommendation.parameter === 'allowed_risk_levels') {
        updatedSettings[recommendation.parameter] = recommendation.suggested_value === 1 
          ? ['low'] 
          : ['low', 'medium'];
      } else {
        updatedSettings[recommendation.parameter] = recommendation.suggested_value;
      }

      await base44.entities.AutoTradingSettings.update(autoTradingSettings.id, updatedSettings);
      queryClient.invalidateQueries({ queryKey: ['auto-trading-settings'] });
      
      alert(`Successfully updated ${recommendation.parameter.replace(/_/g, ' ')}`);
    } catch (error) {
      console.error('Failed to apply recommendation:', error);
      alert('Failed to apply recommendation');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-12 h-12 bg-gradient-to-br from-indigo-600 to-purple-600 rounded-2xl flex items-center justify-center">
              <Sparkles className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-4xl font-bold bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">
                AI Trading Insights
              </h1>
              <p className="text-slate-400">
                Personalized performance analysis and strategy recommendations
              </p>
            </div>
          </div>
        </div>

        {/* Info Banner */}
        <div className="bg-gradient-to-r from-indigo-500/10 to-purple-500/10 border border-indigo-500/30 rounded-2xl p-6 mb-8">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 bg-indigo-600 rounded-xl flex items-center justify-center flex-shrink-0">
              <TrendingUp className="w-6 h-6 text-white" />
            </div>
            <div className="flex-1">
              <h3 className="text-xl font-semibold text-white mb-2">
                AI-Powered Performance Analysis
              </h3>
              <p className="text-slate-300 mb-3">
                Our advanced AI analyzes your trading history, identifies patterns, and provides actionable 
                recommendations to optimize your strategy. Get insights on risk management, asset allocation, 
                and parameter tuning to improve your trading performance.
              </p>
              <div className="flex flex-wrap gap-2">
                <Badge className="bg-indigo-500/20 text-indigo-300 border-indigo-500/30">
                  Performance Metrics
                </Badge>
                <Badge className="bg-purple-500/20 text-purple-300 border-purple-500/30">
                  Strategy Optimization
                </Badge>
                <Badge className="bg-blue-500/20 text-blue-300 border-blue-500/30">
                  Risk Analysis
                </Badge>
                <Badge className="bg-pink-500/20 text-pink-300 border-pink-500/30">
                  Asset Recommendations
                </Badge>
              </div>
            </div>
          </div>
        </div>

        {/* Trading Preferences Section */}
        <div className="mb-8">
          <TradingPreferencesForm />
        </div>

        {/* Minimum Trades Warning */}
        {trades && trades.length < 5 && (
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-2xl p-6 mb-8">
            <div className="flex items-start gap-4">
              <AlertCircle className="w-6 h-6 text-yellow-400 flex-shrink-0 mt-1" />
              <div>
                <h3 className="text-lg font-semibold text-yellow-300 mb-2">
                  More Data Needed for Analysis
                </h3>
                <p className="text-yellow-200 mb-3">
                  You currently have {trades.length} trade{trades.length !== 1 ? 's' : ''}. 
                  Complete at least 5 trades to unlock AI-powered insights and personalized recommendations.
                </p>
                <p className="text-yellow-200/80 text-sm">
                  💡 Tip: Start trading on the Trading page to build your history and get valuable insights!
                </p>
              </div>
            </div>
          </div>
        )}

        {/* AI Trading Advisor Component */}
        <AITradingAdvisor
          trades={trades}
          portfolio={portfolio}
          autoTradingSettings={autoTradingSettings}
          onApplyRecommendation={handleApplyAdvisorRecommendation}
        />

        {/* Additional Info Section for users with enough trades */}
        {trades && trades.length >= 5 && (
          <div className="mt-8 bg-slate-900/50 border border-slate-700 rounded-2xl p-6">
            <h3 className="text-lg font-semibold text-white mb-4">How to Use AI Insights</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center flex-shrink-0">
                    <span className="text-white font-bold">1</span>
                  </div>
                  <div>
                    <h4 className="text-white font-semibold mb-1">Review Your Performance</h4>
                    <p className="text-slate-400 text-sm">
                      Check the Overview tab to see your current metrics, win rate, and profit factor.
                    </p>
                  </div>
                </div>
              </div>
              <div>
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 bg-purple-600 rounded-lg flex items-center justify-center flex-shrink-0">
                    <span className="text-white font-bold">2</span>
                  </div>
                  <div>
                    <h4 className="text-white font-semibold mb-1">Identify Issues</h4>
                    <p className="text-slate-400 text-sm">
                      The Issues tab highlights problems in your strategy that need attention.
                    </p>
                  </div>
                </div>
              </div>
              <div>
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center flex-shrink-0">
                    <span className="text-white font-bold">3</span>
                  </div>
                  <div>
                    <h4 className="text-white font-semibold mb-1">Apply Recommendations</h4>
                    <p className="text-slate-400 text-sm">
                      Use the "Apply" button on recommendations to optimize your auto-trading settings.
                    </p>
                  </div>
                </div>
              </div>
              <div>
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 bg-pink-600 rounded-lg flex items-center justify-center flex-shrink-0">
                    <span className="text-white font-bold">4</span>
                  </div>
                  <div>
                    <h4 className="text-white font-semibold mb-1">Monitor Asset Performance</h4>
                    <p className="text-slate-400 text-sm">
                      Check which assets are performing well and adjust your focus accordingly.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
