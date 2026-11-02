"""params engine: the four live rules with their key settings opened up as a 3 x 3 x 3 grid (PLAN.md).

The rule code is the exact live code (record.py / record_sma.py / record_dip.py via build_dataset.py) with the
constants turned into settings. One simulator serves both uses:
  * shadow records: one fixed grid point for every day (the grid centre = today's rule = data/team_trades.parquet);
  * walk-forward: a per-day schedule of grid points (the settings active on a signal day decide the signal and its
    plan; an open trade keeps its plan; one open trade per stock carries across quarter boundaries).

Note: we do NOT `import signals` - importing it rewrites data/signals.parquet (a module-level side effect outside our
folder). We rebuild the two things we need from it (point-in-time list, stock frames) with the same code.
"""
import itertools
import os
import pickle
import sys
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]                       # research/strategies
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(HERE.parent))         # team/ (evaluate.py)
OUT = HERE / "out"
OUT.mkdir(exist_ok=True)

COST = 0.005
RULES = ["strong_trend", "sma_trend", "rsi_dip", "kk_dip"]
GRID = {   # (axis name, values); the middle value of every axis is today's live setting
    "strong_trend": [("vol", [1.5, 2.0, 3.0]), ("stop", [3.0, 4.0, 5.0]), ("hold", [40, 60, 90])],
    "sma_trend": [("cut", [0.6, 0.7, 0.8]), ("stop", [3.0, 4.0, 5.0]), ("hold", [40, 60, 90])],
    "rsi_dip": [("rsi2", [5.0, 10.0, 15.0]), ("depth", [0.75, 1.0, 1.25]), ("hold", [5, 10, 15])],
    "kk_dip": [("push", [0.005, 0.01, 0.02]), ("depth", [0.75, 1.0, 1.25]), ("hold", [5, 10, 15])],
}
CFGS = list(itertools.product(range(3), repeat=3))      # config id = a*9 + b*3 + c
TODAY = 13                                                # (1, 1, 1)


def cid(a, b, c):
    return a * 9 + b * 3 + c


def label(rule, k):
    a = CFGS[k]
    return "/".join(f"{GRID[rule][x][1][a[x]]:g}" for x in range(3))


def neighbours(k):
    a = CFGS[k]
    out = [k]
    for ax in range(3):
        for d in (-1, 1):
            b = list(a)
            b[ax] += d
            if 0 <= b[ax] <= 2:
                out.append(cid(*b))
    return out


def atr_simple(f):   # record.py
    tr = pd.concat([f.high - f.low, (f.high - f.close.shift()).abs(), (f.low - f.close.shift()).abs()], axis=1).max(axis=1)
    return tr.rolling(14, min_periods=14).mean()


def load():
    """Per-stock arrays for every rule and every signal-axis value. Cached when PARAMS_CACHE is set (a pickle path)."""
    cache = os.environ.get("PARAMS_CACHE")
    if cache and Path(cache).exists():
        return pickle.load(open(cache, "rb"))
    import backtest as B
    import fair as F
    import adaptive as A
    import record_dip as RD
    pit = {}
    for y in range(2019, 2027):                                # signals.py
        lo = pd.Timestamp(f"{y}-01-01") if y > 2019 else B.START
        pit[y] = F.pit_universe(lo)
    st = {}
    for s, f in F.ALL.items():
        f = f.reset_index(drop=True)
        n = len(f)
        dates = pd.to_datetime(f.date)
        g = RD.frame(f[["date", "open", "high", "low", "close", "volume"]].copy())
        assert (pd.to_datetime(g.date).to_numpy() == dates.to_numpy()).all()
        hi = f.close.rolling(252, min_periods=252).max().shift(1)
        wx = A.WX.reindex(dates, method="ffill").to_numpy()
        base = (f.close > hi) & (f.close > f.sma50) & (wx == "sunny")
        cross = B.e_sma_cross(f)
        dip200 = g.close > g.sma200
        sig = {
            "strong_trend": np.vstack([(base & (f.volume >= v * f.vol50)).to_numpy() for v in (1.5, 2.0, 3.0)]),
            "sma_trend": np.vstack([(cross & (f.rs_rank >= q)).fillna(False).to_numpy().astype(bool) for q in (0.6, 0.7, 0.8)]),
            "rsi_dip": np.vstack([((g.rsi2 < t) & dip200).fillna(False).to_numpy() for t in (5.0, 10.0, 15.0)]),
            "kk_dip": np.vstack([((g.low <= (1 - p) * g.lo20p) & dip200).fillna(False).to_numpy() for p in (0.005, 0.01, 0.02)]),
        }
        yrs = dates.dt.year.to_numpy()
        inpit = np.array([s in pit.get(y, ()) for y in yrs]) & (dates >= B.START).to_numpy()
        st[s] = {
            "n": n, "date": dates.to_numpy(), "inpit": inpit, "sig": sig,
            "o": f.open.to_numpy(float), "l": f.low.to_numpy(float), "c": f.close.to_numpy(float),
            "atr_s": atr_simple(f).to_numpy(float),
            "go": g.open.to_numpy(float), "gl": g.low.to_numpy(float), "gc": g.close.to_numpy(float),
            "atr_e": g.atr.to_numpy(float), "s5": g.sma5.to_numpy(float),
        }
    if cache:
        pickle.dump(st, open(cache, "wb"), protocol=pickle.HIGHEST_PROTOCOL)
    return st


def simulate(rule, x, cfg_day):
    """One stock, one rule. cfg_day: int array (n,) - the grid point active on each day. Returns closed and open trades
    as tuples (i, j, k, net, how, cfg); `how` == 'OPEN' for a trade still open at the end of the data."""
    n = x["n"]
    ax = GRID[rule]
    sigax = cfg_day // 9
    active = x["sig"][rule][sigax, np.arange(n)]
    out, busy = [], -1
    trend = rule in ("strong_trend", "sma_trend")
    for i in np.flatnonzero(active):
        if i <= busy:
            continue
        cfg = int(cfg_day[i])
        _, b, h = CFGS[cfg]
        H = ax[2][1][h]
        if trend:
            o, l, c, atr = x["o"], x["l"], x["c"], x["atr_s"]
            if i + 1 >= n or (rule == "sma_trend" and np.isnan(atr[i])):
                continue
            j = i + 1
            stop = c[i] - ax[1][1][b] * atr[i]
            end = min(j + H, n)
            hit = np.flatnonzero(l[j:end] <= stop)
            if hit.size:
                k = j + int(hit[0])
                px, how = min(o[k], stop), "STOP_HIT"
            else:
                k, px, how = end - 1, c[end - 1], (f"REVIEW_{H}" if j + H <= n else "OPEN")
            busy = k
            out.append((i, j, k, px / o[j] - 1 - COST, how, cfg))
        else:
            o, l, c, atr, s5 = x["go"], x["gl"], x["gc"], x["atr_e"], x["s5"]
            if np.isnan(atr[i]):
                continue
            lim = round(c[i] - ax[1][1][b] * atr[i], 2)
            j = i + 1
            if j >= n:
                continue
            if l[j] > lim * 0.998:
                continue
            e = min(o[j], lim)
            stop = e - 5 * atr[i]
            k = None
            for m in range(j, min(j + H, n)):
                if l[m] <= stop:
                    k, px, how = m, (min(o[m], stop) if m > j else stop), "STOP_HIT"
                    break
                if c[m] > s5[m]:
                    k, px, how = m, c[m], "BOUNCE"
                    break
            if k is None:
                if j + H - 1 >= n:
                    out.append((i, j, n - 1, np.nan, "OPEN", cfg))
                    busy = n
                    continue
                k, px, how = j + H - 1, c[j + H - 1], f"TIME_{H}"
            busy = k
            e = round(e, 4)                                  # record_dip.py reports the fill to 4 decimals
            out.append((i, j, k, px / e - 1 - COST, how, cfg))
    return out


def run(st, rule, schedule):
    """schedule: callable(dates ndarray) -> int array of grid points. Returns the closed trades on the point-in-time
    list (same filters as team_trades), columns like team_trades plus `cfg`."""
    rows = []
    for s, x in st.items():
        cfg_day = schedule(x["date"])
        for i, j, k, net, how, cfg in simulate(rule, x, cfg_day):
            if how == "OPEN" or not x["inpit"][i]:
                continue
            d = x["date"]
            rows.append((rule, s, d[i], d[j], d[k], net, how, k - j + 1, cfg))
    return pd.DataFrame(rows, columns=["rule", "symbol", "signal_date", "entry_date", "exit_date", "net", "how", "days", "cfg"])


def fixed(k):
    return lambda dates: np.full(len(dates), k, dtype=int)


def grid_trades(st=None, refresh=False):
    """Shadow record of all 108 grid points -> out/grid_trades.parquet."""
    p = OUT / "grid_trades.parquet"
    if p.exists() and not refresh:
        return pd.read_parquet(p)
    st = st if st is not None else load()
    t = pd.concat([run(st, rule, fixed(k)) for rule in RULES for k in range(27)], ignore_index=True)
    t.to_parquet(p, index=False)
    return t


if __name__ == "__main__":
    import time
    t0 = time.time()
    st = load()
    print(f"loaded {len(st)} stocks in {time.time() - t0:.0f}s")
    t0 = time.time()
    g = grid_trades(st, refresh=True)
    print(f"grid: {len(g)} trades in {time.time() - t0:.0f}s")
    # reproduction check: grid centre == data/team_trades.parquet
    ref = pd.read_parquet(ROOT / "data" / "team_trades.parquet")
    for rule in RULES:
        a = g[(g.rule == rule) & (g.cfg == TODAY)].copy()
        b = ref[ref.rule == rule]
        key = ["symbol", "signal_date"]
        m = a.merge(b, on=key, how="outer", suffixes=("", "_ref"), indicator=True)
        both = m[m._merge == "both"]
        print(f"{rule:13s} mine {len(a):5d} ref {len(b):5d} matched {len(both):5d} | max |net diff| "
              f"{(both.net - both.net_ref).abs().max():.2e} | exit date diffs {(both.exit_date != both.exit_date_ref).sum()}"
              f" | how diffs {(both.how != both.how_ref).sum()}")
