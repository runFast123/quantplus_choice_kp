# Team brief: make the four live signal rules adapt to the market

You are one of four researchers. Each of you owns one adaptation method. You will compete on the same data with the same
scorer, then read each other's results, try to beat them, and agree on one design that we will build into the product.

## The product (what exists today)
QuantsPulse (Indian equities, NSE) shows research signals from four rules, all live:
- `strong_trend`: new 52-week closing high on >= 2x the 50-day average volume, close above the 50-day average, market
  "sunny" (Nifty 50 above its 200-day average with the 50-day above it, India VIX <= 22). Next-open entry, safety stop
  close - 4 x ATR14, exit at the stop or after 60 sessions.
- `sma_trend`: the 20-day average crosses above the 50-day, and the stock is a leader (126-session return in the top 30 %
  of the 500 largest companies that day). Same plan as strong_trend.
- `rsi_dip`: RSI(2) < 10 in a stock above its 200-day average; buy next session only at close - 1 x ATR14 (filled if the
  low trades 0.2 % through it); sell at the first close above the 5-day average, at most 10 sessions; stop 5 x ATR14.
- `kk_dip`: the low pushes >= 1 % under the previous 20-day low in a stock above its 200-day average; same plan as rsi_dip.
Exact code: `research/strategies/record.py` (strong), `record_sma.py` (`sma_trend_trades`), `record_dip.py` (`trades`).
In production the rules run in Postgres (SQL, `supabase/migrations/2026100100003[3-8]*.sql`) once a day after the close;
every signal is graded afterwards (`public.signal_outcomes`, `public.strategy_trade_results`).

## The goal
"Self-checking / auto-adaptive": each rule should adjust to the market of the moment so that more of the signals we show
make money, without overfitting. Industrial standard: walk-forward, no look-ahead, costs included, every trade counted,
robust to small changes, explainable to a beginner, and cheap to run daily.

## Data (read-only; already built)
Working directory: `research/strategies/` (run Python from there so `import signals` etc. work; Python 3.14 with pandas,
numpy, scikit-learn, pyarrow).
- `data/team_trades.parquet`: every trade of the four rules, Jul 2019 - Oct 2026, each year's point-in-time top 300 stocks,
  after a 0.5 % round-trip cost. Columns: rule, symbol, signal_date, entry_date, exit_date, net (fraction, after cost),
  how (STOP_HIT / REVIEW_60 / BOUNCE / TIME_10), days, and signal-day features: d200 d50 d20 slope200 rsi14 rsi2 atrpct
  volratio rs_rank r5 r20 r126 dist_hi252 clv gap sector_rank nifty_d200 nifty_r20 vix vix_chg5 wx (0 stormy, 1 mixed,
  2 sunny) breadth50 breadth200. 7,337 trades.
- `data/team_features.parquet`: the same features for every stock-day (to study the market, or to build new filters).
- `data/candles.parquet` (daily OHLCV, adjusted; symbols incl. ^NSEI, ^CRSLDX), `data/NSEI_long.parquet`,
  `data/INDIAVIX_long.parquet` (2005+), `data/universe.csv`. If you need to re-run a rule with other parameters, import
  `signals` (gives `signals.F.ALL` = {symbol: frame with indicators}, `signals.pit` = {year: set of symbols}); importing
  takes ~20 s.

## Rules of engagement (non-negotiable)
1. **Walk-forward only.** Evaluate on 2021-01-01 .. 2026-10-31, quarter by quarter. At the start of each quarter your method
   may use only what was known then: features up to each signal's date, and **outcomes only of trades whose exit_date is
   before the quarter starts** (no peeking at trades still open). Fit/choose using earlier data; never on the quarter you
   score.
2. **Score with `team/evaluate.py`** (import `evaluate` and call `report(decisions, name)`); do not write your own scorer.
   `decisions` is the trades frame (subset to signal_date >= 2021-01-01) with a boolean column `take` (and optional `size`
   in [0, 1]). If your method changes the rules' parameters, pass your own trades frame with the same columns.
3. **No new data sources, no writes anywhere outside `research/strategies/team/<your name>/`.** Do not touch the database,
   the app (`web/`), git, or other agents' folders. Read-only on everything else.
4. **Pre-register**: before running, write your planned variants in `team/<your name>/PLAN.md`. Report every variant you
   ran, including the losers. More than ~12 variants is data mining; say so if you go beyond.
5. **Be honest.** If your method does not beat the static rules out of sample, say so plainly. "Made money %" up while
   total profit collapses is not a win; say what you traded away.
6. Keep it buildable: it must run once a day after the close in Postgres SQL or in our Python pipeline (GitHub Actions,
   a few minutes), and a beginner must be able to understand what it does in one sentence.

## What to deliver (`team/<your name>/REPORT.md`, under ~700 words)
- Your method in two sentences, and the one-sentence beginner explanation.
- The evaluate.py table for your best variant AND the static baseline, all four rules, 2021–26 and 2024–26.
- Every variant you ran (one line each).
- Robustness: per-year results, sensitivity to your 1-2 key settings, number of tunable parameters.
- How it would run in production (SQL or Python, inputs, outputs, how often), and what could go wrong.
- Your honest verdict: adopt / adopt partly / do not adopt.
