import { useState, useEffect, useRef } from 'react';

// Standard mapping for common CoinGecko symbols to Binance pairs
// Assuming USDT pairs for all
const getBinancePair = (symbol) => {
  if (!symbol) return null;
  // Special cases if needed, but usually just uppercase symbol + USDT
  return `${symbol.toLowerCase()}usdt`;
};

export function useBinanceWebSocket(symbols = []) {
  const [livePrices, setLivePrices] = useState({});
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);

  useEffect(() => {
    // If no symbols, just listen to all mini tickers for simplicity if the list is dynamic
    // Or subscribe to specific ones.
    // !miniTicker@arr gives updates for ALL pairs, which is efficient for a broad list
    // filtering happens client side.
    
    const connect = () => {
      if (wsRef.current) {
        wsRef.current.close();
      }

      const ws = new WebSocket('wss://stream.binance.com:9443/ws/!miniTicker@arr');
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('✅ Binance WebSocket connected');
        setIsConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          // data is an array of mini-ticker objects
          // { s: "BTCUSDT", c: "45000.00", ... }
          
          const updates = {};
          let hasUpdates = false;

          // Create a set of lowercased symbols we care about for fast lookup
          // Add "usdt" suffix
          const targetPairs = new Set(symbols.map(s => getBinancePair(s)));

          data.forEach(ticker => {
            const pair = ticker.s.toLowerCase();
            // If we are tracking this pair (or if no specific symbols provided, track all - but that's too much memory)
            // Better to only track what's needed.
            
            if (symbols.length === 0 || targetPairs.has(pair)) {
              // Extract symbol back from pair (remove usdt)
              // This is a bit hacky, but works for standard pairs
              if (pair.endsWith('usdt')) {
                const symbol = pair.slice(0, -4).toUpperCase();
                updates[symbol] = parseFloat(ticker.c);
                hasUpdates = true;
              }
            }
          });

          if (hasUpdates) {
            setLivePrices(prev => ({ ...prev, ...updates }));
          }
        } catch (err) {
          // ignore parse errors
        }
      };

      ws.onclose = () => {
        console.log('⚠️ Binance WebSocket disconnected');
        setIsConnected(false);
        // Reconnect after delay
        reconnectTimeoutRef.current = setTimeout(connect, 3000);
      };

      ws.onerror = (err) => {
        console.error('WebSocket error:', err);
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
  }, [JSON.stringify(symbols)]); // Re-connect if symbols list changes significantly

  return { livePrices, isConnected };
}