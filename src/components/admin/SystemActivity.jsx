import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TrendingUp, TrendingDown, Bell, Activity } from "lucide-react";

export default function SystemActivity({ trades, notifications, users }) {
  const recentTrades = trades.slice(0, 10);
  const recentNotifications = notifications.slice(0, 10);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {/* Recent Trades */}
      <Card className="bg-slate-900 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Activity className="w-5 h-5" />
            Recent Trades
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[400px] pr-4">
            {recentTrades.length === 0 ? (
              <p className="text-slate-400 text-center py-8">No trades yet</p>
            ) : (
              <div className="space-y-3">
                {recentTrades.map((trade) => (
                  <div key={trade.id} className="p-3 bg-slate-800 rounded-lg border border-slate-700">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        {trade.trade_type === 'buy' ? (
                          <TrendingUp className="w-4 h-4 text-green-400" />
                        ) : (
                          <TrendingDown className="w-4 h-4 text-red-400" />
                        )}
                        <span className="font-semibold text-white">{trade.asset_symbol}</span>
                        <Badge className={trade.trade_type === 'buy' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}>
                          {trade.trade_type}
                        </Badge>
                      </div>
                      <Badge className="bg-slate-700 text-slate-300">
                        {trade.status}
                      </Badge>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <span className="text-slate-400">Qty:</span>
                        <span className="text-white ml-1">{trade.quantity?.toFixed(6)}</span>
                      </div>
                      <div>
                        <span className="text-slate-400">Price:</span>
                        <span className="text-white ml-1">${trade.price?.toLocaleString()}</span>
                      </div>
                      <div>
                        <span className="text-slate-400">Total:</span>
                        <span className="text-white ml-1">${trade.total_value?.toLocaleString()}</span>
                      </div>
                      <div>
                        <span className="text-slate-400">P&L:</span>
                        <span className={`ml-1 ${(trade.profit_loss || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {(trade.profit_loss || 0) >= 0 ? '+' : ''}${(trade.profit_loss || 0).toFixed(2)}
                        </span>
                      </div>
                    </div>
                    <p className="text-xs text-slate-500 mt-2">
                      By: {trade.created_by} • {new Date(trade.created_date).toLocaleString()}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Recent Notifications */}
      <Card className="bg-slate-900 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Bell className="w-5 h-5" />
            Recent Notifications
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[400px] pr-4">
            {recentNotifications.length === 0 ? (
              <p className="text-slate-400 text-center py-8">No notifications yet</p>
            ) : (
              <div className="space-y-3">
                {recentNotifications.map((notification) => (
                  <div key={notification.id} className="p-3 bg-slate-800 rounded-lg border border-slate-700">
                    <div className="flex items-start justify-between mb-2">
                      <h4 className="font-semibold text-white text-sm">{notification.title}</h4>
                      <Badge className={
                        notification.priority === 'urgent' ? 'bg-red-500/20 text-red-400' :
                        notification.priority === 'high' ? 'bg-orange-500/20 text-orange-400' :
                        'bg-blue-500/20 text-blue-400'
                      }>
                        {notification.priority}
                      </Badge>
                    </div>
                    <p className="text-sm text-slate-400 mb-2">{notification.message}</p>
                    <div className="flex items-center justify-between text-xs">
                      <Badge className="bg-slate-700 text-slate-300">
                        {notification.notification_type}
                      </Badge>
                      <span className="text-slate-500">
                        {new Date(notification.created_date).toLocaleString()}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}