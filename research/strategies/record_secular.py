"""Secular trend (ADR-051): the tested record of EXACTLY the rule migration 55 runs, and the independent version of that
SQL for the live cross-check.

  secular_trend  Secular trend (= Pring's Special K, specialk.py) closes above its signal line (SMA 50 of SMA 50) after
                 closing at or under it the session before, while Secular trend is not lower than 5 sessions ago (flat
                 or rising) and is below -150 (the owner's line);
  plan           entry at the next open; safety stop = signal close - 4 x ATR14 (simple 14-day average true range); out
                 at the stop (or the open, if it gaps under), otherwise the close of the 60th session. One trade per
                 stock. (The same plan as Strong trend, SMA 20/50 trend and 200-day trend.) The 500 largest companies.
Record: research stocks, point-in-time top 300 per year, 0.5 % round-trip cost, Special K from prices since 2010
(download_long.py). 'Made money' = the trade's result after costs was above zero.

    python record_secular.py            -> data/secular_record.json (+ data/secular_record.csv)
    python record_secular.py --live     -> data/expected_secular_signals.csv from data/live_candles.parquet (dump_live.py):
                                           what the SQL must write on the live candles, Special K from those candles only
"""
import json
import sys
from decimal import ROUND_HALF_UP, Decimal

import numpy as np
import pandas as pd

import backtest as B
import record as R
import record_sma as RS
import specialk as K

COST = 0.005
LEVEL = -150


def entries(k: pd.Series, sig: pd.Series) -> pd.Series:
    return (k > sig) & (k.shift() <= sig.shift()) & (k >= k.shift(5)) & (k < LEVEL)


def stop_of(close: float, atr: float) -> float:
    return float(Decimal(str(close - 4 * atr)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def trades(f: pd.DataFrame, k: pd.Series, sig: pd.Series):
    """(signal index, entry index, exit index | None, stop, exit price | None, how) for one stock."""
    f = f.reset_index(drop=True)
    k, sig = k.reset_index(drop=True), sig.reset_index(drop=True)
    atr = R.atr_simple(f).to_numpy()
    hit = entries(k, sig).fillna(False).to_numpy()
    o, l, c = f.open.to_numpy(), f.low.to_numpy(), f.close.to_numpy()
    n, busy, out = len(f), -1, []
    for i in np.flatnonzero(hit):
        if i <= busy or np.isnan(atr[i]):
            continue
        stop = stop_of(c[i], atr[i])
        if stop <= 0:
            continue
        j = i + 1
        if j >= n:
            out.append((i, None, None, stop, None, "OPEN"))
            busy = n
            continue
        end = min(j + 60, n)
        k_, px, how = None, None, None
        for m in range(j, end):
            if l[m] <= stop:
                k_, px, how = m, min(o[m], stop), "STOP_HIT"
                break
        if k_ is None:
            if j + 60 > n:
                out.append((i, j, None, stop, None, "OPEN"))
                busy = n
                continue
            k_, px, how = j + 59, c[j + 59], "REVIEW_60"
        busy = k_
        out.append((i, j, k_, stop, px, how))
    return out


def record():
    K.attach()

    def run(s, f):
        g = f.reset_index(drop=True)
        return [(g.date.iat[i], px / g.open.iat[j] - 1 - COST, how, k - j + 1)
                for i, j, k, stop, px, how in trades(g, g.sk, g.sk_sig) if how != "OPEN"]

    t = RS.collect(run)
    t.to_csv(B.D / "secular_record.csv", index=False)
    rep = RS.periods(t)
    rep["yearly"] = {int(y): RS.stats(g) for y, g in t.groupby(t.date.dt.year)}
    rep["first"], rep["last"] = str(t.date.min().date()), str(t.date.max().date())
    json.dump(rep, open(B.D / "secular_record.json", "w"), indent=1, default=float)
    for lab in ("all", "2019_23", "2024_26"):
        x = rep[lab]
        print(f"{lab:8s} {x['trades']:4d} trades ({x['per_year']:.0f}/yr), made money {x['made_money_pct']}%, "
              f"avg {x['avg_pct']:+.2f}%, median {x['median_pct']:+.2f}%, {x['avg_days']} days")
    for y, x in rep["yearly"].items():
        print(f"  {y}: {x['trades']:3d} trades, made money {x['made_money_pct']}%, avg {x['avg_pct']:+.2f}%")
    print(f"first signal {rep['first']}, last {rep['last']}")


def expect_live():
    c = pd.read_parquet(B.D / "live_candles.parquet")
    c["day"] = pd.to_datetime(c.ts, utc=True).dt.tz_convert("Asia/Kolkata").dt.date
    sy = pd.read_csv(B.D / "live_symbols.csv")
    names = set(sy[(sy.segment == "equity") & (sy.mcap_rank <= 500)].symbol)
    out = []
    for s, f in c[c.symbol.isin(names)].sort_values(["symbol", "ts"]).groupby("symbol"):
        f = f.reset_index(drop=True)
        k, sig = K.special_k(f.close)
        for i, j, k_, stop, px, how in trades(f, k, sig):
            out.append((s, "buy", f.day.iat[i], stop, ""))
            if k_ is not None:
                out.append((s, "exit", f.day.iat[k_], None, how))
    e = pd.DataFrame(out, columns=["symbol", "signal_type", "day", "stop", "result"])
    e.to_csv(B.D / "expected_secular_signals.csv", index=False)
    print("expected secular_trend:", (e.signal_type == "buy").sum(), "buys,", (e.signal_type == "exit").sum(), "exits")
    print(e.to_string(index=False))


if __name__ == "__main__":
    expect_live() if "--live" in sys.argv else record()
