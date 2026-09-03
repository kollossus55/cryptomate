import React from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Activity, BarChart2, TrendingUp, Zap, Waves, Signal, LineChart, ArrowUpDown, Sparkles, CandlestickChart, Cloud, Brain } from "lucide-react";

export default function IndicatorSettingsModal({ isOpen, onClose, settings, onUpdate, onSave }) {
  const handleToggle = (key) => {
    onUpdate({
      ...settings,
      [key]: !settings[key]
    });
  };

  const handleSelectAll = () => {
    const allEnabled = {};
    indicators.forEach(ind => {
      allEnabled[ind.id] = true;
    });
    onUpdate(allEnabled);
  };

  const handleClearAll = () => {
    const allDisabled = {};
    indicators.forEach(ind => {
      allDisabled[ind.id] = false;
    });
    onUpdate(allDisabled);
  };

  const indicators = [
    { 
      id: 'rsi', 
      name: 'Relative Strength Index (RSI)', 
      description: 'Measures momentum to identify overbought/oversold conditions.',
      icon: Activity,
      color: 'text-blue-400'
    },
    { 
      id: 'macd', 
      name: 'MACD', 
      description: 'Trend-following momentum indicator showing relationship between moving averages.',
      icon: BarChart2,
      color: 'text-purple-400'
    },
    { 
      id: 'bollinger', 
      name: 'Bollinger Bands', 
      description: 'Defined by a set of trendlines plotted two standard deviations away from a SMA.',
      icon: Waves,
      color: 'text-cyan-400'
    },
    { 
      id: 'ema', 
      name: 'EMA Trend', 
      description: 'Exponential Moving Average crossover (Golden/Death Cross detection).',
      icon: TrendingUp,
      color: 'text-yellow-400'
    },
    { 
      id: 'stoch', 
      name: 'Stochastic Oscillator', 
      description: 'Momentum indicator comparing closing price to a range of prices.',
      icon: Zap,
      color: 'text-orange-400'
    },
    { 
      id: 'adx', 
      name: 'ADX (Average Directional Index)', 
      description: 'Measures trend strength. >25 indicates strong trend.',
      icon: Signal,
      color: 'text-green-400'
    },
    { 
      id: 'sma', 
      name: 'SMA (Simple Moving Average)', 
      description: 'Identifies support/resistance levels and trend direction.',
      icon: LineChart,
      color: 'text-pink-400'
    },
    { 
      id: 'ao', 
      name: 'Awesome Oscillator', 
      description: 'Momentum indicator using 5-period and 34-period moving averages.',
      icon: ArrowUpDown,
      color: 'text-teal-400'
    },
    { 
      id: 'aroon', 
      name: 'Aroon Indicator', 
      description: 'Identifies trend changes and measures trend strength.',
      icon: Sparkles,
      color: 'text-indigo-400'
    },
    { 
      id: 'candlestick', 
      name: 'Candlestick Patterns', 
      description: 'Recognizes bullish/bearish patterns like engulfing, morning/evening star.',
      icon: CandlestickChart,
      color: 'text-amber-400'
    },
    { 
      id: 'ichimoku', 
      name: 'Ichimoku Cloud', 
      description: 'Comprehensive indicator showing support/resistance, trend, and momentum.',
      icon: Cloud,
      color: 'text-violet-400'
    },
    {
      id: 'sp500ai',
      name: 'SP500 Full AI (HA + SSL + CMO + TMO)',
      description: 'Multi-component AI indicator: Heikin Ashi candles, SSL Channel, Chande Momentum Oscillator, dual AI RSI, True Momentum Oscillator, and AI Money Flow. Acts as both a filter and confidence booster.',
      icon: Brain,
      color: 'text-rose-400'
    }
  ];

  const sp500SubIndicators = [
    { id: 'sp500ai_ha', name: 'Heikin Ashi' },
    { id: 'sp500ai_ssl', name: 'SSL Channel' },
    { id: 'sp500ai_cmo', name: 'Chande Momentum (CMO)' },
    { id: 'sp500ai_airsi', name: 'AI RSI (Dual Divergence)' },
    { id: 'sp500ai_tmo', name: 'True Momentum (TMO)' },
    { id: 'sp500ai_mf', name: 'AI Money Flow' }
  ];

  return (
    <Sheet open={isOpen} onOpenChange={onClose}>
      <SheetContent className="bg-slate-900 border-slate-700 text-white overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-xl font-bold flex items-center gap-2">
            <Activity className="w-5 h-5 text-indigo-400" />
            Signal Indicators
          </SheetTitle>
          <p className="text-sm text-slate-400">
            Configure which technical indicators should influence the AI signal generation.
          </p>
        </SheetHeader>

        <div className="flex gap-2 mb-4">
          <Button 
            onClick={handleSelectAll}
            variant="outline"
            size="sm"
            className="flex-1 border-indigo-500 text-indigo-400 hover:bg-indigo-500/10"
          >
            Select All
          </Button>
          <Button 
            onClick={handleClearAll}
            variant="outline"
            size="sm"
            className="flex-1 border-slate-600 text-slate-400 hover:bg-slate-700"
          >
            Clear All
          </Button>
        </div>

        <div className="space-y-4 py-4">
          {indicators.map((indicator) => {
            const Icon = indicator.icon;
            const isSp500 = indicator.id === 'sp500ai';
            return (
              <div key={indicator.id} className="space-y-2">
                <div className="flex items-start justify-between bg-slate-800/50 p-3 rounded-lg border border-slate-700/50">
                  <div className="flex gap-3">
                    <div className={`mt-1 ${indicator.color}`}>
                      <Icon className="w-5 h-5" />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={indicator.id} className="text-base font-semibold cursor-pointer">
                        {indicator.name}
                      </Label>
                      <p className="text-xs text-slate-400 pr-4">
                        {indicator.description}
                      </p>
                    </div>
                  </div>
                  <Switch
                    id={indicator.id}
                    checked={settings[indicator.id]}
                    onCheckedChange={() => handleToggle(indicator.id)}
                    className="data-[state=checked]:bg-indigo-600"
                  />
                </div>
                {isSp500 && settings.sp500ai && (
                  <div className="ml-8 pl-3 border-l-2 border-rose-500/30 space-y-2">
                    <p className="text-xs text-slate-500 italic">Toggle individual SP500 AI components:</p>
                    {sp500SubIndicators.map((sub) => (
                      <div key={sub.id} className="flex items-center justify-between bg-slate-900/40 p-2 rounded-md">
                        <Label htmlFor={sub.id} className="text-sm text-slate-300 cursor-pointer">
                          {sub.name}
                        </Label>
                        <Switch
                          id={sub.id}
                          checked={settings[sub.id] !== false}
                          onCheckedChange={() => handleToggle(sub.id)}
                          className="data-[state=checked]:bg-rose-500"
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <SheetFooter className="mt-6">
          <Button onClick={() => onSave ? onSave() : onClose()} className="w-full bg-indigo-600 hover:bg-indigo-700">
            Save Configuration
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}