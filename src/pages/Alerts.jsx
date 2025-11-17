
import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Bell,
  Plus,
  TrendingUp,
  TrendingDown,
  Activity,
  BarChart3,
  Trash2,
  AlertCircle,
  Sparkles,
  Target, // New import
  MessageSquare, // New import
  Send // New import
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

import CreatePriceAlert from "../components/notifications/CreatePriceAlert";

export default function Alerts() {
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [monitoringActive, setMonitoringActive] = useState(false);
  const queryClient = useQueryClient();

  const { data: alerts = [] } = useQuery({
    queryKey: ['price-alerts'],
    queryFn: () => base44.entities.PriceAlert.list('-created_date'),
  });

  const { data: notifications = [] } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => base44.entities.Notification.list('-created_date', 10),
  });

  const updateAlertMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.PriceAlert.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['price-alerts'] });
    },
  });

  const deleteAlertMutation = useMutation({
    mutationFn: (id) => base44.entities.PriceAlert.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['price-alerts'] });
    },
  });

  useEffect(() => {
    if (!monitoringActive || alerts.length === 0) return;

    const checkAlerts = async () => {
      const activeAlerts = alerts.filter(a => a.is_active);
      
      // Simulate an AI anomaly notification
      if (Math.random() > 0.95) {
        await base44.entities.Notification.create({
          notification_type: 'ai_anomaly',
          priority: 'high',
          title: 'Unusual Market Activity Detected',
          message: 'AI detected abnormal trading patterns in BTC/USDT. Volume spike of 340% in last 15 minutes.',
          data: {
            asset: 'BTC/USDT',
            anomaly_type: 'volume_spike',
            confidence: 87,
            details: 'Large institutional buy orders detected'
          }
        });
      }
    };

    const interval = setInterval(checkAlerts, 30000);
    return () => clearInterval(interval);
  }, [monitoringActive, alerts]);

  const handleToggleAlert = async (alert) => {
    await updateAlertMutation.mutateAsync({
      id: alert.id,
      data: { ...alert, is_active: !alert.is_active }
    });
  };

  const handleDeleteAlert = async (id) => {
    if (window.confirm('Delete this alert?')) {
      await deleteAlertMutation.mutateAsync(id);
    }
  };

  const getAlertIcon = (type) => {
    const iconProps = { className: "w-5 h-5" };
    switch (type) {
      case 'price_above':
      case 'resistance_break': // New type
        return <TrendingUp {...iconProps} className="w-5 h-5 text-green-400" />;
      case 'price_below':
      case 'support_break': // New type
        return <TrendingDown {...iconProps} className="w-5 h-5 text-red-400" />;
      case 'price_change_percent':
      case 'volatility':
      case 'bollinger_breakout': // New type
        return <Activity {...iconProps} className="w-5 h-5 text-blue-400" />;
      case 'volume_spike':
        return <BarChart3 {...iconProps} className="w-5 h-5 text-purple-400" />;
      case 'rsi_overbought': // New type
      case 'rsi_oversold': // New type
      case 'macd_crossover': // New type
      case 'macd_crossunder': // New type
      case 'sma_crossover': // New type
      case 'sma_crossunder': // New type
        return <Target {...iconProps} className="w-5 h-5 text-orange-400" />;
      case 'ai_pattern': // New type
        return <Sparkles {...iconProps} className="w-5 h-5 text-indigo-400" />;
      default:
        return <Bell {...iconProps} />;
    }
  };

  const getAlertTypeLabel = (type) => {
    const labels = {
      price_above: 'Price Above',
      price_below: 'Price Below',
      price_change_percent: 'Price Change %',
      volume_spike: 'Volume Spike',
      volatility: 'High Volatility',
      // New labels
      rsi_overbought: 'RSI Overbought',
      rsi_oversold: 'RSI Oversold',
      macd_crossover: 'MACD Bullish Cross',
      macd_crossunder: 'MACD Bearish Cross',
      sma_crossover: 'SMA Golden Cross',
      sma_crossunder: 'SMA Death Cross',
      bollinger_breakout: 'Bollinger Breakout',
      support_break: 'Support Break',
      resistance_break: 'Resistance Break',
      ai_pattern: 'AI Pattern'
    };
    return labels[type] || type;
  };

  // New function for detailed alert descriptions
  const getAlertDescription = (alert) => {
    // AI Pattern specific description
    if (alert.alert_type === 'ai_pattern') {
      const patternType = alert.ai_pattern_config?.pattern_type || 'Pattern';
      const minConfidence = alert.ai_pattern_config?.min_confidence || 75;
      return `${patternType} (${minConfidence}% confidence)`;
    }
    
    // RSI specific description
    if (alert.alert_type.includes('rsi_')) {
      const period = alert.technical_indicator_params?.period || 14;
      const level = alert.alert_type === 'rsi_overbought' 
        ? alert.technical_indicator_params?.overbought_level || 70
        : alert.technical_indicator_params?.oversold_level || 30;
      return `RSI (${period}) ${alert.alert_type === 'rsi_overbought' ? '>' : '<'} ${level}`;
    }

    // MACD specific description
    if (alert.alert_type.includes('macd_')) {
      const fastPeriod = alert.technical_indicator_params?.fast_period || 12;
      const slowPeriod = alert.technical_indicator_params?.slow_period || 26;
      const signalPeriod = alert.technical_indicator_params?.signal_period || 9;
      return `MACD (${fastPeriod}, ${slowPeriod}, ${signalPeriod})`;
    }

    // SMA specific description
    if (alert.alert_type.includes('sma_')) {
      const fastPeriod = alert.technical_indicator_params?.fast_period || 50;
      const slowPeriod = alert.technical_indicator_params?.slow_period || 200;
      return `SMA ${fastPeriod} / ${slowPeriod}`;
    }

    // Bollinger Breakout description
    if (alert.alert_type === 'bollinger_breakout') {
      const period = alert.technical_indicator_params?.period || 20;
      return `Bollinger Bands (${period}) Breakout`;
    }

    // Support/Resistance Break description
    if (alert.alert_type === 'support_break' || alert.alert_type === 'resistance_break') {
      return `${getAlertTypeLabel(alert.alert_type)} @ $${alert.threshold_value.toLocaleString()}`;
    }

    // Generic price/volume alert description
    if (alert.threshold_value !== undefined && alert.threshold_value !== null) {
      return `${getAlertTypeLabel(alert.alert_type)} ${alert.alert_type === 'price_above' || alert.alert_type === 'price_below' ? '$' : ''}${alert.threshold_value.toLocaleString()}${
        alert.alert_type.includes('percent') ? '%' : ''
      }`;
    }

    // Fallback for types without threshold_value or specific params
    return getAlertTypeLabel(alert.alert_type);
  };

  const activeAlertsCount = alerts.filter(a => a.is_active).length;
  const recentNotifications = notifications.slice(0, 5);

  // New categorization for alerts
  const alertsByType = {
    price: alerts.filter(a => ['price_above', 'price_below', 'price_change_percent'].includes(a.alert_type)),
    volume: alerts.filter(a => ['volume_spike', 'volatility'].includes(a.alert_type)),
    technical: alerts.filter(a => 
      a.alert_type.includes('rsi_') || 
      a.alert_type.includes('macd_') || 
      a.alert_type.includes('sma_') || 
      a.alert_type === 'bollinger_breakout' || 
      a.alert_type === 'support_break' || 
      a.alert_type === 'resistance_break'
    ),
    ai: alerts.filter(a => a.alert_type === 'ai_pattern')
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white">
      <div className="max-w-7xl mx-auto px-6 py-8">
        
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold mb-2 bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">
            Alerts & Notifications
          </h1>
          <p className="text-slate-400">Advanced monitoring with technical indicators and AI patterns</p> {/* Updated text */}
        </div>

        {/* Monitoring Status */}
        <Card className={`mb-8 border-2 transition-all duration-300 ${
          monitoringActive 
            ? 'bg-gradient-to-br from-green-600/30 to-emerald-600/30 border-green-400' 
            : 'bg-gradient-to-br from-slate-800 to-slate-900 border-slate-600'
        }`}>
          <CardContent className="pt-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className={`w-16 h-16 rounded-2xl flex items-center justify-center transition-all duration-300 ${
                  monitoringActive 
                    ? 'bg-green-500 animate-pulse shadow-xl shadow-green-500/50' 
                    : 'bg-slate-700'
                }`}>
                  <Sparkles className="w-8 h-8 text-white" />
                </div>
                <div>
                  <h3 className="text-2xl font-bold mb-1 text-white">
                    Alert Monitoring
                  </h3>
                  <p className="text-base font-medium text-white">
                    {monitoringActive 
                      ? `✓ Monitoring ${activeAlertsCount} active ${activeAlertsCount === 1 ? 'alert' : 'alerts'}`
                      : 'Enable monitoring to receive real-time alerts'
                    }
                  </p>
                </div>
              </div>
              
              <div className="flex items-center gap-4">
                <Badge className={`font-bold px-6 py-3 ${
                  monitoringActive 
                    ? 'text-xl bg-green-500 text-white border-green-400' 
                    : 'text-sm bg-slate-700 text-white border-slate-500'
                }`}>
                  {monitoringActive ? '⚡ ACTIVE' : 'Inactive'}
                </Badge>
                <Switch
                  checked={monitoringActive}
                  onCheckedChange={setMonitoringActive}
                  className={`data-[state=checked]:bg-green-500 scale-150 ${
                    monitoringActive ? 'shadow-lg shadow-green-500/50' : ''
                  } transition-all`}
                />
              </div>
            </div>
            
            {monitoringActive && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="mt-6 p-4 bg-blue-500/30 border-2 border-blue-400 rounded-xl"
              >
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-blue-100 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-bold text-white mb-1">
                      Demo Mode Active
                    </p>
                    <p className="text-sm text-white/90 leading-relaxed">
                      <strong>Simulated monitoring:</strong> Technical indicators and AI patterns are demonstrated. 
                      External notifications (Discord/Telegram) are simulated. With backend functions, real-time analysis would trigger alerts instantly.
                    </p>
                  </div>
                </div>
              </motion.div>
            )}
          </CardContent>
        </Card>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8"> {/* Updated to 4 columns */}
          <Card className="bg-slate-900 border-slate-700">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-slate-400 text-sm mb-1">Total Alerts</p>
                  <p className="text-3xl font-bold text-white">{alerts.length}</p>
                </div>
                <Bell className="w-10 h-10 text-indigo-400" />
              </div>
            </CardContent>
          </Card>

          {/* New Card: Technical Alerts */}
          <Card className="bg-slate-900 border-slate-700">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-slate-400 text-sm mb-1">Technical</p>
                  <p className="text-3xl font-bold text-orange-400">{alertsByType.technical.length}</p>
                </div>
                <Target className="w-10 h-10 text-orange-400" />
              </div>
            </CardContent>
          </Card>

          {/* New Card: AI Patterns */}
          <Card className="bg-slate-900 border-slate-700">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-slate-400 text-sm mb-1">AI Patterns</p>
                  <p className="text-3xl font-bold text-indigo-400">{alertsByType.ai.length}</p>
                </div>
                <Sparkles className="w-10 h-10 text-indigo-400" />
              </div>
            </CardContent>
          </Card>

          {/* Updated Card: Triggered Today to just Triggered */}
          <Card className="bg-slate-900 border-slate-700">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-slate-400 text-sm mb-1">Triggered</p>
                  <p className="text-3xl font-bold text-purple-400">
                    {alerts.reduce((sum, a) => sum + (a.triggered_count || 0), 0)}
                  </p>
                </div>
                <Activity className="w-10 h-10 text-purple-400" /> {/* Changed icon from Sparkles */}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Alerts List */}
        <Card className="bg-slate-900 border-slate-700 mb-8">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-white">Your Alerts</CardTitle>
              <Button
                onClick={() => setIsCreateDialogOpen(true)}
                className="bg-indigo-600 hover:bg-indigo-700"
              >
                <Plus className="w-4 h-4 mr-2" />
                Create Alert
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {alerts.length === 0 ? (
              <div className="text-center py-12">
                <Bell className="w-16 h-16 text-slate-600 mx-auto mb-4" />
                <h3 className="text-xl font-semibold text-white mb-2">No Alerts Yet</h3>
                <p className="text-slate-400 mb-6">Create your first advanced alert with technical indicators</p> {/* Updated text */}
                <Button
                  onClick={() => setIsCreateDialogOpen(true)}
                  className="bg-indigo-600 hover:bg-indigo-700"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Create Your First Alert
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <AnimatePresence>
                  {alerts.map((alert) => (
                    <motion.div
                      key={alert.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, x: -20 }}
                      className={`p-4 rounded-xl border transition-all ${
                        alert.is_active
                          ? 'bg-slate-800 border-indigo-500/30'
                          : 'bg-slate-800/50 border-slate-700'
                      }`}
                    >
                      <div className="flex items-start gap-4">
                        <div className="flex-shrink-0 mt-1">
                          {getAlertIcon(alert.alert_type)}
                        </div>
                        
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <div>
                              <h4 className="font-semibold text-white mb-1 flex items-center gap-2"> {/* Added flex items-center gap-2 */}
                                {alert.asset_symbol}
                                {/* New Badges for alert types */}
                                {alert.alert_type === 'ai_pattern' && (
                                  <Badge className="bg-indigo-500/20 text-indigo-400 text-xs">
                                    AI
                                  </Badge>
                                )}
                                {(alert.alert_type.includes('rsi_') || 
                                  alert.alert_type.includes('macd_') || 
                                  alert.alert_type.includes('sma_') || 
                                  alert.alert_type === 'bollinger_breakout' || 
                                  alert.alert_type === 'support_break' || 
                                  alert.alert_type === 'resistance_break') && (
                                  <Badge className="bg-orange-500/20 text-orange-400 text-xs">
                                    Technical
                                  </Badge>
                                )}
                              </h4>
                              <p className="text-sm text-slate-400">
                                {getAlertDescription(alert)} {/* Using the new description function */}
                              </p>
                            </div>
                            
                            <div className="flex items-center gap-2">
                              <Badge className={alert.is_active ? 'bg-green-500/20 text-green-400' : 'bg-slate-500/20 text-slate-400'}>
                                {alert.is_active ? 'Active' : 'Inactive'}
                              </Badge>
                            </div>
                          </div>
                          
                          {/* New: Notification Methods display */}
                          {alert.notification_method && alert.notification_method.length > 0 && (
                            <div className="flex items-center gap-2 mb-3 flex-wrap"> {/* Added flex-wrap */}
                              {alert.notification_method.map((method) => (
                                <Badge key={method} variant="outline" className="border-slate-600 text-slate-400 text-xs">
                                  {method === 'in_app' && <Bell className="w-3 h-3 mr-1" />}
                                  {method === 'discord' && <MessageSquare className="w-3 h-3 mr-1" />}
                                  {method === 'telegram' && <Send className="w-3 h-3 mr-1" />}
                                  {method.replace('_', ' ')} {/* Display method name */}
                                </Badge>
                              ))}
                            </div>
                          )}
                          
                          {alert.note && (
                            <p className="text-sm text-slate-500 mb-3">{alert.note}</p>
                          )}
                          
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-4 text-xs text-slate-500">
                              <span>Triggered: {alert.triggered_count || 0} times</span>
                              {alert.last_triggered && (
                                <span>Last: {new Date(alert.last_triggered).toLocaleDateString()}</span>
                              )}
                            </div>
                            
                            <div className="flex items-center gap-2">
                              <Switch
                                checked={alert.is_active}
                                onCheckedChange={() => handleToggleAlert(alert)}
                                className="data-[state=checked]:bg-green-500"
                              />
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                                onClick={() => handleDeleteAlert(alert.id)}
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Notifications */}
        <Card className="bg-slate-900 border-slate-700">
          <CardHeader>
            <CardTitle className="text-white">Recent Notifications</CardTitle>
          </CardHeader>
          <CardContent>
            {recentNotifications.length === 0 ? (
              <div className="text-center py-8">
                <AlertCircle className="w-12 h-12 text-slate-600 mx-auto mb-3" />
                <p className="text-slate-400">No notifications yet</p>
              </div>
            ) : (
              <div className="space-y-3">
                {recentNotifications.map((notification) => (
                  <div
                    key={notification.id}
                    className="p-3 bg-slate-800 rounded-lg border border-slate-700"
                  >
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <h4 className="font-semibold text-white text-sm">{notification.title}</h4>
                      <Badge className={`text-xs ${
                        notification.priority === 'urgent' ? 'bg-red-500/20 text-red-400' :
                        notification.priority === 'high' ? 'bg-orange-500/20 text-orange-400' :
                        'bg-blue-500/20 text-blue-400'
                      }`}>
                        {notification.priority}
                      </Badge>
                    </div>
                    <p className="text-sm text-slate-400">{notification.message}</p>
                    <p className="text-xs text-slate-500 mt-2">
                      {new Date(notification.created_date).toLocaleString()}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Create Alert Dialog */}
      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        {/* Added max-h and overflow-y for better form handling */}
        <DialogContent className="bg-slate-900 border-slate-700 max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-white">Create New Alert</DialogTitle>
          </DialogHeader>
          <CreatePriceAlert onClose={() => setIsCreateDialogOpen(false)} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
