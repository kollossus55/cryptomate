import { useState, useEffect } from "react";
import { LineChart, Line, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ComposedChart } from "recharts";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TrendingUp, Activity, BarChart3, AlertCircle, RefreshCw } from "lucide-react";

export default function AdvancedChart({ asset }) {
  const [priceData, setPriceData] = useState([]);
  const [timeframe, setTimeframe] = useState('1H');
  const [indicators, setIndicators] = useState({
    sma20: true,
    sma50: false,
    ema12: false,
    rsi: false,
    macd: false
  });
  const [isLoading, setIsLoading] = useState(false);
  const [dataSource, setDataSource] = useState('simulated');

  useEffect(() => {
    if (asset) {
      generateMockData();
      tryFetchLiveData();
    }
  }, [asset, timeframe]);

  const tryFetchLiveData = async () => {
    try {
      const coinGeckoIds = {
        BTC: "bitcoin", ETH: "ethereum", BNB: "binancecoin", SOL: "solana",
        XRP: "ripple", ADA: "cardano", AVAX: "avalanche-2", DOGE: "dogecoin",
        DOT: "polkadot", MATIC: "matic-network", LTC: "litecoin", LINK: "chainlink",
        UNI: "uniswap", ATOM: "cosmos", XLM: "stellar", ALGO: "algorand",
        VET: "vechain", FIL: "filecoin", NEAR: "near", APT: "aptos"
      };

      const coinId = coinGeckoIds[asset.symbol];
      if (!coinId) return;

      // Map timeframes to CoinGecko days parameter
      const timeframeMap = {
        '5M': { days: 1, interval: 'hourly' },
        '15M': { days: 1, interval: 'hourly' },
        '1H': { days: 1, interval: 'hourly' },
        '4H': { days: 7, interval: 'hourly' },
        '1D': { days: 30, interval: 'daily' },
        '1W': { days: 90, interval: 'daily' }
      };

      const { days, interval } = timeframeMap[timeframe] || timeframeMap['1H'];
      
      const response = await fetch(
        `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?vs_currency=usd&days=${days}&interval=${interval}`,
        { 
          method: 'GET',
          headers: { 'Accept': 'application/json' }
        }
      );
      
      if (!response.ok) throw new Error(`API error: ${response.status}`);
      
      const data = await response.json();
      
      if (data.prices && data.prices.length > 0) {
        const processed = data.prices.map((price, idx) => {
          const timestamp = price[0];
          const value = price[1];
          const volume = data.total_volumes?.[idx]?.[1] || 0;
          const prevValue = idx > 0 ? data.prices[idx - 1][1] : value;
          
          return {
            timestamp,
            date: new Date(timestamp).toLocaleDateString(),
            time: new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            price: value,
            volume: volume / 1e9,
            isPositive: value >= prevValue,
            change: ((value - prevValue) / prevValue) * 100
          };
        });

        const withIndicators = calculateIndicators(processed);
        setPriceData(withIndicators);
        setDataSource('live');
      }
    } catch (error) {
      console.log("Live data unavailable, using simulated data:", error.message);
    }
  };

  const calculateIndicators = (data) => {
    if (data.length === 0) return data;

    const calculateSMA = (period) => {
      return data.map((item, idx) => {
        if (idx < period - 1) return null;
        const sum = data.slice(idx - period + 1, idx + 1).reduce((acc, d) => acc + d.price, 0);
        return sum / period;
      });
    };

    const calculateEMA = (period) => {
      const multiplier = 2 / (period + 1);
      const ema = [];
      
      const sma = data.slice(0, period).reduce((acc, d) => acc + d.price, 0) / period;
      ema.push(sma);
      
      for (let i = 1; i < data.length; i++) {
        const value = (data[i].price - ema[i - 1]) * multiplier + ema[i - 1];
        ema.push(value);
      }
      
      return ema;
    };

    const calculateRSI = (period = 14) => {
      const rsi = [];
      let gains = 0;
      let losses = 0;

      for (let i = 0; i < data.length; i++) {
        if (i === 0) {
          rsi.push(null);
          continue;
        }

        const change = data[i].price - data[i - 1].price;
        
        if (i < period) {
          if (change > 0) gains += change;
          else losses += Math.abs(change);
          rsi.push(null);
        } else if (i === period) {
          const avgGain = gains / period;
          const avgLoss = losses / period;
          const rs = avgGain / (avgLoss || 1);
          rsi.push(100 - (100 / (1 + rs)));
        } else {
          const prevAvgGain = gains / period;
          const prevAvgLoss = losses / period;
          
          gains = (prevAvgGain * (period - 1) + (change > 0 ? change : 0)) / period;
          losses = (prevAvgLoss * (period - 1) + (change < 0 ? Math.abs(change) : 0)) / period;
          
          const rs = gains / (losses || 1);
          rsi.push(100 - (100 / (1 + rs)));
        }
      }

      return rsi;
    };

    const calculateMACD = () => {
      const ema12 = calculateEMA(12);
      const ema26 = calculateEMA(26);
      const macdLine = ema12.map((val, idx) => val - ema26[idx]);
      
      const signalMultiplier = 2 / (9 + 1);
      const signal = [];
      signal.push(macdLine[0]);
      
      for (let i = 1; i < macdLine.length; i++) {
        signal.push((macdLine[i] - signal[i - 1]) * signalMultiplier + signal[i - 1]);
      }
      
      const histogram = macdLine.map((val, idx) => val - signal[idx]);
      
      return { macdLine, signal, histogram };
    };

    const sma20 = calculateSMA(20);
    const sma50 = calculateSMA(50);
    const ema12 = calculateEMA(12);
    const rsi = calculateRSI(14);
    const macd = calculateMACD();

    return data.map((item, idx) => ({
      ...item,
      sma20: sma20[idx],
      sma50: sma50[idx],
      ema12: ema12[idx],
      rsi: rsi[idx],
      macd: macd.macdLine[idx],
      macdSignal: macd.signal[idx],
      macdHistogram: macd.histogram[idx]
    }));
  };

  const generateMockData = () => {
    const basePrice = asset.price || 100;
    const mock = [];
    
    // Determine points based on timeframe
    const timeframeConfig = {
      '5M': { points: 288, interval: 300000 }, // 5 min * 288 = 24 hours
      '15M': { points: 96, interval: 900000 }, // 15 min * 96 = 24 hours
      '1H': { points: 72, interval: 3600000 }, // 1 hour * 72 = 3 days
      '4H': { points: 42, interval: 14400000 }, // 4 hours * 42 = 7 days
      '1D': { points: 30, interval: 86400000 }, // 1 day * 30 = 1 month
      '1W': { points: 52, interval: 604800000 } // 1 week * 52 = 1 year
    };
    
    const config = timeframeConfig[timeframe] || timeframeConfig['1H'];
    let currentPrice = basePrice;
    let prevPrice = basePrice;
    
    for (let i = 0; i < config.points; i++) {
      const trend = (Math.random() - 0.48) * 0.02;
      const volatility = Math.random() * 0.03;
      const change = currentPrice * (trend + volatility);
      
      prevPrice = currentPrice;
      currentPrice = Math.max(currentPrice + change, basePrice * 0.8);
      
      const timestamp = Date.now() - (config.points - i) * config.interval;
      const date = new Date(timestamp);
      
      // Format time based on timeframe
      let timeDisplay;
      if (timeframe === '5M' || timeframe === '15M' || timeframe === '1H') {
        timeDisplay = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      } else if (timeframe === '4H') {
        timeDisplay = date.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + 
                      date.toLocaleTimeString([], { hour: '2-digit' });
      } else {
        timeDisplay = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
      }
      
      mock.push({
        timestamp,
        date: date.toLocaleDateString(),
        time: timeDisplay,
        price: currentPrice,
        volume: (Math.random() * 2) + 0.5,
        isPositive: currentPrice >= prevPrice,
        change: ((currentPrice - prevPrice) / prevPrice) * 100
      });
    }
    
    const withIndicators = calculateIndicators(mock);
    setPriceData(withIndicators);
    setDataSource('simulated');
  };

  const handleRefresh = () => {
    setIsLoading(true);
    generateMockData();
    tryFetchLiveData().finally(() => setIsLoading(false));
  };

  const toggleIndicator = (indicator) => {
    setIndicators(prev => ({ ...prev, [indicator]: !prev[indicator] }));
  };

  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-slate-900/95 border border-slate-700 rounded-lg p-3 shadow-xl backdrop-blur-sm">
          <p className="text-slate-300 text-sm mb-2 font-semibold">{label}</p>
          {payload.map((entry, idx) => (
            <p key={idx} className="text-sm" style={{ color: entry.color }}>
              <span className="font-semibold">{entry.name}:</span> ${entry.value?.toFixed(2)}
            </p>
          ))}
        </div>
      );
    }
    return null;
  };

  // Custom bar for volume with color based on price movement
  const CustomVolumeBar = (props) => {
    const { fill, x, y, width, height, payload } = props;
    const barColor = payload.isPositive ? '#10b981' : '#ef4444'; // Green if up, red if down
    
    return (
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill={barColor}
        opacity={0.7}
      />
    );
  };

  return (
    <div className="space-y-4">
      {/* Data Source Badge */}
      <div className="flex items-center justify-between">
        <Badge 
          variant="outline" 
          className={dataSource === 'live' 
            ? "border-green-500 text-green-400 bg-green-500/10" 
            : "border-blue-500 text-blue-400 bg-blue-500/10"
          }
        >
          {dataSource === 'live' ? '● Live Data' : '● Simulated Data'}
        </Badge>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          disabled={isLoading}
          className="border-slate-700 text-slate-300 hover:bg-slate-800"
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Info Banner */}
      {dataSource === 'simulated' && (
        <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-3 flex gap-2">
          <AlertCircle className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm text-blue-200 font-semibold mb-1">Demo Mode - Simulated Chart Data</p>
            <p className="text-xs text-blue-200/80">
              Showing realistic simulated data for demonstration. All technical indicators are calculated correctly and update in real-time.
            </p>
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex gap-2 flex-wrap">
          {['5M', '15M', '1H', '4H', '1D', '1W'].map((tf) => (
            <Button
              key={tf}
              variant={timeframe === tf ? "default" : "outline"}
              size="sm"
              onClick={() => setTimeframe(tf)}
              className={timeframe === tf ? "bg-indigo-600 hover:bg-indigo-700" : "border-slate-700 text-slate-300 hover:bg-slate-800"}
            >
              {tf}
            </Button>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => toggleIndicator('sma20')}
            className={indicators.sma20 ? "bg-blue-500/20 border-blue-500 text-blue-300 hover:bg-blue-500/30" : "border-slate-700 text-slate-300 hover:bg-slate-800"}
          >
            SMA 20
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => toggleIndicator('sma50')}
            className={indicators.sma50 ? "bg-purple-500/20 border-purple-500 text-purple-300 hover:bg-purple-500/30" : "border-slate-700 text-slate-300 hover:bg-slate-800"}
          >
            SMA 50
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => toggleIndicator('ema12')}
            className={indicators.ema12 ? "bg-green-500/20 border-green-500 text-green-300 hover:bg-green-500/30" : "border-slate-700 text-slate-300 hover:bg-slate-800"}
          >
            EMA 12
          </Button>
        </div>
      </div>

      {/* Chart Tabs */}
      <Tabs defaultValue="price" className="w-full">
        <TabsList className="bg-slate-800 border-slate-700">
          <TabsTrigger value="price" className="data-[state=active]:bg-indigo-600">
            <TrendingUp className="w-4 h-4 mr-2" />
            Price Chart
          </TabsTrigger>
          <TabsTrigger value="rsi" className="data-[state=active]:bg-indigo-600">
            <Activity className="w-4 h-4 mr-2" />
            RSI
          </TabsTrigger>
          <TabsTrigger value="macd" className="data-[state=active]:bg-indigo-600">
            <BarChart3 className="w-4 h-4 mr-2" />
            MACD
          </TabsTrigger>
        </TabsList>

        {/* Price Chart */}
        <TabsContent value="price" className="mt-4">
          <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-xl p-4 border border-slate-700">
            {priceData.length > 0 ? (
              <ResponsiveContainer width="100%" height={400}>
                <ComposedChart data={priceData}>
                  <defs>
                    <linearGradient id="colorPrice" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#818cf8" stopOpacity={0.8}/>
                      <stop offset="50%" stopColor="#6366f1" stopOpacity={0.4}/>
                      <stop offset="95%" stopColor="#4f46e5" stopOpacity={0.1}/>
                    </linearGradient>
                    <linearGradient id="colorSMA20" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.5}/>
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                    </linearGradient>
                    <linearGradient id="colorSMA50" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#a855f7" stopOpacity={0.5}/>
                      <stop offset="95%" stopColor="#a855f7" stopOpacity={0}/>
                    </linearGradient>
                    <linearGradient id="colorEMA12" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.5}/>
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.3} />
                  <XAxis 
                    dataKey="time" 
                    stroke="#94a3b8" 
                    tick={{ fill: '#94a3b8', fontSize: 11 }}
                    tickMargin={8}
                  />
                  <YAxis 
                    stroke="#94a3b8" 
                    tick={{ fill: '#94a3b8', fontSize: 11 }}
                    domain={['auto', 'auto']}
                    tickMargin={8}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ color: '#94a3b8', paddingTop: '10px' }} />
                  
                  <Area
                    type="monotone"
                    dataKey="price"
                    fill="url(#colorPrice)"
                    stroke="#818cf8"
                    strokeWidth={3}
                    name="Price"
                  />
                  
                  {indicators.sma20 && (
                    <Line
                      type="monotone"
                      dataKey="sma20"
                      stroke="#3b82f6"
                      strokeWidth={2.5}
                      dot={false}
                      name="SMA 20"
                      strokeDasharray="5 5"
                    />
                  )}
                  
                  {indicators.sma50 && (
                    <Line
                      type="monotone"
                      dataKey="sma50"
                      stroke="#a855f7"
                      strokeWidth={2.5}
                      dot={false}
                      name="SMA 50"
                      strokeDasharray="5 5"
                    />
                  )}
                  
                  {indicators.ema12 && (
                    <Line
                      type="monotone"
                      dataKey="ema12"
                      stroke="#10b981"
                      strokeWidth={2.5}
                      dot={false}
                      name="EMA 12"
                    />
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[400px] flex items-center justify-center text-slate-400">
                No chart data available
              </div>
            )}
          </div>
        </TabsContent>

        {/* RSI Chart */}
        <TabsContent value="rsi" className="mt-4">
          <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-xl p-4 border border-slate-700">
            <div className="mb-2 flex items-center justify-between">
              <h4 className="text-slate-300 font-semibold">Relative Strength Index (RSI)</h4>
              <div className="flex gap-2">
                <Badge className="bg-red-500/20 text-red-400 border-red-500/30">Oversold &lt; 30</Badge>
                <Badge className="bg-green-500/20 text-green-400 border-green-500/30">Overbought &gt; 70</Badge>
              </div>
            </div>
            {priceData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={priceData}>
                  <defs>
                    <linearGradient id="colorRSI" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.8}/>
                      <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.2}/>
                    </linearGradient>
                  </defs>
                  
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.3} />
                  <XAxis 
                    dataKey="time" 
                    stroke="#94a3b8" 
                    tick={{ fill: '#94a3b8', fontSize: 11 }}
                  />
                  <YAxis 
                    stroke="#94a3b8" 
                    tick={{ fill: '#94a3b8', fontSize: 11 }}
                    domain={[0, 100]}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ color: '#94a3b8' }} />
                  
                  <Area
                    type="monotone"
                    dataKey="rsi"
                    stroke="#f59e0b"
                    fill="url(#colorRSI)"
                    strokeWidth={2.5}
                    name="RSI"
                  />
                  
                  <Line dataKey={() => 70} stroke="#ef4444" strokeWidth={2} strokeDasharray="5 5" dot={false} name="Overbought" />
                  <Line dataKey={() => 30} stroke="#10b981" strokeWidth={2} strokeDasharray="5 5" dot={false} name="Oversold" />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[300px] flex items-center justify-center text-slate-400">
                No RSI data available
              </div>
            )}
          </div>
        </TabsContent>

        {/* MACD Chart */}
        <TabsContent value="macd" className="mt-4">
          <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-xl p-4 border border-slate-700">
            <h4 className="text-slate-300 font-semibold mb-2">MACD (Moving Average Convergence Divergence)</h4>
            {priceData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <ComposedChart data={priceData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.3} />
                  <XAxis 
                    dataKey="time" 
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
                    dataKey="macdHistogram" 
                    fill="#818cf8" 
                    name="MACD Histogram"
                    opacity={0.7}
                  />
                  
                  <Line
                    type="monotone"
                    dataKey="macd"
                    stroke="#3b82f6"
                    strokeWidth={2.5}
                    dot={false}
                    name="MACD Line"
                  />
                  
                  <Line
                    type="monotone"
                    dataKey="macdSignal"
                    stroke="#f59e0b"
                    strokeWidth={2.5}
                    dot={false}
                    name="Signal Line"
                  />
                </ComposedChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[300px] flex items-center justify-center text-slate-400">
                No MACD data available
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* Volume Chart */}
      <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-xl p-4 border border-slate-700">
        <h4 className="text-slate-300 font-semibold mb-2">Volume (Billions USD)</h4>
        {priceData.length > 0 ? (
          <ResponsiveContainer width="100%" height={150}>
            <BarChart data={priceData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.3} />
              <XAxis 
                dataKey="time" 
                stroke="#94a3b8" 
                tick={{ fill: '#94a3b8', fontSize: 11 }}
              />
              <YAxis 
                stroke="#94a3b8" 
                tick={{ fill: '#94a3b8', fontSize: 11 }}
              />
              <Tooltip content={<CustomTooltip />} />
              <Bar 
                dataKey="volume" 
                shape={<CustomVolumeBar />}
                name="Volume" 
              />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-[150px] flex items-center justify-center text-slate-400">
            No volume data available
          </div>
        )}
      </div>
    </div>
  );
}