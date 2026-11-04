"""200-day trend v2 (ADR-042), the owner's choices of 2026-11-04: a 200-day EMA, no straightness test, the safety stop
counted on the close. Tested record, a plain EMA-200 trade for comparison, and (--live) the expected signals of
migration 44 on the read-only live-candle copy.

  EMA200    seeded with the simple average of the first 200 closes, then ema = a * close + (1 - a) * ema_prev,
            a = 2 / 201 (the TA-Lib convention; the SQL uses the same)
  slope     least-squares slope of the last 100 EMA values x 20 sessions, in % of today's EMA (as in improve_lr.py)
  ours      buy at the next open on the first day the close is above the EMA and the slope is >= -0.25 (flat or rising),
            after a measurable day on which that did not hold; sold at the close of the first day that closes at or
            under the safety stop (signal close - 4 x ATR14), otherwise at the close of the 60th session
  plain     buy at the next open after the close crosses above the EMA; sell at the next open after it crosses under
  random    a random day above the EMA, our plan (5 draws)
Each year's 300 most traded stocks, 0.5 % round trip, open trades left out.
"""
import json
import sys

import numpy as np
import pandas as pd

import backtest as B
import improve_lr as L
import signals as S

COST = 0.005
IS_END = L.IS_END


def ema_seeded(c, n=200):
    c = np.asarray(c, dtype=float)
    out = np.full(len(c), np.nan)
    if len(c) < n:
        return out
    a = 2 / (n + 1)
    out[n - 1] = c[:n].mean()
    for i in range(n, len(c)):
        out[i] = a * c[i] + (1 - a) * out[i - 1]
    return out


def slope100(e):
    xs = np.arange(100) - 49.5
    sxx = (xs * xs).sum()
    out = np.full(len(e), np.nan)
    for i in range(99, len(e)):
        y = e[i - 99:i + 1]
        if np.isnan(y).any():
            continue
        out[i] = 2000 * (xs * (y - y.mean())).sum() / sxx / e[i]
    return out


def frame(f):
    f = f.reset_index(drop=True).copy()
    f["ema"] = ema_seeded(f.close.to_numpy())
    f["eslope"] = slope100(f.ema.to_numpy())
    return f


FR = {s: frame(f) for s, f in L.FR.items()}


def on_known(f):
    on = (f.close > f.ema) & (f.eslope >= -0.25)
    known = f.ema.notna() & f.eslope.notna()
    return on.to_numpy(), known.to_numpy()


def ours(f, rnd=None):
    on, known = on_known(f)
    o, c, atr = f.open.to_numpy(), f.close.to_numpy(), f.atr.to_numpy()
    n, busy, out = len(f), -1, []
    idx = range(1, n) if rnd is None else np.flatnonzero(rnd & on & known)
    for i in idx:
        if i <= busy or i + 1 >= n or np.isnan(atr[i]):
            continue
        if rnd is None and not (on[i] and known[i] and known[i - 1] and not on[i - 1]):
            continue
        j, stop = i + 1, c[i] - 4 * atr[i]
        end = min(j + 60, n)
        k, px, how = end - 1, c[end - 1], ("REVIEW" if j + 60 <= n else "OPEN")
        for m in range(j, end):
            if c[m] <= stop:
                k, px, how = m, c[m], "STOP"
                break
        busy = k
        out.append((i, f.date.iat[i], px / o[j] - 1 - COST, how, k - j + 1))
    return out


def plain(f):
    e, c, o = f.ema.to_numpy(), f.close.to_numpy(), f.open.to_numpy()
    n, out, i = len(f), [], 1
    while i < n - 1:
        if np.isnan(e[i]) or np.isnan(e[i - 1]) or not (c[i] > e[i] and c[i - 1] <= e[i - 1]):
            i += 1
            continue
        j = i + 1
        k = next((x for x in range(j, n - 1) if c[x] < e[x]), None)
        if k is None:
            out.append((i, f.date.iat[i], np.nan, "OPEN", 0))
            break
        out.append((i, f.date.iat[i], o[k + 1] / o[j] - 1 - COST, "CROSS_DOWN", k + 1 - j + 1))
        i = k + 2
    return out


def collect(fn):
    rows = []
    for s, f in FR.items():
        for i, d, net, how, days in fn(f):
            if d < B.START or s not in S.pit.get(d.year, ()) or how == "OPEN":
                continue
            rows.append((s, i, d, net, how, days))
    return pd.DataFrame(rows, columns=["symbol", "i", "date", "net", "how", "days"])


def stats(t, yrs):
    w = t.net > 0
    return {"trades": int(len(t)), "per_year": round(len(t) / yrs), "made_money_pct": round(100 * w.mean(), 1),
            "avg_pct": round(100 * t.net.mean(), 2), "median_pct": round(100 * t.net.median(), 2),
            "avg_win_pct": round(100 * t.net[w].mean(), 1), "avg_loss_pct": round(100 * t.net[~w].mean(), 1),
            "avg_days": round(t.days.mean()), "stopped_pct": round(100 * (t.how == "STOP").mean(), 1)}


def periods(t):
    return {"2019_23": stats(t[t.date < IS_END], 4.5), "2024_26": stats(t[t.date >= IS_END], 2.83), "all": stats(t, 7.33)}


def expect_live():
    """Independent version of migration 44 on the live-candle copy -> data/expected_ema_signals.csv."""
    from decimal import ROUND_HALF_UP, Decimal
    cdl = pd.read_parquet(B.D / "live_candles.parquet")
    cdl["day"] = pd.to_datetime(cdl.ts, utc=True).dt.tz_convert("Asia/Kolkata").dt.date
    sy = pd.read_csv(B.D / "live_symbols.csv")
    names = set(sy[(sy.segment == "equity") & (sy.mcap_rank <= 500)].symbol)
    out = []
    for s, f in cdl[cdl.symbol.isin(names)].sort_values(["symbol", "ts"]).groupby("symbol"):
        f = f.reset_index(drop=True)
        if len(f) < 300:
            continue
        c = f.close.to_numpy(dtype=float)
        e = ema_seeded(c)
        sl = slope100(e)
        prev = f.close.shift()
        tr = pd.concat([f.high - f.low, (f.high - prev).abs(), (f.low - prev).abs()], axis=1).max(axis=1)
        atr = tr.rolling(14, min_periods=14).mean().to_numpy()
        known = ~np.isnan(e) & ~np.isnan(sl)
        on = known & (c > np.nan_to_num(e)) & (np.nan_to_num(sl, nan=-9) >= -0.25)
        n, busy = len(f), -1
        for i in range(1, n):
            if i <= busy or not on[i] or not known[i - 1] or on[i - 1] or np.isnan(atr[i]):
                continue
            stop = float(Decimal(str(c[i] - 4 * atr[i])).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))
            if stop <= 0:
                continue
            out.append((s, "buy", f.day.iat[i], stop, ""))
            j = i + 1
            if j >= n:
                busy = n
                continue
            k = None
            for m in range(j, min(j + 60, n)):
                if c[m] <= stop:
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
    e.to_csv(B.D / "expected_ema_signals.csv", index=False)
    print("expected:", (e.signal_type == "buy").sum(), "buys,", (e.signal_type == "exit").sum(), "exits")


if __name__ == "__main__" and "--live" in sys.argv:
    expect_live()
elif __name__ == "__main__":
    O, P = collect(ours), collect(plain)
    rnd = []
    for seed in range(5):
        rng = np.random.default_rng(300 + seed)
        rnd.append(collect(lambda f: ours(f, rnd=rng.random(len(f)) < 0.01)))
    R = pd.concat(rnd)
    near = lambda a, b: {(s, i) for s, i in zip(a.symbol, a.i) if any(abs(i - x) <= 5 for x in b.get(s, ()))}
    o_sh = near(O, P.groupby("symbol").i.apply(list).to_dict())
    p_sh = near(P, O.groupby("symbol").i.apply(list).to_dict())
    O["kind"] = ["both" if (s, i) in o_sh else "ours only" for s, i in zip(O.symbol, O.i)]
    P["kind"] = ["both" if (s, i) in p_sh else "plain only" for s, i in zip(P.symbol, P.i)]
    rep = {"ours": periods(O), "plain": periods(P), "random": periods(R),
           "ours_only": stats(O[O.kind == "ours only"], 7.33), "ours_shared": stats(O[O.kind == "both"], 7.33),
           "plain_only": stats(P[P.kind == "plain only"], 7.33),
           "by_year": {int(y): {"ours": stats(g, 1), "plain": stats(P[P.date.dt.year == y], 1)} for y, g in O.groupby(O.date.dt.year)}}
    ex = {}
    for s in ("SUZLON", "ADANIPORTS", "MARUTI", "RELIANCE"):
        ex[s] = {"plain": [(str(d.date()), round(100 * x, 1)) for _, d, x, h, _ in plain(FR[s]) if d >= pd.Timestamp("2024-01-01") and h != "OPEN"],
                 "ours": [(str(d.date()), round(100 * x, 1), h) for _, d, x, h, _ in ours(FR[s]) if d >= pd.Timestamp("2024-01-01") and h != "OPEN"]}
    rep["examples"] = ex
    json.dump(rep, open(B.D / "record_ema.json", "w"), indent=1, default=float)
    O.to_csv(B.D / "ema_trend_record.csv", index=False)
    for k in ("ours", "plain", "random"):
        for p in ("2019_23", "2024_26", "all"):
            print(k, p, rep[k][p])
    for k in ("ours_only", "ours_shared", "plain_only"):
        print(k, rep[k])
    print(json.dumps(ex))
