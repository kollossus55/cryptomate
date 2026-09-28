import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";

import { Checkbox } from "@/components/ui/checkbox";
import { Play, Calendar, DollarSign, Target, Shield } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export default function BacktestForm({ onRun }) {
  const [config, setConfig] = useState({
    name: `Backtest ${new Date().toLocaleDateString()}`,
    initialCapital: 10000,
    period: {
      startDate: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      endDate: new Date().toISOString().split('T')[0]
    },
    strategy: {
      assets: ['BTC', 'ETH', 'SOL'],
      minConfidence: 70,
      maxPositionSize: 15,
      stopLoss: 5,
      takeProfit: 10,
      riskLevel: 'medium'
    }
  });

  const [isRunning, setIsRunning] = useState(false);

  const availableAssets = [
    'BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'ADA', 
    'AVAX', 'DOGE', 'DOT', 'MATIC', 'LTC', 'LINK'
  ];

  const toggleAsset = (asset) => {
    const current = config.strategy.assets;
    if (current.includes(asset)) {
      setConfig({
        ...config,
        strategy: {
          ...config.strategy,
          assets: current.filter(a => a !== asset)
        }
      });
    } else {
      setConfig({
        ...config,
        strategy: {
          ...config.strategy,
          assets: [...current, asset]
        }
      });
    }
  };

  const handleRun = async () => {
    if (config.strategy.assets.length === 0) {
      alert('Please select at least one asset');
      return;
    }

    setIsRunning(true);
    try {
      await onRun(config);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Name and Capital */}
      <Card className="bg-slate-900 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Target className="w-5 h-5 text-purple-400" />
            Backtest Configuration
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label className="text-slate-300 mb-2 block">Backtest Name</Label>
            <Input
              value={config.name}
              onChange={(e) => setConfig({...config, name: e.target.value})}
              className="bg-slate-800 border-slate-700 text-white"
            />
          </div>

          <div>
            <Label className="text-slate-300 mb-2 block">Initial Capital (USD)</Label>
            <Input
              type="number"
              value={config.initialCapital}
              onChange={(e) => setConfig({...config, initialCapital: parseFloat(e.target.value) || 10000})}
              className="bg-slate-800 border-slate-700 text-white"
            />
          </div>
        </CardContent>
      </Card>

      {/* Period Selection */}
      <Card className="bg-slate-900 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Calendar className="w-5 h-5 text-blue-400" />
            Historical Period
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-slate-300 mb-2 block">Start Date</Label>
              <Input
                type="date"
                value={config.period.startDate}
                onChange={(e) => setConfig({
                  ...config,
                  period: {...config.period, startDate: e.target.value}
                })}
                className="bg-white border-slate-700 text-black"
              />
            </div>
            <div>
              <Label className="text-slate-300 mb-2 block">End Date</Label>
              <Input
                type="date"
                value={config.period.endDate}
                onChange={(e) => setConfig({
                  ...config,
                  period: {...config.period, endDate: e.target.value}
                })}
                className="bg-white border-slate-700 text-black"
                max={new Date().toISOString().split('T')[0]}
              />
            </div>
          </div>

          <div className="flex gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const end = new Date();
                const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
                setConfig({
                  ...config,
                  period: {
                    startDate: start.toISOString().split('T')[0],
                    endDate: end.toISOString().split('T')[0]
                  }
                });
              }}
              className="border-slate-700 text-slate-300 hover:bg-slate-800"
            >
              1 Month
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const end = new Date();
                const start = new Date(end.getTime() - 90 * 24 * 60 * 60 * 1000);
                setConfig({
                  ...config,
                  period: {
                    startDate: start.toISOString().split('T')[0],
                    endDate: end.toISOString().split('T')[0]
                  }
                });
              }}
              className="border-slate-700 text-slate-300 hover:bg-slate-800"
            >
              3 Months
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const end = new Date();
                const start = new Date(end.getTime() - 180 * 24 * 60 * 60 * 1000);
                setConfig({
                  ...config,
                  period: {
                    startDate: start.toISOString().split('T')[0],
                    endDate: end.toISOString().split('T')[0]
                  }
                });
              }}
              className="border-slate-700 text-slate-300 hover:bg-slate-800"
            >
              6 Months
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const end = new Date();
                const start = new Date(end.getTime() - 365 * 24 * 60 * 60 * 1000);
                setConfig({
                  ...config,
                  period: {
                    startDate: start.toISOString().split('T')[0],
                    endDate: end.toISOString().split('T')[0]
                  }
                });
              }}
              className="border-slate-700 text-slate-300 hover:bg-slate-800"
            >
              1 Year
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Asset Selection */}
      <Card className="bg-slate-900 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-yellow-400" />
            Assets to Trade ({config.strategy.assets.length} selected)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
            {availableAssets.map((asset) => (
              <button
                key={asset}
                onClick={() => toggleAsset(asset)}
                className={`p-3 rounded-lg border-2 transition-all ${
                  config.strategy.assets.includes(asset)
                    ? 'bg-purple-500/20 border-purple-500 text-purple-300'
                    : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-600'
                }`}
              >
                <span className="font-bold">{asset}</span>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Strategy Parameters */}
      <Card className="bg-slate-900 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Shield className="w-5 h-5 text-green-400" />
            Strategy Parameters
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="bg-slate-800/50 p-4 rounded-lg border border-slate-700">
            <Label className="text-slate-300 mb-3 block">
              Min AI Confidence: <span className="text-purple-400 font-bold">{config.strategy.minConfidence}%</span>
            </Label>
            <Slider
              value={[config.strategy.minConfidence]}
              onValueChange={(value) => setConfig({
                ...config,
                strategy: {...config.strategy, minConfidence: value[0]}
              })}
              min={50}
              max={95}
              step={5}
              className="mb-2 [&_[role=slider]]:bg-purple-500 [&_[role=slider]]:border-purple-400 [&_.bg-primary]:bg-purple-500"
            />
            <p className="text-xs text-slate-400">Only execute trades with AI confidence above this level</p>
          </div>

          <div className="bg-slate-800/50 p-4 rounded-lg border border-slate-700">
            <Label className="text-slate-300 mb-3 block">
              Max Position Size: <span className="text-blue-400 font-bold">{config.strategy.maxPositionSize}%</span>
            </Label>
            <Slider
              value={[config.strategy.maxPositionSize]}
              onValueChange={(value) => setConfig({
                ...config,
                strategy: {...config.strategy, maxPositionSize: value[0]}
              })}
              min={5}
              max={50}
              step={5}
              className="mb-2 [&_[role=slider]]:bg-blue-500 [&_[role=slider]]:border-blue-400 [&_.bg-primary]:bg-blue-500"
            />
            <p className="text-xs text-slate-400">Maximum % of capital per trade</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-slate-300 mb-2 block">Stop Loss (%)</Label>
              <Input
                type="number"
                value={config.strategy.stopLoss}
                onChange={(e) => setConfig({
                  ...config,
                  strategy: {...config.strategy, stopLoss: parseFloat(e.target.value) || 5}
                })}
                className="bg-slate-800 border-slate-700 text-white"
                step="0.5"
              />
            </div>
            <div>
              <Label className="text-slate-300 mb-2 block">Take Profit (%)</Label>
              <Input
                type="number"
                value={config.strategy.takeProfit}
                onChange={(e) => setConfig({
                  ...config,
                  strategy: {...config.strategy, takeProfit: parseFloat(e.target.value) || 10}
                })}
                className="bg-slate-800 border-slate-700 text-white"
                step="0.5"
              />
            </div>
          </div>

        </CardContent>
      </Card>

      {/* Run Button */}
      <Button
        onClick={handleRun}
        disabled={isRunning || config.strategy.assets.length === 0}
        className="w-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-lg py-6"
      >
        <Play className={`w-5 h-5 mr-2 ${isRunning ? 'animate-spin' : ''}`} />
        {isRunning ? 'Running Backtest...' : 'Run Backtest'}
      </Button>
    </div>
  );
}