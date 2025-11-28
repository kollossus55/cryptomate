import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChevronDown, ChevronUp, Bug, Activity, AlertCircle, CheckCircle2, XCircle, Clock, TrendingUp, Settings as SettingsIcon, RefreshCw, Sparkles, Zap, PlayCircle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";

export default function AutoTradingDebugPanel({ 
  autoTradingSettings, 
  portfolio, 
  assets, 
  assetConfidence,
  isEnabled 
}) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [logs, setLogs] = useState([]);
  const [nextCheckIn, setNextCheckIn] = useState(45);
  const [lastRefresh, setLastRefresh] = useState(Date.now());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [lastSettingsUpdate, setLastSettingsUpdate] = useState(null);
  const [lastPortfolioUpdate, setLastPortfolioUpdate] = useState(null);
  
  const queryClient = useQueryClient();

  // Track when actual data changes (not just component refresh)
  useEffect(() => {
    if (autoTradingSettings) {
      setLastSettingsUpdate(Date.now());
    }
  }, [
    autoTradingSettings?.trades_today, 
    autoTradingSettings?.daily_loss, 
    autoTradingSettings?.is_enabled,
    autoTradingSettings?.market_condition,
    autoTradingSettings?.use_dynamic_risk,
    autoTradingSettings?.use_smart_routing,
    autoTradingSettings?.use_vwap,
    autoTradingSettings?.use_twap,
    autoTradingSettings?.twap_num_orders,
    autoTradingSettings?.twap_duration_minutes,
    autoTradingSettings?.twap_threshold_percent,
    autoTradingSettings?.vwap_participation_rate,
    autoTradingSettings?.vwap_lookback_periods,
    autoTradingSettings?.high_volatility_threshold,
    autoTradingSettings?.extreme_volatility_threshold,
    autoTradingSettings?.execution_strategy
  ]);

  useEffect(() => {
    if (portfolio) {
      setLastPortfolioUpdate(Date.now());
    }
  }, [portfolio?.total_balance, portfolio?.available_balance, portfolio?.positions?.length]);

  // Trigger manual auto-trade cycle
  const handleRunAutoTrade = async () => {
    setIsRunning(true);
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [{
      id: Date.now(),
      timestamp,
      message: '🚀 Triggering manual auto-trade cycle...',
      type: 'info'
    }, ...prev].slice(0, 50));

    try {
      const { base44 } = await import('@/api/base44Client');
      
      // Invoke the scheduler directly
      const result = await base44.functions.invoke('tradingScheduler');
      
      // Refresh data to show results
      await queryClient.invalidateQueries({ queryKey: ['portfolio'] });
      await queryClient.invalidateQueries({ queryKey: ['auto-trading-settings'] });
      await queryClient.refetchQueries({ queryKey: ['portfolio'] });
      
      const successTimestamp = new Date().toLocaleTimeString();
      setLogs(prev => [{
        id: Date.now() + 1,
        timestamp: successTimestamp,
        message: `✅ Cycle complete: ${result.data?.summary?.trades_executed || 0} trades executed`,
        type: 'success'
      }, ...prev].slice(0, 50));
      
    } catch (error) {
      console.error('Failed to run auto-trade:', error);
      const errorTimestamp = new Date().toLocaleTimeString();
      setLogs(prev => [{
        id: Date.now() + 2,
        timestamp: errorTimestamp,
        message: `❌ Cycle failed: ${error.message}`,
        type: 'error'
      }, ...prev].slice(0, 50));
    } finally {
      setIsRunning(false);
      setLastRefresh(Date.now());
    }
  };

  // Force refresh function
  const handleForceRefresh = async () => {
    setIsRefreshing(true);
    
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [{
      id: Date.now(),
      timestamp,
      message: '🔄 Refreshing data from server...',
      type: 'info'
    }, ...prev].slice(0, 50));

    try {
      // Invalidate and immediately refetch queries
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['auto-trading-settings'] }),
        queryClient.invalidateQueries({ queryKey: ['portfolio'] })
      ]);

      // Wait a bit for the queries to refetch
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Force refetch to ensure we get fresh data
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ['auto-trading-settings'] }),
        queryClient.refetchQueries({ queryKey: ['portfolio'] })
      ]);

      setLastRefresh(Date.now());
      
      // Add success log
      const successTimestamp = new Date().toLocaleTimeString();
      setLogs(prev => [{
        id: Date.now() + 1,
        timestamp: successTimestamp,
        message: '✅ Data refreshed successfully from database',
        type: 'success'
      }, ...prev].slice(0, 50));
    } catch (error) {
      console.error('Failed to refresh:', error);
      
      // Add error log
      const errorTimestamp = new Date().toLocaleTimeString();
      setLogs(prev => [{
        id: Date.now() + 2,
        timestamp: errorTimestamp,
        message: `❌ Refresh failed: ${error.message}`,
        type: 'error'
      }, ...prev].slice(0, 50));
    } finally {
      setTimeout(() => setIsRefreshing(false), 800);
    }
  };

  // Reset daily counters function
  const handleResetDailyCounters = async () => {
    if (!window.confirm('Are you sure you want to reset daily counters? This will set "trades_today" and "daily_loss" to 0, clear "assets_traded_today", and update "last_trade_date".')) {
      return;
    }

    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [{
      id: Date.now(),
      timestamp,
      message: '🔄 Resetting daily counters...',
      type: 'info'
    }, ...prev].slice(0, 50));

    try {
      if (autoTradingSettings?.id) {
        // We use queryClient.fetchQuery to manually trigger an update and ensure the cache is fresh
        await queryClient.fetchQuery({
          queryKey: ['auto-trading-settings'],
          queryFn: async () => {
            // Import base44 here to use it
            const { base44 } = await import('@/api/base44Client');
            
            // Update the settings
            await base44.entities.AutoTradingSettings.update(autoTradingSettings.id, {
              ...autoTradingSettings,
              trades_today: 0,
              daily_loss: 0,
              assets_traded_today: [],
              last_trade_date: new Date().toISOString()
            });

            // Refetch the updated data directly after the update
            const result = await base44.entities.AutoTradingSettings.list();
            // Assuming list returns an array and we want the first (or only) item
            return result[0];
          },
          // To ensure it actually runs the queryFn even if data is in cache
          staleTime: 0,
          cacheTime: 0
        });

        const successTimestamp = new Date().toLocaleTimeString();
        setLogs(prev => [{
          id: Date.now() + 1,
          timestamp: successTimestamp,
          message: '✅ Daily counters reset successfully.',
          type: 'success'
        }, ...prev].slice(0, 50));
      } else {
        throw new Error('Auto-trading settings ID not found.');
      }
    } catch (error) {
      console.error('Failed to reset counters:', error);
      
      const errorTimestamp = new Date().toLocaleTimeString();
      setLogs(prev => [{
        id: Date.now() + 2,
        timestamp: errorTimestamp,
        message: `❌ Reset failed: ${error.message}`,
        type: 'error'
      }, ...prev].slice(0, 50));
    }
  };

  // Intercept console.log to capture auto-trading logs
  useEffect(() => {
    if (!isEnabled) return;

    const originalLog = console.log;
    console.log = (...args) => {
      originalLog(...args);
      
      // Capture auto-trading related logs - EXPANDED LIST
      const message = args.join(' ');
      if (message.includes('🔍') || message.includes('🎯') || message.includes('⏭️') || 
          message.includes('🚀') || message.includes('⛔') || message.includes('✅') ||
          message.includes('ℹ️') || message.includes('⚠️') || message.includes('❌') ||
          message.includes('🤖') || message.includes('💰') || message.includes('📊') ||
          message.includes('🧠') || message.includes('⏱️') || message.includes('📅') ||
          message.includes('🎬')) { // Added trade execution emojis
        
        const timestamp = new Date().toLocaleTimeString();
        const logEntry = {
          id: Date.now() + Math.random(),
          timestamp,
          message,
          type: message.includes('⛔') || message.includes('❌') ? 'error' :
                message.includes('⚠️') ? 'warning' :
                message.includes('🚀') || message.includes('✅') || message.includes('🤖') || message.includes('💰') ? 'success' :
                message.includes('🎯') ? 'opportunity' :
                'info'
        };

        setLogs(prev => [logEntry, ...prev].slice(0, 50)); // Keep last 50 logs
      }
    };

    return () => {
      console.log = originalLog;
    };
  }, [isEnabled]);

  // Countdown timer for next check
  useEffect(() => {
    if (!isEnabled) return;

    const interval = setInterval(() => {
      setNextCheckIn(prev => {
        if (prev <= 1) return 45;
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isEnabled]);

  // Track data updates
  useEffect(() => {
    setLastRefresh(Date.now());
  }, [autoTradingSettings, portfolio]);

  if (!isEnabled) {
    return (
      <Card className="bg-slate-800 border-slate-700 mb-6">
        <CardContent className="p-4">
          <div className="flex items-center gap-3 text-slate-400">
            <Bug className="w-5 h-5" />
            <span className="text-sm">Auto-trading debug panel (enable auto-trading to see status)</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  const getLogIcon = (type) => {
    switch(type) {
      case 'error': return <XCircle className="w-4 h-4 text-red-400" />;
      case 'warning': return <AlertCircle className="w-4 h-4 text-yellow-400" />;
      case 'success': return <CheckCircle2 className="w-4 h-4 text-green-400" />;
      case 'opportunity': return <TrendingUp className="w-4 h-4 text-indigo-400" />;
      default: return <Activity className="w-4 h-4 text-slate-400" />;
    }
  };

  const getLogBg = (type) => {
    switch(type) {
      case 'error': return 'bg-red-500/10 border-red-500/30';
      case 'warning': return 'bg-yellow-500/10 border-yellow-500/30';
      case 'success': return 'bg-green-500/10 border-green-500/30';
      case 'opportunity': return 'bg-indigo-500/10 border-indigo-500/30';
      default: return 'bg-slate-500/10 border-slate-500/30';
    }
  };

  // Get top 5 assets by confidence
  const topAssets = Object.entries(assetConfidence || {})
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5);

  // Check circuit breaker status
  const isCircuitBreakerTriggered = 
    (autoTradingSettings?.daily_loss || 0) >= (autoTradingSettings?.max_daily_loss_percent || 0);
  
  const tradesLimitReached = 
    (autoTradingSettings?.trades_today || 0) >= (autoTradingSettings?.max_trades_per_day || 10);

  const hasRequirements = portfolio && assets && assets.length > 0 && Object.keys(assetConfidence).length > 0;

  const getTimeAgo = (timestamp) => {
    if (!timestamp) return 'Unknown';
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 5) return 'Just now';
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 120) return '1m ago';
    return `${Math.floor(seconds / 60)}m ago`;
  };

  return (
    <Card className="bg-gradient-to-br from-slate-900 to-slate-800 border-indigo-500/40 mb-6">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-500/20 rounded-xl flex items-center justify-center">
              <Bug className="w-5 h-5 text-indigo-400" />
            </div>
            <div>
              <CardTitle className="text-white flex items-center gap-2">
                Auto-Trading Debug Panel
                <Badge className={hasRequirements ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}>
                  {hasRequirements ? 'Ready' : 'Not Ready'}
                </Badge>
              </CardTitle>
              <div className="flex items-center gap-3 mt-1">
                <p className="text-xs text-slate-400">
                  Next check in {nextCheckIn}s
                </p>
                <span className="text-slate-600">•</span>
                <p className="text-xs text-slate-400">
                  Settings: {getTimeAgo(lastSettingsUpdate)}
                </p>
                <span className="text-slate-600">•</span>
                <p className="text-xs text-slate-400">
                  Portfolio: {getTimeAgo(lastPortfolioUpdate)}
                </p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {tradesLimitReached && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleResetDailyCounters}
                className="text-orange-400 hover:text-orange-300 hover:bg-orange-500/10 border-orange-500/40"
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                Reset Counters
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={handleRunAutoTrade}
              disabled={isRunning}
              className="text-green-400 hover:text-green-300 border-green-500/30 hover:bg-green-500/10 bg-green-500/5"
            >
              {isRunning ? (
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <PlayCircle className="w-4 h-4 mr-2" />
              )}
              {isRunning ? 'Running Cycle...' : 'Run Auto-Trade'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleForceRefresh}
              disabled={isRefreshing}
              className="text-indigo-400 hover:text-indigo-300 hover:bg-indigo-500/10"
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
              {isRefreshing ? 'Refreshing...' : 'Refresh Data'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsExpanded(!isExpanded)}
              className="text-slate-400 hover:text-white"
            >
              {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
            </Button>
          </div>
        </div>
      </CardHeader>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
          >
            <CardContent className="space-y-4">
              
              {/* Status Grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-slate-800 rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Clock className="w-4 h-4 text-indigo-400" />
                    <span className="text-xs text-slate-400">Next Check</span>
                  </div>
                  <p className="text-lg font-bold text-white">{nextCheckIn}s</p>
                </div>

                <div className="bg-slate-800 rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Activity className="w-4 h-4 text-green-400" />
                    <span className="text-xs text-slate-400">Confidence Ready</span>
                  </div>
                  <p className="text-lg font-bold text-white">
                    {Object.keys(assetConfidence).length}/{assets?.length || 0}
                  </p>
                </div>

                <div className="bg-slate-800 rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <TrendingUp className="w-4 h-4 text-yellow-400" />
                    <span className="text-xs text-slate-400">Trades Today</span>
                  </div>
                  <p className="text-lg font-bold text-white">
                    {autoTradingSettings?.trades_today || 0}/{autoTradingSettings?.max_trades_per_day || 10}
                  </p>
                </div>

                <div className="bg-slate-800 rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <SettingsIcon className="w-4 h-4 text-purple-400" />
                    <span className="text-xs text-slate-400">Min Confidence</span>
                  </div>
                  <p className="text-lg font-bold text-white">
                    {autoTradingSettings?.min_confidence || 70}%
                  </p>
                </div>
              </div>

              {/* System Status */}
              <div className="bg-slate-800 rounded-lg p-4">
                <h4 className="text-sm font-semibold text-white mb-3">System Status</h4>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-400">Portfolio Loaded</span>
                    {portfolio ? (
                      <Badge className="bg-green-500/20 text-green-400">
                        <CheckCircle2 className="w-3 h-3 mr-1" />
                        Yes - ${portfolio.available_balance?.toLocaleString()}
                      </Badge>
                    ) : (
                      <Badge className="bg-red-500/20 text-red-400">
                        <XCircle className="w-3 h-3 mr-1" />
                        No
                      </Badge>
                    )}
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-400">Assets Data</span>
                    {assets && assets.length > 0 ? (
                      <Badge className="bg-green-500/20 text-green-400">
                        <CheckCircle2 className="w-3 h-3 mr-1" />
                        {assets.length} assets
                      </Badge>
                    ) : (
                      <Badge className="bg-red-500/20 text-red-400">
                        <XCircle className="w-3 h-3 mr-1" />
                        No assets
                      </Badge>
                    )}
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-400">AI Confidence</span>
                    {Object.keys(assetConfidence).length > 0 ? (
                      <Badge className="bg-green-500/20 text-green-400">
                        <CheckCircle2 className="w-3 h-3 mr-1" />
                        {Object.keys(assetConfidence).length} calculated
                      </Badge>
                    ) : (
                      <Badge className="bg-yellow-500/20 text-yellow-400">
                        <AlertCircle className="w-3 h-3 mr-1" />
                        Calculating...
                      </Badge>
                    )}
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-400">Market Condition</span>
                    {autoTradingSettings?.market_condition ? (
                      <Badge className={
                        autoTradingSettings.market_condition === 'extreme' ? 'bg-red-500/20 text-red-400' :
                        autoTradingSettings.market_condition === 'volatile' ? 'bg-orange-500/20 text-orange-400' :
                        'bg-green-500/20 text-green-400'
                      }>
                        {autoTradingSettings.market_condition.toUpperCase()}
                      </Badge>
                    ) : (
                      <Badge className="bg-green-500/20 text-green-400">NORMAL</Badge>
                    )}
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-400">Circuit Breaker</span>
                    {isCircuitBreakerTriggered ? (
                      <Badge className="bg-red-500/20 text-red-400">
                        <XCircle className="w-3 h-3 mr-1" />
                        TRIGGERED
                      </Badge>
                    ) : (
                      <Badge className="bg-green-500/20 text-green-400">
                        <CheckCircle2 className="w-3 h-3 mr-1" />
                        OK
                      </Badge>
                    )}
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-400">Dynamic Risk</span>
                    {autoTradingSettings?.use_dynamic_risk ? (
                      <Badge className="bg-indigo-500/20 text-indigo-400">
                        <Activity className="w-3 h-3 mr-1" />
                        ENABLED
                      </Badge>
                    ) : (
                      <Badge className="bg-slate-500/20 text-slate-400">DISABLED</Badge>
                    )}
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-400">Smart Execution</span>
                    {autoTradingSettings?.use_smart_routing ? (
                      <Badge className="bg-purple-500/20 text-purple-400">
                        {autoTradingSettings.execution_strategy?.toUpperCase() || 'SMART'}
                      </Badge>
                    ) : (
                      <Badge className="bg-slate-500/20 text-slate-400">STANDARD</Badge>
                    )}
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-400">Daily Trade Limit</span>
                    {tradesLimitReached ? (
                      <motion.div
                        animate={{ scale: [1, 1.1, 1] }}
                        transition={{ repeat: Infinity, duration: 1.5 }}
                      >
                        <Badge className="bg-red-500/20 text-red-400 border-red-500/40 animate-pulse">
                          <XCircle className="w-3 h-3 mr-1" />
                          Daily Limit Reached
                        </Badge>
                      </motion.div>
                    ) : (
                      <Badge className="bg-green-500/20 text-green-400">
                        <CheckCircle2 className="w-3 h-3 mr-1" />
                        OK
                      </Badge>
                    )}
                  </div>
                </div>
              </div>

              {/* Advanced Features Status */}
              {(autoTradingSettings?.use_vwap || autoTradingSettings?.use_twap || autoTradingSettings?.use_dynamic_risk) && (
                <div className="bg-indigo-500/10 border border-indigo-500/30 rounded-lg p-4">
                  <h4 className="text-sm font-semibold text-indigo-300 mb-3 flex items-center gap-2">
                    <Sparkles className="w-4 h-4" />
                    Advanced Features Active
                  </h4>
                  <div className="space-y-2 text-sm">
                    {autoTradingSettings.use_twap && (
                      <div className="flex items-start gap-2">
                        <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full mt-1.5"></div>
                        <div>
                          <span className="text-indigo-200 font-semibold">TWAP Execution</span>
                          <p className="text-indigo-300/80 text-xs">
                            {autoTradingSettings.twap_num_orders} orders over {autoTradingSettings.twap_duration_minutes}min for positions &gt;{autoTradingSettings.twap_threshold_percent}%
                          </p>
                        </div>
                      </div>
                    )}
                    {autoTradingSettings.use_vwap && (
                      <div className="flex items-start gap-2">
                        <div className="w-1.5 h-1.5 bg-purple-400 rounded-full mt-1.5"></div>
                        <div>
                          <span className="text-purple-200 font-semibold">VWAP Execution</span>
                          <p className="text-purple-300/80 text-xs">
                            {autoTradingSettings.vwap_participation_rate}% market participation, {autoTradingSettings.vwap_lookback_periods} period lookback
                          </p>
                        </div>
                      </div>
                    )}
                    {autoTradingSettings.use_dynamic_risk && (
                      <div className="flex items-start gap-2">
                        <div className="w-1.5 h-1.5 bg-green-400 rounded-full mt-1.5"></div>
                        <div>
                          <span className="text-green-200 font-semibold">Dynamic Risk Management</span>
                          <p className="text-green-300/80 text-xs">
                            Auto-adjusts position sizing based on market volatility (high: &gt;{autoTradingSettings.high_volatility_threshold}%, extreme: &gt;{autoTradingSettings.extreme_volatility_threshold}%)
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Top Confidence Assets */}
              {topAssets.length > 0 && (
                <div className="bg-slate-800 rounded-lg p-4">
                  <h4 className="text-sm font-semibold text-white mb-3">Top 5 Assets by AI Confidence</h4>
                  <div className="space-y-2">
                    {topAssets.map(([symbol, confidence], idx) => {
                      const asset = assets.find(a => a.symbol === symbol);
                      const meetsThreshold = confidence >= (autoTradingSettings?.min_confidence || 70);
                      
                      return (
                        <div key={symbol} className="flex items-center justify-between bg-slate-700 rounded-lg p-2">
                          <div className="flex items-center gap-2">
                            <span className="text-slate-400 text-xs font-mono">#{idx + 1}</span>
                            <span className="text-white font-semibold">{symbol}</span>
                            {asset && (
                              <span className={`text-xs ${asset.change24h >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                {asset.change24h >= 0 ? '+' : ''}{asset.change24h?.toFixed(2)}%
                              </span>
                            )}
                          </div>
                          <Badge className={meetsThreshold 
                            ? 'bg-green-500/20 text-green-400 border-green-500/30' 
                            : 'bg-red-500/20 text-red-400 border-red-500/30'
                          }>
                            {confidence}%
                            {meetsThreshold && <CheckCircle2 className="w-3 h-3 ml-1" />}
                          </Badge>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Real-Time Logs */}
              <div className="bg-slate-800 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-semibold text-white">Real-Time Activity Log</h4>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setLogs([])}
                    className="text-xs text-slate-400 hover:text-white"
                  >
                    Clear
                  </Button>
                </div>
                
                <ScrollArea className="h-64 pr-4">
                  {logs.length === 0 ? (
                    <div className="text-center py-8 text-slate-500">
                      <Activity className="w-8 h-8 mx-auto mb-2 opacity-50" />
                      <p className="text-sm">Waiting for auto-trading activity...</p>
                      <p className="text-xs mt-1">Logs will appear here when checks run</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {logs.map((log) => (
                        <motion.div
                          key={log.id}
                          initial={{ opacity: 0, x: -20 }}
                          animate={{ opacity: 1, x: 0 }}
                          className={`flex items-start gap-2 p-2 rounded-lg border ${getLogBg(log.type)}`}
                        >
                          <div className="mt-0.5">
                            {getLogIcon(log.type)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-xs text-slate-400 font-mono">{log.timestamp}</span>
                              <Badge variant="outline" className="text-xs">
                                {log.type}
                              </Badge>
                            </div>
                            <p className="text-xs text-slate-300 break-words">{log.message}</p>
                          </div>
                        </motion.div>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </div>

              {/* Quick Tips */}
              <div className="bg-indigo-500/10 border border-indigo-500/30 rounded-lg p-3">
                <h4 className="text-xs font-semibold text-indigo-300 mb-2">💡 Debugging Tips</h4>
                <ul className="space-y-1 text-xs text-indigo-200">
                  <li>• If no trades execute: Lower min_confidence or check confidence levels above</li>
                  <li>• If "No opportunities found": Assets may not meet confidence + price change criteria</li>
                  <li>• System checks every 45 seconds when page is open</li>
                  <li>• Use the Refresh button above to force reload data immediately</li>
                  <li>• Check browser console (F12) for detailed technical logs</li>
                </ul>
              </div>

            </CardContent>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}