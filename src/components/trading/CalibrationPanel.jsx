import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Target, RefreshCw, TrendingUp, TrendingDown, Info } from "lucide-react";

/**
 * Signal Calibration Panel
 *
 * Shows whether the signal engine's 0-100 strength scores actually predict
 * profitable trades. Reads the fitted CalibrationModel (logistic regression
 * of outcome on strength) and the calibration buckets (actual win rate per
 * strength band). A "Recalibrate" button invokes the calibrateSignals backend
 * function to refit on the latest resolved trades.
 */
export default function CalibrationPanel() {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState(null);

  // Latest fitted model for this user
  const { data: models = [], isLoading: isLoadingModels } = useQuery({
    queryKey: ["calibration-models"],
    queryFn: () => base44.entities.CalibrationModel.list("-fitted_at", 5),
    staleTime: 30_000,
  });

  // RLS filters to the calling user's own models, so the first result is theirs.
  const myModel = models?.[0] || null;

  // Count of resolved + open signal-outcomes, for context
  const { data: outcomes = [] } = useQuery({
    queryKey: ["signal-outcomes-summary"],
    queryFn: () => base44.entities.SignalOutcome.list("-entry_time", 500),
    staleTime: 30_000,
  });

  const resolvedCount = (outcomes || []).filter((o) => o.resolved).length;
  const openCount = (outcomes || []).filter((o) => !o.resolved).length;

  const recalibrateMutation = useMutation({
    mutationFn: () => base44.functions.invoke("calibrateSignals", {}),
    onSuccess: (res) => {
      setMessage(res?.message || "Calibration complete.");
      queryClient.invalidateQueries({ queryKey: ["calibration-models"] });
      queryClient.invalidateQueries({ queryKey: ["signal-outcomes-summary"] });
    },
    onError: (err) => setMessage("Calibration failed: " + (err.message || "unknown error")),
  });

  // Turn a strength score into a win probability using the fitted model
  const probabilityFor = (strength) => {
    if (!myModel) return null;
    const z = myModel.intercept + myModel.slope * strength;
    return 1 / (1 + Math.exp(-z));
  };

  return (
    <Card className="bg-slate-900 border-slate-700">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-white flex items-center gap-2">
            <Target className="w-5 h-5 text-emerald-400" />
            Signal Calibration
          </CardTitle>
          <Button
            onClick={() => recalibrateMutation.mutate()}
            disabled={recalibrateMutation.isPending}
            size="sm"
            className="bg-emerald-600 hover:bg-emerald-700 text-white border-0"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${recalibrateMutation.isPending ? "animate-spin" : ""}`} />
            Recalibrate
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Status row */}
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Badge className="bg-slate-700 text-slate-200 border-slate-600">
            {resolvedCount} resolved
          </Badge>
          <Badge className="bg-indigo-500/20 text-indigo-300 border-indigo-500/40">
            {openCount} open
          </Badge>
          {myModel && (
            <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/40">
              Model fitted on {myModel.sample_size} trades
            </Badge>
          )}
        </div>

        {/* Message */}
        {message && (
          <div className="p-3 rounded-lg bg-slate-800 border border-slate-700 text-sm text-slate-300">
            {message}
          </div>
        )}

        {/* No model yet */}
        {!myModel && !isLoadingModels && (
          <div className="p-4 rounded-lg bg-slate-800/50 border border-slate-700 flex items-start gap-3">
            <Info className="w-5 h-5 text-slate-400 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-slate-300">
              No calibration model yet. The auto-trader logs every entry signal and its
              outcome as trades close. Once you have at least 20 resolved trades, click
              <span className="text-emerald-400 font-medium"> Recalibrate </span>
              to fit a logistic regression that turns the 0-100 strength score into a
              real win probability.
            </div>
          </div>
        )}

        {/* Live indicator */}
        {myModel && (
          <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-start gap-2">
            <Target className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-emerald-200/90">
              <span className="font-semibold">Live:</span> the auto-trader now gates new entries on
              the calibrated win-probability from this model instead of raw strength. If the model
              is deleted or refitted, the next worker cycle picks up the change automatically.
            </p>
          </div>
        )}

        {/* Model summary */}
        {myModel && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-slate-800 rounded-lg p-3">
              <div className="text-xs text-slate-400 mb-1">Overall Win Rate</div>
              <div className="text-lg font-bold text-white">
                {((myModel.win_rate ?? 0) * 100).toFixed(1)}%
              </div>
            </div>
            <div className="bg-slate-800 rounded-lg p-3">
              <div className="text-xs text-slate-400 mb-1">Sample Size</div>
              <div className="text-lg font-bold text-white">{myModel.sample_size}</div>
            </div>
            <div className="bg-slate-800 rounded-lg p-3">
              <div className="text-xs text-slate-400 mb-1">Slope</div>
              <div className="text-lg font-bold text-white">
                {myModel.slope >= 0 ? "+" : ""}{myModel.slope.toFixed(4)}
              </div>
            </div>
            <div className="bg-slate-800 rounded-lg p-3">
              <div className="text-xs text-slate-400 mb-1">P(win) at 70 strength</div>
              <div className="text-lg font-bold text-white">
                {probabilityFor(70) !== null ? (probabilityFor(70) * 100).toFixed(0) + "%" : "—"}
              </div>
            </div>
          </div>
        )}

        {/* Reliability diagram — actual vs predicted per bucket */}
        {myModel?.calibration_buckets?.length > 0 && (
          <div>
            <div className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-indigo-400" />
              Reliability — actual win rate per strength band
            </div>
            <div className="space-y-2">
              {myModel.calibration_buckets.map((b, i) => {
                const actualPct = (b.actual_win_rate ?? 0) * 100;
                const predictedPct = (b.predicted_win_rate ?? 0) * 100;
                const gap = Math.abs(actualPct - predictedPct);
                const wellCalibrated = gap < 10;
                return (
                  <div key={i} className="flex items-center gap-3">
                    <div className="w-16 text-xs text-slate-400 flex-shrink-0">{b.label}</div>
                    <div className="flex-1 relative h-7 bg-slate-800 rounded-lg overflow-hidden">
                      {/* Actual bar */}
                      <div
                        className={`absolute left-0 top-0 h-full ${wellCalibrated ? "bg-emerald-500/60" : "bg-amber-500/60"} flex items-center justify-end pr-2`}
                        style={{ width: `${Math.max(actualPct, 3)}%` }}
                      >
                        <span className="text-xs text-white font-medium">{actualPct.toFixed(0)}%</span>
                      </div>
                    </div>
                    <div className="w-24 text-xs text-slate-400 flex-shrink-0 text-right">
                      {b.count} trades
                    </div>
                    <div className={`w-20 text-xs flex-shrink-0 text-right ${wellCalibrated ? "text-emerald-400" : "text-amber-400"}`}>
                      {wellCalibrated ? "calibrated" : `off by ${gap.toFixed(0)}%`}
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-slate-500 mt-2">
              Each bar is the actual win rate for trades scored in that band. A
              well-calibrated model has the bar length match the strength number
              (e.g. the 70-80 band should win ~75% of the time).
            </p>
          </div>
        )}

        {/* Honest disclaimer */}
        <div className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/20 flex items-start gap-2">
          <Info className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-amber-200/80">
            Calibration is only as good as the sample. Below 50 resolved trades the
            model is noisy; below 20 it won't fit at all. Keep the auto-trader running
            and re-fit periodically as more trades close.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}