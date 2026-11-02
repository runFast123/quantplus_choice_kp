"""Shared dataset for the adaptation team (ADR-038 research): every trade of the four live rules, Jul 2019 - Oct 2026,
on each year's point-in-time top 300, after a 0.5 % round-trip cost, with what the market and the stock looked like on
the signal day (all known at that close). Writes ../data/team_trades.parquet and ../data/team_features.parquet.

Columns (team_trades): rule, symbol, signal_date, entry_date, exit_date, net (after cost), how, days, + features.
Features: stock d200 d50 d20 slope200 rsi14 rsi2 atrpct volratio rs_rank r5 r20 r126 dist_hi252 clv gap sector_rank;
market nifty_d200 nifty_r20 vix vix_chg5 wx (0 stormy / 1 mixed / 2 sunny) breadth50 breadth200.
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import signals as S          # noqa: E402  (point-in-time list, features, market table)
import record as R           # noqa: E402
import record_dip as RD      # noqa: E402
import record_sma as RS      # noqa: E402

B, F = S.B, S.F
COST = 0.005
OUT = B.D

FEATS = ["d200", "d50", "d20", "slope200", "rsi14", "rsi2", "atrpct", "volratio", "rs_rank", "r5", "r20", "r126",
         "dist_hi252", "clv", "gap", "sector_rank"]


def stock_features(s, f):
    f = f.reset_index(drop=True)
    sec = S.sector_of.get(s, "Other")
    return pd.DataFrame({
        "symbol": s, "date": f.date,
        "d200": f.close / f.sma200 - 1, "d50": f.close / f.sma50 - 1, "d20": f.close / f.sma20 - 1,
        "slope200": f.sma200 / f.sma200.shift(20) - 1, "rsi14": f.rsi14, "rsi2": f.rsi2,
        "atrpct": f.atr14 / f.close, "volratio": f.volume / f.vol50, "rs_rank": f.rs_rank,
        "r5": f.close / f.close.shift(5) - 1, "r20": f.close / f.close.shift(20) - 1, "r126": f.ret126,
        "dist_hi252": f.close / f.hi252 - 1,
        "clv": ((f.close - f.low) / (f.high - f.low)).where(f.high > f.low, 0.5),
        "gap": f.open / f.close.shift() - 1,
        "sector_rank": S.sec_rank[sec].reindex(f.date).to_numpy() if sec in S.sec_rank else np.nan,
    })


def strong_trades(s, f):
    """record.py's exact Strong trend rule (4 ATR stop, 60 sessions), returning entry/exit dates too."""
    f = f.reset_index(drop=True)
    hi = f.close.rolling(252, min_periods=252).max().shift(1)
    atr = R.atr_simple(f)
    wx = R.WX.reindex(pd.to_datetime(f.date), method="ffill").to_numpy()
    sig = ((f.close > hi) & (f.volume >= 2 * f.vol50) & (f.close > f.sma50) & (wx == "sunny")).to_numpy()
    o, l, c = f.open.to_numpy(), f.low.to_numpy(), f.close.to_numpy()
    out, busy, n = [], -1, len(f)
    for i in np.flatnonzero(sig):
        if i <= busy or i + 1 >= n:
            continue
        j = i + 1
        stop = c[i] - 4.0 * atr.iat[i]
        end = min(j + 60, n)
        k, px, how = end - 1, c[end - 1], "REVIEW_60" if j + 60 <= n else "OPEN"
        for m in range(j, end):
            if l[m] <= stop:
                k, px, how = m, min(o[m], stop), "STOP_HIT"
                break
        busy = k
        out.append((f.date.iat[i], f.date.iat[j], f.date.iat[k], px / o[j] - 1 - COST, how, k - j + 1))
    return out


def sma_trades(s, f):
    f = f.reset_index(drop=True)
    res = []
    for d, net, how, days in RS.sma_trend_trades(f):
        i = int(np.flatnonzero(f.date.to_numpy() == np.datetime64(d))[0])
        j, k = i + 1, min(i + days, len(f) - 1)
        res.append((d, f.date.iat[j], f.date.iat[k], net, how, days))
    return res


def dip_trades(rule):
    def run(s, f):
        g = RD.frame(f[["date", "open", "high", "low", "close", "volume"]].copy())
        tr, _ = RD.trades(g, rule)
        out = []
        for sd, ed, xd, e, px, how in tr:
            if px is None:
                continue
            days = int((g.date == xd).idxmax() - (g.date == ed).idxmax()) + 1
            out.append((sd, ed, xd, px / e - 1 - COST, how, days))
        return out
    return run


if __name__ == "__main__":
    feats = pd.concat([stock_features(s, f) for s, f in F.ALL.items()])
    feats = feats.join(S.mkt, on="date")
    feats.to_parquet(OUT / "team_features.parquet", index=False)
    rows = []
    for rule, fn in (("strong_trend", strong_trades), ("sma_trend", sma_trades),
                     ("rsi_dip", dip_trades("rsi_dip")), ("kk_dip", dip_trades("kk_dip"))):
        for s, f in F.ALL.items():
            for sd, ed, xd, net, how, days in fn(s, f):
                if sd < B.START or s not in S.pit.get(sd.year, ()) or how == "OPEN":
                    continue
                rows.append((rule, s, sd, ed, xd, net, how, days))
    t = pd.DataFrame(rows, columns=["rule", "symbol", "signal_date", "entry_date", "exit_date", "net", "how", "days"])
    t = t.merge(feats, left_on=["symbol", "signal_date"], right_on=["symbol", "date"], how="left").drop(columns="date")
    t.to_parquet(OUT / "team_trades.parquet", index=False)
    print(t.groupby("rule").agg(trades=("net", "size"), made_money=("net", lambda x: round(100 * (x > 0).mean(), 1)),
                                avg=("net", lambda x: round(100 * x.mean(), 2))))
    print("features missing:", t[FEATS].isna().mean().round(3).to_dict())
