"""200-day average + linear-regression trend (the owner's fifth rule, ADR-040 research). Variants written down before
running.

The idea (owner, 2026-11-03): signal only when the stock closes above its 200-day average AND the linear-regression
line fitted to that 200-day average is flat or rising (or about to rise). Linear regression as in TradingView's
"Linear Regression Channel": a least-squares line through the last N values; its slope says which way it leans and
Pearson's R how straight it is.

Measures (all known at the signal close)
  sma200   simple 200-day average close
  slope    least-squares slope of the last N values of sma200, as the fitted line's change over 20 sessions in % of
           today's sma200 ("+1.0" = the line rises 1 % every 20 sessions)
  r_px     Pearson's R of the last 100 closes against time (TradingView's channel default), the straightness of the price trend

Entries (entry at the next open)
  cross    the close crosses above sma200 today (yesterday at or under it) and the slope condition holds
  turn_on  the first day both hold (close above sma200 and the slope condition), after a day when they did not
Slope conditions
  rising   slope >= 0
  flat     slope >= -0.25 (flat: the line moves less than a quarter of a percent in 20 sessions, or rises)
  turning  slope >= -1.0 and slope higher than 10 sessions ago (still a little down but turning up), or slope >= 0
LR length N: 50 or 100 sessions.   Price straightness: none, or r_px >= 0.5.
Exits
  plan     safety stop = signal close - 4 x ATR14, otherwise the close of the 60th session (Strong trend / SMA plan)
  trend    the same safety stop; otherwise out at the close of the first session that closes under sma200 with the
           slope under -0.25 (the trend has turned), at most 250 sessions
2 x 3 x 2 x 2 x 2 = 48 variants. Baselines: the bare cross above sma200 (no slope test), and random entries with the
plan exit.
Choose on 2019-07..2023-12 by the owner's goal used for ADR-037: the fewest losing trades among variants with at least
150 trades a year and a positive average; report 2024-01..2026-10 for every variant. Point-in-time top 300, 0.5 %
round-trip cost, open trades left out. 'Made money' = the trade's result after costs was above zero.
"""
import json
import sys

import numpy as np
import pandas as pd

import backtest as B
import record as R
import signals as S

F = S.F
COST = 0.005
IS_END = pd.Timestamp("2024-01-01")


def lr_slope(y, n):
    """Rolling least-squares slope of y against 0..n-1 (per session)."""
    t = pd.Series(np.arange(len(y), dtype=float), index=y.index)
    sx, sy = t.rolling(n).sum(), y.rolling(n, min_periods=n).sum()
    sxy, sxx = (t * y).rolling(n, min_periods=n).sum(), (t * t).rolling(n).sum()
    return (n * sxy - sx * sy) / (n * sxx - sx * sx)


def measures(f):
    f = f.reset_index(drop=True).copy()
    f["sma200"] = f.close.rolling(200, min_periods=200).mean()
    for n in (50, 100):
        f[f"slope{n}"] = 100 * 20 * lr_slope(f.sma200, n) / f.sma200
    t = pd.Series(np.arange(len(f), dtype=float))
    f["r_px"] = f.close.rolling(100, min_periods=100).corr(t)
    f["atr"] = R.atr_simple(f)
    return f


SLOPES = {
    "rising": lambda s: s >= 0,
    "flat": lambda s: s >= -0.25,
    "turning": lambda s: (s >= 0) | ((s >= -1.0) & (s > s.shift(10))),
}


def signal(f, entry, slope, n, rmin):
    above = f.close > f.sma200
    ok = SLOPES[slope](f[f"slope{n}"]) & (f.r_px >= rmin if rmin else True)
    both = (above & ok).fillna(False)
    if entry == "cross":
        x = both & (f.close.shift() <= f.sma200.shift())
    else:
        # the day before must be measurable too, or a stock's first full-history day would always "turn on"
        known = (f.sma200.notna() & f[f"slope{n}"].notna() & f.r_px.notna()).shift(fill_value=False)
        x = both & ~both.shift(fill_value=False) & known
    return x.fillna(False).to_numpy()


def trades(f, sig, exit_):
    o, l, c = f.open.to_numpy(), f.low.to_numpy(), f.close.to_numpy()
    sma, sl, atr = f.sma200.to_numpy(), f.slope50.to_numpy(), f.atr.to_numpy()
    n, busy, out = len(f), -1, []
    for i in np.flatnonzero(sig):
        if i <= busy or i + 1 >= n or np.isnan(atr[i]):
            continue
        j = i + 1
        stop = c[i] - 4 * atr[i]
        hold = 60 if exit_ == "plan" else 250
        end = min(j + hold, n)
        k, px, how = end - 1, c[end - 1], ("REVIEW" if j + hold <= n else "OPEN")
        for m in range(j, end):
            if l[m] <= stop:
                k, px, how = m, min(o[m], stop), "STOP_HIT"
                break
            if exit_ == "trend" and c[m] < sma[m] and sl[m] < -0.25:
                k, px, how = m, c[m], "TREND_END"
                break
        busy = k
        out.append((i, f.date.iat[i], px / o[j] - 1 - COST, how, k - j + 1))
    return out


def collect(fn):
    rows = []
    for s, f in FR.items():
        for i, d, net, how, days in fn(s, f):
            if d < B.START or s not in S.pit.get(d.year, ()) or how == "OPEN":
                continue
            rows.append((s, d, net, how, days))
    return pd.DataFrame(rows, columns=["symbol", "date", "net", "how", "days"])


def stats(t, yrs):
    if t.empty:
        return {"trades": 0}
    w = t.net > 0
    return {"trades": int(len(t)), "per_year": round(len(t) / yrs), "made_money_pct": round(100 * w.mean(), 1),
            "avg_pct": round(100 * t.net.mean(), 2), "median_pct": round(100 * t.net.median(), 2),
            "avg_win_pct": round(100 * t.net[w].mean(), 2), "avg_loss_pct": round(100 * t.net[~w].mean(), 2),
            "pf": round(t.net[w].sum() / -t.net[~w].sum(), 2) if (~w).any() else None,
            "stopped_pct": round(100 * (t.how == "STOP_HIT").mean(), 1), "avg_days": round(t.days.mean(), 1)}


def periods(t):
    return {"2019_23": stats(t[t.date < IS_END], 4.5), "2024_26": stats(t[t.date >= IS_END], 2.83),
            "all": stats(t, 7.33)}


FR = {s: measures(f) for s, f in F.ALL.items()}

if __name__ == "__main__":
    res = {}
    for entry in ("cross", "turn_on"):
        for slope in SLOPES:
            for n in (50, 100):
                for rmin in (None, 0.5):
                    for ex in ("plan", "trend"):
                        key = f"{entry}|{slope}|N{n}|{'r0.5' if rmin else 'any'}|{ex}"
                        t = collect(lambda s, f: trades(f, signal(f, entry, slope, n, rmin), ex))
                        res[key] = periods(t)
                        a, b = res[key]["2019_23"], res[key]["2024_26"]
                        print(f"{key:34s} 19-23 {a.get('trades',0):5d} ({a.get('per_year',0):4d}/yr) made {a.get('made_money_pct',0):4.1f}% "
                              f"avg {a.get('avg_pct',0):+5.2f}% | 24-26 {b.get('trades',0):5d} made {b.get('made_money_pct',0):4.1f}% "
                              f"avg {b.get('avg_pct',0):+5.2f}%", flush=True)

    # baselines
    def bare(f):
        return ((f.close > f.sma200) & (f.close.shift() <= f.sma200.shift())).fillna(False).to_numpy()
    for ex in ("plan", "trend"):
        res[f"bare_cross|{ex}"] = periods(collect(lambda s, f: trades(f, bare(f), ex)))
    rnd = []
    for seed in range(5):
        rng = np.random.default_rng(seed)
        rnd.append(collect(lambda s, f: trades(f, (rng.random(len(f)) < 0.01) & f.sma200.notna().to_numpy(), "plan")))
    res["random|plan"] = periods(pd.concat(rnd))

    for k in ("bare_cross|plan", "bare_cross|trend", "random|plan"):
        a, b = res[k]["2019_23"], res[k]["2024_26"]
        print(f"{k:34s} 19-23 {a['trades']:5d} made {a['made_money_pct']:4.1f}% avg {a['avg_pct']:+5.2f}% | "
              f"24-26 {b['trades']:5d} made {b['made_money_pct']:4.1f}% avg {b['avg_pct']:+5.2f}%")

    ok = {k: v for k, v in res.items() if "|" in k and k.split("|")[0] in ("cross", "turn_on")
          and v["2019_23"].get("per_year", 0) >= 150 and v["2019_23"].get("avg_pct", -1) > 0}
    pick = max(ok, key=lambda k: (ok[k]["2019_23"]["made_money_pct"], ok[k]["2019_23"]["avg_pct"]))
    print("\nchosen on 2019-23 (fewest losing trades, >= 150 a year, positive average):", pick)
    print(json.dumps(res[pick], indent=1))
    json.dump({"pick": pick, "variants": res}, open(B.D / "improve_lr.json", "w"), indent=1, default=float)
    sys.exit(0)
