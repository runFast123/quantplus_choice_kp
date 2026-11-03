"""200-day trend (ADR-040): the tested record of the rule chosen by improve_lr.py, the checks around it, and (--live)
the expected signals of migration 41 on the read-only live-candle copy.

Chosen rule (improve_lr.py, 48 variants, chosen on 2019-07..2023-12):
  ma200_trend  the first session on which all three hold, after a session on which they did not:
                 1. the close is above the 200-day average close
                 2. the least-squares line through the last 100 values of that 200-day average is flat or rising:
                    its change over 20 sessions is at least -0.25 % of today's average
                 3. the last 100 closes lean up in a fairly straight line: Pearson's R of close against time >= 0.5
  plan         entry at the next open; safety stop = signal close - 4 x ATR14 (simple 14-day average true range);
               out at the stop (or the open, if it gaps under), otherwise the close of the 60th session. One trade per
               stock. (The same plan as Strong trend and SMA 20/50 trend.)
Round 2 (written before running, chosen the same way on 2019-23, kept only if 2024-26 does not get worse): the rule
plus the market not stormy, plus a leader (6-month return in the top 30 %), plus both.
Also: year by year, by market weather, a random entry on days the stock is above its 200-day average (same plan),
and how often a buy lands within 5 sessions of a Strong trend or SMA 20/50 trend buy in the same stock.
Point-in-time top 300 per year, 0.5 % round-trip cost, open trades left out.
"""
import json
import sys

import numpy as np
import pandas as pd

import adaptive as A
import backtest as B
import improve_lr as L
import record_sma as RS
import signals as S

COST = L.COST
IS_END = L.IS_END
FR = L.FR
for s, f in FR.items():
    f["wx"] = A.WX.reindex(pd.to_datetime(f.date), method="ffill").to_numpy()


def ma200_signal(f, extra=None):
    ok = (f.close > f.sma200) & (f.slope100 >= -0.25) & (f.r_px >= 0.5)
    if extra is not None:
        ok = ok & extra(f)
    ok = ok.fillna(False)
    known = (f.sma200.notna() & f.slope100.notna() & f.r_px.notna()).shift(fill_value=False)
    return (ok & ~ok.shift(fill_value=False) & known).to_numpy()


def collect(sig_fn, exit_="plan"):
    rows = []
    for s, f in FR.items():
        for i, d, net, how, days in L.trades(f, sig_fn(f), exit_):
            if d < B.START or s not in S.pit.get(d.year, ()) or how == "OPEN":
                continue
            rows.append((s, d, net, how, days, f.wx[i]))
    return pd.DataFrame(rows, columns=["symbol", "date", "net", "how", "days", "wx"])


def line(t):
    if t.empty:
        return "no trades"
    w = t.net > 0
    return f"{len(t):5d} made {100 * w.mean():4.1f}% avg {100 * t.net.mean():+5.2f}% median {100 * t.net.median():+5.2f}%"


EXTRAS = {
    "+not stormy": lambda f: f.wx != "stormy",
    "+leader": lambda f: f.rs_rank >= 0.7,
    "+both": lambda f: (f.wx != "stormy") & (f.rs_rank >= 0.7),
}


def expect_live():
    """Independent version of migration 41 on the read-only live-candle copy -> data/expected_ma200_signals.csv.
    Same arithmetic as the SQL: averages of exact closes, centred least-squares sums, Pearson's R from centred sums."""
    from decimal import ROUND_HALF_UP, Decimal
    c = pd.read_parquet(B.D / "live_candles.parquet")
    c["day"] = pd.to_datetime(c.ts, utc=True).dt.tz_convert("Asia/Kolkata").dt.date
    sy = pd.read_csv(B.D / "live_symbols.csv")
    names = set(sy[(sy.segment == "equity") & (sy.mcap_rank <= 500)].symbol)
    c = c[c.symbol.isin(names)].sort_values(["symbol", "ts"])
    xs = np.arange(100, dtype=float) - 49.5
    sxx = float((xs * xs).sum())
    out = []
    for s, f in c.groupby("symbol"):
        f = f.reset_index(drop=True)
        n = len(f)
        if n < 300:
            continue
        cl = f.close.to_numpy(dtype=float)
        sma = pd.Series(cl).rolling(200).mean().to_numpy()
        slope = np.full(n, np.nan)
        r = np.full(n, np.nan)
        for i in range(298, n):
            y = sma[i - 99:i + 1]
            slope[i] = 100 * 20 * float((xs * (y - y.mean())).sum()) / sxx / sma[i]
        for i in range(99, n):
            y = cl[i - 99:i + 1]
            dy = y - y.mean()
            den = np.sqrt(sxx * float((dy * dy).sum()))
            r[i] = float((xs * dy).sum()) / den if den > 0 else np.nan
        prev = f.close.shift()
        tr = pd.concat([f.high - f.low, (f.high - prev).abs(), (f.low - prev).abs()], axis=1).max(axis=1)
        atr = tr.rolling(14, min_periods=14).mean().to_numpy()
        ok = (cl > sma) & (slope >= -0.25) & (r >= 0.5)
        o, lo = f.open.to_numpy(), f.low.to_numpy()
        busy = -1
        for i in range(299, n):
            if i <= busy or not ok[i] or ok[i - 1] or np.isnan(atr[i]):
                continue
            stop = float(Decimal(str(cl[i] - 4 * atr[i])).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))
            if stop <= 0:
                continue
            out.append((s, "buy", f.day.iat[i], stop, ""))
            j = i + 1
            if j >= n:
                busy = n
                continue
            k = None
            for m in range(j, min(j + 60, n)):
                if lo[m] <= stop:
                    k, how = m, "STOP_HIT"
                    break
            if k is None:
                if j + 59 >= n:
                    busy = n
                    continue
                k, how = j + 59, "REVIEW_60"
            busy = k
            out.append((s, "exit", f.day.iat[k], None, how))
    e = pd.DataFrame(out, columns=["symbol", "signal_type", "day", "stop", "result"])
    e.to_csv(B.D / "expected_ma200_signals.csv", index=False)
    print("expected ma200_trend:", (e.signal_type == "buy").sum(), "buys,", (e.signal_type == "exit").sum(), "exits")


if __name__ == "__main__" and "--live" in sys.argv:
    expect_live()
elif __name__ == "__main__":
    base = collect(ma200_signal)
    print("ma200_trend   19-23", line(base[base.date < IS_END]), "| 24-26", line(base[base.date >= IS_END]))
    for k, x in EXTRAS.items():
        t = collect(lambda f: ma200_signal(f, x))
        print(f"{k:13s} 19-23", line(t[t.date < IS_END]), "| 24-26", line(t[t.date >= IS_END]))

    # random entry on days the stock closes above its 200-day average, same plan
    rnd = []
    for seed in range(5):
        rng = np.random.default_rng(100 + seed)
        # same days as the rule can fire on: full history (the regression measures exist) and above the 200-day average
        rnd.append(collect(lambda f: (rng.random(len(f)) < 0.01) & ((f.close > f.sma200) & f.slope100.notna()).to_numpy()))
    rnd = pd.concat(rnd)
    print("random above 200d 19-23", line(rnd[rnd.date < IS_END]), "| 24-26", line(rnd[rnd.date >= IS_END]))

    print("\nby year:")
    yr = {}
    for y, g in base.groupby(base.date.dt.year):
        rg = rnd[rnd.date.dt.year == y]
        yr[int(y)] = {"trades": len(g), "made_money_pct": round(100 * (g.net > 0).mean(), 1), "avg_pct": round(100 * g.net.mean(), 2),
                      "random_made_money_pct": round(100 * (rg.net > 0).mean(), 1), "random_avg_pct": round(100 * rg.net.mean(), 2)}
        print(" ", y, yr[int(y)])
    print("by market weather on the signal day:")
    wx = {}
    for w, g in base.groupby("wx"):
        wx[str(w)] = {"trades": len(g), "made_money_pct": round(100 * (g.net > 0).mean(), 1), "avg_pct": round(100 * g.net.mean(), 2)}
        print(" ", w, wx[str(w)])
    print("how trades ended:", base.how.value_counts(normalize=True).round(3).to_dict())

    # overlap with the two other trend rules (same stock, buy within 5 sessions either side)
    strong = pd.read_csv(B.D / "strong_trend_record.csv", parse_dates=["date"])
    sma = []
    for s, f in RS.F.ALL.items():
        for d, *_ in RS.sma_trend_trades(f):
            sma.append((s, d))
    others = pd.concat([strong[["symbol", "date"]], pd.DataFrame(sma, columns=["symbol", "date"])])
    near = 0
    by = {s: g.date.to_numpy() for s, g in others.groupby("symbol")}
    for s, d in zip(base.symbol, base.date):
        ds = by.get(s)
        if ds is not None and (np.abs((ds - np.datetime64(d)) / np.timedelta64(1, "D")) <= 7).any():
            near += 1
    print(f"within a week of a Strong trend or SMA 20/50 trend buy in the same stock: {near} of {len(base)} ({100 * near / len(base):.0f}%)")

    w = base.net > 0
    report = {
        "rule": "ma200_trend", "period": "Jul 2019 – Oct 2026",
        "all": L.stats(base, 7.33), "2019_23": L.stats(base[base.date < IS_END], 4.5), "2024_26": L.stats(base[base.date >= IS_END], 2.83),
        "random_above_200d": {"2019_23": L.stats(rnd[rnd.date < IS_END], 4.5), "2024_26": L.stats(rnd[rnd.date >= IS_END], 2.83)},
        "by_year": yr, "by_weather": wx, "overlap_pct": round(100 * near / len(base), 1),
        "ended": base.how.value_counts().to_dict(),
    }
    base.to_csv(B.D / "ma200_trend_record.csv", index=False)
    json.dump(report, open(B.D / "ma200_trend_record.json", "w"), indent=1, default=float)
