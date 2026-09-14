import React, { useState, useCallback } from "react";
import { fetchKlines } from "@/lib/binanceMarketData";
import {
  heikinAshi, sslChannel, cmo, tmo, mfi, rsi, supplyDemandZones, atrPercent,
} from "@shared/trading/indicators";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Scan, X, TrendingUp, TrendingDown, Layers, Loader2, CheckCircle2 } from "lucide-react";
import {
  ComposedChart, Line, XAxis, YAxis, ResponsiveContainer, ReferenceArea, Tooltip, CartesianGrid,
} from "recharts";

// SP500 AI sub-components — each evaluates to true (bullish) / false (bearish) / null (no data).
const SUB_COMPONENTS = [
  {
    key: "sp500ai_ha", name: "Heikin Ashi",
    eval: (candles) => {
      const ha = heikinAshi(candles);
      if (!ha.length) return null;
      const last = ha[ha.length - 1];
      return last.close > last.open;
    },
  },
  {
    key: "sp500ai_ssl", name: "SSL Channel",
    eval: (candles) => {
      const ssl = sslChannel(candles);
      return ssl ? ssl.bullish : null;
    },
  },
  {
    key: "sp500ai_cmo", name: "CMO",
    eval: (candles) => {
      const c = cmo(candles);
      return c === null ? null : c > 0;
    },
  },
  {
    key: "sp500ai_airsi", name: "RSI",
    eval: (candles) => {
      const r = rsi(candles);
      return r === null ? null : r > 50 && r <= 90;
    },
  },
  {
    key: "sp500ai_tmo", name: "TMO",
    eval: (candles) => {
      const t = tmo(candles);
      return t ? t.bullish : null;
    },
  },
  {
    key: "sp500ai_mf", name: "Money Flow",
    eval: (candles) => {
      const m = mfi(candles);
      return m === null ? null : m > 50 && m <= 95;
    },
  },
];

function parseCandles(rawKlines) {
  if (!rawKlines) return null;
  return rawKlines
    .map((k) => ({
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
      closeTime: parseInt(k[6]),
    }))
    .filter((c) => Number.isFinite(c.close) && c.close > 0);
}

/**
 * Check whether an asset meets the confluence criteria:
 *  1. ALL enabled SP500 AI sub-components point the same way (all bullish → buy, all bearish → sell).
 *  2. Price is within ~2 ATR of an unmitigated supply or demand zone.
 * Returns null if either condition fails.
 */
function checkConfluence(candles, indicatorSettings) {
  const enabled = SUB_COMPONENTS.filter((s) => indicatorSettings[s.key] !== false);
  if (enabled.length === 0) return null;

  const results = enabled.map((s) => ({ name: s.name, key: s.key, bull: s.eval(candles) }));

  // Every sub-component must have produced a definitive reading.
  if (results.some((r) => r.bull === null)) return null;

  const allBull = results.every((r) => r.bull === true);
  const allBear = results.every((r) => r.bull === false);
  if (!allBull && !allBear) return null;

  const sd = supplyDemandZones(candles);
  if (!sd) return null;

  const vol = atrPercent(candles) ?? 0.02;
  const proximity = 2 * vol;
  const price = sd.price;

  let zoneType = null;
  let zone = null;

  if (sd.nearestDemand) {
    const dist = Math.abs(price - sd.nearestDemand.top) / price;
    if (dist / vol <= proximity) { zoneType = "demand"; zone = sd.nearestDemand; }
  }
  if (!zoneType && sd.nearestSupply) {
    const dist = Math.abs(price - sd.nearestSupply.bottom) / price;
    if (dist / vol <= proximity) { zoneType = "supply"; zone = sd.nearestSupply; }
  }
  if (!zoneType) return null;

  return {
    direction: allBull ? "buy" : "sell",
    components: results,
    zoneType,
    zone,
    price,
    zones: sd.zones,
  };
}

function MiniChart({ candles, zone, zoneType }) {
  const recent = candles.slice(-60);
  const data = recent.map((c) => ({
    time: new Date(c.closeTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    close: c.close,
  }));

  return (
    <ResponsiveContainer width="100%" height={140}>
      <ComposedChart data={data} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
        <XAxis dataKey="time" tick={{ fill: "#94a3b8", fontSize: 10 }} interval="preserveStartEnd" minTickGap={40} />
        <YAxis domain={["auto", "auto"]} tick={{ fill: "#94a3b8", fontSize: 10 }} width={50} tickFormatter={(v) => `$${Number(v).toFixed(v < 1 ? 4 : 0)}`} />
        <Tooltip
          contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, fontSize: 12 }}
          labelStyle={{ color: "#94a3b8" }}
          formatter={(v) => [`$${Number(v).toFixed(4)}`, "Close"]}
        />
        {zone && (
          <ReferenceArea
            y1={zone.bottom}
            y2={zone.top}
            fill={zoneType === "demand" ? "#22c55e" : "#ef4444"}
            fillOpacity={0.15}
            stroke={zoneType === "demand" ? "#22c55e" : "#ef4444"}
            strokeOpacity={0.4}
            strokeDasharray="4 2"
          />
        )}
        <Line type="monotone" dataKey="close" stroke="#6366f1" strokeWidth={2} dot={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export default function ConfluenceSignalScanner({ assets, indicatorSettings }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [signals, setSignals] = useState([]);
  const [scannedCount, setScannedCount] = useState(0);

  const sp500Enabled = indicatorSettings?.sp500ai !== false;
  const sdEnabled = indicatorSettings?.supply_demand !== false;

  const canScan = sp500Enabled && sdEnabled;

  const runScan = useCallback(async () => {
    setIsOpen(true);
    setIsScanning(true);
    setSignals([]);
    setScannedCount(0);

    // Top 20 by volume — keeps the scan fast and within OKX rate limits.
    const topAssets = [...assets]
      .sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0))
      .slice(0, 20);

    setProgress({ done: 0, total: topAssets.length });
    const found = [];

    for (let i = 0; i < topAssets.length; i++) {
      const asset = topAssets[i];
      try {
        const raw = await fetchKlines(`${asset.symbol}USDT`, "1h", 200);
        const candles = parseCandles(raw);
        if (candles && candles.length >= 60) {
          const result = checkConfluence(candles, indicatorSettings);
          if (result) {
            found.push({ asset, result, candles });
          }
        }
      } catch (err) {
        console.warn(`Confluence scan: ${asset.symbol} failed — ${err.message}`);
      }

      setProgress({ done: i + 1, total: topAssets.length });
      setScannedCount(i + 1);
      // Small delay to respect OKX rate limits.
      if (i < topAssets.length - 1) await new Promise((r) => setTimeout(r, 250));
    }

    setSignals(found);
    setIsScanning(false);
  }, [assets, indicatorSettings]);

  return (
    <>
      <Button
        onClick={runScan}
        disabled={!canScan}
        size="lg"
        className={`font-bold ${canScan ? "bg-gradient-to-br from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white" : "bg-slate-700 text-slate-500 cursor-not-allowed"}`}
        title={!canScan ? "Enable SP500 AI and Supply & Demand in indicator settings to use this scan" : "Scan for assets where all SP500 AI components align at a supply/demand zone"}
      >
        <Scan className="w-5 h-5 mr-2" />
        Confluence Scan
      </Button>

      <Dialog open={isOpen} onOpenChange={(open) => { if (!isScanning) setIsOpen(open); }}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl">
              <Layers className="w-5 h-5 text-emerald-400" />
              SP500 AI × Supply/Demand Confluence
            </DialogTitle>
            <p className="text-sm text-slate-400">
              Scans the top 20 assets by volume. A signal fires when every enabled SP500 AI sub-component
              points the same way AND price sits at an unmitigated supply or demand zone.
            </p>
          </DialogHeader>

          {!canScan && (
            <div className="bg-amber-500/10 border border-amber-500/40 rounded-lg p-4 text-sm text-amber-300">
              Enable <strong>SP500 AI</strong> and <strong>Supply &amp; Demand Zones</strong> in the
              indicator settings (gear icon) to run this scan.
            </div>
          )}

          {isScanning && (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <Loader2 className="w-8 h-8 text-emerald-400 animate-spin" />
              <p className="text-slate-300 font-medium">
                Scanning {progress.done} / {progress.total} assets…
              </p>
              <div className="w-full max-w-sm bg-slate-800 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-emerald-500 h-full transition-all duration-300"
                  style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
                />
              </div>
            </div>
          )}

          {!isScanning && signals.length === 0 && scannedCount > 0 && (
            <div className="flex flex-col items-center justify-center py-12 gap-2 text-center">
              <CheckCircle2 className="w-8 h-8 text-slate-500" />
              <p className="text-slate-400">
                Scanned {scannedCount} assets. No confluence signals right now —
                all SP500 AI components are not yet aligned at a zone for any asset.
              </p>
            </div>
          )}

          {!isScanning && signals.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/40">
                  {signals.length} signal{signals.length !== 1 ? "s" : ""} found
                </Badge>
              </div>
              {signals.map(({ asset, result, candles }) => (
                <div
                  key={asset.symbol}
                  className="bg-slate-800/60 border border-slate-700 rounded-xl p-4"
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center font-bold ${result.direction === "buy" ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"}`}>
                        {result.direction === "buy" ? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />}
                      </div>
                      <div>
                        <div className="font-bold text-lg">{asset.symbol}</div>
                        <div className="text-sm text-slate-400">${result.price.toFixed(result.price < 1 ? 6 : 2)}</div>
                      </div>
                    </div>
                    <Badge className={result.direction === "buy" ? "bg-green-600 text-white" : "bg-red-600 text-white"}>
                      {result.direction === "buy" ? "BUY" : "SELL"}
                    </Badge>
                  </div>

                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {result.components.map((c) => (
                      <span
                        key={c.key}
                        className={`text-xs px-2 py-1 rounded-md font-medium ${
                          c.bull ? "bg-green-500/15 text-green-400 border border-green-500/30" : "bg-red-500/15 text-red-400 border border-red-500/30"
                        }`}
                      >
                        {c.name} {c.bull ? "↑" : "↓"}
                      </span>
                    ))}
                  </div>

                  <div className="flex items-center gap-2 mb-3 text-sm">
                    <Layers className="w-4 h-4 text-emerald-400" />
                    <span className="text-slate-300">
                      At unmitigated <strong className={result.zoneType === "demand" ? "text-green-400" : "text-red-400"}>
                        {result.zoneType}
                      </strong> zone
                    </span>
                    <span className="text-slate-500">
                      (${result.zone.bottom.toFixed(result.price < 1 ? 6 : 2)}–${result.zone.top.toFixed(result.price < 1 ? 6 : 2)})
                    </span>
                  </div>

                  <MiniChart candles={candles} zone={result.zone} zoneType={result.zoneType} />
                </div>
              ))}
            </div>
          )}

          {!isScanning && (
            <div className="flex justify-end pt-2">
              <Button variant="outline" onClick={() => setIsOpen(false)} className="border-slate-600 text-slate-300">
                <X className="w-4 h-4 mr-2" />
                Close
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}