# CryptoMate — Migration Guide

Everything from the review has been implemented. This is what changed, what you
need to do to deploy it, and what I could not verify from here.

---

## Deploy checklist

Do these in order. Steps 1 and 2 will break the app if skipped.

### 1. Set the encryption key

The credentials function refuses to store anything without it.

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Set the output as `EXCHANGE_ENCRYPTION_KEY` in your Base44 environment.

Losing this key makes every stored credential permanently unreadable. That is
by design — there is no recovery path, and there should not be one.

### 2. Migrate the entity schemas

`base44/entities/` has been updated. Apply them, then note:

- **`ExchangeConnection` no longer has `api_key` / `api_secret`.** Existing rows
  hold base64 strings that the new code will not read. Those credentials should
  be treated as compromised regardless — they were stored recoverably. Revoke
  them on the exchange and re-add through the new flow.
- **`AutoTradingSettings`** gains `kill_switch_enabled`, `daily_counters_date`,
  `daily_start_equity`, `run_lock_until`, `risk_per_trade_percent`,
  `atr_stop_multiplier`, `max_gross_exposure_percent`, `max_correlation`,
  `indicator_settings`.
- **`Trade`** gains `fee`, `slippage_percent`, `gross_profit_loss`.

### 3. Sync shared modules and deploy

```bash
npm run sync:functions   # copies shared/trading into each function bundle
npm test                 # 64 tests, should be all green
npm run build
```

`prebuild` runs the sync automatically, so `npm run build` alone is enough in CI.

### 4. Reset paper portfolios

Historical P&L was computed with the broken formula and the lost-write race, so
existing balances are wrong in ways that cannot be reconstructed. Start the
paper portfolios from a clean balance or the new metrics inherit old errors.

### 5. Verify before enabling

```
kill_switch_enabled = true
```

Leave it on. Run the worker manually once and read the logs. You want to see
real symbols and real strengths, and `dataSource: "binance_ohlcv"` in the
response. Only then flip the switch off.

---

## Architecture

```
shared/trading/          ← single source of truth
├── marketData.js        real OHLCV, universe, order books. No synthetic fallback.
├── indicators.js        RSI/MACD/BB/Stoch/ATR/HA/SSL/MFI/CMO on real OHLCV
├── signalEngine.js      deterministic scoring, no randomness
├── costs.js             fees, spread, order-book slippage
├── sizing.js            ATR sizing, correlation and exposure caps
├── risk.js              daily limits, rollover, kill switch, schedule
├── portfolio.js         state machine, correct P&L, single write
└── backtest.js          bar-by-bar replay, no look-ahead

    ↓ @shared alias (Vite)          ↓ npm run sync:functions
  browser engine + backtester     base44/functions/*/shared/
```

The browser engine, the backtester and the server worker now run the *same*
code. That is the point: previously the browser enforced risk limits the server
ignored, and the backtester implemented a third, unrelated strategy.

---

## What changed, by review item

| # | Issue | Fix |
|---|-------|-----|
| 1 | Signals on `Math.random()` history | Real Binance klines; `generateSyntheticHistory` now throws |
| 2 | Risk limits unenforced server-side | `evaluateAllGuards()` runs before market data; UTC rollover; kill switch |
| 3 | Stale-read race lost proceeds | One in-memory state object, one write at end of run |
| 4 | Wrong P&L formula | `qty × (exit − entry) − fees`; equity derived, not accumulated |
| 5 | No fees or slippage | `costs.js` on every fill, with order-book walking |
| 6 | Backtester tested nothing | Real candles, shared signal code, no look-ahead, benchmark |
| 7 | Base64 "encryption" | AES-GCM server-side; withdraw-enabled keys rejected |
| 8 | Random sentiment at 30% weight | Weight defaults to 0; pluggable real provider |
| 9 | "Confidence" implied probability | Renamed to strength, rendered `/100`; `calibrate()` stub documented |
| 10 | Flat sizing, no correlation check | ATR sizing, correlation gate, gross exposure cap |

### Details worth knowing

**Exits always run.** The daily trade cap blocks *new entries* only. A stop-loss
has to be able to fire on trade number 11, so the guard returns
`newEntriesAllowed: false` rather than halting the cycle.

**Fail closed.** If `daily_start_equity` is unknown, the loss limit reports
breached. A risk control that cannot be evaluated must block, not wave trades
through.

**No fallback to fake data, anywhere.** V4 responded to a CoinGecko failure by
generating ten fake coins with random prices and trading them. The new worker
aborts the run. Same in the backtester: it fails with an error rather than
inventing history.

**Universe scan is 2 calls, not 250.** One `/ticker/24hr` call ranks the whole
exchange; only the top candidates get a klines request. V4's design would have
timed out fetching 250 candle sets.

**Stop priority in the backtest.** When a bar's range spans both stop and
target, the stop is assumed to have filled. Without tick data you cannot know
the order, and assuming the favourable one is how backtests manufacture returns.

---

## Things I could not verify from here

Three, stated plainly:

1. **Live API calls.** My sandbox blocks `api.binance.com`, so `fetchUniverse`,
   `fetchCandles` and the signed validation call are untested against the real
   endpoints. The logic is tested; the wire format is not. Run the worker
   manually once with the kill switch on and read the logs before trusting it.

2. **Whether Base44 bundles the `./shared/` relative import.** The sync script
   copies the modules into each function directory so the import is local rather
   than crossing a directory boundary, which should work. If the deploy fails on
   module resolution, the fallback is inlining the modules into `entry.ts`.

3. **The concurrency lease is best-effort, not a mutex.** Base44 has no
   compare-and-swap, so there is a small window between reading and writing
   `run_lock_until` where two runs could both proceed. It is much better than
   V4 (which had nothing), but if you later see duplicate fills, that window is
   why, and the real fix is an atomic operation at the database level.

---

## Still worth doing

Not bugs, but the next things I would pick up:

- **Calibrate the strength score.** `calibrate()` in `signalEngine.js` is a
  documented stub. Log every signal with its eventual outcome, fit a logistic
  regression, check calibration on held-out data. Only then does a probability
  belong in the UI.
- **Fit the component weights.** They are still hand-picked constants — better
  reasoned than V4's, but not derived from data.
- **Real sentiment, or delete the feature.** CryptoPanic or LunarCrush, or use
  the `InvokeLLM` integration over real headlines.
- **Walk-forward testing.** `splitTrainTest()` is there. Tune on train, evaluate
  *once* on test. If you tune, peek at test, and re-tune, the test set is
  training data now and the out-of-sample guarantee is gone.
- **Migrate remaining components.** `AltcoinScanner`, `PredictiveModels`,
  `AnomalyDetection` and `NewsWidget` still contain `Math.random()`. They are
  display-only and do not drive trades, but they present invented numbers as
  analysis.

---

## The part the code cannot fix

The system is now correct: it measures honestly, it will not trade on invented
data, and it will stop when it should. That was the goal and it is met.

It is still not a profitable strategy, and nothing in this diff made it one. The
approach — rank liquid assets by a weighted momentum-and-indicator score, exit
at a fixed stop and target — is among the most widely deployed retail strategies
there is. It will now generate real signals from real data, and those signals
may well have no edge after costs.

The difference is that you can now find out. Run it in paper mode until you have
200+ trades, then compare against the buy-and-hold benchmark the backtester
reports for the same window and the same assets. If it does not beat that, the
strategy needs changing — and now the numbers will actually tell you so, which
before they could not.

---

# Update — auto-trades not firing

Three independent bugs, each sufficient on its own to prevent every trade.

## 1. The strength score could never reach the threshold (my bug)

`min_confidence` defaults to **70**. Measured across every market regime, the
scorer's ceiling was **56**. Zero trades was guaranteed by construction.

The components contradicted each other. `trendComponent` correctly scored a
strong uptrend at 75, but RSI above 70 took −15 as "overbought", Stochastic
above 80 took −8, MFI above 80 took −10, and price in the upper Bollinger zone
took −5. Three of four components penalised exactly the conditions a momentum
strategy exists to buy. Everything landed near 50.

Those penalties are right for mean reversion. Yours is a momentum strategy, and
I gave it a scorer that flinched at strength.

**Fix:** the engine is now regime-aware. `detectRegime()` runs first, and each
oscillator is interpreted against it — in an established uptrend a high RSI
confirms, price riding the upper Bollinger band is strength rather than
over-extension, and strong money flow is confirmation. In a range, the
mean-reverting reading applies. The two are blended by trend conviction so
scores do not jump as the regime flips.

The SP500-AI composite had the same flaw in its vote conditions: CMO between 0
and 50, RSI between 50 and 70, MFI between 50 and 80. A strong uptrend exceeds
all three upper bounds, so the composite scored powerful trends as *bearish*.
Votes are now directional, excluding only genuine exhaustion.

Measured on 300 realistic GBM samples:

| Regime | mean | share clearing 70 |
|---|---|---|
| strong uptrend (+0.30%/hr) | 65.8 | 50% |
| mild uptrend (+0.10%/hr) | 59.8 | 37% |
| flat | 52.6 | 18% |
| mild downtrend | 49.8 | 20% |
| strong downtrend (−0.30%/hr) | 42.2 | 7% |

Monotonic, with real separation. **Leave `min_confidence` at 70** — it is now
both reachable and selective.

## 2. The bot could only trade while a browser tab was open

Binance returns HTTP 451 to Base44's servers. The workaround fed data from the
browser, but the scheduled 15-minute scan hit the geo-block and returned
without writing anything, so `ScanResult` was only ever written by
`AltcoinScanner.jsx` while someone had that page open. Overnight the worker had
no universe, no candles, and aborted every cycle.

**Fix:** `marketData.js` now runs a provider chain — Binance, then OKX, then
Coinbase — and uses whichever answers. OKX is the useful fallback: its symbols
map almost one-to-one (`BTCUSDT` → `BTC-USDT`) and it lists USDT spot pairs, so
results are normalised back to Binance-style symbols and nothing downstream
needs to know which exchange replied. The working provider is cached for ten
minutes so a blocked primary is not retried on every symbol.

The browser-fed path still works and takes precedence when present. It is no
longer the only path.

## 3. The slippage gate rejected everything (unit bug)

`scoreFromTicker` returned `atrPercent` as a percentage (`5.0` for 5%), but
`estimateSlippage` expects a fraction (`0.05`). The volatility term came out
~100× too large, pinned the estimate at its 5% cap, and every candidate failed
the 0.5% gate.

The formula was also wrong independently of units: it added `(atrPercent −
0.01)` raw, so even a correct 3% ATR produced ~2% estimated slippage. And the
impact term used a bare `sqrt(participation) × 0.5` with no volatility term,
which is not the square-root impact law.

**Fix:** unit corrected at source, with defensive normalisation in
`estimateSlippage` (anything above 1.0 cannot be a sane fraction). Impact is now
`atr × sqrt(participation)`, with spread widening as a small multiple of ATR.

| Scenario | before | after | gate at 0.5% |
|---|---|---|---|
| $500M major, 2% ATR, $1k | 2.12% | 0.09% | passes |
| $50M alt, 3% ATR, $1k | 2.27% | 0.12% | passes |
| thin $200k, 8% ATR, $1k | 5.00% | 0.78% | blocks (correctly) |

## Verification

`npm test` — 83 tests, all passing. Includes regression tests that pin each of
the three bugs, plus a provider-failover suite that verifies OKX and Coinbase
parsing against captured response shapes with Binance stubbed to fail.

End-to-end gate simulation: of 40 strong-uptrend candidates, 26 now open a
position. The other 14 are stopped only by strength legitimately below 70 — no
gate blocks spuriously.

## Still worth watching

**`max_correlation` at 0.8 is tight for crypto.** Majors routinely correlate
above 0.8 on hourly returns, so this may block positions 2 through 5 even when
each is a good setup. It was not a cause of zero trades — it only applies once
you hold something — but watch for `Skip X: correlated_with_Y` in the logs and
consider 0.85 if it fires constantly.

**Only the top 15 movers get real candles** in the browser-fed scanner path;
the rest fall back to `scoreFromTicker`, which needs a 24h move above 13.3% to
clear 70. With the provider chain working server-side this matters less, but it
is why scanner-sourced signals skew toward large movers.

**I could not test live API calls.** My sandbox blocks all three exchanges, so
provider parsing is verified against captured response shapes, not the live
wire. Run one cycle with the kill switch on and confirm the log line
`[marketData] using provider: okx` (or binance) before trusting it.
