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
