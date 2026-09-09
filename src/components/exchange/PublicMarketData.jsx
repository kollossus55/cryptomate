import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, Activity, DollarSign } from "lucide-react";

export default function PublicMarketData({ exchange, symbol }) {
  const [marketData, setMarketData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (exchange && symbol) {
      fetchMarketData();
      const interval = setInterval(fetchMarketData, 30000); // Update every 30 seconds
      return () => clearInterval(interval);
    }
  }, [exchange, symbol]);

  const fetchMarketData = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const cleanSymbol = symbol.replace('/', '');
      let url;

      switch (exchange) {
        case 'okx': {
          // OKX uses hyphenated instId format (BTC-USDT) not Binance's BTCUSDT
          const instId = cleanSymbol.endsWith('USDT')
            ? `${cleanSymbol.slice(0, -4)}-USDT`
            : cleanSymbol;
          url = `https://www.okx.com/api/v5/market/ticker?instId=${instId}`;
          break;
        }
        default:
          setError('Exchange not supported for public data yet');
          return;
      }

      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error('Failed to fetch market data');
      }

      const data = await response.json();

      // OKX returns { code: "0", data: [{ ... }] }
      if (data.code !== '0' || !data.data?.[0]) {
        throw new Error(data.msg || 'Failed to fetch market data');
      }

      const t = data.data[0];
      const last = parseFloat(t.last);
      const open24h = parseFloat(t.open24h);
      const change24h = open24h > 0 ? ((last - open24h) / open24h) * 100 : 0;

      setMarketData({
        symbol: t.instId,
        price: last,
        change24h,
        high24h: parseFloat(t.high24h),
        low24h: parseFloat(t.low24h),
        volume24h: parseFloat(t.vol24h),
        quoteVolume: parseFloat(t.volCcy24h),
        bid: parseFloat(t.bidPx),
        ask: parseFloat(t.askPx),
        lastUpdate: Date.now()
      });

    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  if (!marketData && !error) {
    return null;
  }

  if (error) {
    return (
      <Card className="bg-slate-800 border-slate-700">
        <CardContent className="pt-6">
          <p className="text-sm text-slate-400">{error}</p>
        </CardContent>
      </Card>
    );
  }

  const isPositive = marketData.change24h >= 0;

  return (
    <Card className="bg-gradient-to-br from-slate-900 to-slate-800 border-slate-700">
      <CardHeader>
        <CardTitle className="text-white flex items-center justify-between">
          <span>{marketData.symbol} Live Market Data</span>
          <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
            ● Live from {exchange.charAt(0).toUpperCase() + exchange.slice(1)}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <DollarSign className="w-4 h-4 text-slate-400" />
              <p className="text-xs text-slate-400">Current Price</p>
            </div>
            <p className="text-2xl font-bold text-white">
              ${marketData.price.toLocaleString()}
            </p>
          </div>

          <div>
            <div className="flex items-center gap-2 mb-1">
              {isPositive ? (
                <TrendingUp className="w-4 h-4 text-green-400" />
              ) : (
                <TrendingDown className="w-4 h-4 text-red-400" />
              )}
              <p className="text-xs text-slate-400">24h Change</p>
            </div>
            <p className={`text-2xl font-bold ${isPositive ? 'text-green-400' : 'text-red-400'}`}>
              {isPositive ? '+' : ''}{marketData.change24h.toFixed(2)}%
            </p>
          </div>

          <div>
            <div className="flex items-center gap-2 mb-1">
              <Activity className="w-4 h-4 text-slate-400" />
              <p className="text-xs text-slate-400">24h High/Low</p>
            </div>
            <p className="text-lg font-bold text-white">
              ${marketData.high24h.toLocaleString()}
            </p>
            <p className="text-sm text-slate-400">
              ${marketData.low24h.toLocaleString()}
            </p>
          </div>

          <div>
            <div className="flex items-center gap-2 mb-1">
              <Activity className="w-4 h-4 text-slate-400" />
              <p className="text-xs text-slate-400">24h Volume</p>
            </div>
            <p className="text-lg font-bold text-white">
              {(marketData.volume24h / 1000).toFixed(2)}K
            </p>
            <p className="text-sm text-slate-400">
              ${(marketData.quoteVolume / 1e6).toFixed(2)}M
            </p>
          </div>

          <div className="col-span-2">
            <div className="bg-slate-800 rounded-lg p-3">
              <p className="text-xs text-slate-400 mb-2">Order Book</p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-green-400 mb-1">Bid (Buy)</p>
                  <p className="text-lg font-bold text-green-400">
                    ${marketData.bid.toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-red-400 mb-1">Ask (Sell)</p>
                  <p className="text-lg font-bold text-red-400">
                    ${marketData.ask.toLocaleString()}
                  </p>
                </div>
              </div>
              <p className="text-xs text-slate-500 mt-2">
                Spread: ${(marketData.ask - marketData.bid).toFixed(2)}
              </p>
            </div>
          </div>

          <div className="col-span-2">
            <div className="bg-indigo-500/10 border border-indigo-500/30 rounded-lg p-3">
              <p className="text-xs text-indigo-200 font-semibold mb-1">
                Real-Time Data Source
              </p>
              <p className="text-xs text-indigo-200/80">
                Live prices from {exchange.charAt(0).toUpperCase() + exchange.slice(1)} public API. 
                Updates every 30 seconds. No authentication required.
              </p>
            </div>
          </div>
        </div>

        {marketData.lastUpdate && (
          <p className="text-xs text-slate-500 mt-4">
            Last updated: {new Date(marketData.lastUpdate).toLocaleTimeString()}
          </p>
        )}
      </CardContent>
    </Card>
  );
}