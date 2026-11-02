"""P1 plan menu (PLAN.md): re-run the four rules with one alternative plan each, on the same point-in-time top 300,
same 0.5 % cost. First re-runs the DEFAULT plans and checks they reproduce data/team_trades.parquet exactly.

  strong_trend / sma_trend  alt "short": same entry, same 4 x ATR14 stop, review after 20 sessions instead of 60
  rsi_dip / kk_dip          alt "deep":  buy limit close - 1.5 x ATR14 instead of 1.0 x, everything else the same
Writes regime/plan_trades.parquet (columns of team_trades + plan). Run from research/strategies/team/regime.
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT))
import signals as S          # noqa: E402
import record as R           # noqa: E402
import record_dip as RD      # noqa: E402
import backtest as B         # noqa: E402

COST = 0.005


def trend(f, kind, hold=60, stop_k=4.0):
    f = f.reset_index(drop=True)
    atr = R.atr_simple(f)
    if kind == "strong_trend":
        hi = f.close.rolling(252, min_periods=252).max().shift(1)
        wx = R.WX.reindex(pd.to_datetime(f.date), method="ffill").to_numpy()
        sig = ((f.close > hi) & (f.volume >= 2 * f.vol50) & (f.close > f.sma50) & (wx == "sunny")).to_numpy()
    else:
        sig = (B.e_sma_cross(f) & (f.rs_rank >= 0.7)).fillna(False).to_numpy()
    atr = atr.to_numpy()
    o, l, c = f.open.to_numpy(), f.low.to_numpy(), f.close.to_numpy()
    out, busy, n = [], -1, len(f)
    for i in np.flatnonzero(sig):
        if i <= busy or i + 1 >= n or (kind == "sma_trend" and np.isnan(atr[i])):
            continue
        j = i + 1
        stop = c[i] - stop_k * atr[i]
        end = min(j + hold, n)
        k, px, how = end - 1, c[end - 1], f"REVIEW_{hold}" if j + hold <= n else "OPEN"
        for m in range(j, end):
            if l[m] <= stop:
                k, px, how = m, min(o[m], stop), "STOP_HIT"
                break
        busy = k
        out.append((f.date.iat[i], f.date.iat[j], f.date.iat[k], px / o[j] - 1 - COST, how, k - j + 1))
    return out


def dip(f, rule, lim_k=1.0):
    g = RD.frame(f[["date", "open", "high", "low", "close", "volume"]].copy())
    sig = ((g.rsi2 < 10) if rule == "rsi_dip" else (g.low <= 0.99 * g.lo20p)) & (g.close > g.sma200)
    o, h, l, c, s5, atr = (g[k].to_numpy(float) for k in ("open", "high", "low", "close", "sma5", "atr"))
    n, busy, out = len(g), -1, []
    for i in np.flatnonzero(sig.fillna(False).to_numpy()):
        if i <= busy or np.isnan(atr[i]):
            continue
        lim = round(c[i] - lim_k * atr[i], 2)
        j = i + 1
        if j >= n or l[j] > lim * 0.998:
            continue
        e = min(o[j], lim)
        stop = e - 5 * atr[i]
        k = px = how = None
        for m in range(j, min(j + 10, n)):
            if l[m] <= stop:
                k, px, how = m, (min(o[m], stop) if m > j else stop), "STOP_HIT"
                break
            if c[m] > s5[m]:
                k, px, how = m, c[m], "BOUNCE"
                break
        if k is None:
            if j + 9 >= n:
                busy = n
                continue
            k, px, how = j + 9, c[j + 9], "TIME_10"
        busy = k
        out.append((g.date.iat[i], g.date.iat[j], g.date.iat[k], px / e - 1 - COST, how, k - j + 1))
    return out


def collect(rule, fn):
    rows = []
    for s, f in S.F.ALL.items():
        for sd, ed, xd, net, how, days in fn(f):
            if sd < S.B.START or s not in S.pit.get(sd.year, ()) or how == "OPEN":
                continue
            rows.append((rule, s, sd, ed, xd, net, how, days))
    return pd.DataFrame(rows, columns=["rule", "symbol", "signal_date", "entry_date", "exit_date", "net", "how", "days"])


if __name__ == "__main__":
    base = pd.read_parquet(ROOT / "data" / "team_trades.parquet")
    menu = {
        "strong_trend": (lambda f: trend(f, "strong_trend"), lambda f: trend(f, "strong_trend", hold=20)),
        "sma_trend": (lambda f: trend(f, "sma_trend"), lambda f: trend(f, "sma_trend", hold=20)),
        "rsi_dip": (lambda f: dip(f, "rsi_dip"), lambda f: dip(f, "rsi_dip", lim_k=1.5)),
        "kk_dip": (lambda f: dip(f, "kk_dip"), lambda f: dip(f, "kk_dip", lim_k=1.5)),
    }
    parts = []
    for rule, (fd, fa) in menu.items():
        d = collect(rule, fd)
        b = base[base.rule == rule]
        key = ["symbol", "signal_date"]
        j = d.merge(b[key + ["net", "exit_date"]], on=key, how="outer", suffixes=("", "_b"), indicator=True)
        same = (j._merge == "both") & np.isclose(j.net, j.net_b) & (j.exit_date == j.exit_date_b)
        print(f"{rule}: default re-run {len(d)} vs team_trades {len(b)}, identical rows {int(same.sum())}")
        a = collect(rule, fa)
        parts += [d.assign(plan="default"), a.assign(plan="alt")]
    p = pd.concat(parts, ignore_index=True)
    p["signal_date"] = pd.to_datetime(p.signal_date)
    for c in ("entry_date", "exit_date"):
        p[c] = pd.to_datetime(p[c])
    p.to_parquet(HERE / "plan_trades.parquet", index=False)
    pre = p[p.signal_date < "2021-01-01"]        # design-period view only; 2021+ is judged by evaluate.py
    print(pre.groupby(["rule", "plan"]).net.agg(["size", lambda x: (x > 0).mean(), "mean"]).round(4))
