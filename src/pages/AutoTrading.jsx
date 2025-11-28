import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Sparkles, AlertTriangle, Shield, Zap, CheckCircle, Settings, TrendingUp, Target, AlertCircle, Clock, Server, Globe } from "lucide-react"; // Added AlertCircle and Clock icons
import { Checkbox } from "@/components/ui/checkbox";

export default function AutoTrading() {
  const [settings, setSettings] = useState({
    is_enabled: false,
    execution_mode: 'auto',
    min_confidence: 70,
    max_position_size_percent: 10,
    max_daily_loss_percent: 5,
    allowed_risk_levels: ["low", "medium"],
    trade_types: ["buy", "sell"],
    max_trades_per_day: 10,
    stop_loss_percent: 3,
    take_profit_percent: 8,
    trades_today: 0,
    daily_loss: 0,
    last_trade_date: null,
    assets_traded_today: [], // NEW: Initialize assets traded list
    // New Advanced Risk Management settings
    use_trailing_stop: false,
    trailing_stop_percent: 2, // How far below highest price to trail
    trailing_stop_activation: 3, // Profit % needed to activate trailing
    use_breakeven_protection: false,
    breakeven_trigger_percent: 4, // Profit % to activate break-even
    breakeven_offset_percent: 0.5, // Stop placed above entry price
    use_partial_profits: false,
    partial_profit_targets: [
      { profit_percent: 5, sell_percent: 50 },
      { profit_percent: 10, sell_percent: 25 },
    ],
    // NEW: Smart Order Execution settings
    use_smart_routing: false,
    execution_strategy: 'smart_limit', // Default strategy
    limit_offset_percent: 0.1, // Distance from market price for limit orders
    order_timeout_seconds: 30, // Convert to market order after timeout
    max_slippage_percent: 0.5, // Max slippage before cancelling order
    use_dynamic_slippage: false,
    use_twap: false,
    twap_threshold_percent: 5, // Use TWAP for trades larger than this % of portfolio
    twap_duration_minutes: 15, // Time to execute all TWAP orders
    twap_num_orders: 5, // Split trade into this many orders
  });

  const queryClient = useQueryClient();

  const { data: savedSettings, isLoading } = useQuery({
    queryKey: ['auto-trading-settings'],
    queryFn: async () => {
      const result = await base44.entities.AutoTradingSettings.list();
      return result[0]; // Assuming only one set of auto-trading settings per user
    },
  });

  // MOVED: Define saveSettingsMutation BEFORE the useEffect that uses it
  const saveSettingsMutation = useMutation({
    mutationFn: async (data) => {
      if (savedSettings?.id) {
        return await base44.entities.AutoTradingSettings.update(savedSettings.id, data);
      } else {
        return await base44.entities.AutoTradingSettings.create(data);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['auto-trading-settings'] });
    },
  });

  useEffect(() => {
    if (savedSettings) {
      setSettings(prevSettings => ({
        ...prevSettings,
        ...savedSettings,
        // Ensure arrays are initialized if null/undefined from savedSettings
        allowed_risk_levels: savedSettings.allowed_risk_levels || [],
        trade_types: savedSettings.trade_types || [],
        partial_profit_targets: savedSettings.partial_profit_targets || [
          { profit_percent: 5, sell_percent: 50 },
          { profit_percent: 10, sell_percent: 25 },
        ],
        assets_traded_today: savedSettings.assets_traded_today || [], // NEW: Initialize assets traded list
        execution_mode: savedSettings.execution_mode || 'auto',
        // Ensure boolean/number values have defaults if coming from null/undefined in savedSettings
        use_trailing_stop: savedSettings.use_trailing_stop ?? false,
        trailing_stop_percent: savedSettings.trailing_stop_percent ?? 2,
        trailing_stop_activation: savedSettings.trailing_stop_activation ?? 3,
        use_breakeven_protection: savedSettings.use_breakeven_protection ?? false,
        breakeven_trigger_percent: savedSettings.breakeven_trigger_percent ?? 4,
        breakeven_offset_percent: savedSettings.breakeven_offset_percent ?? 0.5,
        use_partial_profits: savedSettings.use_partial_profits ?? false,
        // NEW: Smart Order Execution settings from savedSettings
        use_smart_routing: savedSettings.use_smart_routing ?? false,
        execution_strategy: savedSettings.execution_strategy ?? 'smart_limit',
        limit_offset_percent: savedSettings.limit_offset_percent ?? 0.1,
        order_timeout_seconds: savedSettings.order_timeout_seconds ?? 30,
        max_slippage_percent: savedSettings.max_slippage_percent ?? 0.5,
        use_dynamic_slippage: savedSettings.use_dynamic_slippage ?? false,
        use_twap: savedSettings.use_twap ?? false,
        twap_threshold_percent: savedSettings.twap_threshold_percent ?? 5,
        twap_duration_minutes: savedSettings.twap_duration_minutes ?? 15,
        twap_num_orders: savedSettings.twap_num_orders ?? 5,
      }));
    }
  }, [savedSettings]);

  // Reset daily counters at midnight or initialize last_trade_date
  useEffect(() => {
    if (!savedSettings || !savedSettings.id) return; // Ensure settings are loaded and have an ID

    const checkDailyReset = () => {
      const today = new Date().toDateString(); // E.g., "Mon Jan 01 2024"
      const lastCountersUpdateDate = savedSettings.last_trade_date ? new Date(savedSettings.last_trade_date).toDateString() : null;

      let shouldMutate = false;
      const newSettingsToSave = { ...savedSettings };

      // Case 1: It's a new day AND counters are non-zero (needs reset) OR assets_traded_today is not empty
      if (lastCountersUpdateDate && lastCountersUpdateDate !== today &&
          (savedSettings.trades_today > 0 || savedSettings.daily_loss > 0 || (savedSettings.assets_traded_today && savedSettings.assets_traded_today.length > 0))) {
        console.log("Daily reset: new day detected with non-zero counters.");
        newSettingsToSave.trades_today = 0;
        newSettingsToSave.daily_loss = 0;
        newSettingsToSave.assets_traded_today = []; // NEW: Reset traded assets list
        newSettingsToSave.last_trade_date = new Date().toISOString(); // Update to today's date
        shouldMutate = true;
      }
      // Case 2: last_trade_date was never set (first load or old record)
      else if (!lastCountersUpdateDate) {
        console.log("Daily reset: last_trade_date not set, initializing.");
        // If counters are non-zero or assets_traded_today is not empty, assume they are stale and reset them
        if (savedSettings.trades_today > 0 || savedSettings.daily_loss > 0 || (savedSettings.assets_traded_today && savedSettings.assets_traded_today.length > 0)) {
          newSettingsToSave.trades_today = 0;
          newSettingsToSave.daily_loss = 0;
        }
        newSettingsToSave.assets_traded_today = []; // NEW: Reset traded assets list
        newSettingsToSave.last_trade_date = new Date().toISOString(); // Set to today's date
        shouldMutate = true;
      }

      if (shouldMutate) {
        saveSettingsMutation.mutate(newSettingsToSave);
      }
    };

    checkDailyReset(); // Run once immediately
    const interval = setInterval(checkDailyReset, 60000); // Check every minute

    return () => clearInterval(interval); // Cleanup interval on component unmount
  }, [savedSettings]); 

  const handleSave = async () => {
    // When saving, explicitly update last_trade_date to ensure it reflects the current day
    // for future daily reset checks, especially if no trades occurred but settings changed.
    await saveSettingsMutation.mutateAsync({
      ...settings,
      last_trade_date: new Date().toISOString()
    });
  };

  const toggleRiskLevel = (level) => {
    const current = settings.allowed_risk_levels || [];
    if (current.includes(level)) {
      setSettings({
        ...settings,
        allowed_risk_levels: current.filter(l => l !== level)
      });
    } else {
      setSettings({
        ...settings,
        allowed_risk_levels: [...current, level]
      });
    }
  };

  const toggleTradeType = (type) => {
    const current = settings.trade_types || [];
    if (current.includes(type)) {
      setSettings({
        ...settings,
        trade_types: current.filter(t => t !== type)
      });
    } else {
      setSettings({
        ...settings,
        trade_types: [...current, type]
      });
    }
  };

  const isCircuitBreakerTriggered = settings.daily_loss >= (settings.max_daily_loss_percent || 0);
  const tradesLimitReached = settings.trades_today >= settings.max_trades_per_day;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white">
      <div className="max-w-5xl mx-auto px-6 py-8">
        
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold mb-2 bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">
            Auto-Trading Settings
          </h1>
          <p className="text-slate-400">Configure AI-powered automated trading with risk management</p>
        </div>

        {/* Browser-Assisted Mode Notice */}
        <Card className="bg-gradient-to-r from-slate-800 via-slate-900 to-slate-800 border-indigo-500/40 mb-8">
          <CardContent className="pt-6">
            <div className="flex gap-3">
              <div className="w-12 h-12 bg-gradient-to-br from-indigo-600 to-purple-600 rounded-xl flex items-center justify-center flex-shrink-0 shadow-lg">
                <Sparkles className="w-5 h-5 text-white animate-pulse" />
              </div>
              <div>
                <h3 className="font-semibold text-indigo-300 mb-2">Browser-Assisted Auto-Trading</h3>
                <p className="text-slate-300 text-sm leading-relaxed mb-3">
                  <strong className="text-indigo-200">How it works:</strong> When enabled, the AI monitors markets <strong className="text-white">while your browser tab is open</strong> and automatically executes trades 
                  based on your settings. Trades are executed with paper trading funds following your risk parameters.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                  <div className="flex items-center gap-2 text-slate-300">
                    <CheckCircle className="w-4 h-4 text-green-400" />
                    <span>✅ Monitors every 45 seconds</span>
                  </div>
                  <div className="flex items-center gap-2 text-slate-300">
                    <CheckCircle className="w-4 h-4 text-green-400" />
                    <span>✅ Respects all risk limits</span>
                  </div>
                  <div className="flex items-center gap-2 text-slate-300">
                    <CheckCircle className="w-4 h-4 text-green-400" />
                    <span>✅ Stop loss & take profit</span>
                  </div>
                  <div className="flex items-center gap-2 text-slate-300">
                    <AlertTriangle className="w-4 h-4 text-red-400" />
                    <span>⚠️ Browser must stay open</span>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Demo Notice - Updated */}
        <Card className="bg-gradient-to-r from-slate-800 via-slate-900 to-slate-800 border-blue-500/40 mb-8">
          <CardContent className="pt-6">
            <div className="flex gap-3">
              <div className="w-12 h-12 bg-gradient-to-br from-blue-600 to-cyan-600 rounded-xl flex items-center justify-center flex-shrink-0 shadow-lg">
                <AlertTriangle className="w-5 h-5 text-white" />
              </div>
              <div>
                <h3 className="font-semibold text-blue-300 mb-2">Paper Trading with Browser-Assisted Execution</h3>
                <p className="text-slate-300 text-sm leading-relaxed">
                  This implements <strong className="text-blue-200">assisted auto-trading</strong> that runs in your browser. When enabled, trades are automatically executed 
                  using paper trading funds while you have the Trading page open. For true 24/7 auto-trading, you would need external backend infrastructure 
                  running independently of the browser.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Status Card */}
        <Card className="bg-gradient-to-br from-slate-900 to-slate-800 border-slate-700 mb-8">
        <CardContent className="pt-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${
              settings.is_enabled ? 'bg-green-500/20' : 'bg-slate-700'
            }`}>
              <Sparkles className={`w-6 h-6 ${settings.is_enabled ? 'text-green-400' : 'text-slate-400'}`} />
            </div>
            <div>
              <h3 className="text-xl font-bold text-white">Auto-Trading Status</h3>
              <p className={`text-sm ${settings.is_enabled ? 'text-green-400' : 'text-slate-400'}`}>
                {settings.is_enabled ? 'Active' : 'Disabled'}
              </p>
            </div>
          </div>
          <Switch
            checked={settings.is_enabled}
            onCheckedChange={(checked) => setSettings({...settings, is_enabled: checked})}
            className="data-[state=checked]:bg-green-500"
          />
        </div>

        <div className="mb-6 bg-slate-800/50 p-4 rounded-xl border border-slate-700">
          <Label className="text-slate-300 mb-3 block flex items-center gap-2">
            <Zap className="w-4 h-4 text-yellow-400" />
            Execution Mode
          </Label>
          <div className="grid grid-cols-3 gap-3">
            <button
              onClick={() => setSettings({...settings, execution_mode: 'auto'})}
              className={`p-3 rounded-lg border flex flex-col items-center gap-2 transition-all ${
                settings.execution_mode === 'auto'
                  ? 'bg-indigo-600/20 border-indigo-500 text-white'
                  : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700'
              }`}
            >
              <Sparkles className={`w-5 h-5 ${settings.execution_mode === 'auto' ? 'text-indigo-400' : ''}`} />
              <span className="text-sm font-medium">Auto (Recommended)</span>
            </button>
            <button
              onClick={() => setSettings({...settings, execution_mode: 'browser'})}
              className={`p-3 rounded-lg border flex flex-col items-center gap-2 transition-all ${
                settings.execution_mode === 'browser'
                  ? 'bg-blue-600/20 border-blue-500 text-white'
                  : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700'
              }`}
            >
              <Globe className={`w-5 h-5 ${settings.execution_mode === 'browser' ? 'text-blue-400' : ''}`} />
              <span className="text-sm font-medium">Browser Only</span>
            </button>
            <button
              onClick={() => setSettings({...settings, execution_mode: 'server'})}
              className={`p-3 rounded-lg border flex flex-col items-center gap-2 transition-all ${
                settings.execution_mode === 'server'
                  ? 'bg-purple-600/20 border-purple-500 text-white'
                  : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700'
              }`}
            >
              <Server className={`w-5 h-5 ${settings.execution_mode === 'server' ? 'text-purple-400' : ''}`} />
              <span className="text-sm font-medium">Server Only</span>
            </button>
          </div>
          <p className="text-xs text-slate-400 mt-3">
            {settings.execution_mode === 'auto' && "Automatically uses server-side trading if available, falls back to browser."}
            {settings.execution_mode === 'browser' && "Forces trading to run in your browser tab. Must keep tab open."}
            {settings.execution_mode === 'server' && "Forces server-side trading. Requires backend functions to be enabled."}
          </p>
        </div>

        {settings.is_enabled && (
          <div className="grid grid-cols-3 gap-4">
                <div className="bg-slate-800 rounded-lg p-4">
                  <p className="text-slate-400 text-sm mb-1">Trades Today</p>
                  <p className="text-2xl font-bold text-white">{settings.trades_today}/{settings.max_trades_per_day}</p>
                </div>
                <div className="bg-slate-800 rounded-lg p-4">
                  <p className="text-slate-400 text-sm mb-1">Daily Loss</p>
                  <p className={`text-2xl font-bold ${isCircuitBreakerTriggered ? 'text-red-400' : 'text-white'}`}>
                    {settings.daily_loss.toFixed(1)}%
                  </p>
                </div>
                <div className="bg-slate-800 rounded-lg p-4">
                  <p className="text-slate-400 text-sm mb-1">Status</p>
                  <Badge className={isCircuitBreakerTriggered || tradesLimitReached ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400'}>
                    {isCircuitBreakerTriggered ? 'Circuit Breaker' : tradesLimitReached ? 'Limit Reached' : 'Active'}
                  </Badge>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Warning */}
        {settings.is_enabled && (
          <Card className="bg-yellow-500/10 border-yellow-500/30 mb-8">
            <CardContent className="pt-6">
              <div className="flex gap-3">
                <AlertTriangle className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-semibold text-yellow-200 mb-2">Auto-Trading Enabled (Browser-Assisted)</h3>
                  <p className="text-yellow-200/80 text-sm">
                    Your settings are active for browser-assisted auto-trading. The AI will execute paper trades 
                    automatically while this tab is open and the Trading page is active.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          
          {/* AI Settings */}
          <Card className="bg-slate-900 border-slate-700">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-white">
                <Sparkles className="w-5 h-5 text-indigo-400" />
                AI Configuration
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <Label className="text-slate-300 mb-3 block">
                  Minimum Confidence: {settings.min_confidence}%
                </Label>
                <Slider
                  value={[settings.min_confidence]}
                  onValueChange={(value) => setSettings({...settings, min_confidence: value[0]})}
                  min={50}
                  max={95}
                  step={5}
                  className="mb-2"
                />
                <p className="text-xs text-slate-400">Only execute trades with AI confidence above this level</p>
              </div>

              <div>
                <Label className="text-slate-300 mb-3 block">Allowed Risk Levels</Label>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={settings.allowed_risk_levels?.includes('low')}
                      onCheckedChange={() => toggleRiskLevel('low')}
                      className="border-green-500 data-[state=checked]:bg-green-500"
                    />
                    <Label className="text-slate-300">Low Risk</Label>
                    <Badge className="bg-green-500/20 text-green-400 ml-auto">Recommended</Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={settings.allowed_risk_levels?.includes('medium')}
                      onCheckedChange={() => toggleRiskLevel('medium')}
                      className="border-yellow-500 data-[state=checked]:bg-yellow-500"
                    />
                    <Label className="text-slate-300">Medium Risk</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={settings.allowed_risk_levels?.includes('high')}
                      onCheckedChange={() => toggleRiskLevel('high')}
                      className="border-red-500 data-[state=checked]:bg-red-500"
                    />
                    <Label className="text-slate-300">High Risk</Label>
                    <Badge className="bg-red-500/20 text-red-400 ml-auto">Caution</Badge>
                  </div>
                </div>
              </div>

              <div>
                <Label className="text-slate-300 mb-3 block">Trade Types</Label>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={settings.trade_types?.includes('buy')}
                      onCheckedChange={() => toggleTradeType('buy')}
                      className="border-green-500 data-[state=checked]:bg-green-500"
                    />
                    <Label className="text-slate-300">Buy (Long)</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={settings.trade_types?.includes('sell')}
                      onCheckedChange={() => toggleTradeType('sell')}
                      className="border-red-500 data-[state=checked]:bg-red-500"
                    />
                    <Label className="text-slate-300">Sell (Short)</Label>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Risk Management */}
          <Card className="bg-slate-900 border-slate-700">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-white">
                <Shield className="w-5 h-5 text-green-400" />
                Risk Management
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <Label className="text-slate-300 mb-3 block">
                  Max Position Size: {settings.max_position_size_percent}%
                </Label>
                <Slider
                  value={[settings.max_position_size_percent]}
                  onValueChange={(value) => setSettings({...settings, max_position_size_percent: value[0]})}
                  min={1}
                  max={50}
                  step={1}
                  className="mb-2"
                />
                <p className="text-xs text-slate-400">Maximum % of portfolio per trade</p>
              </div>

              <div>
                <Label className="text-slate-300 mb-3 block">
                  Circuit Breaker: {settings.max_daily_loss_percent}%
                </Label>
                <Slider
                  value={[settings.max_daily_loss_percent]}
                  onValueChange={(value) => setSettings({...settings, max_daily_loss_percent: value[0]})}
                  min={1}
                  max={20}
                  step={1}
                  className="mb-2"
                />
                <p className="text-xs text-slate-400">Stop trading if daily loss exceeds this %</p>
              </div>

              <div>
                <Label className="text-slate-300 mb-2 block">Max Trades Per Day</Label>
                <Input
                  type="number"
                  value={settings.max_trades_per_day}
                  onChange={(e) => setSettings({...settings, max_trades_per_day: parseInt(e.target.value) || 0})}
                  className="bg-slate-800 border-slate-700 text-white"
                  min="1"
                  max="100"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-slate-300 mb-2 block">Stop Loss %</Label>
                  <Input
                    type="number"
                    value={settings.stop_loss_percent}
                    onChange={(e) => setSettings({...settings, stop_loss_percent: parseFloat(e.target.value) || 0})}
                    className="bg-slate-800 border-slate-700 text-white"
                    step="0.5"
                  />
                </div>
                <div>
                  <Label className="text-slate-300 mb-2 block">Take Profit %</Label>
                  <Input
                    type="number"
                    value={settings.take_profit_percent}
                    onChange={(e) => setSettings({...settings, take_profit_percent: parseFloat(e.target.value) || 0})}
                    className="bg-slate-800 border-slate-700 text-white"
                    step="0.5"
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Advanced Risk Management */}
        <Card className="bg-slate-900 border-slate-700 mt-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-white">
              <Target className="w-5 h-5 text-purple-400" />
              Advanced Risk Management
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            
            {/* Trailing Stop Loss */}
            <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h4 className="text-white font-semibold flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-green-400" />
                    Trailing Stop Loss
                  </h4>
                  <p className="text-xs text-slate-400 mt-1">
                    Stop loss moves up automatically as price increases
                  </p>
                </div>
                <Switch
                  checked={settings.use_trailing_stop}
                  onCheckedChange={(checked) => setSettings({...settings, use_trailing_stop: checked})}
                  className="data-[state=checked]:bg-green-500"
                />
              </div>
              
              {settings.use_trailing_stop && (
                <div className="space-y-4 pt-4 border-t border-slate-700">
                  <div>
                    <Label className="text-slate-300 mb-2 block">
                      Trailing Distance: {settings.trailing_stop_percent ?? 2}%
                    </Label>
                    <Slider
                      value={[settings.trailing_stop_percent ?? 2]}
                      onValueChange={(value) => setSettings({...settings, trailing_stop_percent: value[0]})}
                      min={0.5}
                      max={5}
                      step={0.5}
                      className="mb-2"
                    />
                    <p className="text-xs text-slate-400">How far below highest price to trail</p>
                  </div>
                  
                  <div>
                    <Label className="text-slate-300 mb-2 block">
                      Activation Threshold: {settings.trailing_stop_activation ?? 3}%
                    </Label>
                    <Slider
                      value={[settings.trailing_stop_activation ?? 3]}
                      onValueChange={(value) => setSettings({...settings, trailing_stop_activation: value[0]})}
                      min={1}
                      max={10}
                      step={0.5}
                      className="mb-2"
                    />
                    <p className="text-xs text-slate-400">Profit % needed to activate trailing</p>
                  </div>
                </div>
              )}
            </div>

            {/* Break-Even Protection */}
            <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h4 className="text-white font-semibold flex items-center gap-2">
                    <Shield className="w-4 h-4 text-blue-400" />
                    Break-Even Protection
                  </h4>
                  <p className="text-xs text-slate-400 mt-1">
                    Move stop to entry price after reaching profit target
                  </p>
                </div>
                <Switch
                  checked={settings.use_breakeven_protection}
                  onCheckedChange={(checked) => setSettings({...settings, use_breakeven_protection: checked})}
                  className="data-[state=checked]:bg-blue-500"
                />
              </div>
              
              {settings.use_breakeven_protection && (
                <div className="space-y-4 pt-4 border-t border-slate-700">
                  <div>
                    <Label className="text-slate-300 mb-2 block">
                      Trigger at Profit: {settings.breakeven_trigger_percent ?? 4}%
                    </Label>
                    <Slider
                      value={[settings.breakeven_trigger_percent ?? 4]}
                      onValueChange={(value) => setSettings({...settings, breakeven_trigger_percent: value[0]})}
                      min={1}
                      max={10}
                      step={0.5}
                      className="mb-2"
                    />
                    <p className="text-xs text-slate-400">Profit % to activate break-even</p>
                  </div>
                  
                  <div>
                    <Label className="text-slate-300 mb-2 block">
                      Offset: {settings.breakeven_offset_percent ?? 0.5}%
                    </Label>
                    <Slider
                      value={[settings.breakeven_offset_percent ?? 0.5]}
                      onValueChange={(value) => setSettings({...settings, breakeven_offset_percent: value[0]})}
                      min={0}
                      max={2}
                      step={0.1}
                      className="mb-2"
                    />
                    <p className="text-xs text-slate-400">Stop placed above entry price</p>
                  </div>
                </div>
              )}
            </div>

            {/* Partial Profit Taking */}
            <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h4 className="text-white font-semibold flex items-center gap-2">
                    <Target className="w-4 h-4 text-yellow-400" />
                    Partial Profit Taking
                  </h4>
                  <p className="text-xs text-slate-400 mt-1">
                    Automatically take profits at multiple levels
                  </p>
                </div>
                <Switch
                  checked={settings.use_partial_profits}
                  onCheckedChange={(checked) => setSettings({...settings, use_partial_profits: checked})}
                  className="data-[state=checked]:bg-yellow-500"
                />
              </div>
              
              {settings.use_partial_profits && (
                <div className="space-y-3 pt-4 border-t border-slate-700">
                  <p className="text-xs text-slate-400 mb-2">Profit Targets:</p>
                  
                  {(settings.partial_profit_targets || []).map((target, idx) => (
                    <div key={idx} className="bg-slate-700 rounded-lg p-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label className="text-slate-300 text-xs mb-1 block">
                            At {target.profit_percent}% Profit
                          </Label>
                          <Input
                            type="number"
                            value={target.profit_percent}
                            onChange={(e) => {
                              const newTargets = [...(settings.partial_profit_targets || [])];
                              newTargets[idx].profit_percent = parseFloat(e.target.value) || 0;
                              setSettings({...settings, partial_profit_targets: newTargets});
                            }}
                            className="bg-slate-800 border-slate-600 text-white text-sm"
                            min="1"
                            step="0.5"
                          />
                        </div>
                        <div>
                          <Label className="text-slate-300 text-xs mb-1 block">
                            Sell {target.sell_percent}%
                          </Label>
                          <Input
                            type="number"
                            value={target.sell_percent}
                            onChange={(e) => {
                              const newTargets = [...(settings.partial_profit_targets || [])];
                              newTargets[idx].sell_percent = parseFloat(e.target.value) || 0;
                              setSettings({...settings, partial_profit_targets: newTargets});
                            }}
                            className="bg-slate-800 border-slate-600 text-white text-sm"
                            min="1"
                            max="100"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                  
                  <p className="text-xs text-slate-500 mt-2">
                    Example: At 5% profit, sell 50% of position. At 10% profit, sell 25% more.
                  </p>
                </div>
              )}
            </div>

            {/* Feature Summary */}
            <div className="bg-indigo-500/10 border border-indigo-500/30 rounded-lg p-4">
              <h4 className="text-sm font-semibold text-indigo-300 mb-3">🎯 Active Features Summary</h4>
              <div className="space-y-2 text-xs">
                {settings.use_trailing_stop && (
                  <div className="flex items-center gap-2 text-green-400">
                    <CheckCircle className="w-4 h-4" />
                    <span>Trailing Stop: {settings.trailing_stop_percent}% trail after {settings.trailing_stop_activation}% profit</span>
                  </div>
                )}
                {settings.use_breakeven_protection && (
                  <div className="flex items-center gap-2 text-blue-400">
                    <CheckCircle className="w-4 h-4" />
                    <span>Break-Even: Activates at {settings.breakeven_trigger_percent}% profit</span>
                  </div>
                )}
                {settings.use_partial_profits && (
                  <div className="flex items-center gap-2 text-yellow-400">
                    <CheckCircle className="w-4 h-4" />
                    <span>Partial Profits: {settings.partial_profit_targets?.length || 0} targets configured</span>
                  </div>
                )}
                {!settings.use_trailing_stop && !settings.use_breakeven_protection && !settings.use_partial_profits && (
                  <p className="text-slate-400">No advanced features enabled. Using standard stop loss and take profit.</p>
                )}
              </div>
            </div>

          </CardContent>
        </Card>

        {/* Smart Order Execution */}
        <Card className="bg-slate-900 border-slate-700 mt-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-white">
              <Zap className="w-5 h-5 text-yellow-400" />
              Smart Order Execution
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            
            {/* Smart Order Routing */}
            <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h4 className="text-white font-semibold flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-indigo-400" />
                    Smart Order Routing
                  </h4>
                  <p className="text-xs text-slate-400 mt-1">
                    Automatically selects optimal execution strategy
                  </p>
                </div>
                <Switch
                  checked={settings.use_smart_routing}
                  onCheckedChange={(checked) => setSettings({...settings, use_smart_routing: checked})}
                  className="data-[state=checked]:bg-indigo-500"
                />
              </div>
              
              {settings.use_smart_routing && (
                <div className="space-y-4 pt-4 border-t border-slate-700">
                  <div>
                    <Label className="text-slate-300 mb-2 block">
                      Execution Strategy
                    </Label>
                    <select
                      value={settings.execution_strategy || 'smart_limit'}
                      onChange={(e) => setSettings({...settings, execution_strategy: e.target.value})}
                      className="w-full bg-slate-700 border border-slate-600 text-white rounded-lg px-3 py-2 text-sm"
                    >
                      <option value="market">Market (Immediate, Higher Slippage)</option>
                      <option value="limit">Limit (Better Price, May Not Fill)</option>
                      <option value="smart_limit">Smart Limit (Recommended)</option>
                      <option value="iceberg">Iceberg (Hide Order Size)</option>
                    </select>
                    <p className="text-xs text-slate-500 mt-1">
                      Smart limit dynamically adjusts based on market conditions
                    </p>
                  </div>

                  <div>
                    <Label className="text-slate-300 mb-2 block">
                      Limit Offset: {settings.limit_offset_percent ?? 0.1}%
                    </Label>
                    <Slider
                      value={[settings.limit_offset_percent ?? 0.1]}
                      onValueChange={(value) => setSettings({...settings, limit_offset_percent: value[0]})}
                      min={0.05}
                      max={1.0}
                      step={0.05}
                      className="mb-2"
                    />
                    <p className="text-xs text-slate-400">Distance from market price for limit orders</p>
                  </div>

                  <div>
                    <Label className="text-slate-300 mb-2 block">
                      Order Timeout: {settings.order_timeout_seconds ?? 30}s
                    </Label>
                    <Slider
                      value={[settings.order_timeout_seconds ?? 30]}
                      onValueChange={(value) => setSettings({...settings, order_timeout_seconds: value[0]})}
                      min={10}
                      max={120}
                      step={10}
                      className="mb-2"
                    />
                    <p className="text-xs text-slate-400">Convert to market order after timeout</p>
                  </div>
                </div>
              )}
            </div>

            {/* Slippage Control */}
            <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
              <div className="mb-4">
                <h4 className="text-white font-semibold flex items-center gap-2 mb-1">
                  <AlertCircle className="w-4 h-4 text-orange-400" />
                  Slippage Control
                </h4>
                <p className="text-xs text-slate-400">
                  Protect against excessive price movement during execution
                </p>
              </div>
              
              <div className="space-y-4">
                <div>
                  <Label className="text-slate-300 mb-2 block">
                    Max Slippage: {settings.max_slippage_percent ?? 0.5}%
                  </Label>
                  <Slider
                    value={[settings.max_slippage_percent ?? 0.5]}
                    onValueChange={(value) => setSettings({...settings, max_slippage_percent: value[0]})}
                    min={0.1}
                    max={2.0}
                    step={0.1}
                    className="mb-2"
                  />
                  <p className="text-xs text-slate-400">Orders exceeding this will be cancelled</p>
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-slate-300 text-sm">Dynamic Slippage Adjustment</Label>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Increase limits during high volatility
                    </p>
                  </div>
                  <Switch
                    checked={settings.use_dynamic_slippage}
                    onCheckedChange={(checked) => setSettings({...settings, use_dynamic_slippage: checked})}
                    className="data-[state=checked]:bg-orange-500"
                  />
                </div>
              </div>
            </div>

            {/* TWAP Execution */}
            <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h4 className="text-white font-semibold flex items-center gap-2">
                    <Clock className="w-4 h-4 text-cyan-400" />
                    TWAP (Time-Weighted Average Price)
                  </h4>
                  <p className="text-xs text-slate-400 mt-1">
                    Split large trades over time to minimize market impact
                  </p>
                </div>
                <Switch
                  checked={settings.use_twap}
                  onCheckedChange={(checked) => setSettings({...settings, use_twap: checked})}
                  className="data-[state=checked]:bg-cyan-500"
                />
              </div>
              
              {settings.use_twap && (
                <div className="space-y-4 pt-4 border-t border-slate-700">
                  <div>
                    <Label className="text-slate-300 mb-2 block">
                      Trigger Threshold: {settings.twap_threshold_percent ?? 5}% of Portfolio
                    </Label>
                    <Slider
                      value={[settings.twap_threshold_percent ?? 5]}
                      onValueChange={(value) => setSettings({...settings, twap_threshold_percent: value[0]})}
                      min={1}
                      max={20}
                      step={1}
                      className="mb-2"
                    />
                    <p className="text-xs text-slate-400">Use TWAP for trades larger than this</p>
                  </div>
                  
                  <div>
                    <Label className="text-slate-300 mb-2 block">
                      Duration: {settings.twap_duration_minutes ?? 15} minutes
                    </Label>
                    <Slider
                      value={[settings.twap_duration_minutes ?? 15]}
                      onValueChange={(value) => setSettings({...settings, twap_duration_minutes: value[0]})}
                      min={5}
                      max={60}
                      step={5}
                      className="mb-2"
                    />
                    <p className="text-xs text-slate-400">Time to execute all TWAP orders</p>
                  </div>

                  <div>
                    <Label className="text-slate-300 mb-2 block">
                      Number of Orders: {settings.twap_num_orders ?? 5}
                    </Label>
                    <Slider
                      value={[settings.twap_num_orders ?? 5]}
                      onValueChange={(value) => setSettings({...settings, twap_num_orders: value[0]})}
                      min={3}
                      max={20}
                      step={1}
                      className="mb-2"
                    />
                    <p className="text-xs text-slate-400">Split trade into this many orders</p>
                  </div>
                </div>
              )}
            </div>

            {/* Execution Summary */}
            <div className="bg-gradient-to-r from-indigo-500/10 to-cyan-500/10 border border-indigo-500/30 rounded-lg p-4">
              <h4 className="text-sm font-semibold text-indigo-300 mb-3">🎯 Smart Execution Summary</h4>
              <div className="space-y-2 text-xs">
                {settings.use_smart_routing && (
                  <div className="flex items-center gap-2 text-indigo-400">
                    <CheckCircle className="w-4 h-4" />
                    <span>Smart routing: {settings.execution_strategy || 'smart_limit'} strategy with {settings.max_slippage_percent ?? 0.5}% max slippage</span>
                  </div>
                )}
                {settings.use_twap && (
                  <div className="flex items-center gap-2 text-cyan-400">
                    <CheckCircle className="w-4 h-4" />
                    <span>TWAP: Splits trades {'>'} {settings.twap_threshold_percent ?? 5}% into {settings.twap_num_orders ?? 5} orders over {settings.twap_duration_minutes ?? 15}min</span>
                  </div>
                )}
                {settings.use_dynamic_slippage && (
                  <div className="flex items-center gap-2 text-orange-400">
                    <CheckCircle className="w-4 h-4" />
                    <span>Dynamic slippage: Adjusts limits based on market volatility</span>
                  </div>
                )}
                {!settings.use_smart_routing && !settings.use_twap && !settings.use_dynamic_slippage && (
                  <p className="text-slate-400">No smart execution features enabled. Orders will use standard market execution.</p>
                )}
              </div>
            </div>

          </CardContent>
        </Card>

        {/* Best Practices */}
        <Card className="bg-slate-900 border-slate-700 mt-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-white">
              <CheckCircle className="w-5 h-5 text-blue-400" />
              Best Practices
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3 text-slate-300">
              <li className="flex items-start gap-2">
                <span className="text-indigo-400 mt-1">•</span>
                <span>Start with conservative settings (low risk, high confidence threshold)</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-indigo-400 mt-1">•</span>
                <span>Monitor performance daily and adjust settings based on results</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-indigo-400 mt-1">•</span>
                <span>Use the circuit breaker to protect against unexpected market volatility</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-indigo-400 mt-1">•</span>
                <span>Keep position sizes small (5-10% of portfolio) for diversification</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-indigo-400 mt-1">•</span>
                <span>Test with paper trading before using real funds</span>
              </li>
            </ul>
          </CardContent>
        </Card>

        {/* Save Button */}
        <div className="mt-8 flex gap-4">
          <Button
            onClick={handleSave}
            disabled={saveSettingsMutation.isPending}
            className="bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 flex-1"
          >
            <Settings className="w-4 h-4 mr-2" />
            {saveSettingsMutation.isPending ? 'Saving...' : 'Save Settings'}
          </Button>
        </div>
      </div>
    </div>
  );
}