"""Adaptive versions of today's three strategies + the hybrid 'Strong trend' signal with a plan.

Market weather (one fixed definition, never tuned):
  stormy  Nifty 50 below its 200-day avg with the 50-day below the 200-day, OR India VIX above 22
  sunny   Nifty above its 200-day avg with the 50-day above the 200-day, AND India VIX at or below 22
  mixed   everything else

Design discipline: every variant below was written down BEFORE running. Choice is made on the design
period only (SMA/RSI/hybrid 2019-07..2023-12; KK 2006..2018); the later period is the check.
Cost: 0.5 % round trip throughout (realistic for delivery trades incl. STT, stamp, slippage).
"""
import json

import numpy as np
import pandas as pd

import backtest as B
import diagnose as G
import fair as F
import portfolio as P

B.COST = 0.005

wx = pd.Series("mixed", index=G.nifty.index)
up = (G.nifty > G.s200) & (G.s50 > G.s200)
down = (G.nifty < G.s200) & (G.s50 < G.s200)
v = G.vix.reindex(G.nifty.index, method="ffill")
wx[up & (v <= 22)] = "sunny"
wx[down | (v > 22)] = "stormy"
WX = wx

for s, f in F.ALL.items():
    f["wx"] = WX.reindex(pd.to_datetime(f.date), method="ffill").values
    f["hc_atr"] = f.atr14


# ------------------------------------------------------------------ exits built on each stock's own swing (ATR)
def x_atr_cross(k_stop):            # SMA: out on the death cross, or a stop k x ATR under the entry
    def run(f, j):
        e = f.open.iat[j]
        stop = e - k_stop * f.atr14.iat[j - 1]
        for k in range(j, len(f)):
            if f.low.iat[k] <= stop:
                return k, min(f.open.iat[k], stop) if k > j else stop
            if f.sma20.iat[k] < f.sma50.iat[k]:
                return k, f.close.iat[k]
        return len(f) - 1, f.close.iat[-1]
    return run


def x_rsi40(f, j):                  # RSI dip: stop 2 x ATR, out when RSI cools from above 70, or after 20 sessions
    e = f.open.iat[j]
    stop = e - 2 * f.atr14.iat[j - 1]
    end = min(j + 20, len(f))
    for k in range(j, end):
        if f.low.iat[k] <= stop:
            return k, min(f.open.iat[k], stop) if k > j else stop
        if k > j and f.rsi14.iat[k - 1] > 70 and f.rsi14.iat[k] <= 70:
            return k, f.close.iat[k]
    return end - 1, f.close.iat[end - 1]


def x_hold_atr(n, k_stop):
    def run(f, j):
        e = f.open.iat[j]
        stop = e - k_stop * f.atr14.iat[j - 1]
        end = min(j + n, len(f))
        for k in range(j, end):
            if f.low.iat[k] <= stop:
                return k, min(f.open.iat[k], stop) if k > j else stop
        return end - 1, f.close.iat[end - 1]
    return run


def x_chandelier(k_stop, k_trail, half_at_r=None, max_days=None):
    """Initial stop k_stop x ATR under the entry; the stop then follows the highest close minus k_trail x ATR
    (it only moves up). Optional: take half off at +half_at_r R. Returns an effective exit price."""
    def run(f, j):
        e = f.open.iat[j]
        a0 = f.atr14.iat[j - 1]
        stop = e - k_stop * a0
        risk = e - stop
        t1 = e + half_at_r * risk if half_at_r else None
        took = False
        hc = e
        end = len(f) if not max_days else min(j + max_days, len(f))
        for k in range(j, end):
            if f.low.iat[k] <= stop:
                px = min(f.open.iat[k], stop) if k > j else stop
                return k, (0.5 * t1 + 0.5 * px) if took else px
            if t1 and not took and f.high.iat[k] >= t1:
                took = True
            hc = max(hc, f.close.iat[k])
            stop = max(stop, hc - k_trail * f.atr14.iat[k])
        px = f.close.iat[end - 1]
        return end - 1, (0.5 * t1 + 0.5 * px) if took else px
    return run


# ------------------------------------------------------------------ entries
not_stormy = lambda f: f.wx != "stormy"
sma_today = B.e_sma_cross
sma_v1 = lambda f: B.e_sma_cross(f) & (f.close > f.sma200)
sma_v2 = lambda f: sma_v1(f) & not_stormy(f)
rsi_today = B.e_rsi_rev
rsi_v1 = lambda f: (f.close > f.sma200) & f.sma200_up & (f.rsi14.shift() < 40) & (f.rsi14 >= 40)
rsi_v2 = lambda f: rsi_v1(f) & not_stormy(f)
rsi_v3 = lambda f: rsi_v1(f) & (f.wx == "sunny")


def trend_entry(rs_min=None, vol_mult=1.5):
    def e(f):
        x = (f.close > f.hi252) & (f.volume > vol_mult * f.vol50) & (f.close > f.sma50) & not_stormy(f)
        return x & (f.rs_rank > rs_min) if rs_min else x
    return e


VARIANTS = {
    "SMA today (cross/cross)": (sma_today, B.x_cross("sma20", "sma50")),
    "SMA v1 stock above 200d": (sma_v1, B.x_cross("sma20", "sma50")),
    "SMA v2 v1 + not stormy": (sma_v2, B.x_cross("sma20", "sma50")),
    "SMA v3 v2 + 3xATR stop": (sma_v2, x_atr_cross(3)),
    "RSI today (30 / 5% / 8%)": (rsi_today, B.x_rsi_rev),
    "RSI v1 dip-to-40 in uptrend": (rsi_v1, x_rsi40),
    "RSI v2 v1 + not stormy": (rsi_v2, x_rsi40),
    "RSI v3 v1 + sunny only": (rsi_v3, x_rsi40),
    "TREND hold60 2.5ATR": (trend_entry(), x_hold_atr(60, 2.5)),
    "TREND chand 2.5/3": (trend_entry(), x_chandelier(2.5, 3)),
    "TREND chand 2.5/3 half@2R": (trend_entry(), x_chandelier(2.5, 3, half_at_r=2)),
    "TREND chand 2/4 half@2R": (trend_entry(), x_chandelier(2, 4, half_at_r=2)),
    "TREND+RS70 chand 2.5/3 half@2R": (trend_entry(0.7), x_chandelier(2.5, 3, half_at_r=2)),
    "TREND+RS70 hold60 2.5ATR": (trend_entry(0.7), x_hold_atr(60, 2.5)),
}


def event_edge(entry, lo, hi):
    rows = []
    for s, f in B.stocks.items():
        sig = entry(f).fillna(False).to_numpy()
        for i in np.flatnonzero(sig):
            d = f.date.iat[i]
            if lo <= d < hi and i + 1 < len(f):
                rows.append((s, d))
    ev = pd.DataFrame(rows, columns=["symbol", "date"])
    if ev.empty:
        return "no signals"
    ev = ev.merge(G.fwd, on=["symbol", "date"], how="left")
    x = ev.r20 - ev.date.map(G.day_avg)
    by = x.groupby(ev.date).mean().dropna()
    t = by.mean() / (by.std() / np.sqrt(len(by))) if len(by) > 2 else np.nan
    return f"beat avg stock 20d {100*by.mean():+.2f}pp (t={t:.1f}, {len(ev)} sig)"


if __name__ == "__main__":
    pd.set_option("display.width", 220)
    for uni in ("today's top 500", "point-in-time top 300"):
        print(f"\n\n################ universe: {uni}")
        for lab, lo, hi in F.periods:
            names = set(F.ALL) if uni.startswith("today") else F.pit_universe(lo)
            B.stocks = {s: F.ALL[s] for s in names}
            hold = P.stats(F.ew(lo, hi, names))
            print(f"\n=== {lab} | hold the same stocks: {hold}")
            for name, (e, x) in VARIANTS.items():
                t, _ = B.run_strategy(e, x)
                t = t[(t.date >= lo) & (t.date < hi)]
                if t.empty:
                    print(f"  {name:32s} no trades")
                    continue
                eq, n = P.simulate(e, x, lo, hi)
                print(f"  {name:32s} trades {len(t):5d} win {100*(t.ret>0).mean():3.0f}% avg {100*t.ret.mean():+5.2f}% "
                      f"days {t.days.mean():4.0f} | {event_edge(e, lo, hi)} | 10-slot {P.stats(eq)}")

    # ------------------------------------------------------------------ KK: design 2006-2018, check 2019-2026
    kk = pd.DataFrame(json.load(open(B.D / "kk_eod_results_fixed.json"))["trades"])
    kk["risk"] = (kk.entry_fill_price - kk.stop_loss).abs() / kk.entry_fill_price
    kk["ret"] = kk.realized_r_multiple * kk.risk - B.COST
    kk["wx"] = WX.reindex(pd.to_datetime(kk.signal_date), method="ffill").values
    design = kk.signal_date < "2019-01-01"
    wide = kk[design].risk.quantile(2 / 3)       # 'wide stop' cut-off fixed on the design years
    print(f"\n\n################ KK (stored record), cost 0.5 %; wide-stop cut-off from 2006-18 = {100*wide:.1f}% of price")
    rules = {
        "KK today: buys": kk.signal == "BUY",
        "KK today: shorts": kk.signal == "SELL",
        "KK v1 buys, not stormy": (kk.signal == "BUY") & (kk.wx != "stormy"),
        "KK v2 v1 + skip wide stops": (kk.signal == "BUY") & (kk.wx != "stormy") & (kk.risk <= wide),
        "KK v3 v2 + sunny only": (kk.signal == "BUY") & (kk.wx == "sunny") & (kk.risk <= wide),
        "KK shorts, stormy only": (kk.signal == "SELL") & (kk.wx == "stormy"),
    }
    for name, m in rules.items():
        parts = []
        for lab, p in (("2006-18", design), ("2019-26", ~design)):
            t = kk[m & p]
            parts.append(f"{lab}: {len(t):5d} trades win {100*(t.ret>0).mean():3.0f}% avg {100*t.ret.mean():+.2f}%")
        print(f"  {name:28s} " + " | ".join(parts))
