"""Owner question (2026-11-04): does it matter which daily price the 200-day average is built on — the close, the high
or the low? Every version below is run with the average on each source; the buy test and the safety stop use the
close (a close above the average; a day that closes at or under the stop), as in compare_200dma.py / record_ema.py.

  plain SMA / plain EMA   buy at the next open after the close crosses above the average, sell at the next open after
                          it crosses back under (no stop)
  ours SMA                close above the SMA, its 100-session regression slope x 20 >= -0.25 %, the last 100 closes
                          climbing steadily (Pearson's R >= 0.5); first day all hold; stop on the close or the 60th close
  ours EMA                the live rule (migration 44): close above the EMA, the EMA's slope >= -0.25 %; same plan
Each year's 300 most traded stocks, 0.5 % round trip, open trades left out. Writes data/compare_sources.json.
"""
import json

import numpy as np
import pandas as pd

import backtest as B
import improve_lr as L
import record_ema as RE
import signals as S

COST = 0.005
IS_END = L.IS_END


def frame(f, src):
    p = f[src].to_numpy(dtype=float)
    sma = pd.Series(p).rolling(200, min_periods=200).mean().to_numpy()
    ema = RE.ema_seeded(p)
    return {"sma": sma, "ema": ema, "sma_sl": RE.slope100(sma), "ema_sl": RE.slope100(ema)}


def plain(f, ma):
    c, o = f.close.to_numpy(), f.open.to_numpy()
    n, out, i = len(f), [], 1
    while i < n - 1:
        if np.isnan(ma[i]) or np.isnan(ma[i - 1]) or not (c[i] > ma[i] and c[i - 1] <= ma[i - 1]):
            i += 1
            continue
        j = i + 1
        k = next((x for x in range(j, n - 1) if c[x] < ma[x]), None)
        if k is None:
            break
        out.append((f.date.iat[i], o[k + 1] / o[j] - 1 - COST))
        i = k + 2
    return out


def ours(f, ma, sl, rmin):
    c, o, atr = f.close.to_numpy(), f.open.to_numpy(), f.atr.to_numpy()
    r = f.r_px.to_numpy()
    known = ~np.isnan(ma) & ~np.isnan(sl)
    if rmin:
        known &= ~np.isnan(r)
    on = known & (c > np.nan_to_num(ma, nan=np.inf)) & (np.nan_to_num(sl, nan=-9) >= -0.25)
    if rmin:
        on &= np.nan_to_num(r, nan=-1) >= rmin
    n, busy, out = len(f), -1, []
    for i in range(1, n):
        if i <= busy or i + 1 >= n or not on[i] or not known[i - 1] or on[i - 1] or np.isnan(atr[i]):
            continue
        j, stop = i + 1, c[i] - 4 * atr[i]
        end = min(j + 60, n)
        hit = next((m for m in range(j, end) if c[m] <= stop), None)
        if hit is None and j + 60 > n:
            break                                            # still open
        k = hit if hit is not None else end - 1
        busy = k
        out.append((f.date.iat[i], c[k] / o[j] - 1 - COST))
    return out


def stats(rows, yrs):
    t = np.array([x for _, x in rows])
    if not len(t):
        return {"trades": 0}
    w = t > 0
    return {"trades": int(len(t)), "per_year": round(len(t) / yrs), "made_money_pct": round(100 * w.mean(), 1),
            "avg_pct": round(100 * t.mean(), 2), "avg_win_pct": round(100 * t[w].mean(), 1), "avg_loss_pct": round(100 * t[~w].mean(), 1)}


if __name__ == "__main__":
    res = {}
    for src in ("close", "high", "low"):
        runs = {k: [] for k in ("plain SMA", "plain EMA", "ours SMA", "ours EMA")}
        for s, f in L.FR.items():
            f = f.reset_index(drop=True)
            m = frame(f, src)
            keep = lambda rows: [(d, x) for d, x in rows if d >= B.START and s in S.pit.get(d.year, ())]
            runs["plain SMA"] += keep(plain(f, m["sma"]))
            runs["plain EMA"] += keep(plain(f, m["ema"]))
            runs["ours SMA"] += keep(ours(f, m["sma"], m["sma_sl"], 0.5))
            runs["ours EMA"] += keep(ours(f, m["ema"], m["ema_sl"], None))
        for k, rows in runs.items():
            res[f"{src}|{k}"] = {"2019_23": stats([r for r in rows if r[0] < IS_END], 4.5),
                                 "2024_26": stats([r for r in rows if r[0] >= IS_END], 2.83), "all": stats(rows, 7.33)}
            a, b = res[f"{src}|{k}"]["all"], res[f"{src}|{k}"]["2024_26"]
            print(f"{src:5s} {k:10s} all {a['trades']:5d} made {a['made_money_pct']:4.1f}% avg {a['avg_pct']:+6.2f}% | "
                  f"24-26 {b['trades']:5d} ({b['per_year']}/yr) made {b['made_money_pct']:4.1f}% avg {b['avg_pct']:+6.2f}%", flush=True)
    json.dump(res, open(B.D / "compare_sources.json", "w"), indent=1, default=float)
