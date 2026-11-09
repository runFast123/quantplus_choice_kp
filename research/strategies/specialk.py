"""Pring's Special K (owner's idea, 2026-11-09): variants written down before running.

Special K (TradingView's ta.specialK, Pring's weights): the sum of 12 rates of change, each smoothed by a simple average
and weighted 1 to 4:
    ROC  10 15 20 30 | 40 65 75 100 | 195 265 390 530     (ROC_r = 100 x (close / close r sessions ago - 1))
    SMA  10 10 10 15 | 50 65 75 100 | 130 130 130 195
    w     1  2  3  4 |  1  2  3   4 |   1   2   3   4
Signal line = SMA 50 of (SMA 50 of Special K): the owner's script, lengths 50 and 50. It needs 725 sessions to start,
so it is computed on prices from 2010 (data/candles_long.parquet, download_long.py); trades start on 2019-07-01.

The owner's rule: when Special K crosses above its signal line (the two lines cross) and Special K is flat or rising,
give a signal. Entry at the next open.
Entries (all: Special K closes above the signal line today, at or under it yesterday)
  K0 the cross alone (to measure what the owner's filter adds)
  K1 + Special K not lower than yesterday
  K2 + Special K not lower than 5 sessions ago        (flat or rising over a week)
  K3 + Special K not lower than 10 sessions ago       (flat or rising over two weeks)
  K4 K2 + Special K above zero (Pring: long-term momentum positive)
  K5 K2 + the stock above a rising 200-day average (the house trend filter)
Exits
  cross     Special K closes back under the signal line
  cross4    the same, with a safety stop 4 x ATR under the entry
  hold60    safety stop 4 x ATR, otherwise the close of the 60th session (the live trend rules' plan)
  trail     stop 3 x ATR under the entry, then the highest close - 3 x ATR
Choose on 2019-07..2023-12: the fewest losing trades among variants with at least 150 trades a year and a positive
average (the owner's goal, as for SMA 20/50); report 2024-01..2026-10 for every variant. Point-in-time top 300 per
year, 0.5 % round-trip cost, one trade per stock at a time. A random entry with the same plan is the yardstick.
"""
import json

import numpy as np
import pandas as pd

import adaptive as A
import backtest as B
import improve as I
import signals as S

F = S.F
ROC = (10, 15, 20, 30, 40, 65, 75, 100, 195, 265, 390, 530)
SMA = (10, 10, 10, 15, 50, 65, 75, 100, 130, 130, 130, 195)
W = (1, 2, 3, 4, 1, 2, 3, 4, 1, 2, 3, 4)


def special_k(close: pd.Series, len1=50, len2=50):
    k = sum(w * (100 * (close / close.shift(r) - 1)).rolling(n, min_periods=n).mean() for r, n, w in zip(ROC, SMA, W))
    sig = k.rolling(len1, min_periods=len1).mean().rolling(len2, min_periods=len2).mean()
    return k, sig


def attach():
    """Special K from the long history, joined onto each research frame by date."""
    long = pd.read_parquet(B.D / "candles_long.parquet")
    long["date"] = pd.to_datetime(long.date).dt.tz_localize(None)
    have = 0
    for s, f in F.ALL.items():
        g = long[long.symbol == s].sort_values("date")
        if len(g) < 725:
            f["sk"], f["sk_sig"] = np.nan, np.nan
            continue
        k, sig = special_k(g.close.reset_index(drop=True))
        m = pd.DataFrame({"date": g.date.to_numpy(), "sk": k.to_numpy(), "sk_sig": sig.to_numpy()})
        j = f[["date"]].merge(m, on="date", how="left")
        f["sk"], f["sk_sig"] = j.sk.to_numpy(), j.sk_sig.to_numpy()
        have += f.sk_sig.notna().any()
    print(f"Special K attached to {have} of {len(F.ALL)} stocks", flush=True)


cross = lambda f: (f.sk > f.sk_sig) & (f.sk.shift() <= f.sk_sig.shift())
not_lower = lambda n: (lambda f: f.sk >= f.sk.shift(n))
trend = lambda f: (f.close > f.sma200) & f.sma200_up

ENTRIES = {
    "K0 cross": cross,
    "K1 +rising 1d": lambda f: cross(f) & not_lower(1)(f),
    "K2 +flat/rising 5d": lambda f: cross(f) & not_lower(5)(f),
    "K3 +flat/rising 10d": lambda f: cross(f) & not_lower(10)(f),
    "K4 K2+above 0": lambda f: cross(f) & not_lower(5)(f) & (f.sk > 0),
    "K5 K2+uptrend": lambda f: cross(f) & not_lower(5)(f) & trend(f),
}


def x_sk_cross(stop_atr=None):
    def run(f, j, e):
        stop = e - stop_atr * f.atr14.iat[j - 1] if stop_atr else None
        for k in range(j, len(f)):
            if stop is not None and f.low.iat[k] <= stop:
                return k, min(f.open.iat[k], stop) if k > j else stop
            if f.sk.iat[k] < f.sk_sig.iat[k]:
                return k, f.close.iat[k]
        return len(f) - 1, f.close.iat[-1]
    return run


wrap = lambda x: (lambda f, j, e: x(f, j))
EXITS = {
    "cross": x_sk_cross(),
    "cross4": x_sk_cross(4),
    "hold60": wrap(A.x_hold_atr(60, 4)),
    "trail": wrap(A.x_chandelier(3, 3)),
}


def stats(g, yrs):
    if g.empty:
        return dict(trades=0)
    w = g.net > 0
    return dict(trades=len(g), per_year=round(len(g) / yrs), made_money_pct=round(100 * w.mean(), 1),
                avg_pct=round(100 * g.net.mean(), 2), median_pct=round(100 * g.net.median(), 2),
                pf=round(g.net[w].sum() / -g.net[~w].sum(), 2) if (~w).any() else None, avg_days=round(g.days.mean(), 1))


def periods(t):
    return {"2019_23": stats(t[t.date < I.IS_END], 4.5), "2024_26": stats(t[t.date >= I.IS_END], 2.83), "all": stats(t, 7.33)}


def random_entry(rate, seed):
    rng = np.random.default_rng(seed)
    return lambda f: pd.Series(rng.random(len(f)) < rate, index=f.index) & f.sk_sig.notna()


if __name__ == "__main__":
    attach()
    rows, kept = [], {}
    for en, e in ENTRIES.items():
        for xn, x in EXITS.items():
            t = I.run_close_rule(e, x)
            kept[(en, xn)] = t
            p = periods(t)
            rows += [dict(entry=en, exit=xn, period=k, **v) for k, v in p.items()]
            print(f"  {en:20s} {xn:7s} {I.summary(t)}", flush=True)
    out = pd.DataFrame(rows)
    out.to_csv(B.D / "specialk_summary.csv", index=False)

    ins = out[(out.period == "2019_23") & (out.per_year >= 150) & (out.avg_pct > 0)]
    pick = ins.sort_values(["made_money_pct", "avg_pct"], ascending=False).iloc[0] if len(ins) else None
    report = {"variants": rows}
    if pick is not None:
        en, xn = pick.entry, pick.exit
        t = kept[(en, xn)]
        print(f"\nchosen on 2019-23: {en} / {xn}")
        t.to_csv(B.D / "specialk_chosen_trades.csv", index=False)
        yearly = {int(y): stats(g, 1) for y, g in t.groupby(t.date.dt.year)}
        for y, v in yearly.items():
            print(f"  {y}: {v}")
        # yardstick: random days with the same plan and the same number of trades a year, five seeds
        days = sum(int(f.sk_sig.notna().sum()) for f in F.ALL.values())
        sig_days = sum(int(ENTRIES[en](f).fillna(False).sum()) for f in F.ALL.values())
        rnd = pd.concat([I.run_close_rule(random_entry(sig_days / days, s), EXITS[xn]) for s in range(5)])
        print(f"  random entry, same plan: {I.summary(rnd)}")
        report.update(chosen={"entry": en, "exit": xn, **periods(t)}, yearly=yearly, random=periods(rnd))
    live = json.load(open(B.D / "final_report.json"))
    report["live_rules"] = {k: v["new"] for k, v in live.items()}
    json.dump(report, open(B.D / "specialk_report.json", "w"), indent=1, default=str)
    print("wrote data/specialk_summary.csv and data/specialk_report.json")
