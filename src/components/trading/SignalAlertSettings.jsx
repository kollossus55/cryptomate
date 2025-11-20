import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Bell, TrendingUp, TrendingDown, Settings, Save, AlertCircle } from "lucide-react";

export default function SignalAlertSettings() {
  const queryClient = useQueryClient();
  
  const [settings, setSettings] = useState({
    min_confidence_buy: 70,
    min_confidence_sell: 65,
    enable_predictive_alerts: true,
    min_predicted_gain: 5,
    news_sentiment_weight: 0.3,
    alert_frequency: 'hourly'
  });

  const { data: userPreferences } = useQuery({
    queryKey: ['trading-preferences'],
    queryFn: async () => {
      const result = await base44.entities.TradingPreferences.list();
      return result[0];
    },
    retry: 1,
  });

  const savePreferencesMutation = useMutation({
    mutationFn: async (data) => {
      if (userPreferences?.id) {
        return await base44.entities.TradingPreferences.update(userPreferences.id, data);
      } else {
        return await base44.entities.TradingPreferences.create(data);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trading-preferences'] });
    },
  });

  useEffect(() => {
    if (userPreferences?.signal_alert_thresholds) {
      setSettings(userPreferences.signal_alert_thresholds);
    }
  }, [userPreferences]);

  const handleSave = async () => {
    const data = {
      ...userPreferences,
      signal_alert_thresholds: settings
    };
    await savePreferencesMutation.mutateAsync(data);
  };

  return (
    <Card className="bg-slate-900 border-slate-700">
      <CardHeader>
        <CardTitle className="text-white flex items-center gap-2">
          <Bell className="w-5 h-5 text-indigo-400" />
          Signal Alert Settings
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label className="text-slate-300 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-green-400" />
              Min Buy Signal Confidence (%)
            </Label>
            <Input
              type="number"
              min="0"
              max="100"
              value={settings.min_confidence_buy}
              onChange={(e) => setSettings({...settings, min_confidence_buy: parseInt(e.target.value)})}
              className="bg-slate-800 border-slate-700 text-white"
            />
            <p className="text-xs text-slate-400">
              Only alert for buy signals with this confidence or higher
            </p>
          </div>

          <div className="space-y-2">
            <Label className="text-slate-300 flex items-center gap-2">
              <TrendingDown className="w-4 h-4 text-red-400" />
              Min Sell Signal Confidence (%)
            </Label>
            <Input
              type="number"
              min="0"
              max="100"
              value={settings.min_confidence_sell}
              onChange={(e) => setSettings({...settings, min_confidence_sell: parseInt(e.target.value)})}
              className="bg-slate-800 border-slate-700 text-white"
            />
            <p className="text-xs text-slate-400">
              Only alert for sell signals with this confidence or higher
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-slate-300 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-purple-400" />
              Enable Predictive Price Alerts
            </Label>
            <Switch
              checked={settings.enable_predictive_alerts}
              onCheckedChange={(checked) => setSettings({...settings, enable_predictive_alerts: checked})}
            />
          </div>
          <p className="text-xs text-slate-400">
            Get alerts based on AI-predicted price movements
          </p>
        </div>

        {settings.enable_predictive_alerts && (
          <div className="space-y-2">
            <Label className="text-slate-300">
              Min Predicted Gain for Alerts (%)
            </Label>
            <Input
              type="number"
              min="0"
              max="50"
              step="0.5"
              value={settings.min_predicted_gain}
              onChange={(e) => setSettings({...settings, min_predicted_gain: parseFloat(e.target.value)})}
              className="bg-slate-800 border-slate-700 text-white"
            />
            <p className="text-xs text-slate-400">
              Only alert for buy signals with predicted gains above this threshold
            </p>
          </div>
        )}

        <div className="space-y-2">
          <Label className="text-slate-300">
            News Sentiment Weight (0-1)
          </Label>
          <Input
            type="number"
            min="0"
            max="1"
            step="0.05"
            value={settings.news_sentiment_weight}
            onChange={(e) => setSettings({...settings, news_sentiment_weight: parseFloat(e.target.value)})}
            className="bg-slate-800 border-slate-700 text-white"
          />
          <p className="text-xs text-slate-400">
            How much to weight news sentiment in signal calculations (higher = more influence)
          </p>
        </div>

        <div className="space-y-2">
          <Label className="text-slate-300">
            Alert Frequency
          </Label>
          <select
            value={settings.alert_frequency}
            onChange={(e) => setSettings({...settings, alert_frequency: e.target.value})}
            className="w-full bg-slate-800 border border-slate-700 text-white rounded-md px-3 py-2"
          >
            <option value="realtime">Real-time</option>
            <option value="hourly">Hourly digest</option>
            <option value="daily">Daily summary</option>
          </select>
          <p className="text-xs text-slate-400">
            How often you want to receive signal alerts
          </p>
        </div>

        <div className="bg-indigo-500/10 border border-indigo-500/30 rounded-lg p-4">
          <h4 className="text-indigo-300 font-semibold mb-2">Current Settings Summary</h4>
          <div className="space-y-1 text-sm text-slate-300">
            <div className="flex justify-between">
              <span>Buy signals:</span>
              <Badge className="bg-green-500/20 text-green-400">≥{settings.min_confidence_buy}%</Badge>
            </div>
            <div className="flex justify-between">
              <span>Sell signals:</span>
              <Badge className="bg-red-500/20 text-red-400">≥{settings.min_confidence_sell}%</Badge>
            </div>
            <div className="flex justify-between">
              <span>Predictive alerts:</span>
              <Badge className={settings.enable_predictive_alerts ? "bg-purple-500/20 text-purple-400" : "bg-slate-600 text-slate-400"}>
                {settings.enable_predictive_alerts ? 'Enabled' : 'Disabled'}
              </Badge>
            </div>
            <div className="flex justify-between">
              <span>News weight:</span>
              <Badge className="bg-blue-500/20 text-blue-400">{(settings.news_sentiment_weight * 100).toFixed(0)}%</Badge>
            </div>
          </div>
        </div>

        <Button
          onClick={handleSave}
          disabled={savePreferencesMutation.isPending}
          className="w-full bg-indigo-600 hover:bg-indigo-700"
        >
          <Save className="w-4 h-4 mr-2" />
          {savePreferencesMutation.isPending ? 'Saving...' : 'Save Alert Settings'}
        </Button>
      </CardContent>
    </Card>
  );
}