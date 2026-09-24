import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, XCircle, Clock, Brain, TrendingUp, RefreshCw, AlertCircle } from "lucide-react";

/**
 * AIConfirmationPanel — displays pending trade approvals created by the
 * auto-trading worker when ai_confirmation_mode is "manual". The user can
 * approve (executes the trade) or reject (discards) each one.
 */
export default function AIConfirmationPanel() {
  const queryClient = useQueryClient();
  const [actionLoading, setActionLoading] = useState(null);

  const { data: approvals = [], isLoading, refetch } = useQuery({
    queryKey: ['pending-trade-approvals'],
    queryFn: async () => {
      const result = await base44.entities.PendingTradeApproval.list('-created_date', 50);
      return result || [];
    },
    refetchInterval: 15000,
  });

  const pending = approvals.filter((a) => a.status === 'pending');

  const handleAction = async (approvalId, action) => {
    setActionLoading(approvalId);
    try {
      await base44.functions.invoke('executeApprovedTrade', {
        approval_id: approvalId,
        action,
      });
      queryClient.invalidateQueries({ queryKey: ['pending-trade-approvals'] });
    } catch (err) {
      console.error('Approval action failed:', err);
    } finally {
      setActionLoading(null);
    }
  };

  const formatTime = (ts) => {
    if (!ts) return '—';
    const d = new Date(ts);
    const mins = Math.floor((Date.now() - d.getTime()) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    return d.toLocaleTimeString();
  };

  const isExpired = (a) => a.expires_at && new Date(a.expires_at) < new Date();

  return (
    <Card className="bg-slate-800 border-2 border-violet-500/50 shadow-[0_0_15px_rgba(139,92,246,0.15)]">
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-violet-100">
          <div className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-violet-400" />
            AI Trade Confirmations
            {pending.length > 0 && (
              <Badge className="bg-violet-500/20 text-violet-300 border-violet-500/30">
                {pending.length} pending
              </Badge>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => refetch()}
            className="text-slate-400 hover:text-white"
          >
            <RefreshCw className="w-4 h-4" />
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-slate-400 text-sm py-8 text-center">Loading pending approvals…</div>
        ) : pending.length === 0 ? (
          <div className="text-slate-400 text-sm py-8 text-center flex flex-col items-center gap-2">
            <CheckCircle className="w-8 h-8 text-slate-600" />
            <p>No trades waiting for approval.</p>
            <p className="text-xs text-slate-500">
              When the auto-trader finds a signal in manual mode, it will appear here for your confirmation.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {pending.map((a) => {
              const expired = isExpired(a);
              return (
                <div
                  key={a.id}
                  className={`bg-slate-900/60 rounded-xl p-4 border ${
                    expired ? 'border-slate-700 opacity-60' : 'border-violet-500/30'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <TrendingUp className="w-4 h-4 text-green-400" />
                        <span className="font-semibold text-white">{a.asset_symbol}</span>
                        <Badge className="bg-green-500/20 text-green-400 border-green-500/30 text-xs">
                          BUY
                        </Badge>
                        <Badge className="bg-indigo-500/20 text-indigo-300 border-indigo-500/30 text-xs">
                          {a.signal_strength}/100
                        </Badge>
                      </div>
                      <p className="text-xs text-slate-400">
                        {a.signal_reasons?.slice(0, 2).join(' • ') || 'Signal detected'}
                      </p>
                    </div>
                    <div className="text-right text-xs text-slate-500">
                      <Clock className="w-3 h-3 inline mr-1" />
                      {formatTime(a.created_date)}
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-xs mb-3">
                    <div className="bg-slate-800/50 rounded p-2">
                      <p className="text-slate-500">Entry</p>
                      <p className="text-white font-medium">${a.entry_price?.toFixed(4)}</p>
                    </div>
                    <div className="bg-slate-800/50 rounded p-2">
                      <p className="text-slate-500">Size</p>
                      <p className="text-white font-medium">${a.position_size_usdt?.toFixed(0)}</p>
                    </div>
                    <div className="bg-slate-800/50 rounded p-2">
                      <p className="text-slate-500">SL / TP</p>
                      <p className="text-white font-medium text-[10px]">
                        {a.stop_loss_price?.toFixed(2)} / {a.take_profit_price?.toFixed(2)}
                      </p>
                    </div>
                  </div>

                  {expired ? (
                    <div className="flex items-center gap-2 text-amber-400 text-xs">
                      <AlertCircle className="w-4 h-4" />
                      <span>Expired — awaiting auto-cleanup</span>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={() => handleAction(a.id, 'approve')}
                        disabled={actionLoading === a.id}
                        className="bg-green-600 hover:bg-green-700 text-white flex-1"
                      >
                        <CheckCircle className="w-4 h-4 mr-1" />
                        {actionLoading === a.id ? 'Executing…' : 'Approve & Execute'}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleAction(a.id, 'reject')}
                        disabled={actionLoading === a.id}
                        className="border-red-500/40 text-red-400 hover:bg-red-500/10 flex-1"
                      >
                        <XCircle className="w-4 h-4 mr-1" />
                        Reject
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}