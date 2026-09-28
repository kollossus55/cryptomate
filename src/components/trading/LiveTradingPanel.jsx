import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, Zap, Clock, Link2, Power, AlertTriangle, Shield } from "lucide-react";
import { Link } from "react-router-dom";
import { createPageUrl } from "../utils";

export default function LiveTradingPanel() {
  const queryClient = useQueryClient();
  const [isProcessing, setIsProcessing] = useState(false);

  const { data: settings } = useQuery({
    queryKey: ['auto-trading-settings'],
    queryFn: async () => {
      const result = await base44.entities.AutoTradingSettings.list();
      return result[0];
    },
    staleTime: 15000,
  });

  const { data: connections } = useQuery({
    queryKey: ['exchange-connections'],
    queryFn: async () => {
      return await base44.entities.ExchangeConnection.list();
    },
    staleTime: 30000,
  });

  const activeConnection = connections?.find(c => c.is_active && c.connection_status === 'connected');
  const liveEnabled = settings?.live_trading_enabled;
  const killSwitch = settings?.kill_switch_enabled;

  const requestedAt = settings?.live_trading_requested_at ? new Date(settings.live_trading_requested_at) : null;
  const cooldownEnd = requestedAt ? new Date(requestedAt.getTime() + 24 * 60 * 60 * 1000) : null;
  const cooldownPassed = cooldownEnd ? new Date() >= cooldownEnd : false;
  const cooldownRemaining = cooldownEnd ? Math.max(0, cooldownEnd.getTime() - Date.now()) : 0;
  const cooldownHours = Math.floor(cooldownRemaining / (1000 * 60 * 60));
  const cooldownMinutes = Math.floor((cooldownRemaining % (1000 * 60 * 60)) / (1000 * 60));

  const invokeLiveControl = async (action) => {
    const res = await base44.functions.invoke('liveTradingControl', { action });
    const data = res?.data ?? res;
    if (!data || data.success !== true) {
      throw new Error(data?.error || 'Request failed');
    }
    return data;
  };

  const handleRequestLive = async () => {
    if (!activeConnection) return;
    if (!window.confirm('Request live trading? A 24-hour cooldown will begin before you can enable live orders.')) return;
    setIsProcessing(true);
    try {
      await invokeLiveControl('request');
      queryClient.invalidateQueries({ queryKey: ['auto-trading-settings'] });
      queryClient.invalidateQueries({ queryKey: ['exchange-connections'] });
    } catch (error) {
      console.error('Failed to request live trading:', error);
      alert(`Failed to request live trading: ${error.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleEnableLive = async () => {
    if (!cooldownPassed) {
      alert('24-hour cooldown has not passed yet.');
      return;
    }
    if (!window.confirm('ENABLE LIVE TRADING?\n\nThis will place REAL orders with REAL money on your exchange.\n\nAre you absolutely sure?')) return;
    if (!window.confirm('FINAL WARNING: Live trading uses your real exchange funds. Confirm to proceed.')) return;
    setIsProcessing(true);
    try {
      // The server re-verifies the 24h cooldown; this is the authoritative gate.
      await invokeLiveControl('enable');
      queryClient.invalidateQueries({ queryKey: ['auto-trading-settings'] });
    } catch (error) {
      console.error('Failed to enable live trading:', error);
      alert(`Failed to enable live trading: ${error.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDisableLive = async () => {
    if (!window.confirm('Disable live trading? Auto-trading will revert to paper mode immediately.')) return;
    setIsProcessing(true);
    try {
      await invokeLiveControl('disable');
      queryClient.invalidateQueries({ queryKey: ['auto-trading-settings'] });
    } catch (error) {
      console.error('Failed to disable live trading:', error);
      alert(`Failed to disable live trading: ${error.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCancelRequest = async () => {
    setIsProcessing(true);
    try {
      await invokeLiveControl('cancel');
      queryClient.invalidateQueries({ queryKey: ['auto-trading-settings'] });
      queryClient.invalidateQueries({ queryKey: ['exchange-connections'] });
    } catch (error) {
      console.error('Failed to cancel request:', error);
      alert(`Failed to cancel request: ${error.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  if (!activeConnection) {
    return (
      <Card className="bg-slate-900/80 border-slate-700 mb-6">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Zap className="w-5 h-5 text-yellow-500" />
            Live Trading
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-slate-400" />
            <p className="text-slate-400 text-sm">
              Connect an exchange first to enable live trading.{' '}
              <Link to={createPageUrl('ExchangeSettings')} className="text-indigo-400 hover:underline">
                Go to Exchange Settings →
              </Link>
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={`mb-6 border-2 ${liveEnabled ? 'border-red-500/50 bg-red-500/5' : 'border-slate-700 bg-slate-900/80'}`}>
      <CardHeader>
        <CardTitle className="text-white flex items-center gap-2 flex-wrap">
          <Zap className={`w-5 h-5 ${liveEnabled ? 'text-red-500' : 'text-yellow-500'}`} />
          Live Trading
          {liveEnabled ? (
            <Badge className="bg-red-500/20 text-red-400 border-red-500/50 animate-pulse">LIVE</Badge>
          ) : (
            <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">PAPER</Badge>
          )}
          {killSwitch && (
            <Badge className="bg-red-600 text-white">KILL SWITCH ACTIVE</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2 text-sm">
          <Link2 className="w-4 h-4 text-slate-400" />
          <span className="text-slate-300">
            Connected to <strong className="text-white">{activeConnection.exchange_name.toUpperCase()}</strong>
            {' '}({activeConnection.api_key_fingerprint})
          </span>
        </div>

        {killSwitch && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 flex items-start gap-2">
            <Shield className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
            <p className="text-red-200 text-sm">
              Kill switch is active. All trading is halted. Disable the kill switch in Auto-Trading settings to resume.
            </p>
          </div>
        )}

        {liveEnabled && !killSwitch && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 flex items-start gap-2">
            <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-red-200 text-sm font-semibold">Live trading is ACTIVE</p>
              <p className="text-red-200/80 text-xs">
                The auto-trading worker is placing real orders on your exchange. Manual trades can also be placed live.
              </p>
            </div>
          </div>
        )}

        {requestedAt && !liveEnabled && !cooldownPassed && (
          <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3 flex items-start gap-2">
            <Clock className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-blue-200 text-sm font-semibold">24-hour cooldown in progress</p>
              <p className="text-blue-200/80 text-xs">
                Time remaining: <strong>{cooldownHours}h {cooldownMinutes}m</strong>
              </p>
              <p className="text-blue-200/60 text-xs mt-1">
                Requested at {requestedAt.toLocaleString()}. You can enable live trading after the cooldown passes.
              </p>
            </div>
          </div>
        )}

        {requestedAt && !liveEnabled && cooldownPassed && (
          <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3 flex items-start gap-2">
            <Power className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-green-200 text-sm font-semibold">Cooldown complete</p>
              <p className="text-green-200/80 text-xs">
                You can now enable live trading. Real orders will be placed on your exchange.
              </p>
            </div>
          </div>
        )}

        <div className="flex gap-2 flex-wrap">
          {!requestedAt && !liveEnabled && (
            <Button
              onClick={handleRequestLive}
              disabled={isProcessing || killSwitch}
              className="bg-yellow-500 hover:bg-yellow-400 text-slate-900 font-semibold"
            >
              <Clock className="w-4 h-4 mr-2" />
              Request Live Trading
            </Button>
          )}

          {requestedAt && !liveEnabled && !cooldownPassed && (
            <Button
              onClick={handleCancelRequest}
              disabled={isProcessing}
              variant="outline"
              className="border-slate-600 text-slate-300 hover:bg-slate-800"
            >
              Cancel Request
            </Button>
          )}

          {requestedAt && !liveEnabled && cooldownPassed && (
            <>
              <Button
                onClick={handleEnableLive}
                disabled={isProcessing || killSwitch}
                className="bg-red-600 hover:bg-red-700 text-white font-semibold"
              >
                <Power className="w-4 h-4 mr-2" />
                Enable Live Trading
              </Button>
              <Button
                onClick={handleCancelRequest}
                disabled={isProcessing}
                variant="outline"
                className="border-slate-600 text-slate-300 hover:bg-slate-800"
              >
                Cancel Request
              </Button>
            </>
          )}

          {liveEnabled && (
            <Button
              onClick={handleDisableLive}
              disabled={isProcessing}
              className="bg-slate-700 hover:bg-slate-600 text-white font-semibold"
            >
              <Power className="w-4 h-4 mr-2" />
              Disable Live Trading
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}