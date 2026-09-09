import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TrendingUp, TrendingDown, Wallet, PieChart, Target, Award, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { base44 } from "@/api/base44Client";

export default function PortfolioCard({ portfolio, onClosePosition, assets = [], livePrices = {} }) {
  const [extraPrices, setExtraPrices] = useState({});
  const [winRate, setWinRate] = useState(0);

  // Real win rate from completed sell trades with a non-zero P&L.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const trades = await base44.entities.Trade.filter(
          { trade_type: 'sell', status: 'completed' },
          '-created_date', 200
        );
        if (cancelled) return;
        const closed = trades.filter(t => typeof t.profit_loss === 'number');
        if (closed.length === 0) { setWinRate(0); return; }
        const winners = closed.filter(t => t.profit_loss > 0).length;
        setWinRate(Math.round((winners / closed.length) * 100));
      } catch {
        if (!cancelled) setWinRate(0);
      }
    })();
    return () => { cancelled = true; };
  }, [portfolio?.total_trades]);

  // Fetch live prices for held positions whose symbols aren't in the
  // websocket-tracked assets list. The server worker buys obscure altcoins
  // (XSOXL, XINTC, PUMP, …) that CoinGecko and Binance don't serve from the
  // UK, but OKX is reachable and lists nearly all of them. One call returns
  // every spot ticker.
  useEffect(() => {
    const positions = portfolio?.positions || [];
    if (positions.length === 0) return;

    const missingSymbols = positions
      .map(p => p.asset_symbol.replace('/USDT', '').replace(/USDT$/, ''))
      .filter(sym => !assets.find(a => a.symbol === sym) && !extraPrices[sym]);

    if (missingSymbols.length === 0) return;

    let cancelled = false;
    const timeoutId = setTimeout(() => { cancelled = true; }, 10000);

    fetch(`https://www.okx.com/api/v5/market/tickers?instType=SPOT`, { headers: { Accept: 'application/json' } })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`Status ${r.status}`)))
      .then(data => {
        if (cancelled || !Array.isArray(data?.data)) return;
        const priceMap = {};
        for (const t of data.data) {
          if (typeof t.instId !== 'string' || !t.instId.endsWith('-USDT')) continue;
          const base = t.instId.replace(/-USDT$/, '');
          if (missingSymbols.includes(base) && t.last) {
            priceMap[base] = parseFloat(t.last);
          }
        }
        setExtraPrices(prev => ({ ...prev, ...priceMap }));
      })
      .catch(err => console.warn('PortfolioCard: failed to fetch OKX position prices', err.message))
      .finally(() => clearTimeout(timeoutId));

    return () => { cancelled = true; clearTimeout(timeoutId); };
  }, [portfolio?.positions, assets]);

  if (!portfolio) return null;

  // Create a map of current prices for quick lookup, prioritizing live socket data
  const currentPrices = {};
  assets.forEach(asset => {
    const livePrice = livePrices[asset.symbol];
    currentPrices[`${asset.symbol}/USDT`] = livePrice || asset.price;
  });
  // Merge in any prices we fetched for server-bought positions not in the asset list
  Object.entries(extraPrices).forEach(([symbol, price]) => {
    const key = symbol.includes('/USDT') ? symbol : `${symbol}/USDT`;
    if (!currentPrices[key]) currentPrices[key] = price;
  });

  // Normalize a position's asset_symbol (server stores "ZECUSDT", manual trades
  // use "ZEC/USDT") to the "BASE/USDT" key used in currentPrices.
  const lookupPrice = (assetSymbol) =>
    currentPrices[assetSymbol] ||
    currentPrices[assetSymbol.replace(/USDT$/, '/USDT')] ||
    currentPrices[assetSymbol.replace('/USDT', 'USDT')];

  const totalBalance = portfolio.total_balance || 0;
  const availableBalance = portfolio.available_balance || 0;
  const totalProfitLoss = portfolio.total_profit_loss || 0;
  const totalTrades = portfolio.total_trades || 0;
  
  const profitLossPercent = totalBalance > 0 ? ((totalProfitLoss / totalBalance) * 100).toFixed(2) : "0.00";
  const isProfit = totalProfitLoss >= 0;
  const allocatedBalance = totalBalance - availableBalance;
  const allocationPercent = totalBalance > 0 ? ((allocatedBalance / totalBalance) * 100).toFixed(1) : "0.0";

  const handleClosePosition = (position) => {
    const currentPrice = lookupPrice(position.asset_symbol) || position.avg_entry_price;
    const estimatedPnL = (currentPrice - position.avg_entry_price) * position.quantity;
    const estimatedValue = position.quantity * currentPrice;
    
    if (window.confirm(
      `Close position for ${position.asset_symbol}?\n\n` +
      `Quantity: ${position.quantity?.toFixed(6)}\n` +
      `Current Value: $${estimatedValue.toFixed(2)}\n` +
      `Unrealized P&L: ${estimatedPnL >= 0 ? '+' : ''}$${estimatedPnL.toFixed(2)}`
    )) {
      if (onClosePosition) onClosePosition(position);
    }
  };

  return (
    <Card className="bg-gradient-to-br from-slate-900 to-slate-800 border-slate-700">
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-white">
          <div className="flex items-center gap-2">
            <Wallet className="w-5 h-5 text-indigo-400" />
            Portfolio Overview
          </div>
          <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">
            PAPER TRADING
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div>
            <p className="text-slate-400 text-sm mb-1">Total Balance</p>
            <p className="text-2xl font-bold text-white">${totalBalance.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-slate-400 text-sm mb-1">Available</p>
            <p className="text-2xl font-bold text-green-400">${availableBalance.toLocaleString()}</p>
            <p className="text-xs text-slate-500">{(100 - parseFloat(allocationPercent)).toFixed(1)}% free</p>
          </div>
          <div>
            <p className="text-slate-400 text-sm mb-1 flex items-center gap-1">
              Total P&L
              {isProfit ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            </p>
            <p className={`text-2xl font-bold ${isProfit ? 'text-green-400' : 'text-red-400'}`}>
              {isProfit ? '+' : ''}${totalProfitLoss.toLocaleString()}
            </p>
            <p className={`text-xs ${isProfit ? 'text-green-400' : 'text-red-400'}`}>
              {isProfit ? '+' : ''}{profitLossPercent}%
            </p>
          </div>
          <div>
            <p className="text-slate-400 text-sm mb-1">Total Trades</p>
            <p className="text-2xl font-bold text-white">{totalTrades}</p>
          </div>
        </div>

        {/* Performance Metrics */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6 p-4 bg-slate-800 rounded-xl">
          <div className="text-center">
            <div className="flex items-center justify-center gap-1 mb-1">
              <Award className="w-4 h-4 text-indigo-400" />
              <p className="text-slate-400 text-xs">Win Rate</p>
            </div>
            <p className="text-lg font-bold text-indigo-400">{winRate}%</p>
          </div>
          <div className="text-center">
            <div className="flex items-center justify-center gap-1 mb-1">
              <Target className="w-4 h-4 text-purple-400" />
              <p className="text-slate-400 text-xs">Allocated</p>
            </div>
            <p className="text-lg font-bold text-purple-400">{allocationPercent}%</p>
          </div>
          <div className="text-center">
            <div className="flex items-center justify-center gap-1 mb-1">
              <PieChart className="w-4 h-4 text-cyan-400" />
              <p className="text-slate-400 text-xs">ROI</p>
            </div>
            <p className={`text-lg font-bold ${isProfit ? 'text-green-400' : 'text-red-400'}`}>
              {profitLossPercent}%
            </p>
          </div>
        </div>

        {portfolio.positions && portfolio.positions.length > 0 && (
          <div>
            <h4 className="text-slate-300 font-semibold mb-3 flex items-center gap-2">
              <PieChart className="w-4 h-4" />
              Open Positions ({portfolio.positions.length})
            </h4>
            <div className="space-y-2">
              {portfolio.positions.map((position, idx) => {
                const quantity = position.quantity || 0;
                const avgEntryPrice = position.avg_entry_price || 0;
                
                // Calculate real-time P&L using current market prices
                const currentPrice = lookupPrice(position.asset_symbol) || avgEntryPrice;
                const currentValue = quantity * currentPrice;
                const profitLoss = (currentPrice - avgEntryPrice) * quantity;
                const profitLossPercent = avgEntryPrice > 0 ? ((profitLoss / (quantity * avgEntryPrice)) * 100).toFixed(2) : 0;
                
                return (
                  <div key={idx} className="bg-slate-800 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <p className="font-semibold text-white text-lg">{position.asset_symbol || 'Unknown'}</p>
                        <p className="text-xs text-slate-400">
                          Qty: {quantity.toFixed(6)} @ ${avgEntryPrice.toLocaleString()}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-white font-semibold">${currentValue.toLocaleString()}</p>
                        <div className="flex flex-col items-end">
                          <span className="text-[10px] text-slate-500 uppercase tracking-wider">Unrealized P&L</span>
                          <p className={`text-sm font-bold ${profitLoss >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {profitLoss >= 0 ? '+' : ''}${profitLoss.toFixed(2)} ({profitLoss >= 0 ? '+' : ''}{profitLossPercent}%)
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2 mt-2">
                      <Button
                        onClick={() => handleClosePosition(position)}
                        size="sm"
                        className={`flex-1 ${
                          profitLoss >= 0 
                            ? 'bg-green-600 hover:bg-green-700' 
                            : 'bg-red-600 hover:bg-red-700'
                        }`}
                      >
                        <X className="w-4 h-4 mr-1" />
                        Close Position
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {(!portfolio.positions || portfolio.positions.length === 0) && (
          <div className="text-center py-8 bg-slate-800 rounded-xl">
            <PieChart className="w-12 h-12 text-slate-600 mx-auto mb-2" />
            <p className="text-slate-400 text-sm">No open positions</p>
            <p className="text-slate-500 text-xs">Start trading to see your positions here</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}