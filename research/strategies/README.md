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
| `improve_sma.py`, `record_sma.py` | SMA 20/50: 24 pre-written variants; the exact SMA 20/50 trend rule's record and one consistent before/after table for all four rules (`data/final_report.json`); `record_sma.py --live` for the live cross-check |
| `dump_live.py`, `expect_live.py`, `pglite_live.mjs` | a read-only copy of the live candles, an independent Python version of migration 33, and the SQL run on PGlite: both must produce the same signals |

Rules of the house: choose on the design years, report the check years; compare with random entries and with holding
the same stocks; include costs (0.5 % round trip); never drop a losing signal from a record; say "tested on past
prices", never "will".
