import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Shield, TrendingUp, AlertTriangle, Activity, Layers } from "lucide-react";

// Advanced risk controls that are enforced server-side but had no UI.
// Receives the shared settings state + setter so saves persist to the backend.
export default function AdvancedRiskControls({ settings, setSettings }) {
  const num = (key, fallback) => settings[key] ?? fallback;

  const set = (key, value) => setSettings(prev => ({ ...prev, [key]: value }));

  return (
    <>
      {/* ATR-Based Risk Sizing */}
      <Card className="bg-slate-800 border-2 border-amber-500/50 mt-6 shadow-[0_0_15px_rgba(245,158,11,0.15)]">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-amber-100">
            <TrendingUp className="w-5 h-5 text-amber-400" />
            ATR-Based Risk Sizing
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="bg-slate-900/50 rounded-xl p-4 border border-amber-500/30">
            <p className="text-xs text-amber-400/70 mb-4 leading-relaxed">
              Volatility-adaptive position sizing. Instead of a flat stop-loss percentage, the engine sizes each
              position so that a hit to the stop costs exactly <strong>risk_per_trade_percent</strong> of equity.
              The stop distance is <strong>atr_stop_multiplier</strong> × ATR, so it widens in choppy markets and
              tightens in calm ones — giving each trade room to breathe without risking more capital.
            </p>

            <div className="space-y-5">
              <div>
                <Label className="text-amber-200 mb-2 block font-medium">
                  Risk Per Trade: <span className="text-amber-400 font-bold">{num("risk_per_trade_percent", 1)}%</span> of equity
                </Label>
                <Slider
                  value={[num("risk_per_trade_percent", 1)]}
                  onValueChange={(v) => set("risk_per_trade_percent", v[0])}
                  min={0.25}
                  max={5}
                  step={0.25}
                  className="mb-2 [&>.relative>.bg-primary]:bg-amber-500 [&>.block]:border-amber-500"
                />
                <p className="text-xs text-amber-400/60">
                  Capital risked if the stop is hit. 1–2% is recommended for survival across losing streaks.
                </p>
              </div>

              <div>
                <Label className="text-amber-200 mb-2 block font-medium">
                  ATR Stop Multiplier: <span className="text-amber-400 font-bold">{num("atr_stop_multiplier", 2)}× ATR</span>
                </Label>
                <Slider
                  value={[num("atr_stop_multiplier", 2)]}
                  onValueChange={(v) => set("atr_stop_multiplier", v[0])}
                  min={1}
                  max={5}
                  step={0.5}
                  className="mb-2 [&>.relative>.bg-primary]:bg-amber-500 [&>.block]:border-amber-500"
                />
                <p className="text-xs text-amber-400/60">
                  Stop distance in ATR multiples. Higher = wider, more forgiving stops. 2× is a common swing-trading default.
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Portfolio Exposure & Correlation */}
      <Card className="bg-slate-800 border-2 border-rose-500/50 mt-6 shadow-[0_0_15px_rgba(244,63,94,0.15)]">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-rose-100">
            <Shield className="w-5 h-5 text-rose-400" />
            Portfolio Exposure & Correlation
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="bg-slate-900/50 rounded-xl p-4 border border-rose-500/30 space-y-5">
            <div>
              <Label className="text-rose-200 mb-2 block font-medium">
                Max Gross Exposure: <span className="text-rose-400 font-bold">{num("max_gross_exposure_percent", 60)}%</span>
              </Label>
              <Slider
                value={[num("max_gross_exposure_percent", 60)]}
                onValueChange={(v) => set("max_gross_exposure_percent", v[0])}
                min={20}
                max={100}
                step={5}
                className="mb-2 [&>.relative>.bg-primary]:bg-rose-500 [&>.block]:border-rose-500"
              />
              <p className="text-xs text-rose-400/60">
                Hard cap on total invested capital across all open positions. Position count alone does not bound market risk.
              </p>
            </div>

            <div>
              <Label className="text-rose-200 mb-2 block font-medium">
                Max Correlation: <span className="text-rose-400 font-bold">{num("max_correlation", 0.8).toFixed(2)}</span>
              </Label>
              <Slider
                value={[num("max_correlation", 0.8)]}
                onValueChange={(v) => set("max_correlation", v[0])}
                min={0.3}
                max={1.0}
                step={0.05}
                className="mb-2 [&>.relative>.bg-primary]:bg-rose-500 [&>.block]:border-rose-500"
              />
              <p className="text-xs text-rose-400/60">
                Reject a new candidate whose returns correlate above this with an existing open position. Lower = more diversified.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Market Crash Circuit Breaker */}
      <Card className="bg-slate-800 border-2 border-red-500/50 mt-6 shadow-[0_0_15px_rgba(239,68,68,0.15)]">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-red-100">
            <AlertTriangle className="w-5 h-5 text-red-400" />
            Market Crash Circuit Breaker
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="bg-slate-900/50 rounded-xl p-4 border border-red-500/30 space-y-5">
            <p className="text-xs text-red-400/70 leading-relaxed">
              Separate from the daily-loss circuit breaker, this guards against broad market crashes.
              When the overall market drops by the threshold percentage, all trading halts for the cooldown period.
            </p>

            <div>
              <Label className="text-red-200 mb-2 block font-medium">
                Market Drop Threshold: <span className="text-red-400 font-bold">{num("circuit_breaker_market_drop", 15)}%</span>
              </Label>
              <Slider
                value={[num("circuit_breaker_market_drop", 15)]}
                onValueChange={(v) => set("circuit_breaker_market_drop", v[0])}
                min={5}
                max={30}
                step={1}
                className="mb-2 [&>.relative>.bg-primary]:bg-red-500 [&>.block]:border-red-500"
              />
              <p className="text-xs text-red-400/60">Market-wide drop % that triggers the halt.</p>
            </div>

            <div>
              <Label className="text-red-200 mb-2 block font-medium">
                Cooldown Period: <span className="text-red-400 font-bold">{num("circuit_breaker_cooldown_minutes", 60)} min</span>
              </Label>
              <Slider
                value={[num("circuit_breaker_cooldown_minutes", 60)]}
                onValueChange={(v) => set("circuit_breaker_cooldown_minutes", v[0])}
                min={15}
                max={240}
                step={15}
                className="mb-2 [&>.relative>.bg-primary]:bg-red-500 [&>.block]:border-red-500"
              />
              <p className="text-xs text-red-400/60">How long trading stays paused after the breaker triggers.</p>
            </div>

            {settings.circuit_breaker_triggered_at && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                <p className="text-xs text-red-300 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" />
                  Currently triggered — use "Reset Halt" above to resume trading.
                </p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* VWAP Execution */}
      <Card className="bg-slate-800 border-2 border-cyan-500/50 mt-6 shadow-[0_0_15px_rgba(6,182,212,0.15)]">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-cyan-100">
            <Activity className="w-5 h-5 text-cyan-400" />
            VWAP (Volume-Weighted Average Price)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="bg-slate-900/50 rounded-xl p-4 border border-cyan-500/30">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h4 className="text-cyan-100 font-semibold flex items-center gap-2">
                  <Layers className="w-4 h-4 text-cyan-400" />
                  VWAP Execution
                </h4>
                <p className="text-xs text-cyan-400/60 mt-1">
                  Execute orders aligned with volume-weighted average price to minimize market impact
                </p>
              </div>
              <Switch
                checked={settings.use_vwap ?? false}
                onCheckedChange={(checked) => set("use_vwap", checked)}
                className="data-[state=checked]:bg-cyan-500"
              />
            </div>

            {settings.use_vwap && (
              <div className="space-y-4 pt-4 border-t border-cyan-500/20">
                <div>
                  <Label className="text-cyan-200 mb-2 block">
                    Lookback Periods: <span className="text-cyan-400 font-bold">{num("vwap_lookback_periods", 20)}</span>
                  </Label>
                  <Slider
                    value={[num("vwap_lookback_periods", 20)]}
                    onValueChange={(v) => set("vwap_lookback_periods", v[0])}
                    min={5}
                    max={50}
                    step={5}
                    className="mb-2 [&>.relative>.bg-primary]:bg-cyan-500 [&>.block]:border-cyan-500"
                  />
                  <p className="text-xs text-cyan-400/60">Number of periods used to calculate VWAP</p>
                </div>

                <div>
                  <Label className="text-cyan-200 mb-2 block">
                    Participation Rate: <span className="text-cyan-400 font-bold">{num("vwap_participation_rate", 10)}%</span> of market volume
                  </Label>
                  <Slider
                    value={[num("vwap_participation_rate", 10)]}
                    onValueChange={(v) => set("vwap_participation_rate", v[0])}
                    min={1}
                    max={30}
                    step={1}
                    className="mb-2 [&>.relative>.bg-primary]:bg-cyan-500 [&>.block]:border-cyan-500"
                  />
                  <p className="text-xs text-cyan-400/60">Target percentage of market volume to participate in</p>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </>
  );
}