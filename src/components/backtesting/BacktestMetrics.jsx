import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  TrendingUp, 
  TrendingDown, 
  Target, 
  Activity, 
  Award,
  DollarSign,
  BarChart3,
  AlertTriangle
} from "lucide-react";

export default function BacktestMetrics({ backtest }) {
  if (!backtest) return null;

  const metrics = [
    {
      label: "Total Return",
      value: `${backtest.total_return >= 0 ? '+' : ''}${backtest.total_return?.toFixed(2)}%`,
      icon: backtest.total_return >= 0 ? TrendingUp : TrendingDown,
      color: backtest.total_return >= 0 ? 'text-green-400' : 'text-red-400',
      bg: backtest.total_return >= 0 ? 'bg-green-500/10' : 'bg-red-500/10',
      border: backtest.total_return >= 0 ? 'border-green-500/30' : 'border-red-500/30'
    },
    {
      label: "Win Rate",
      value: `${backtest.win_rate?.toFixed(1)}%`,
      icon: Target,
      color: backtest.win_rate >= 60 ? 'text-green-400' : backtest.win_rate >= 50 ? 'text-yellow-400' : 'text-red-400',
      bg: 'bg-indigo-500/10',
      border: 'border-indigo-500/30'
    },
    {
      label: "Sharpe Ratio",
      value: backtest.sharpe_ratio?.toFixed(2),
      icon: Activity,
      color: backtest.sharpe_ratio >= 1 ? 'text-green-400' : backtest.sharpe_ratio >= 0 ? 'text-yellow-400' : 'text-red-400',
      bg: 'bg-purple-500/10',
      border: 'border-purple-500/30',
      subtitle: backtest.sharpe_ratio >= 1 ? 'Excellent' : backtest.sharpe_ratio >= 0 ? 'Good' : 'Poor'
    },
    {
      label: "Profit Factor",
      value: backtest.profit_factor?.toFixed(2),
      icon: Award,
      color: backtest.profit_factor >= 2 ? 'text-green-400' : backtest.profit_factor >= 1 ? 'text-yellow-400' : 'text-red-400',
      bg: 'bg-yellow-500/10',
      border: 'border-yellow-500/30'
    },
    {
      label: "Max Drawdown",
      value: `-${backtest.max_drawdown?.toFixed(1)}%`,
      icon: AlertTriangle,
      color: backtest.max_drawdown <= 10 ? 'text-green-400' : backtest.max_drawdown <= 20 ? 'text-yellow-400' : 'text-red-400',
      bg: 'bg-red-500/10',
      border: 'border-red-500/30'
    },
    {
      label: "Total Trades",
      value: backtest.total_trades,
      icon: BarChart3,
      color: 'text-blue-400',
      bg: 'bg-blue-500/10',
      border: 'border-blue-500/30',
      subtitle: `${backtest.winning_trades}W / ${backtest.losing_trades}L`
    },
    {
      label: "Final Capital",
      value: `$${backtest.final_capital?.toLocaleString()}`,
      icon: DollarSign,
      color: 'text-white',
      bg: 'bg-slate-700',
      border: 'border-slate-600'
    },
    {
      label: "Avg Win",
      value: `$${backtest.avg_win?.toFixed(2)}`,
      icon: TrendingUp,
      color: 'text-green-400',
      bg: 'bg-green-500/10',
      border: 'border-green-500/30'
    }
  ];

  return (
    <Card className="bg-slate-900 border-slate-700">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-white">Performance Metrics</CardTitle>
          <Badge className="bg-purple-500/20 text-purple-400">
            {backtest.name}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {metrics.map((metric, idx) => {
            const Icon = metric.icon;
            return (
              <div
                key={idx}
                className={`p-4 rounded-xl border ${metric.bg} ${metric.border}`}
              >
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs text-slate-400">{metric.label}</p>
                  <Icon className={`w-4 h-4 ${metric.color}`} />
                </div>
                <p className={`text-2xl font-bold ${metric.color}`}>
                  {metric.value}
                </p>
                {metric.subtitle && (
                  <p className="text-xs text-slate-500 mt-1">{metric.subtitle}</p>
                )}
              </div>
            );
          })}
        </div>

        {/* Additional Stats */}
        <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-4 pt-6 border-t border-slate-700">
          <div>
            <p className="text-xs text-slate-400 mb-1">Largest Win</p>
            <p className="text-lg font-bold text-green-400">
              ${backtest.largest_win?.toFixed(2)}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-400 mb-1">Largest Loss</p>
            <p className="text-lg font-bold text-red-400">
              ${backtest.largest_loss?.toFixed(2)}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-400 mb-1">Avg Loss</p>
            <p className="text-lg font-bold text-red-400">
              ${backtest.avg_loss?.toFixed(2)}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-400 mb-1">Duration</p>
            <p className="text-lg font-bold text-white">
              {backtest.duration_seconds?.toFixed(1)}s
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}