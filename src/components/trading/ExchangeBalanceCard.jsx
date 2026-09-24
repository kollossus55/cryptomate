import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RefreshCw, Wallet, AlertCircle, ExternalLink, Timer } from "lucide-react";
import { Link } from "react-router-dom";
import { createPageUrl } from "../utils";

export default function ExchangeBalanceCard() {
  const [fetchError, setFetchError] = useState(null);
  const [rateLimitSeconds, setRateLimitSeconds] = useState(0);

  // Client-side cooldown mirror of the server-side Kraken lockout guard.
  // When a fetch returns rate_limited, we disable refresh for 60s so the
  // user doesn't spam the button (each call prolongs the real Kraken lockout).
  useEffect(() => {
    if (rateLimitSeconds <= 0) return;
    const t = setInterval(() => setRateLimitSeconds((s) => s - 1), 1000);
    return () => clearInterval(t);
  }, [rateLimitSeconds]);

  // Load the user's exchange connections
  const { data: connections = [] } = useQuery({
    queryKey: ['exchange-connections'],
    queryFn: () => base44.entities.ExchangeConnection.list(),
    staleTime: 60000,
  });

  const activeConnection = connections.find(c => c.is_active && c.connection_status === 'connected');

  const { data: balanceData, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['exchange-balances', activeConnection?.id],
    queryFn: async () => {
      if (!activeConnection) return null;
      setFetchError(null);
      try {
        const res = await base44.functions.invoke('exchangeCredentials', {
          action: 'fetchBalances',
          connection_id: activeConnection.id,
        });
        if (!res.data?.success) {
          const errMsg = res.data?.error || 'Failed to fetch balances';
          setFetchError(errMsg);
          if (res.data?.rate_limited || /rate-limiting/i.test(errMsg)) {
            setRateLimitSeconds(60);
          }
          return null;
        }
        return res.data;
      } catch (error) {
        const msg = error.response?.data?.error || error.data?.error || error.message || 'Failed to fetch balances';
        setFetchError(msg);
        if (error.response?.data?.rate_limited || /rate-limiting/i.test(msg)) {
          setRateLimitSeconds(60);
        }
        return null;
      }
    },
    enabled: !!activeConnection,
    staleTime: 120000,
    refetchOnWindowFocus: false,
    refetchInterval: false,
    retry: 0,
  });

  // No connection at all
  if (connections.length === 0) {
    return (
      <Card className="bg-slate-800 border-slate-700 mb-6">
        <CardContent className="pt-6">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-slate-700 rounded-xl flex items-center justify-center flex-shrink-0">
              <Wallet className="w-6 h-6 text-slate-400" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-white mb-1">No Exchange Connected</h3>
              <p className="text-sm text-slate-400 mb-3">
                Connect an exchange to see your real account balance here.
              </p>
              <Link to={createPageUrl('ExchangeSettings')}>
                <Button size="sm" className="bg-indigo-600 hover:bg-indigo-700">
                  <ExternalLink className="w-4 h-4 mr-2" />
                  Connect Exchange
                </Button>
              </Link>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Connection exists but not active/connected
  if (!activeConnection) {
    return (
      <Card className="bg-slate-800 border-slate-700 mb-6">
        <CardContent className="pt-6">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-orange-500/20 rounded-xl flex items-center justify-center flex-shrink-0">
              <AlertCircle className="w-6 h-6 text-orange-400" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-white mb-1">Exchange Not Connected</h3>
              <p className="text-sm text-slate-400 mb-3">
                Your exchange connection needs to be tested. Visit Exchange Settings to reconnect.
              </p>
              <Link to={createPageUrl('ExchangeSettings')}>
                <Button size="sm" variant="outline" className="border-slate-600 text-slate-200 hover:bg-slate-700">
                  <ExternalLink className="w-4 h-4 mr-2" />
                  Go to Settings
                </Button>
              </Link>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const balances = balanceData?.balances || [];
  const exchangeName = (activeConnection.exchange_name || '').toUpperCase();

  return (
    <Card className="bg-gradient-to-br from-slate-800 to-slate-900 border-2 border-emerald-500/40 mb-6">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-500/20 rounded-xl flex items-center justify-center">
              <Wallet className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <CardTitle className="text-white text-lg flex items-center gap-2">
                {exchangeName} Live Balance
              </CardTitle>
              <p className="text-xs text-slate-400 mt-0.5">
                Real funds on your {exchangeName} account
              </p>
            </div>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => refetch()}
            disabled={isLoading || isFetching || rateLimitSeconds > 0}
            className="text-slate-400 hover:text-white hover:bg-slate-700"
            title={rateLimitSeconds > 0 ? `Rate-limited by Kraken — retry in ${rateLimitSeconds}s` : 'Refresh'}
          >
            {rateLimitSeconds > 0 ? (
              <Timer className="w-4 h-4 text-amber-400" />
            ) : (
              <RefreshCw className={`w-4 h-4 ${(isLoading || isFetching) ? 'animate-spin' : ''}`} />
            )}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-slate-400 text-sm py-4">Loading balances...</div>
        ) : fetchError ? (
          <div className="flex items-start gap-2 py-2">
            <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-300">{fetchError}</p>
          </div>
        ) : balances.length === 0 ? (
          <div className="flex items-center gap-3 py-2">
            <div className="w-12 h-12 bg-slate-900/60 rounded-xl flex items-center justify-center border border-slate-700">
              <Wallet className="w-5 h-5 text-slate-500" />
            </div>
            <div>
              <div className="text-2xl font-bold text-white tabular-nums">0.00</div>
              <p className="text-xs text-slate-400">No holdings on this account</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {balances.map((b) => (
              <div key={b.asset} className="bg-slate-900/60 rounded-lg p-3 border border-slate-700">
                <div className="text-xs text-slate-400 mb-1">{b.asset}</div>
                <div className="text-lg font-bold text-white tabular-nums">
                  {b.amount.toLocaleString(undefined, { maximumFractionDigits: 8 })}
                </div>
              </div>
            ))}
          </div>
        )}
        <p className="text-xs text-slate-500 mt-3">
          ⚠️ This is your real exchange balance. Trading in this app remains simulated — no real orders are placed.
        </p>
      </CardContent>
    </Card>
  );
}