import React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Activity, BarChart2, TrendingUp, Zap, Waves } from "lucide-react";

export default function IndicatorSettingsModal({ isOpen, onClose, settings, onUpdate }) {
  const handleToggle = (key) => {
    onUpdate({
      ...settings,
      [key]: !settings[key]
    });
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
    }
  ];

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="bg-slate-900 border-slate-700 text-white sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold flex items-center gap-2">
            <Activity className="w-5 h-5 text-indigo-400" />
            Signal Indicators
          </DialogTitle>
          <p className="text-sm text-slate-400">
            Configure which technical indicators should influence the AI signal generation.
          </p>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {indicators.map((indicator) => {
            const Icon = indicator.icon;
            return (
              <div key={indicator.id} className="flex items-start justify-between bg-slate-800/50 p-3 rounded-lg border border-slate-700/50">
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
            );
          })}
        </div>

        <DialogFooter>
          <Button onClick={onClose} className="w-full bg-indigo-600 hover:bg-indigo-700">
            Save Configuration
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}