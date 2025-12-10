import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Activity, Brain, Server, Wifi, Cpu, AlertCircle, CheckCircle2, Clock } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export default function SystemHealthMonitor({ 
  autoTradingSettings, 
  lastScanTime, 
  lastScanResult,
  activeAssetsCount,
  marketCondition
}) {
  const [indicators, setIndicators] = useState([
    { name: "Price Action Analysis", status: "active", type: "technical" },
    { name: "Volume Profile", status: "active", type: "technical" },
    { name: "Market Structure", status: "active", type: "technical" },
    { name: "Sentiment Analysis", status: "active", type: "ai" },
    { name: "Pattern Recognition", status: "active", type: "ai" },
    { name: "Volatility Scanner", status: "active", type: "risk" }
  ]);

  const [logs, setLogs] = useState([]);

  useEffect(() => {
    if (lastScanResult) {
      setLogs(prev => [
        { time: new Date().toLocaleTimeString(), message: lastScanResult, type: lastScanResult.includes('EXECUTED') ? 'success' : 'info' },
        ...prev
      ].slice(0, 5));
    }
  }, [lastScanTime, lastScanResult]);

  const getStatusColor = (status) => {
    switch(status) {
      case 'active': return 'text-green-400';
      case 'warning': return 'text-yellow-400';
      case 'error': return 'text-red-400';
      default: return 'text-slate-400';
    }
  };

  return (
    <Card className="bg-slate-900 border-slate-700 shadow-xl overflow-hidden">
      <CardHeader className="border-b border-slate-800 pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg font-medium text-white flex items-center gap-2">
            <Activity className="w-5 h-5 text-indigo-400" />
            System Intelligence & Status
          </CardTitle>
          <Badge variant="outline" className="bg-slate-800 text-green-400 border-green-500/30 flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            SYSTEM ONLINE
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-slate-800">
          
          {/* Active Indicators */}
          <div className="p-4">
            <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
              <Brain className="w-4 h-4" />
              Active Trading Indicators
            </h4>
            <div className="space-y-2">
              {indicators.map((indicator, idx) => (
                <div key={idx} className="flex items-center justify-between group">
                  <div className="flex items-center gap-2">
                    <div className={`w-1.5 h-1.5 rounded-full ${indicator.type === 'ai' ? 'bg-purple-500' : 'bg-blue-500'}`} />
                    <span className="text-sm text-slate-300 group-hover:text-white transition-colors">{indicator.name}</span>
                  </div>
                  <CheckCircle2 className="w-3 h-3 text-green-500 opacity-50 group-hover:opacity-100" />
                </div>
              ))}
            </div>
            <div className="mt-4 pt-3 border-t border-slate-800">
              <div className="flex justify-between items-center text-xs">
                <span className="text-slate-500">Logic Core</span>
                <span className="text-indigo-400">V4.2 (Smart Dip Buy)</span>
              </div>
            </div>
          </div>

          {/* System Metrics */}
          <div className="p-4">
            <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
              <Cpu className="w-4 h-4" />
              Engine Metrics
            </h4>
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-slate-800/50 p-2 rounded-lg">
                <p className="text-[10px] text-slate-500 mb-1">Market Condition</p>
                <p className={`text-sm font-bold ${
                  marketCondition === 'normal' ? 'text-green-400' : 
                  marketCondition === 'volatile' ? 'text-yellow-400' : 'text-red-400'
                }`}>
                  {marketCondition?.toUpperCase() || 'SCANNING...'}
                </p>
              </div>
              <div className="bg-slate-800/50 p-2 rounded-lg">
                <p className="text-[10px] text-slate-500 mb-1">Active Assets</p>
                <p className="text-sm font-bold text-blue-400">{activeAssetsCount || 0} Analyzed</p>
              </div>
              <div className="bg-slate-800/50 p-2 rounded-lg">
                <p className="text-[10px] text-slate-500 mb-1">Execution Mode</p>
                <p className="text-sm font-bold text-white">
                  {autoTradingSettings?.execution_mode === 'browser' ? 'Browser' : 'Hybrid/Server'}
                </p>
              </div>
              <div className="bg-slate-800/50 p-2 rounded-lg">
                <p className="text-[10px] text-slate-500 mb-1">Confidence Threshold</p>
                <p className="text-sm font-bold text-purple-400">{autoTradingSettings?.min_confidence || 70}%</p>
              </div>
            </div>
          </div>

          {/* Activity Log */}
          <div className="p-4 bg-slate-950/30">
            <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
              <Clock className="w-4 h-4" />
              Live Activity Log
            </h4>
            <div className="space-y-3 min-h-[140px]">
              <AnimatePresence initial={false}>
                {logs.length > 0 ? (
                  logs.map((log, i) => (
                    <motion.div
                      key={log.time + i}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="flex gap-2 items-start text-xs"
                    >
                      <span className="text-slate-600 font-mono whitespace-nowrap">{log.time}</span>
                      <span className={`${log.type === 'success' ? 'text-green-400' : 'text-slate-300'} leading-tight`}>
                        {log.message}
                      </span>
                    </motion.div>
                  ))
                ) : (
                  <div className="flex flex-col items-center justify-center h-24 text-slate-600 text-xs">
                    <Wifi className="w-6 h-6 mb-2 opacity-20" />
                    Waiting for next scan cycle...
                  </div>
                )}
              </AnimatePresence>
            </div>
          </div>

        </div>
      </CardContent>
    </Card>
  );
}