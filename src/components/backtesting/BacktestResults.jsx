import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from "recharts";
import { LineChart as LineChartIcon, BarChart3, List, TrendingUp, TrendingDown, Sparkles } from "lucide-react";
import { format } from "date-fns";

export default function BacktestResults({ backtest }) {
  if (!backtest) return null;

  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-slate-900/95 border border-slate-700 rounded-lg p-3 shadow-xl">
          <p className="text-slate-300 text-sm mb-2">{label}</p>
          {payload.map((entry, idx) => (
            <p key={idx} className="text-sm" style={{ color: entry.color }}>
              {entry.name}: ${entry.value?.toFixed(2)}
            </p>
          ))}
        </div>
      );
    }
    return null;
  };

  const formatDate = (dateStr) => {
    try {
      return format(new Date(dateStr), 'MMM dd');
    } catch {
      return dateStr;
    }
  };

  const equityCurveData = backtest.equity_curve?.map(point => ({
    ...point,
    date: formatDate(point.date)
  })) || [];

  const tradesData = backtest.trades_detail?.filter(t => t.action === 'sell') || [];

  return (
    <Card className="bg-slate-900 border-slate-700">
      <CardHeader>
        <CardTitle className="text-white">Detailed Results</CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="equity" className="w-full">
          <TabsList className="bg-slate-800 border-slate-700">
            <TabsTrigger value="equity" className="data-[state=active]:bg-purple-600">
              <LineChartIcon className="w-4 h-4 mr-2" />
              Equity Curve
            </TabsTrigger>
            <TabsTrigger value="drawdown" className="data-[state=active]:bg-purple-600">
              <BarChart3 className="w-4 h-4 mr-2" />
              Drawdown
            </TabsTrigger>
            <TabsTrigger value="trades" className="data-[state=active]:bg-purple-600">
              <List className="w-4 h-4 mr-2" />
              Trade Log
            </TabsTrigger>
          </TabsList>

          {/* Equity Curve */}
          <TabsContent value="equity" className="mt-6">
            <div className="bg-slate-800 rounded-xl p-4">
              <ResponsiveContainer width="100%" height={400}>
                <AreaChart data={equityCurveData}>
                  <defs>
                    <linearGradient id="colorEquity" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#a855f7" stopOpacity={0.8}/>
                      <stop offset="95%" stopColor="#a855f7" stopOpacity={0.1}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.3} />
                  <XAxis 
                    dataKey="date" 
                    stroke="#94a3b8"
                    tick={{ fill: '#94a3b8', fontSize: 11 }}
                  />
                  <YAxis 
                    stroke="#94a3b8"
                    tick={{ fill: '#94a3b8', fontSize: 11 }}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ color: '#94a3b8' }} />
                  <Area
                    type="monotone"
                    dataKey="equity"
                    stroke="#a855f7"
                    strokeWidth={3}
                    fill="url(#colorEquity)"
                    name="Portfolio Value"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </TabsContent>

          {/* Drawdown */}
          <TabsContent value="drawdown" className="mt-6">
            <div className="bg-slate-800 rounded-xl p-4">
              <ResponsiveContainer width="100%" height={400}>
                <BarChart data={equityCurveData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.3} />
                  <XAxis 
                    dataKey="date" 
                    stroke="#94a3b8"
                    tick={{ fill: '#94a3b8', fontSize: 11 }}
                  />
                  <YAxis 
                    stroke="#94a3b8"
                    tick={{ fill: '#94a3b8', fontSize: 11 }}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ color: '#94a3b8' }} />
                  <Bar
                    dataKey="drawdown"
                    fill="#ef4444"
                    opacity={0.8}
                    name="Drawdown %"
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </TabsContent>

          {/* Trade Log */}
          <TabsContent value="trades" className="mt-6">
            <div className="space-y-2 max-h-[500px] overflow-y-auto">
              {tradesData.map((trade, idx) => (
                <div
                  key={idx}
                  className={`p-4 rounded-lg border ${
                    trade.profit_loss >= 0
                      ? 'bg-green-500/10 border-green-500/30'
                      : 'bg-red-500/10 border-red-500/30'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="font-bold text-white">{trade.asset}</span>
                        <Badge className={
                          trade.action === 'buy'
                            ? 'bg-green-500/20 text-green-400'
                            : 'bg-red-500/20 text-red-400'
                        }>
                          {trade.action.toUpperCase()}
                        </Badge>
                        <Badge className="bg-purple-500/20 text-purple-400">
                          {trade.confidence?.toFixed(0)}% AI
                        </Badge>
                        {backtest.strategy_config?.useSentiment && trade.sentiment_score !== undefined && (
                          <Badge className="bg-pink-500/20 text-pink-400 flex items-center gap-1">
                            <Sparkles className="w-3 h-3" />
                            {trade.sentiment_score > 0 ? '+' : ''}{(trade.sentiment_score * 100).toFixed(0)}% sentiment
                          </Badge>
                        )}
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                        <div>
                          <p className="text-slate-400">Price</p>
                          <p className="text-white font-semibold">${trade.price?.toFixed(2)}</p>
                        </div>
                        <div>
                          <p className="text-slate-400">Quantity</p>
                          <p className="text-white font-semibold">{trade.quantity?.toFixed(6)}</p>
                        </div>
                        <div>
                          <p className="text-slate-400">Date</p>
                          <p className="text-white font-semibold">{formatDate(trade.date)}</p>
                        </div>
                        <div>
                          <p className="text-slate-400">P&L</p>
                          <p className={`font-bold ${
                            trade.profit_loss >= 0 ? 'text-green-400' : 'text-red-400'
                          }`}>
                            {trade.profit_loss >= 0 ? '+' : ''}${trade.profit_loss?.toFixed(2)}
                          </p>
                        </div>
                      </div>
                    </div>

                    {trade.profit_loss >= 0 ? (
                      <TrendingUp className="w-5 h-5 text-green-400" />
                    ) : (
                      <TrendingDown className="w-5 h-5 text-red-400" />
                    )}
                  </div>
                </div>
              ))}

              {tradesData.length === 0 && (
                <div className="text-center py-8 text-slate-400">
                  No trades executed
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}