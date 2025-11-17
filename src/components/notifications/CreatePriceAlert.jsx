
import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Bell, 
  Plus, 
  TrendingUp, 
  TrendingDown, 
  Activity, 
  BarChart3, 
  Sparkles, 
  Target, 
  MessageSquare, 
  Send,
  Mail
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

export default function CreatePriceAlert({ asset, onClose }) {
  const [alertData, setAlertData] = useState({
    asset_symbol: asset?.symbol || '',
    alert_type: 'price_above',
    threshold_value: asset?.price || 0,
    current_value: asset?.price || 0,
    is_active: true,
    trigger_once: false,
    notification_method: ['in_app'],
    note: '',
    technical_indicator_params: {},
    ai_pattern_config: {},
    discord_webhook: '',
    telegram_config: { bot_token: '', chat_id: '' }
  });

  const queryClient = useQueryClient();

  const createAlertMutation = useMutation({
    mutationFn: (data) => base44.entities.PriceAlert.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['price-alerts'] });
      if (onClose) onClose();
    },
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    await createAlertMutation.mutateAsync(alertData);
  };

  const priceAlertTypes = [
    { value: 'price_above', label: 'Price Above', icon: TrendingUp, color: 'text-green-400', category: 'price' },
    { value: 'price_below', label: 'Price Below', icon: TrendingDown, color: 'text-red-400', category: 'price' },
    { value: 'price_change_percent', label: 'Price Change %', icon: Activity, color: 'text-blue-400', category: 'price' },
  ];

  const volumeAlertTypes = [
    { value: 'volume_spike', label: 'Volume Spike', icon: BarChart3, color: 'text-purple-400', category: 'volume' },
    { value: 'volatility', label: 'High Volatility', icon: Activity, color: 'text-orange-400', category: 'volume' },
  ];

  const technicalAlertTypes = [
    { value: 'rsi_overbought', label: 'RSI Overbought', icon: Target, color: 'text-red-400', category: 'technical' },
    { value: 'rsi_oversold', label: 'RSI Oversold', icon: Target, color: 'text-green-400', category: 'technical' },
    { value: 'macd_crossover', label: 'MACD Bullish Cross', icon: TrendingUp, color: 'text-green-400', category: 'technical' },
    { value: 'macd_crossunder', label: 'MACD Bearish Cross', icon: TrendingDown, color: 'text-red-400', category: 'technical' },
    { value: 'sma_crossover', label: 'SMA Golden Cross', icon: TrendingUp, color: 'text-yellow-400', category: 'technical' },
    { value: 'sma_crossunder', label: 'SMA Death Cross', icon: TrendingDown, color: 'text-gray-400', category: 'technical' },
    { value: 'bollinger_breakout', label: 'Bollinger Breakout', icon: Activity, color: 'text-purple-400', category: 'technical' },
    { value: 'support_break', label: 'Support Break', icon: TrendingDown, color: 'text-red-400', category: 'technical' },
    { value: 'resistance_break', label: 'Resistance Break', icon: TrendingUp, color: 'text-green-400', category: 'technical' },
  ];

  const aiAlertTypes = [
    { value: 'ai_pattern', label: 'AI Pattern Detection', icon: Sparkles, color: 'text-indigo-400', category: 'ai' },
  ];

  const allAlertTypes = [...priceAlertTypes, ...volumeAlertTypes, ...technicalAlertTypes, ...aiAlertTypes];
  const selectedAlertType = allAlertTypes.find(t => t.value === alertData.alert_type);
  const AlertIcon = selectedAlertType?.icon || Bell;

  const toggleNotificationMethod = (method) => {
    const current = alertData.notification_method || [];
    if (current.includes(method)) {
      setAlertData({
        ...alertData,
        notification_method: current.filter(m => m !== method)
      });
    } else {
      setAlertData({
        ...alertData,
        notification_method: [...current, method]
      });
    }
  };

  const renderAlertTypeSelector = (types, title) => (
    <div className="space-y-2">
      <h4 className="font-semibold text-white text-sm">{title}</h4>
      <div className="grid grid-cols-1 gap-2">
        {types.map((type) => {
          const Icon = type.icon;
          const isSelected = alertData.alert_type === type.value;
          return (
            <button
              key={type.value}
              type="button"
              onClick={() => setAlertData({...alertData, alert_type: type.value})}
              className={`flex items-center gap-3 p-3 rounded-lg border transition-all ${
                isSelected
                  ? 'bg-indigo-600 border-indigo-500'
                  : 'bg-slate-800 border-slate-700 hover:border-slate-600'
              }`}
            >
              <Icon className={`w-5 h-5 ${isSelected ? 'text-white' : type.color}`} />
              <span className={isSelected ? 'text-white font-medium' : 'text-slate-300'}>
                {type.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );

  const renderThresholdInput = () => {
    const isTechnical = selectedAlertType?.category === 'technical';
    const isAI = selectedAlertType?.category === 'ai';

    if (isAI) {
      return (
        <div className="space-y-4">
          <div>
            <Label className="text-slate-300 mb-2 block">Pattern Type</Label>
            <Select
              value={alertData.ai_pattern_config?.pattern_type || 'bullish_reversal'}
              onValueChange={(value) => setAlertData({
                ...alertData,
                ai_pattern_config: { ...alertData.ai_pattern_config, pattern_type: value }
              })}
            >
              <SelectTrigger className="bg-slate-800 border-slate-700 text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-slate-900 border-slate-700">
                <SelectItem value="bullish_reversal">Bullish Reversal</SelectItem>
                <SelectItem value="bearish_reversal">Bearish Reversal</SelectItem>
                <SelectItem value="breakout">Breakout</SelectItem>
                <SelectItem value="trend_change">Trend Change</SelectItem>
                <SelectItem value="accumulation">Accumulation</SelectItem>
                <SelectItem value="distribution">Distribution</SelectItem>
                <SelectItem value="whale_activity">Whale Activity</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-slate-300 mb-2 block">
              Min AI Confidence: {alertData.ai_pattern_config?.min_confidence || 75}%
            </Label>
            <Input
              type="range"
              min="50"
              max="95"
              step="5"
              value={alertData.ai_pattern_config?.min_confidence || 75}
              onChange={(e) => setAlertData({
                ...alertData,
                ai_pattern_config: { 
                  ...alertData.ai_pattern_config, 
                  min_confidence: parseInt(e.target.value)
                }
              })}
              className="bg-slate-800 border-slate-700"
            />
          </div>

          <div>
            <Label className="text-slate-300 mb-2 block">Lookback Period</Label>
            <Select
              value={alertData.ai_pattern_config?.lookback_period || '1h'}
              onValueChange={(value) => setAlertData({
                ...alertData,
                ai_pattern_config: { ...alertData.ai_pattern_config, lookback_period: value }
              })}
            >
              <SelectTrigger className="bg-slate-800 border-slate-700 text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-slate-900 border-slate-700">
                <SelectItem value="15m">15 Minutes</SelectItem>
                <SelectItem value="1h">1 Hour</SelectItem>
                <SelectItem value="4h">4 Hours</SelectItem>
                <SelectItem value="1d">1 Day</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      );
    }

    if (isTechnical) {
      if (alertData.alert_type.startsWith('rsi_')) {
        return (
          <div className="space-y-4">
            <div>
              <Label className="text-slate-300 mb-2 block">
                RSI Period (default: 14)
              </Label>
              <Input
                type="number"
                placeholder="14"
                value={alertData.technical_indicator_params?.period || 14}
                onChange={(e) => setAlertData({
                  ...alertData,
                  technical_indicator_params: {
                    ...alertData.technical_indicator_params,
                    period: parseInt(e.target.value) || 14
                  }
                })}
                className="bg-slate-800 border-slate-700 text-white"
              />
            </div>
            <div>
              <Label className="text-slate-300 mb-2 block">
                {alertData.alert_type === 'rsi_overbought' ? 'Overbought Level' : 'Oversold Level'} (default: {alertData.alert_type === 'rsi_overbought' ? '70' : '30'})
              </Label>
              <Input
                type="number"
                placeholder={alertData.alert_type === 'rsi_overbought' ? '70' : '30'}
                value={alertData.alert_type === 'rsi_overbought' 
                  ? alertData.technical_indicator_params?.overbought_level || 70
                  : alertData.technical_indicator_params?.oversold_level || 30
                }
                onChange={(e) => setAlertData({
                  ...alertData,
                  technical_indicator_params: {
                    ...alertData.technical_indicator_params,
                    [alertData.alert_type === 'rsi_overbought' ? 'overbought_level' : 'oversold_level']: parseInt(e.target.value)
                  }
                })}
                className="bg-slate-800 border-slate-700 text-white"
              />
            </div>
          </div>
        );
      }

      if (alertData.alert_type.startsWith('macd_')) {
        return (
          <div className="space-y-4">
            <div>
              <Label className="text-slate-300 mb-2 block">Fast Period (default: 12)</Label>
              <Input
                type="number"
                placeholder="12"
                value={alertData.technical_indicator_params?.fast_period || 12}
                onChange={(e) => setAlertData({
                  ...alertData,
                  technical_indicator_params: {
                    ...alertData.technical_indicator_params,
                    fast_period: parseInt(e.target.value) || 12
                  }
                })}
                className="bg-slate-800 border-slate-700 text-white"
              />
            </div>
            <div>
              <Label className="text-slate-300 mb-2 block">Slow Period (default: 26)</Label>
              <Input
                type="number"
                placeholder="26"
                value={alertData.technical_indicator_params?.slow_period || 26}
                onChange={(e) => setAlertData({
                  ...alertData,
                  technical_indicator_params: {
                    ...alertData.technical_indicator_params,
                    slow_period: parseInt(e.target.value) || 26
                  }
                })}
                className="bg-slate-800 border-slate-700 text-white"
              />
            </div>
            <div>
              <Label className="text-slate-300 mb-2 block">Signal Period (default: 9)</Label>
              <Input
                type="number"
                placeholder="9"
                value={alertData.technical_indicator_params?.signal_period || 9}
                onChange={(e) => setAlertData({
                  ...alertData,
                  technical_indicator_params: {
                    ...alertData.technical_indicator_params,
                    signal_period: parseInt(e.target.value) || 9
                  }
                })}
                className="bg-slate-800 border-slate-700 text-white"
              />
            </div>
          </div>
        );
      }

      if (alertData.alert_type.startsWith('sma_')) {
        return (
          <div className="space-y-4">
            <div>
              <Label className="text-slate-300 mb-2 block">Fast SMA Period (default: 50)</Label>
              <Input
                type="number"
                placeholder="50"
                value={alertData.technical_indicator_params?.fast_period || 50}
                onChange={(e) => setAlertData({
                  ...alertData,
                  technical_indicator_params: {
                    ...alertData.technical_indicator_params,
                    fast_period: parseInt(e.target.value) || 50
                  }
                })}
                className="bg-slate-800 border-slate-700 text-white"
              />
            </div>
            <div>
              <Label className="text-slate-300 mb-2 block">Slow SMA Period (default: 200)</Label>
              <Input
                type="number"
                placeholder="200"
                value={alertData.technical_indicator_params?.slow_period || 200}
                onChange={(e) => setAlertData({
                  ...alertData,
                  technical_indicator_params: {
                    ...alertData.technical_indicator_params,
                    slow_period: parseInt(e.target.value) || 200
                  }
                })}
                className="bg-slate-800 border-slate-700 text-white"
              />
            </div>
          </div>
        );
      }

      if (alertData.alert_type === 'support_break' || alertData.alert_type === 'resistance_break') {
        return (
          <div>
            <Label className="text-slate-300 mb-2 block">
              {alertData.alert_type === 'support_break' ? 'Support' : 'Resistance'} Level
            </Label>
            <Input
              type="number"
              step="any"
              placeholder={`Enter ${alertData.alert_type === 'support_break' ? 'support' : 'resistance'} price`}
              value={alertData.threshold_value}
              onChange={(e) => setAlertData({...alertData, threshold_value: parseFloat(e.target.value) || 0})}
              className="bg-slate-800 border-slate-700 text-white"
              required
            />
            {asset && (
              <p className="text-xs text-slate-400 mt-2">
                Current price: ${asset.price.toLocaleString()}
              </p>
            )}
          </div>
        );
      }

      return (
        <div>
          <Label className="text-slate-300 mb-2 block">Bollinger Band Period (default: 20)</Label>
          <Input
            type="number"
            placeholder="20"
            value={alertData.technical_indicator_params?.period || 20}
            onChange={(e) => setAlertData({
              ...alertData,
              technical_indicator_params: {
                ...alertData.technical_indicator_params,
                period: parseInt(e.target.value) || 20
              }
            })}
            className="bg-slate-800 border-slate-700 text-white"
          />
        </div>
      );
    }

    // Regular price/volume alerts
    return (
      <div>
        <Label className="text-slate-300 mb-2 block">
          Threshold Value
          {(alertData.alert_type === 'price_change_percent' || alertData.alert_type === 'volatility') && ' (%)'}
          {alertData.alert_type === 'volume_spike' && ' (% increase)'}
        </Label>
        <Input
          type="number"
          step="any"
          placeholder="Enter threshold"
          value={alertData.threshold_value}
          onChange={(e) => setAlertData({...alertData, threshold_value: parseFloat(e.target.value) || 0})}
          className="bg-slate-800 border-slate-700 text-white"
          required
        />
        {asset && (alertData.alert_type === 'price_above' || alertData.alert_type === 'price_below') && (
          <p className="text-xs text-slate-400 mt-2">
            Current price: ${asset.price.toLocaleString()}
          </p>
        )}
      </div>
    );
  };

  return (
    <Card className="bg-slate-900 border-slate-700">
      <CardHeader>
        <CardTitle className="text-white flex items-center gap-2">
          <Bell className="w-5 h-5 text-indigo-400" />
          Create Advanced Alert
          {asset && (
            <Badge className="bg-indigo-500/20 text-indigo-400 ml-auto">
              {asset.symbol}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          
          {/* Asset Selection */}
          {!asset && (
            <div>
              <Label className="text-slate-300 mb-2 block">Asset Symbol</Label>
              <Input
                placeholder="e.g., BTC/USDT"
                value={alertData.asset_symbol}
                onChange={(e) => setAlertData({...alertData, asset_symbol: e.target.value})}
                className="bg-slate-800 border-slate-700 text-white"
                required
              />
            </div>
          )}

          {/* Alert Type Selection */}
          <Tabs defaultValue="price" className="w-full">
            <TabsList className="bg-slate-800 border-slate-700 w-full">
              <TabsTrigger value="price" className="flex-1 data-[state=active]:bg-indigo-600">
                Price
              </TabsTrigger>
              <TabsTrigger value="technical" className="flex-1 data-[state=active]:bg-indigo-600">
                Technical
              </TabsTrigger>
              <TabsTrigger value="ai" className="flex-1 data-[state=active]:bg-indigo-600">
                AI Patterns
              </TabsTrigger>
            </TabsList>

            <TabsContent value="price" className="mt-4 space-y-4">
              {renderAlertTypeSelector(priceAlertTypes, 'Price Alerts')}
              {renderAlertTypeSelector(volumeAlertTypes, 'Volume & Volatility')}
            </TabsContent>

            <TabsContent value="technical" className="mt-4">
              {renderAlertTypeSelector(technicalAlertTypes, 'Technical Indicators')}
            </TabsContent>

            <TabsContent value="ai" className="mt-4">
              {renderAlertTypeSelector(aiAlertTypes, 'AI-Powered Detection')}
            </TabsContent>
          </Tabs>

          {/* Threshold/Parameters */}
          {renderThresholdInput()}

          {/* Note */}
          <div>
            <Label className="text-slate-300 mb-2 block">Note (Optional)</Label>
            <Textarea
              placeholder="Add a note for this alert..."
              value={alertData.note}
              onChange={(e) => setAlertData({...alertData, note: e.target.value})}
              className="bg-slate-800 border-slate-700 text-white h-20"
            />
          </div>

          {/* Options */}
          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 bg-slate-800 rounded-lg">
              <div>
                <Label className="text-slate-300">Trigger Once</Label>
                <p className="text-xs text-slate-500 mt-1">Alert will deactivate after first trigger</p>
              </div>
              <Switch
                checked={alertData.trigger_once}
                onCheckedChange={(checked) => setAlertData({...alertData, trigger_once: checked})}
              />
            </div>

            <div className="flex items-center justify-between p-3 bg-slate-800 rounded-lg">
              <div>
                <Label className="text-slate-300">Active</Label>
                <p className="text-xs text-slate-500 mt-1">Start monitoring immediately</p>
              </div>
              <Switch
                checked={alertData.is_active}
                onCheckedChange={(checked) => setAlertData({...alertData, is_active: checked})}
              />
            </div>
          </div>

          {/* Notification Methods */}
          <div>
            <Label className="text-slate-300 mb-3 block">Notification Channels</Label>
            <div className="space-y-3">
              {/* In-App */}
              <div className="flex items-center gap-3 p-3 bg-slate-800 rounded-lg">
                <input
                  type="checkbox"
                  id="in_app"
                  checked={alertData.notification_method.includes('in_app')}
                  onChange={() => toggleNotificationMethod('in_app')}
                  className="w-4 h-4 rounded"
                />
                <Bell className="w-5 h-5 text-indigo-400" />
                <div className="flex-1">
                  <Label htmlFor="in_app" className="text-slate-300 cursor-pointer">In-App Notification</Label>
                  <p className="text-xs text-slate-500">Real-time alerts in the app</p>
                </div>
              </div>

              {/* Discord */}
              <div className="space-y-2">
                <div className="flex items-center gap-3 p-3 bg-slate-800 rounded-lg">
                  <input
                    type="checkbox"
                    id="discord"
                    checked={alertData.notification_method.includes('discord')}
                    onChange={() => toggleNotificationMethod('discord')}
                    className="w-4 h-4 rounded"
                  />
                  <MessageSquare className="w-5 h-5 text-indigo-400" />
                  <div className="flex-1">
                    <Label htmlFor="discord" className="text-slate-300 cursor-pointer">Discord</Label>
                    <p className="text-xs text-slate-500">Send to Discord webhook</p>
                  </div>
                </div>
                {alertData.notification_method.includes('discord') && (
                  <Input
                    type="url"
                    placeholder="Discord webhook URL"
                    value={alertData.discord_webhook}
                    onChange={(e) => setAlertData({...alertData, discord_webhook: e.target.value})}
                    className="bg-slate-800 border-slate-700 text-white text-sm"
                  />
                )}
              </div>

              {/* Telegram */}
              <div className="space-y-2">
                <div className="flex items-center gap-3 p-3 bg-slate-800 rounded-lg">
                  <input
                    type="checkbox"
                    id="telegram"
                    checked={alertData.notification_method.includes('telegram')}
                    onChange={() => toggleNotificationMethod('telegram')}
                    className="w-4 h-4 rounded"
                  />
                  <Send className="w-5 h-5 text-blue-400" />
                  <div className="flex-1">
                    <Label htmlFor="telegram" className="text-slate-300 cursor-pointer">Telegram</Label>
                    <p className="text-xs text-slate-500">Send to Telegram bot</p>
                  </div>
                </div>
                {alertData.notification_method.includes('telegram') && (
                  <div className="space-y-2">
                    <Input
                      type="text"
                      placeholder="Bot Token"
                      value={alertData.telegram_config.bot_token}
                      onChange={(e) => setAlertData({
                        ...alertData,
                        telegram_config: {...alertData.telegram_config, bot_token: e.target.value}
                      })}
                      className="bg-slate-800 border-slate-700 text-white text-sm"
                    />
                    <Input
                      type="text"
                      placeholder="Chat ID"
                      value={alertData.telegram_config.chat_id}
                      onChange={(e) => setAlertData({
                        ...alertData,
                        telegram_config: {...alertData.telegram_config, chat_id: e.target.value}
                      })}
                      className="bg-slate-800 border-slate-700 text-white text-sm"
                    />
                  </div>
                )}
              </div>

              {/* Email */}
              <div className="flex items-center gap-3 p-3 bg-slate-800 rounded-lg opacity-50">
                <input
                  type="checkbox"
                  id="email"
                  disabled
                  className="w-4 h-4 rounded"
                />
                <Mail className="w-5 h-5 text-slate-400" />
                <div className="flex-1">
                  <Label htmlFor="email" className="text-slate-400">Email (Coming Soon)</Label>
                  <p className="text-xs text-slate-500">Email notifications</p>
                </div>
              </div>
            </div>
          </div>

          {/* Info Banner */}
          <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
            <p className="text-blue-200 text-sm leading-relaxed">
              <strong>Demo Mode:</strong> External notifications (Discord/Telegram) are simulated. 
              With backend functions enabled, alerts would be sent to your configured channels in real-time.
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3 pt-4">
            {onClose && (
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                className="flex-1 border-slate-700 text-slate-300 hover:bg-slate-800"
              >
                Cancel
              </Button>
            )}
            <Button
              type="submit"
              disabled={createAlertMutation.isPending}
              className="flex-1 bg-indigo-600 hover:bg-indigo-700"
            >
              <Plus className="w-4 h-4 mr-2" />
              {createAlertMutation.isPending ? 'Creating...' : 'Create Alert'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
