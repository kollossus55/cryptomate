import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Settings, 
  Target, 
  Shield, 
  Clock,
  Bell,
  Save,
  Sparkles,
  CheckCircle2
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export default function TradingPreferencesForm({ onSave }) {
  const queryClient = useQueryClient();
  const [showSuccess, setShowSuccess] = useState(false);

  const { data: preferences, isLoading } = useQuery({
    queryKey: ['trading-preferences'],
    queryFn: async () => {
      const result = await base44.entities.TradingPreferences.list();
      return result[0] || null;
    },
  });

  const [formData, setFormData] = useState({
    trading_style: 'balanced',
    risk_tolerance: 'moderate',
    preferred_assets: [],
    excluded_assets: [],
    investment_timeframe: 'medium_term',
    max_position_count: 5,
    preferred_profit_target: 10,
    max_loss_per_trade: 3,
    market_cap_preference: 'mixed',
    volatility_preference: 'moderate',
    diversification_level: 'moderate',
    use_technical_analysis: true,
    use_sentiment_analysis: true,
    use_fundamental_analysis: false,
    rebalancing_frequency: 'weekly',
    notification_preferences: {
      critical_only: false,
      opportunity_alerts: true,
      performance_updates: true
    },
    goals: {
      target_monthly_return: 5,
      target_annual_return: 60,
      capital_preservation: false
    }
  });

  const [assetInput, setAssetInput] = useState('');
  const [excludedAssetInput, setExcludedAssetInput] = useState('');

  useEffect(() => {
    if (preferences) {
      setFormData(preferences);
    }
  }, [preferences]);

  const createPreferencesMutation = useMutation({
    mutationFn: (data) => base44.entities.TradingPreferences.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trading-preferences'] });
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 3000);
      if (onSave) onSave();
    },
  });

  const updatePreferencesMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.TradingPreferences.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trading-preferences'] });
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 3000);
      if (onSave) onSave();
    },
  });

  const handleSave = async () => {
    if (preferences?.id) {
      await updatePreferencesMutation.mutateAsync({
        id: preferences.id,
        data: formData
      });
    } else {
      await createPreferencesMutation.mutateAsync(formData);
    }
  };

  const addPreferredAsset = () => {
    if (assetInput && !formData.preferred_assets.includes(assetInput.toUpperCase())) {
      setFormData({
        ...formData,
        preferred_assets: [...formData.preferred_assets, assetInput.toUpperCase()]
      });
      setAssetInput('');
    }
  };

  const removePreferredAsset = (asset) => {
    setFormData({
      ...formData,
      preferred_assets: formData.preferred_assets.filter(a => a !== asset)
    });
  };

  const addExcludedAsset = () => {
    if (excludedAssetInput && !formData.excluded_assets.includes(excludedAssetInput.toUpperCase())) {
      setFormData({
        ...formData,
        excluded_assets: [...formData.excluded_assets, excludedAssetInput.toUpperCase()]
      });
      setExcludedAssetInput('');
    }
  };

  const removeExcludedAsset = (asset) => {
    setFormData({
      ...formData,
      excluded_assets: formData.excluded_assets.filter(a => a !== asset)
    });
  };

  if (isLoading) {
    return (
      <Card className="bg-slate-900 border-slate-700">
        <CardContent className="py-12 text-center">
          <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
          <p className="text-slate-300">Loading preferences...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-gradient-to-br from-slate-900 to-slate-800 border-indigo-500/40">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-white">
            <Settings className="w-5 h-5 text-indigo-400" />
            Trading Preferences
          </CardTitle>
          <AnimatePresence>
            {showSuccess && (
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
              >
                <Badge className="bg-green-500 text-white">
                  <CheckCircle2 className="w-3 h-3 mr-1" />
                  Saved!
                </Badge>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </CardHeader>

      <CardContent>
        <Tabs defaultValue="style" className="w-full">
          <TabsList className="bg-slate-800/50 border-slate-700 w-full justify-start mb-6">
            <TabsTrigger value="style">Trading Style</TabsTrigger>
            <TabsTrigger value="risk">Risk & Goals</TabsTrigger>
            <TabsTrigger value="assets">Assets</TabsTrigger>
            <TabsTrigger value="analysis">Analysis</TabsTrigger>
            <TabsTrigger value="notifications">Notifications</TabsTrigger>
          </TabsList>

          {/* Trading Style Tab */}
          <TabsContent value="style" className="space-y-6">
            <div>
              <Label className="text-white mb-3 block">Trading Style</Label>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {[
                  { value: 'conservative', label: 'Conservative', icon: '🛡️', desc: 'Safety first' },
                  { value: 'balanced', label: 'Balanced', icon: '⚖️', desc: 'Mix of growth & safety' },
                  { value: 'aggressive', label: 'Aggressive', icon: '🚀', desc: 'High growth potential' },
                  { value: 'day_trader', label: 'Day Trader', icon: '⚡', desc: 'Quick in & out' },
                  { value: 'swing_trader', label: 'Swing Trader', icon: '📈', desc: 'Multi-day holds' }
                ].map(style => (
                  <button
                    key={style.value}
                    onClick={() => setFormData({ ...formData, trading_style: style.value })}
                    className={`p-4 rounded-xl border-2 transition-all ${
                      formData.trading_style === style.value
                        ? 'border-indigo-500 bg-indigo-500/20'
                        : 'border-slate-700 bg-slate-800/50 hover:border-slate-600'
                    }`}
                  >
                    <div className="text-2xl mb-2">{style.icon}</div>
                    <div className="font-semibold text-white text-sm mb-1">{style.label}</div>
                    <div className="text-xs text-slate-400">{style.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <Label className="text-white mb-3 block">Investment Timeframe</Label>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { value: 'short_term', label: 'Short Term', desc: '< 1 month' },
                  { value: 'medium_term', label: 'Medium Term', desc: '1-6 months' },
                  { value: 'long_term', label: 'Long Term', desc: '6+ months' }
                ].map(tf => (
                  <button
                    key={tf.value}
                    onClick={() => setFormData({ ...formData, investment_timeframe: tf.value })}
                    className={`p-4 rounded-xl border-2 transition-all ${
                      formData.investment_timeframe === tf.value
                        ? 'border-purple-500 bg-purple-500/20'
                        : 'border-slate-700 bg-slate-800/50 hover:border-slate-600'
                    }`}
                  >
                    <div className="font-semibold text-white text-sm mb-1">{tf.label}</div>
                    <div className="text-xs text-slate-400">{tf.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <Label className="text-white mb-3 block">Portfolio Diversification</Label>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { value: 'focused', label: 'Focused', desc: '1-3 assets' },
                  { value: 'moderate', label: 'Moderate', desc: '4-8 assets' },
                  { value: 'highly_diversified', label: 'Highly Diversified', desc: '9+ assets' }
                ].map(div => (
                  <button
                    key={div.value}
                    onClick={() => setFormData({ ...formData, diversification_level: div.value })}
                    className={`p-4 rounded-xl border-2 transition-all ${
                      formData.diversification_level === div.value
                        ? 'border-green-500 bg-green-500/20'
                        : 'border-slate-700 bg-slate-800/50 hover:border-slate-600'
                    }`}
                  >
                    <div className="font-semibold text-white text-sm mb-1">{div.label}</div>
                    <div className="text-xs text-slate-400">{div.desc}</div>
                  </button>
                ))}
              </div>
            </div>
          </TabsContent>

          {/* Risk & Goals Tab */}
          <TabsContent value="risk" className="space-y-6">
            <div>
              <Label className="text-white mb-3 block flex items-center gap-2">
                <Shield className="w-4 h-4 text-yellow-400" />
                Risk Tolerance
              </Label>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                {[
                  { value: 'very_low', label: 'Very Low', color: 'green' },
                  { value: 'low', label: 'Low', color: 'blue' },
                  { value: 'moderate', label: 'Moderate', color: 'yellow' },
                  { value: 'high', label: 'High', color: 'orange' },
                  { value: 'very_high', label: 'Very High', color: 'red' }
                ].map(risk => (
                  <button
                    key={risk.value}
                    onClick={() => setFormData({ ...formData, risk_tolerance: risk.value })}
                    className={`p-4 rounded-xl border-2 transition-all ${
                      formData.risk_tolerance === risk.value
                        ? `border-${risk.color}-500 bg-${risk.color}-500/20`
                        : 'border-slate-700 bg-slate-800/50 hover:border-slate-600'
                    }`}
                  >
                    <div className="font-semibold text-white text-sm">{risk.label}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <Label htmlFor="max-positions" className="text-white">Max Simultaneous Positions</Label>
                <Input
                  id="max-positions"
                  type="number"
                  value={formData.max_position_count}
                  onChange={(e) => setFormData({ ...formData, max_position_count: parseInt(e.target.value) })}
                  className="bg-slate-800 border-slate-700 text-white mt-2"
                  min="1"
                  max="20"
                />
              </div>

              <div>
                <Label htmlFor="max-loss" className="text-white">Max Loss Per Trade (%)</Label>
                <Input
                  id="max-loss"
                  type="number"
                  value={formData.max_loss_per_trade}
                  onChange={(e) => setFormData({ ...formData, max_loss_per_trade: parseFloat(e.target.value) })}
                  className="bg-slate-800 border-slate-700 text-white mt-2"
                  min="0.5"
                  max="20"
                  step="0.5"
                />
              </div>
            </div>

            <div>
              <Label className="text-white mb-3 block flex items-center gap-2">
                <Target className="w-4 h-4 text-green-400" />
                Trading Goals
              </Label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <Label htmlFor="monthly-target" className="text-slate-300">Target Monthly Return (%)</Label>
                  <Input
                    id="monthly-target"
                    type="number"
                    value={formData.goals.target_monthly_return}
                    onChange={(e) => setFormData({
                      ...formData,
                      goals: { ...formData.goals, target_monthly_return: parseFloat(e.target.value) }
                    })}
                    className="bg-slate-800 border-slate-700 text-white mt-2"
                    min="1"
                    max="50"
                  />
                </div>

                <div>
                  <Label htmlFor="annual-target" className="text-slate-300">Target Annual Return (%)</Label>
                  <Input
                    id="annual-target"
                    type="number"
                    value={formData.goals.target_annual_return}
                    onChange={(e) => setFormData({
                      ...formData,
                      goals: { ...formData.goals, target_annual_return: parseFloat(e.target.value) }
                    })}
                    className="bg-slate-800 border-slate-700 text-white mt-2"
                    min="10"
                    max="500"
                  />
                </div>
              </div>

              <div className="mt-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.goals.capital_preservation}
                    onChange={(e) => setFormData({
                      ...formData,
                      goals: { ...formData.goals, capital_preservation: e.target.checked }
                    })}
                    className="w-4 h-4 rounded border-slate-700 bg-slate-800"
                  />
                  <span className="text-slate-300 text-sm">
                    Prioritize capital preservation over growth
                  </span>
                </label>
              </div>
            </div>
          </TabsContent>

          {/* Assets Tab */}
          <TabsContent value="assets" className="space-y-6">
            <div>
              <Label className="text-white mb-3 block">Preferred Assets</Label>
              <p className="text-slate-400 text-sm mb-3">Focus AI recommendations on these assets</p>
              <div className="flex gap-2 mb-3">
                <Input
                  placeholder="Enter symbol (e.g., BTC)"
                  value={assetInput}
                  onChange={(e) => setAssetInput(e.target.value.toUpperCase())}
                  onKeyPress={(e) => e.key === 'Enter' && addPreferredAsset()}
                  className="bg-slate-800 border-slate-700 text-white"
                />
                <Button onClick={addPreferredAsset} className="bg-indigo-600 hover:bg-indigo-700">
                  Add
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {formData.preferred_assets.map(asset => (
                  <Badge
                    key={asset}
                    className="bg-indigo-500/20 text-indigo-300 border-indigo-500/30 px-3 py-1 cursor-pointer hover:bg-indigo-500/30"
                    onClick={() => removePreferredAsset(asset)}
                  >
                    {asset} ✕
                  </Badge>
                ))}
                {formData.preferred_assets.length === 0 && (
                  <p className="text-slate-500 text-sm">No preferred assets set (all assets will be considered)</p>
                )}
              </div>
            </div>

            <div>
              <Label className="text-white mb-3 block">Excluded Assets</Label>
              <p className="text-slate-400 text-sm mb-3">Never recommend these assets</p>
              <div className="flex gap-2 mb-3">
                <Input
                  placeholder="Enter symbol (e.g., DOGE)"
                  value={excludedAssetInput}
                  onChange={(e) => setExcludedAssetInput(e.target.value.toUpperCase())}
                  onKeyPress={(e) => e.key === 'Enter' && addExcludedAsset()}
                  className="bg-slate-800 border-slate-700 text-white"
                />
                <Button onClick={addExcludedAsset} className="bg-red-600 hover:bg-red-700">
                  Add
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {formData.excluded_assets.map(asset => (
                  <Badge
                    key={asset}
                    className="bg-red-500/20 text-red-300 border-red-500/30 px-3 py-1 cursor-pointer hover:bg-red-500/30"
                    onClick={() => removeExcludedAsset(asset)}
                  >
                    {asset} ✕
                  </Badge>
                ))}
                {formData.excluded_assets.length === 0 && (
                  <p className="text-slate-500 text-sm">No excluded assets</p>
                )}
              </div>
            </div>

            <div>
              <Label className="text-white mb-3 block">Market Cap Preference</Label>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { value: 'large_cap', label: 'Large Cap', desc: '>$10B' },
                  { value: 'mid_cap', label: 'Mid Cap', desc: '$1B-$10B' },
                  { value: 'small_cap', label: 'Small Cap', desc: '<$1B' },
                  { value: 'mixed', label: 'Mixed', desc: 'All sizes' }
                ].map(cap => (
                  <button
                    key={cap.value}
                    onClick={() => setFormData({ ...formData, market_cap_preference: cap.value })}
                    className={`p-4 rounded-xl border-2 transition-all ${
                      formData.market_cap_preference === cap.value
                        ? 'border-cyan-500 bg-cyan-500/20'
                        : 'border-slate-700 bg-slate-800/50 hover:border-slate-600'
                    }`}
                  >
                    <div className="font-semibold text-white text-sm mb-1">{cap.label}</div>
                    <div className="text-xs text-slate-400">{cap.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <Label className="text-white mb-3 block">Volatility Preference</Label>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { value: 'low', label: 'Low Volatility', desc: 'Stable assets' },
                  { value: 'moderate', label: 'Moderate', desc: 'Balanced' },
                  { value: 'high', label: 'High Volatility', desc: 'High risk/reward' }
                ].map(vol => (
                  <button
                    key={vol.value}
                    onClick={() => setFormData({ ...formData, volatility_preference: vol.value })}
                    className={`p-4 rounded-xl border-2 transition-all ${
                      formData.volatility_preference === vol.value
                        ? 'border-orange-500 bg-orange-500/20'
                        : 'border-slate-700 bg-slate-800/50 hover:border-slate-600'
                    }`}
                  >
                    <div className="font-semibold text-white text-sm mb-1">{vol.label}</div>
                    <div className="text-xs text-slate-400">{vol.desc}</div>
                  </button>
                ))}
              </div>
            </div>
          </TabsContent>

          {/* Analysis Tab */}
          <TabsContent value="analysis" className="space-y-6">
            <div>
              <Label className="text-white mb-3 block flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-purple-400" />
                Analysis Methods
              </Label>
              <p className="text-slate-400 text-sm mb-4">Select which analysis methods AI should prioritize</p>
              <div className="space-y-3">
                <label className="flex items-start gap-3 p-4 rounded-xl border-2 border-slate-700 bg-slate-800/50 cursor-pointer hover:border-slate-600 transition-all">
                  <input
                    type="checkbox"
                    checked={formData.use_technical_analysis}
                    onChange={(e) => setFormData({ ...formData, use_technical_analysis: e.target.checked })}
                    className="w-5 h-5 rounded border-slate-700 bg-slate-800 mt-0.5"
                  />
                  <div className="flex-1">
                    <div className="font-semibold text-white mb-1">Technical Analysis</div>
                    <div className="text-sm text-slate-400">
                      Price patterns, indicators (RSI, MACD, etc.), support/resistance levels
                    </div>
                  </div>
                </label>

                <label className="flex items-start gap-3 p-4 rounded-xl border-2 border-slate-700 bg-slate-800/50 cursor-pointer hover:border-slate-600 transition-all">
                  <input
                    type="checkbox"
                    checked={formData.use_sentiment_analysis}
                    onChange={(e) => setFormData({ ...formData, use_sentiment_analysis: e.target.checked })}
                    className="w-5 h-5 rounded border-slate-700 bg-slate-800 mt-0.5"
                  />
                  <div className="flex-1">
                    <div className="font-semibold text-white mb-1">Sentiment Analysis</div>
                    <div className="text-sm text-slate-400">
                      News sentiment, social media trends, market psychology
                    </div>
                  </div>
                </label>

                <label className="flex items-start gap-3 p-4 rounded-xl border-2 border-slate-700 bg-slate-800/50 cursor-pointer hover:border-slate-600 transition-all">
                  <input
                    type="checkbox"
                    checked={formData.use_fundamental_analysis}
                    onChange={(e) => setFormData({ ...formData, use_fundamental_analysis: e.target.checked })}
                    className="w-5 h-5 rounded border-slate-700 bg-slate-800 mt-0.5"
                  />
                  <div className="flex-1">
                    <div className="font-semibold text-white mb-1">Fundamental Analysis</div>
                    <div className="text-sm text-slate-400">
                      On-chain metrics, adoption rates, network activity, tokenomics
                    </div>
                  </div>
                </label>
              </div>
            </div>

            <div>
              <Label className="text-white mb-3 block flex items-center gap-2">
                <Clock className="w-4 h-4 text-blue-400" />
                Portfolio Rebalancing
              </Label>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { value: 'daily', label: 'Daily' },
                  { value: 'weekly', label: 'Weekly' },
                  { value: 'monthly', label: 'Monthly' },
                  { value: 'as_needed', label: 'As Needed' }
                ].map(freq => (
                  <button
                    key={freq.value}
                    onClick={() => setFormData({ ...formData, rebalancing_frequency: freq.value })}
                    className={`p-4 rounded-xl border-2 transition-all ${
                      formData.rebalancing_frequency === freq.value
                        ? 'border-blue-500 bg-blue-500/20'
                        : 'border-slate-700 bg-slate-800/50 hover:border-slate-600'
                    }`}
                  >
                    <div className="font-semibold text-white text-sm">{freq.label}</div>
                  </button>
                ))}
              </div>
            </div>
          </TabsContent>

          {/* Notifications Tab */}
          <TabsContent value="notifications" className="space-y-6">
            <div>
              <Label className="text-white mb-3 block flex items-center gap-2">
                <Bell className="w-4 h-4 text-yellow-400" />
                Notification Preferences
              </Label>
              <div className="space-y-3">
                <label className="flex items-center gap-3 p-4 rounded-xl border-2 border-slate-700 bg-slate-800/50 cursor-pointer hover:border-slate-600">
                  <input
                    type="checkbox"
                    checked={formData.notification_preferences.critical_only}
                    onChange={(e) => setFormData({
                      ...formData,
                      notification_preferences: {
                        ...formData.notification_preferences,
                        critical_only: e.target.checked
                      }
                    })}
                    className="w-5 h-5 rounded border-slate-700 bg-slate-800"
                  />
                  <div className="flex-1">
                    <div className="font-semibold text-white">Critical Alerts Only</div>
                    <div className="text-sm text-slate-400">Only notify for important events</div>
                  </div>
                </label>

                <label className="flex items-center gap-3 p-4 rounded-xl border-2 border-slate-700 bg-slate-800/50 cursor-pointer hover:border-slate-600">
                  <input
                    type="checkbox"
                    checked={formData.notification_preferences.opportunity_alerts}
                    onChange={(e) => setFormData({
                      ...formData,
                      notification_preferences: {
                        ...formData.notification_preferences,
                        opportunity_alerts: e.target.checked
                      }
                    })}
                    className="w-5 h-5 rounded border-slate-700 bg-slate-800"
                  />
                  <div className="flex-1">
                    <div className="font-semibold text-white">Trading Opportunities</div>
                    <div className="text-sm text-slate-400">Get alerts for AI-detected opportunities</div>
                  </div>
                </label>

                <label className="flex items-center gap-3 p-4 rounded-xl border-2 border-slate-700 bg-slate-800/50 cursor-pointer hover:border-slate-600">
                  <input
                    type="checkbox"
                    checked={formData.notification_preferences.performance_updates}
                    onChange={(e) => setFormData({
                      ...formData,
                      notification_preferences: {
                        ...formData.notification_preferences,
                        performance_updates: e.target.checked
                      }
                    })}
                    className="w-5 h-5 rounded border-slate-700 bg-slate-800"
                  />
                  <div className="flex-1">
                    <div className="font-semibold text-white">Performance Updates</div>
                    <div className="text-sm text-slate-400">Regular updates on portfolio performance</div>
                  </div>
                </label>
              </div>
            </div>
          </TabsContent>
        </Tabs>

        <div className="mt-6 flex justify-end">
          <Button
            onClick={handleSave}
            disabled={createPreferencesMutation.isPending || updatePreferencesMutation.isPending}
            className="bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700"
          >
            <Save className="w-4 h-4 mr-2" />
            Save Preferences
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}