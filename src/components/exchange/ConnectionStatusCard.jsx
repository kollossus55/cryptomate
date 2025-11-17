import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle, AlertCircle, RefreshCw, Wifi, WifiOff, Settings } from "lucide-react";

export default function ConnectionStatusCard({ connection, onTest, onManage, isTesting }) {
  const statusConfig = {
    connected: {
      icon: CheckCircle2,
      color: "text-green-400",
      bg: "bg-green-500/10",
      border: "border-green-500/30",
      label: "Connected"
    },
    pending: {
      icon: AlertCircle,
      color: "text-yellow-400",
      bg: "bg-yellow-500/10",
      border: "border-yellow-500/30",
      label: "Pending"
    },
    disconnected: {
      icon: WifiOff,
      color: "text-slate-400",
      bg: "bg-slate-500/10",
      border: "border-slate-500/30",
      label: "Disconnected"
    },
    error: {
      icon: XCircle,
      color: "text-red-400",
      bg: "bg-red-500/10",
      border: "border-red-500/30",
      label: "Error"
    }
  };

  const status = connection.connection_status || 'pending';
  const config = statusConfig[status];
  const StatusIcon = config.icon;

  const exchangeLogos = {
    binance: { icon: "◆", color: "bg-yellow-500" },
    coinbase: { icon: "●", color: "bg-blue-500" },
    kraken: { icon: "✦", color: "bg-purple-500" },
    bybit: { icon: "◎", color: "bg-orange-500" }
  };

  const logo = exchangeLogos[connection.exchange_name] || { icon: "●", color: "bg-slate-500" };

  return (
    <Card className={`bg-slate-800 border ${config.border} hover:border-slate-600 transition-all`}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-12 h-12 ${logo.color} rounded-xl flex items-center justify-center`}>
              <span className="text-2xl text-white font-bold">{logo.icon}</span>
            </div>
            <div>
              <CardTitle className="text-white capitalize flex items-center gap-2">
                {connection.exchange_name}
                {connection.is_testnet && (
                  <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30 text-xs">
                    TESTNET
                  </Badge>
                )}
              </CardTitle>
              <p className="text-sm text-slate-400 mt-1">
                API Key: {connection.api_key.substring(0, 12)}...
              </p>
            </div>
          </div>
          
          <div className="flex flex-col items-end gap-2">
            <Badge className={`${config.bg} ${config.color} border ${config.border}`}>
              <StatusIcon className="w-3 h-3 mr-1" />
              {config.label}
            </Badge>
            {connection.is_active && (
              <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
                Active
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent>
        {/* Permissions */}
        {connection.permissions && connection.permissions.length > 0 && (
          <div className="mb-4">
            <p className="text-xs text-slate-400 mb-2">Permissions:</p>
            <div className="flex gap-2 flex-wrap">
              {connection.permissions.map((perm) => (
                <Badge key={perm} variant="outline" className="border-slate-600 text-slate-300">
                  {perm}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Error Message */}
        {status === 'error' && connection.error_message && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
            <p className="text-sm text-red-400">{connection.error_message}</p>
          </div>
        )}

        {/* Last Sync */}
        {connection.last_sync && (
          <p className="text-xs text-slate-500 mb-4">
            Last synced: {new Date(connection.last_sync).toLocaleString()}
          </p>
        )}

        {/* Trading Mode - IMPROVED CONTRAST */}
        <div className="mb-4 p-4 bg-slate-900 border-2 border-blue-500/40 rounded-xl">
          <div className="flex items-center gap-2 mb-2">
            <Wifi className="w-5 h-5 text-blue-400" />
            <p className="text-sm font-bold text-white">Trading Mode</p>
          </div>
          <p className="text-sm text-white leading-relaxed">
            {connection.trading_mode === 'simulated' 
              ? '🎮 Simulated Trading (Paper Mode) - Orders are simulated using real market prices'
              : '🚀 Ready for Live Trading - Backend functions required for execution'
            }
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2">
          <Button
            onClick={() => onTest(connection)}
            disabled={isTesting}
            variant="outline"
            size="sm"
            className="flex-1 border-slate-700 text-slate-300 hover:bg-slate-700"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${isTesting ? 'animate-spin' : ''}`} />
            {isTesting ? 'Testing...' : 'Test Connection'}
          </Button>
          <Button
            onClick={() => onManage(connection)}
            variant="outline"
            size="sm"
            className="border-indigo-500 text-indigo-400 hover:bg-indigo-500/10"
          >
            <Settings className="w-4 h-4 mr-2" />
            Manage
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}