import { createClientFromRequest } from 'npm:@base44/sdk@0.8.43';

/**
 * Signal Calibration
 *
 * Reads every resolved SignalOutcome for the calling user, fits a logistic
 * regression of outcome (1 = profitable close, 0 = loss) on signal strength
 * (0-100), and stores the model in CalibrationModel.
 *
 * Also returns calibration buckets — the actual win rate inside each strength
 * band — so the UI can show a reliability diagram. Of the signals scored at 70,
 * roughly 70% should have won; if not, the model is not calibrated and the
 * strength number should not be read as a probability.
 *
 * Requires at least MIN_SAMPLE resolved outcomes before fitting. Below that
 * the function returns the existing model (or a null model) without refitting,
 * because a model fit on a handful of trades is noise.
 */

const MIN_SAMPLE = 20;
const LEARNING_RATE = 0.01;
const ITERATIONS = 2000;
const BUCKETS = [
  { label: '50-60', min: 50, max: 60 },
  { label: '60-70', min: 60, max: 70 },
  { label: '70-80', min: 70, max: 80 },
  { label: '80-90', min: 80, max: 90 },
  { label: '90-100', min: 90, max: 100 },
];

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    let caller;
    try {
      caller = await base44.auth.me();
    } catch {
      return Response.json({ error: 'Authentication required' }, { status: 401 });
    }
    if (!caller) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user_email = caller.email;

    // Pull every resolved outcome for this user. The entity is RLS-scoped to
    // owner_email, so asServiceRole reads all and we filter by owner_email
    // to be explicit (the worker writes owner_email on every record).
    const all = await base44.asServiceRole.entities.SignalOutcome.list('-entry_time', 500);
    const resolved = (all || []).filter(
      (r) => r.resolved && r.owner_email === user_email && typeof r.outcome === 'number'
    );

    // Load any existing model so we can return it when the sample is too small.
    let existing = null;
    try {
      const models = await base44.asServiceRole.entities.CalibrationModel.list('-fitted_at', 10);
      existing = (models || []).find((m) => m.owner_email === user_email) || null;
    } catch (e) {
      console.warn('CalibrationModel read failed:', e.message);
    }

    if (resolved.length < MIN_SAMPLE) {
      return Response.json({
        success: true,
        refit: false,
        reason: 'insufficient_sample',
        sample_size: resolved.length,
        min_sample: MIN_SAMPLE,
        model: existing
          ? { intercept: existing.intercept, slope: existing.slope }
          : null,
        message: `Need at least ${MIN_SAMPLE} resolved trades to fit a model. Currently have ${resolved.length}.`,
      });
    }

    // --- Fit logistic regression: P(win) = sigmoid(intercept + slope * strength) ---
    const strengths = resolved.map((r) => r.signal_strength);
    const outcomes = resolved.map((r) => r.outcome);
    const n = strengths.length;

    let intercept = 0;
    let slope = 0;

    for (let iter = 0; iter < ITERATIONS; iter++) {
      let gIntercept = 0;
      let gSlope = 0;
      for (let j = 0; j < n; j++) {
        const z = intercept + slope * strengths[j];
        const p = 1 / (1 + Math.exp(-z));
        const err = p - outcomes[j];
        gIntercept += err;
        gSlope += err * strengths[j];
      }
      intercept -= LEARNING_RATE * (gIntercept / n);
      slope -= LEARNING_RATE * (gSlope / n);
    }

    // --- Calibration buckets: actual win rate per strength band ---
    const buckets = BUCKETS.map((b) => {
      const inBand = resolved.filter(
        (r) => r.signal_strength >= b.min && r.signal_strength < b.max
      );
      const count = inBand.length;
      const wins = inBand.filter((r) => r.outcome === 1).length;
      const meanStrength =
        count > 0 ? inBand.reduce((s, r) => s + r.signal_strength, 0) / count : 0;
      const predictedWinRate =
        count > 0
          ? 1 / (1 + Math.exp(-(intercept + slope * meanStrength)))
          : 0;
      return {
        label: b.label,
        min_strength: b.min,
        max_strength: b.max,
        count,
        actual_win_rate: count > 0 ? wins / count : 0,
        predicted_win_rate: predictedWinRate,
        mean_strength: Math.round(meanStrength * 100) / 100,
      };
    }).filter((b) => b.count > 0);

    const winRate = outcomes.reduce((s, o) => s + o, 0) / n;

    // Upsert the model for this user.
    if (existing) {
      await base44.asServiceRole.entities.CalibrationModel.update(existing.id, {
        intercept,
        slope,
        sample_size: n,
        win_rate: winRate,
        fitted_at: new Date().toISOString(),
        calibration_buckets: buckets,
      });
    } else {
      await base44.asServiceRole.entities.CalibrationModel.create({
        intercept,
        slope,
        sample_size: n,
        win_rate: winRate,
        fitted_at: new Date().toISOString(),
        calibration_buckets: buckets,
        owner_email: user_email,
        created_by: user_email,
      });
    }

    return Response.json({
      success: true,
      refit: true,
      sample_size: n,
      win_rate: Math.round(winRate * 1000) / 1000,
      model: { intercept, slope },
      calibration_buckets: buckets,
      message: `Model fitted on ${n} resolved trades. Overall win rate ${(winRate * 100).toFixed(1)}%.`,
    });
  } catch (error) {
    console.error('Calibration error:', error);
    return Response.json({ error: 'Signal calibration failed' }, { status: 500 });
  }
});