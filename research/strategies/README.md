# Strategy research

How the signal rules were tested (ADR-035). Read-only on Supabase: the scripts read `web/.env.local` for the
symbol list and the live-candle copy and never write to the database. Prices come from Yahoo Finance (personal,
non-commercial use) and stay in the git-ignored `data/` folder.

```bash
pip install pandas pyarrow yfinance scikit-learn
cd research/strategies
python download.py ../..          # 7 years of daily candles, today's top 500 + Nifty 50 / Nifty 500 -> data/
cp ../../kk_eod_results_fixed.json data/  # KK's stored 20-year record (diagnose.py, adaptive.py)
```

Long history (India VIX and Nifty 50 since 2005, for the market weather):

```python
import yfinance as yf
d = yf.download(["^NSEI", "^INDIAVIX"], start="2005-01-01", auto_adjust=True, group_by="ticker")
for t in ("^NSEI", "^INDIAVIX"):
    d[t].dropna(how="all").reset_index().to_parquet(f"data/{t[1:]}_long.parquet", index=False)
```

| script | what it answers |
| --- | --- |
| `backtest.py` | 10 candidate rules vs a random entry: trade results and the edge over the average stock, design 2019–23 / check 2024–26 |
| `portfolio.py`, `fair.py` | 10-slot portfolios vs the Nifty and vs holding the same stocks; a point-in-time stock list (each year's top 300 by traded value) to remove hindsight |
| `diagnose.py` | where today's three rules go wrong, by market weather, VIX, the stock's trend and swing; KK's stored record |
| `adaptive.py`, `assurance.py` | market-aware versions of the three rules and the Strong trend candidates, fairly measured |
| `signals.py`, `engine.py` | every signal with its context; the walk-forward signal checker (retrained each quarter on graded signals only) |
| `record.py`, `stops.py` | the tested record of the exact Strong trend rule (numbers in `web/src/lib/strong-trend.ts`) and the stop comparison |
| `improve.py`, `improve2.py`, `improve3.py` | fixing RSI reversal and KK: pre-registered variants, strict fills (0.2 % through a dip price), safety stops, year by year, overlap between the two fixes |
| `improve_short.py`, `record_dip.py` | KK short variants (none made money after costs); the tested record of the two dip rules (numbers in `web/src/lib/dip-rules.ts`); `record_dip.py --live` writes the expected dip signals for the live cross-check |
| `improve_lr.py`, `record_lr.py`, `pglite_ma200.mjs`, `report_ma200.py` | 200-day trend (ADR-040): 48 pre-written variants of the 200-day average + regression-line rule; the chosen rule's record, round-2 add-ons, a random day above the 200-day, years, weather, overlap; `record_lr.py --live` and `pglite_ma200.mjs` for the live cross-check; the owner report |
| `breakout_secular.py`, `report_breakout.py` | The owner's breakout confirmation on Secular trend (9 Nov 2026): buy only after a close above the signal day's high within 5 / 10 (main) / 20 / 60 sessions, same stop and 60-session exit, against the rule as now and random days below -150 (`data/secular_breakout.json`); `report_breakout.py` builds the owner PDF. Result: small, unproven gain in 2024-26; the rule is unchanged |
| `early_entry.py` | The owner's USP check (12 Nov 2026): does each live rule enter before the next 50-day breakout (also 20 / 250), at a lower price, against random days? (`data/early_entry.json`). Result: every rule precedes a breakout, but so do ~99% of random days; head start 3–11%; five of six no earlier than random; Strong trend is itself a breakout |
| `pre_breakout.py` | A candidate "Pre-breakout" rule built for that claim (12 Nov 2026): 14 pre-written variants (within 3/5/8% of the 50-day high, uptrend, quiet range, volume dry-up, relative strength) vs random uptrend days and vs the analyst who buys the breakout (`data/pre_breakout.json`). Chosen P05 passed 2019-23 but failed the 2024-26 check (mean −1.0%, below random); not used |
| `report_secular.py` | The owner PDF on Secular trend: tested record, random-day yardstick, first live trades (`data/secular_live_trades.json`, a read-only snapshot) |
| `record_secular.py`, `pglite_secular.mjs` | Secular trend live (ADR-051): the tested record of the exact rule (`data/secular_record.json`); `--live` writes the signals the SQL must give on the live-candle copy, and `pglite_secular.mjs` runs migration 55 on PGlite for the comparison |
| `secular_trend.py` | "Secular trend" (ADR-049 round 2): Special K renamed, signal 50/50, the -150 line read both ways (above, below), with the random-day yardstick on the same side of -150 (`data/secular_summary.csv`, `data/secular_report.json`) |
| `download_long.py`, `specialk.py` | Pring's Special K (ADR-049, shelved): prices from 2010 for the 725-session warm-up (`data/candles_long.parquet`); 24 pre-written variants of the owner's rule (Special K crosses its 50/50 signal line while flat or rising), the chosen one's years, a random entry with the same plan (`data/specialk_summary.csv`, `data/specialk_report.json`) |
| `improve_sma.py`, `record_sma.py` | SMA 20/50: 24 pre-written variants; the exact SMA 20/50 trend rule's record and one consistent before/after table for all four rules (`data/final_report.json`); `record_sma.py --live` for the live cross-check |
| `dump_live.py`, `expect_live.py`, `pglite_live.mjs` | a read-only copy of the live candles, an independent Python version of migration 33, and the SQL run on PGlite: both must produce the same signals |

Rules of the house: choose on the design years, report the check years; compare with random entries and with holding
the same stocks; include costs (0.5 % round trip); never drop a losing signal from a record; say "tested on past
prices", never "will".
