import React, { useState, useEffect, useRef } from 'react';
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowUp, ArrowDown, Activity } from "lucide-react";

export default function RealTimeMarketDepth({ symbol }) {
  const [depth, setDepth] = useState({ bids: [], asks: [] });
  const [recentTrades, setRecentTrades] = useState([]);
  const [price, setPrice] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState('connecting');
  const wsRef = useRef(null);

  useEffect(() => {
    if (!symbol) return;

    // OKX WebSocket — reachable from the UK (Binance WebSocket is geo-blocked)
    const instId = `${symbol.toUpperCase()}-USDT`;
    const ws = new WebSocket('wss://ws.okx.com:8443/ws/v5/public');
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({
        op: 'subscribe',
        args: [
          { channel: 'books5', instId },
          { channel: 'trades', instId }
        ]
      }));
      setConnectionStatus('connected');
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        // Ignore subscribe confirmations and non-data messages
        if (msg.event || !msg.data || !Array.isArray(msg.data)) return;

        if (msg.arg?.channel === 'books5') {
          const book = msg.data[0];
          if (!book) return;
          setDepth({
            bids: (book.bids || []).slice(0, 5).map(([price, qty]) => ({ price: parseFloat(price), qty: parseFloat(qty) })),
            asks: (book.asks || []).slice(0, 5).map(([price, qty]) => ({ price: parseFloat(price), qty: parseFloat(qty) })).reverse()
          });
        }

        if (msg.arg?.channel === 'trades') {
          msg.data.forEach((t) => {
            const trade = {
              id: t.tradeId || t.ts,
              price: parseFloat(t.px),
              qty: parseFloat(t.sz),
              time: parseInt(t.ts),
              isBuyerMaker: t.side === 'sell' // OKX: side='sell' means taker sold → buyer was maker
            };
            setPrice(trade.price);
            setRecentTrades(prev => [trade, ...prev].slice(0, 15));
          });
        }
      } catch (err) {
        // ignore
      }
    };

    ws.onclose = () => {
      setConnectionStatus('disconnected');
    };

    return () => {
      ws.close();
    };
  }, [symbol]);

  const maxTotal = Math.max(
    ...depth.bids.map(b => b.qty),
    ...depth.asks.map(a => a.qty)
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
          <Activity className="w-4 h-4 text-indigo-400" />
          Real-Time Market Data ({symbol}/USDT)
        </h3>
        <Badge variant="outline" className={
          connectionStatus === 'connected' ? 'text-green-400 border-green-500/30' : 'text-yellow-400 border-yellow-500/30'
        }>
          {connectionStatus === 'connected' ? 'Live Feed' : 'Connecting...'}
        </Badge>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Order Book */}
        <div className="bg-slate-950/50 rounded-lg p-3 border border-slate-800">
          <div className="text-xs font-semibold text-slate-400 mb-2 flex justify-between">
            <span>Price</span>
            <span>Size</span>
          </div>
          
          {/* Asks (Sells) - Red */}
          <div className="space-y-0.5 mb-2 flex flex-col-reverse"> {/* Reverse to show lowest ask at bottom near spread */}
            {depth.asks.map((ask, i) => (
              <div key={i} className="flex justify-between text-xs relative h-5 items-center px-1">
                <div 
                  className="absolute right-0 top-0 bottom-0 bg-red-500/10 transition-all duration-200" 
                  style={{ width: `${(ask.qty / maxTotal) * 100}%` }} 
                />
                <span className="text-red-400 relative z-10">{ask.price.toFixed(2)}</span>
                <span className="text-slate-400 relative z-10">{ask.qty.toFixed(4)}</span>
              </div>
            ))}
          </div>

          {/* Current Price */}
          <div className="py-1 text-center font-bold text-lg border-y border-slate-800 my-1">
            {price ? (
              <span className={recentTrades[0]?.isBuyerMaker ? "text-red-400" : "text-green-400"}>
                ${price.toFixed(2)}
              </span>
            ) : (
              <span className="text-slate-500">---</span>
            )}
          </div>

          {/* Bids (Buys) - Green */}
          <div className="space-y-0.5">
            {depth.bids.map((bid, i) => (
              <div key={i} className="flex justify-between text-xs relative h-5 items-center px-1">
                <div 
                  className="absolute right-0 top-0 bottom-0 bg-green-500/10 transition-all duration-200" 
                  style={{ width: `${(bid.qty / maxTotal) * 100}%` }} 
                />
                <span className="text-green-400 relative z-10">{bid.price.toFixed(2)}</span>
                <span className="text-slate-400 relative z-10">{bid.qty.toFixed(4)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Recent Trades */}
        <div className="bg-slate-950/50 rounded-lg p-3 border border-slate-800">
          <div className="text-xs font-semibold text-slate-400 mb-2 flex justify-between">
            <span>Time</span>
            <span>Price</span>
            <span>Qty</span>
          </div>
          <div className="space-y-1 overflow-hidden max-h-[240px]">
            {recentTrades.map((trade, i) => (
              <div key={trade.id} className="flex justify-between text-xs">
                <span className="text-slate-500">
                  {new Date(trade.time).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute:'2-digit', second:'2-digit' })}
                </span>
                <span className={trade.isBuyerMaker ? "text-red-400" : "text-green-400"}>
                  {trade.price.toFixed(2)}
                </span>
                <span className="text-slate-300">{trade.qty.toFixed(4)}</span>
              </div>
            ))}
            {recentTrades.length === 0 && (
              <div className="text-center text-xs text-slate-600 py-4">
                Waiting for trades...
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}