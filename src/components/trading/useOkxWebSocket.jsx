import { useState, useEffect, useRef } from 'react';

// OKX WebSocket provides real-time spot ticker updates.
// Replaces the Binance WebSocket which is geo-blocked in the UK.
// OKX instId format is "BTC-USDT"; we expose the base symbol ("BTC") as the key.
export function useOkxWebSocket(symbols = []) {
  const [livePrices, setLivePrices] = useState({});
  const [liveTickers, setLiveTickers] = useState({});
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);

  useEffect(() => {
    if (symbols.length === 0) return;

    const connect = () => {
      if (wsRef.current) {
        wsRef.current.close();
      }

      const ws = new WebSocket('wss://ws.okx.com:8443/ws/v5/public');
      wsRef.current = ws;

      ws.onopen = () => {
        // Subscribe to individual spot tickers (OKX allows max 100 args per message)
        const args = symbols
          .map(s => ({ channel: 'tickers', instId: `${s.toUpperCase()}-USDT` }))
          .slice(0, 100);
        ws.send(JSON.stringify({ op: 'subscribe', args }));
        setIsConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          // Ignore subscribe confirmations and non-tickers messages
          if (msg.event || !msg.data || !Array.isArray(msg.data)) return;
          if (msg.arg?.channel !== 'tickers') return;

          const priceUpdates = {};
          const tickerUpdates = {};
          let hasUpdates = false;

          msg.data.forEach(ticker => {
            const instId = ticker.instId;
            if (!instId || !instId.endsWith('-USDT')) return;
            const base = instId.replace(/-USDT$/, '');

            const last = parseFloat(ticker.last);
            const open24h = parseFloat(ticker.open24h);
            const volCcy24h = parseFloat(ticker.volCcy24h);
            if (!last || isNaN(last)) return;

            const change24h = open24h > 0 ? ((last - open24h) / open24h) * 100 : 0;
            priceUpdates[base] = last;
            tickerUpdates[base] = {
              price: last,
              change24h,
              volume24h: volCcy24h || 0
            };
            hasUpdates = true;
          });

          if (hasUpdates) {
            setLivePrices(prev => ({ ...prev, ...priceUpdates }));
            setLiveTickers(prev => ({ ...prev, ...tickerUpdates }));
          }
        } catch (err) {
          // ignore parse errors
        }
      };

      ws.onclose = () => {
        setIsConnected(false);
        reconnectTimeoutRef.current = setTimeout(connect, 3000);
      };

      ws.onerror = () => {
        ws.close();
      };
    };

    connect();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [JSON.stringify(symbols)]);

  return { livePrices, liveTickers, isConnected };
}