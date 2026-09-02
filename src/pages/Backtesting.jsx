import { useState } from "react";
import { runBacktest } from '@shared/trading/backtest.js';
import { fetchHistoricalCandles } from '@shared/trading/marketData.js';
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  LineChart,
  TrendingUp,
  BarChart3,
  Play,
  History,
  Sparkles,
  AlertCircle,
  Target,
  TrendingDown
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

import BacktestForm from "../components/backtesting/BacktestForm";
import BacktestResults from "../components/backtesting/BacktestResults";
import BacktestMetrics from "../components/backtesting/BacktestMetrics";

export default function Backtesting() {
  const [activeBacktest, setActiveBacktest] = useState(null);
  const [showNewBacktest, setShowNewBacktest] = useState(false);
  const queryClient = useQueryClient();

  const { data: backtests = [], isLoading } = useQuery({
    queryKey: ['backtests'],
    queryFn: () => base44.entities.BacktestResult.list('-created_date'),
  });

  const createBacktestMutation = useMutation({
    mutationFn: (data) => base44.entities.BacktestResult.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['backtests'] });
    },
  });

  const deleteBacktestMutation = useMutation({
    mutationFn: (id) => base44.entities.BacktestResult.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['backtests'] });
    },
  });

  const handleRunBacktest = async (config) => {
    setShowNewBacktest(false);

    const backtest = await createBacktestMutation.mutateAsync({
      name: config.name,
      strategy_config: config.strategy,
      period: config.period,
      initial_capital: config.initialCapital,
      status: 'running'
    });

    // Previously wrapped in a cosmetic 2s setTimeout and hardcoded
    // status: 'completed' regardless of outcome, so a failed run still
    // displayed as a finished backtest. Real work, real status.
    try {
      const results = await runBacktestSimulation(config);

      await base44.entities.BacktestResult.update(backtest.id, {
        ...backtest,
        ...results,
        status: results.status || 'completed'
      });

      queryClient.invalidateQueries({ queryKey: ['backtests'] });
      if (results.status !== 'failed') {
        setActiveBacktest(results);
      }
    } catch (error) {
      await base44.entities.BacktestResult.update(backtest.id, {
        ...backtest,
        status: 'failed',
        error_message: error.message || 'Backtest failed'
      });
      queryClient.invalidateQueries({ queryKey: ['backtests'] });
    }
  };

  /**
   * Run a backtest on REAL historical candles.
   *
   * The previous implementation drew every price from Math.random(), including
   * entry and exit independently — so a "trade" was two unrelated random
   * numbers subtracted from each other, and the results were uncorrelated with
   * the live strategy or with the market. This fetches real OHLCV from Binance
   * and replays it bar by bar through the SAME scoreAsset() the live worker
   * uses, with fees, slippage, and no look-ahead.
   */
  const runBacktestSimulation = async (config) => {
    const startTime = Date.now();
    const { strategy, period, initialCapital } = config;

    const startMs = new Date(period.startDate).getTime();
    const endMs = new Date(period.endDate).getTime();

    if (!(startMs < endMs)) {
      return { status: 'failed', error_message: 'End date must be after start date' };
    }

    // Map display symbols (BTC, BTC/USDT) onto Binance pairs.
    const symbols = strategy.assets.map((a) =>
      a.includes('USDT') ? a.replace('/', '') : `${a.replace('/', '')}USDT`
    );

    const candlesBySymbol = new Map();
    const failures = [];

    for (const symbol of symbols) {
      try {
        const candles = await fetchHistoricalCandles(symbol, '1h', startMs, endMs);
        if (candles.length > 0) {
          candlesBySymbol.set(symbol, candles);
        } else {
          failures.push(symbol);
        }
      } catch (err) {
        failures.push(symbol);
      }
    }

    // No synthetic fallback. A backtest on invented data is worse than no
    // backtest, because it produces a number people act on.
    if (candlesBySymbol.size === 0) {
      return {
        status: 'failed',
        error_message: `Could not fetch historical data for any of: ${symbols.join(', ')}. ` +
          `Check the symbols are valid Binance USDT pairs and that the date range is not in the future.`,
      };
    }

    const result = runBacktest(candlesBySymbol, {
      initialCapital,
      minStrength: strategy.minConfidence,
      stopLossPercent: strategy.stopLoss,
      takeProfitPercent: strategy.takeProfit,
      maxPositions: strategy.maxPositions ?? 5,
      maxPositionPercent: strategy.maxPositionSize,
      useTrailingStop: strategy.useTrailingStop ?? false,
      trailingStopPercent: strategy.trailingStopPercent ?? 2,
      exchange: 'binance',
    });

    if (result.error) {
      return {
        status: 'failed',
        error_message: result.error === 'insufficient_history'
          ? `Not enough history in that window (${result.barsAvailable} bars). Widen the date range.`
          : result.error,
      };
    }

    const m = result.metrics;
    const durationSeconds = (Date.now() - startTime) / 1000;

    return {
      status: 'completed',
      final_capital: m.finalCapital,
      total_return: Math.round(m.totalReturn * 100) / 100,
      total_trades: m.totalTrades,
      winning_trades: m.winningTrades,
      losing_trades: m.losingTrades,
      win_rate: Math.round(m.winRate * 100) / 100,
      profit_factor: Number.isFinite(m.profitFactor) ? Math.round(m.profitFactor * 100) / 100 : null,
      max_drawdown: m.maxDrawdown,
      sharpe_ratio: m.sharpeRatio,
      sortino_ratio: m.sortinoRatio,
      avg_win: m.avgWin,
      avg_loss: m.avgLoss,
      expectancy: m.expectancy,
      total_fees: m.totalFees,
      fee_drag_percent: m.feeDragPercent,
      exit_breakdown: m.exitBreakdown,
      // Surfaced deliberately: under ~100 trades these numbers are noise.
      statistically_meaningful: m.statisticallyMeaningful,
      sample_warning: m.sampleWarning,
      // The honest comparison. Beating cash is easy in a bull market; beating
      // an equal-weight hold of the same assets over the same window is the bar.
      benchmark_return: result.benchmark?.totalReturn ?? null,
      beat_benchmark: result.benchmark
        ? m.totalReturn > result.benchmark.totalReturn
        : null,
      data_source: 'binance_1h_ohlcv',
      assets_tested: [...candlesBySymbol.keys()],
      assets_unavailable: failures,
      bars_simulated: result.barsSimulated,
      trades_detail: result.trades,
      equity_curve: result.equityCurve,
      duration_seconds: Math.round(durationSeconds * 100) / 100,
    };
  };

  const handleDeleteBacktest = async (id) => {
    if (window.confirm('Delete this backtest result?')) {
      await deleteBacktestMutation.mutateAsync(id);
      if (activeBacktest?.id === id) {
        setActiveBacktest(null);
      }
    }
  };

  const completedBacktests = backtests.filter(b => b.status === 'completed');
  const avgReturn = completedBacktests.length > 0
    ? completedBacktests.reduce((sum, b) => sum + (b.total_return || 0), 0) / completedBacktests.length
    : 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white">
      <div className="max-w-7xl mx-auto px-6 py-8">
        
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-pink-600 rounded-2xl flex items-center justify-center">
              <BarChart3 className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-4xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
                Strategy Backtesting
              </h1>
              <p className="text-slate-400">Replay AI strategies on real Binance OHLCV — same signal engine as the live bot</p>
            </div>
          </div>
        </div>

        {/* Info Banner */}
        <Card className="bg-blue-500/10 border-blue-500/30 mb-8">
          <CardContent className="pt-6">
            <div className="flex gap-3">
              <AlertCircle className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="font-semibold text-blue-200 mb-2">Advanced Backtesting Engine</h3>
                <p className="text-blue-200/80 text-sm leading-relaxed">
                  <strong>Real historical data:</strong> Strategies are replayed bar by bar against actual Binance 1h OHLCV,
                  using the same signal engine the live bot runs. Exchange fees and order-size slippage are applied to every fill,
                  entries fill at the next bar's open (no look-ahead), and results are compared against buy-and-hold on the same assets.
                  Sentiment is not included — no sentiment data source is wired up. 
                  Performance metrics: Sharpe ratio, max drawdown, profit factor, and detailed trade logs.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <Card className="bg-slate-900 border-slate-700">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-slate-400 text-sm mb-1">Total Backtests</p>
                  <p className="text-3xl font-bold text-white">{completedBacktests.length}</p>
                </div>
                <History className="w-10 h-10 text-purple-400" />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-slate-900 border-slate-700">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-slate-400 text-sm mb-1">Avg Return</p>
                  <p className={`text-3xl font-bold ${avgReturn >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {avgReturn >= 0 ? '+' : ''}{avgReturn.toFixed(1)}%
                  </p>
                </div>
                <TrendingUp className="w-10 h-10 text-green-400" />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-slate-900 border-slate-700">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-slate-400 text-sm mb-1">Best Strategy</p>
                  <p className="text-3xl font-bold text-indigo-400">
                    {completedBacktests.length > 0
                      ? Math.max(...completedBacktests.map(b => b.total_return || 0)).toFixed(1) + '%'
                      : 'N/A'
                    }
                  </p>
                </div>
                <Target className="w-10 h-10 text-indigo-400" />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-slate-900 border-slate-700">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-slate-400 text-sm mb-1">Data Source</p>
                  <p className="text-lg font-bold text-cyan-400">Binance 1h</p>
                </div>
                <Badge className="bg-cyan-500/20 text-cyan-400">Real OHLCV</Badge>
              </div>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="new" className="w-full">
          <TabsList className="bg-slate-800 border-slate-700">
            <TabsTrigger value="new" className="data-[state=active]:bg-purple-600">
              <Play className="w-4 h-4 mr-2" />
              New Backtest
            </TabsTrigger>
            <TabsTrigger value="results" className="data-[state=active]:bg-purple-600">
              <LineChart className="w-4 h-4 mr-2" />
              Results
            </TabsTrigger>
            <TabsTrigger value="history" className="data-[state=active]:bg-purple-600">
              <History className="w-4 h-4 mr-2" />
              History
            </TabsTrigger>
          </TabsList>

          {/* New Backtest Tab */}
          <TabsContent value="new" className="mt-6">
            <BacktestForm onRun={handleRunBacktest} />
          </TabsContent>

          {/* Results Tab */}
          <TabsContent value="results" className="mt-6">
            {activeBacktest ? (
              <div className="space-y-6">
                <BacktestMetrics backtest={activeBacktest} />
                <BacktestResults backtest={activeBacktest} />
              </div>
            ) : backtests.length > 0 && backtests[0].status === 'completed' ? (
              <div className="space-y-6">
                <BacktestMetrics backtest={backtests[0]} />
                <BacktestResults backtest={backtests[0]} />
              </div>
            ) : (
              <Card className="bg-slate-900 border-slate-700">
                <CardContent className="py-16 text-center">
                  <BarChart3 className="w-16 h-16 text-slate-600 mx-auto mb-4" />
                  <h3 className="text-xl font-semibold text-white mb-2">No Results Yet</h3>
                  <p className="text-slate-400 mb-6">Run your first backtest to see performance metrics</p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* History Tab */}
          <TabsContent value="history" className="mt-6">
            {backtests.length === 0 ? (
              <Card className="bg-slate-900 border-slate-700">
                <CardContent className="py-16 text-center">
                  <History className="w-16 h-16 text-slate-600 mx-auto mb-4" />
                  <h3 className="text-xl font-semibold text-white mb-2">No Backtest History</h3>
                  <p className="text-slate-400 mb-6">Your completed backtests will appear here</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4">
                <AnimatePresence>
                  {backtests.map((backtest) => (
                    <motion.div
                      key={backtest.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, x: -20 }}
                    >
                      <Card className="bg-slate-900 border-slate-700 hover:border-purple-500/50 transition-all cursor-pointer"
                        onClick={() => setActiveBacktest(backtest)}
                      >
                        <CardContent className="pt-6">
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <div className="flex items-center gap-3 mb-3">
                                <h3 className="font-bold text-white text-lg">{backtest.name}</h3>
                                <Badge className={
                                  backtest.status === 'completed' ? 'bg-green-500/20 text-green-400' :
                                  backtest.status === 'running' ? 'bg-blue-500/20 text-blue-400' :
                                  'bg-red-500/20 text-red-400'
                                }>
                                  {backtest.status}
                                </Badge>
                                {backtest.strategy_config?.useSentiment && (
                                  <Badge className="bg-pink-500/20 text-pink-400 flex items-center gap-1">
                                    <Sparkles className="w-3 h-3" />
                                    Sentiment
                                  </Badge>
                                )}
                              </div>

                              {backtest.status === 'completed' && (
                                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                                  <div>
                                    <p className="text-xs text-slate-400">Return</p>
                                    <p className={`text-lg font-bold ${
                                      (backtest.total_return || 0) >= 0 ? 'text-green-400' : 'text-red-400'
                                    }`}>
                                      {(backtest.total_return || 0) >= 0 ? '+' : ''}
                                      {(backtest.total_return || 0).toFixed(2)}%
                                    </p>
                                  </div>
                                  <div>
                                    <p className="text-xs text-slate-400">Win Rate</p>
                                    <p className="text-lg font-bold text-white">
                                      {(backtest.win_rate || 0).toFixed(1)}%
                                    </p>
                                  </div>
                                  <div>
                                    <p className="text-xs text-slate-400">Sharpe</p>
                                    <p className="text-lg font-bold text-indigo-400">
                                      {(backtest.sharpe_ratio || 0).toFixed(2)}
                                    </p>
                                  </div>
                                  <div>
                                    <p className="text-xs text-slate-400">Max DD</p>
                                    <p className="text-lg font-bold text-red-400">
                                      -{(backtest.max_drawdown || 0).toFixed(1)}%
                                    </p>
                                  </div>
                                  <div>
                                    <p className="text-xs text-slate-400">Trades</p>
                                    <p className="text-lg font-bold text-white">
                                      {backtest.total_trades || 0}
                                    </p>
                                  </div>
                                </div>
                              )}

                              <p className="text-xs text-slate-500 mt-3">
                                {new Date(backtest.created_date).toLocaleString()}
                                {backtest.duration_seconds && ` • Completed in ${backtest.duration_seconds.toFixed(1)}s`}
                              </p>
                            </div>

                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteBacktest(backtest.id);
                              }}
                              className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                            >
                              <TrendingDown className="w-4 h-4" />
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}