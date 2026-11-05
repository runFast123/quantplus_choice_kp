"""Blog data (2026-11-05): each of the five live rules next to the usual way of using the same indicator, on the same
stocks and years, measured the same way. Writes data/blog_compare.json (copied by hand into web/src/lib/blog/data.ts).

  rule     the usual way (chosen before any result was seen)              ours (the live rule, exactly)
  sma      buy when the 20-day average crosses over the 50-day,          SMA 20/50 trend (migration 38)
           sell when it crosses back under
  rsi      buy when RSI 14 climbs back over 30, 5 % stop, 8 % target,    RSI dip (migration 41)
           out when RSI falls back under 70
  kk       a dip 1 % under the 20-day low, bought once the price climbs  KK dip (migration 41)
           back over that day's high (the bounce is confirmed), targets
           0.75R / 2R, five sessions
  strong   buy every new 52-week closing high (no volume, market or      Strong trend (migration 33)
           50-day check), with the same stop and 60-session review
  ma200    buy when the close crosses over the 200-day average, sell     200-day trend (migration 41, stop on the low)
           when it crosses back under, no stop

Everything: each year's 300 most traded NSE stocks (point in time), July 2019 to October 2026, entry at the next open
(the dips at their limit price), 0.5 % round-trip cost, trades still open left out. 'Made money' = above zero after
costs. Tested on past prices; no promise about the future.
"""
import json

import numpy as np
import pandas as pd

import sys

import backtest as B
import improve as I
import record as R
import record_dip as RD
import record_sma as RS
import signals as S

F = S.F
COST = 0.005
IS_END = I.IS_END
BINS = [-np.inf, -20, -10, -5, -2, 0, 2, 5, 10, 20, 40, np.inf]
BIN_LABELS = ["under -20", "-20 to -10", "-10 to -5", "-5 to -2", "-2 to 0", "0 to 2", "2 to 5", "5 to 10",
              "10 to 20", "20 to 40", "over 40"]

for s, f in F.ALL.items():
    f["sma5"] = f.close.rolling(5, min_periods=5).mean()


def collect(fn):
    rows = []
    for s, f in F.ALL.items():
        for d, net, how, days in fn(s, f):
            if d < B.START or s not in S.pit.get(d.year, ()) or how == "OPEN":
                continue
            rows.append((s, d, net, how, days))
    return pd.DataFrame(rows, columns=["symbol", "date", "net", "how", "days"])


def old_rule(entry, exit_):
    def run(s, f):
        f = f.reset_index(drop=True)
        out, busy = [], -1
        for i in np.flatnonzero(entry(f).fillna(False).to_numpy()):
            if i <= busy or i + 1 >= len(f):
                continue
            j = i + 1
            k, px = exit_(f, j)
            busy = k
            out.append((f.date.iat[i], px / f.open.iat[j] - 1 - COST, "", k - j + 1))
        return out
    return run


def kk_old(s, f):
    f = f.reset_index(drop=True)
    out, busy = [], -1
    for i, j, e, trig, stop in I.kk_events(f, "buy"):
        if i <= busy or j <= busy or abs(trig - stop) <= 0:
            continue
        k, px = I.x_kk_today(f, j, e, trig, stop)
        busy = k
        out.append((f.date.iat[i], px / e - 1 - COST, "", k - j + 1))
    return out


def dip(rule):
    def run(s, f):
        g = RD.frame(f[["date", "open", "high", "low", "close", "volume"]].copy())
        at = {d: i for i, d in enumerate(g.date)}
        tr, _ = RD.trades(g, rule)
        return [(sd, px / e - 1 - COST, how, at[xd] - at[ed] + 1) for sd, ed, xd, e, px, how in tr if px is not None]
    return run


def plan60(f, sig):
    """Entry at the next open, stop = signal close - 4 x ATR14 (simple), out at the stop or the 60th session's close."""
    atr = R.atr_simple(f).to_numpy()
    o, l, c = f.open.to_numpy(), f.low.to_numpy(), f.close.to_numpy()
    n, busy, out = len(f), -1, []
    for i in np.flatnonzero(sig):
        if i <= busy or i + 1 >= n or np.isnan(atr[i]):
            continue
        j, stop = i + 1, c[i] - 4 * atr[i]
        end = min(j + 60, n)
        k, px, how = end - 1, c[end - 1], ("REVIEW_60" if j + 60 <= n else "OPEN")
        for m in range(j, end):
            if l[m] <= stop:
                k, px, how = m, min(o[m], stop), "STOP_HIT"
                break
        busy = k
        out.append((f.date.iat[i], px / o[j] - 1 - COST, how, k - j + 1))
    return out


def strong_plain(s, f):
    f = f.reset_index(drop=True)
    hi = f.close.rolling(252, min_periods=252).max().shift(1)
    return plan60(f, (f.close > hi).fillna(False).to_numpy())


def strong_ours(s, f):
    f = f.reset_index(drop=True)
    hi = f.close.rolling(252, min_periods=252).max().shift(1)
    wx = R.WX.reindex(pd.to_datetime(f.date), method="ffill").to_numpy()
    sig = ((f.close > hi) & (f.volume >= 2 * f.vol50) & (f.close > f.sma50) & (wx == "sunny")).fillna(False).to_numpy()
    return plan60(f, sig)


def strong_trail(s, f):
    """Added after the first result (said so in the post): the common breakout exit, every new 52-week closing high,
    sold at the close of the first day it closes under its 50-day average, no stop."""
    f = f.reset_index(drop=True)
    hi = f.close.rolling(252, min_periods=252).max().shift(1)
    sig = (f.close > hi).fillna(False).to_numpy()
    o, c, m = f.open.to_numpy(), f.close.to_numpy(), f.sma50.to_numpy()
    n, busy, out = len(f), -1, []
    for i in np.flatnonzero(sig):
        if i <= busy or i + 1 >= n:
            continue
        j = i + 1
        k = next((x for x in range(j, n) if c[x] < m[x]), None)
        if k is None:
            out.append((f.date.iat[i], np.nan, "OPEN", n - j))
            busy = n
            continue
        busy = k
        out.append((f.date.iat[i], c[k] / o[j] - 1 - COST, "UNDER_50", k - j + 1))
    return out


def example(U, O):
    """One real stock for the chart: the most traded stock of 2025 with at least two closed trades of each kind
    signalled from Jan 2025 to Jun 2026 (picked by that rule, not by its result)."""
    lo, hi = pd.Timestamp("2025-01-01"), pd.Timestamp("2026-06-30")
    win = lambda t: t[(t.date >= lo) & (t.date <= hi)]
    u, o = win(U).symbol.value_counts(), win(O).symbol.value_counts()
    cands = [s for s in S.pit.get(2025, ()) if u.get(s, 0) >= 2 and o.get(s, 0) >= 2 and s in F.ALL]
    if not cands:
        return None
    val = {s: float((F.ALL[s].close * F.ALL[s].volume)[F.ALL[s].date.dt.year == 2025].mean()) for s in cands}
    sym = max(cands, key=val.get)
    f = F.ALL[sym].reset_index(drop=True)
    at = {d: i for i, d in enumerate(f.date)}

    def marks(t):
        rows = []
        for _, r in win(t[t.symbol == sym]).iterrows():
            i = at[r.date]
            k = min(i + int(r.days), len(f) - 1)
            rows.append({"signal": str(r.date.date()), "exit": str(f.date.iat[k].date()), "result_pct": round(100 * r.net, 2)})
        return rows
    g = f[(f.date >= lo) & (f.date <= pd.Timestamp("2026-09-30"))]
    return {"symbol": sym, "closes": [[str(d.date()), round(float(c), 2)] for d, c in zip(g.date, g.close)],
            "usual": marks(U), "ours": marks(O)}


def from_c2(fn):
    def run(s, f):
        import compare_200dma as C2   # its own copy of the candles: loaded only for the 200-day run (memory)
        g = C2.FR.get(s)
        return [] if g is None else [(d, net, how, days) for _, d, net, how, days in fn(g)]
    return run


def stats(t):
    if not len(t):
        return None
    w = t.net > 0
    yrs = max((t.date.max() - t.date.min()).days / 365.25, 0.5)
    q = t.net.quantile([0.1, 0.9])
    return {"trades": int(len(t)), "per_year": int(round(len(t) / yrs)),
            "made_money_pct": round(100 * w.mean(), 1), "avg_pct": round(100 * t.net.mean(), 2),
            "median_pct": round(100 * t.net.median(), 2),
            "avg_win_pct": round(100 * t.net[w].mean(), 2), "avg_loss_pct": round(100 * t.net[~w].mean(), 2),
            "worst10_pct": round(100 * q.iloc[0], 2), "best10_pct": round(100 * q.iloc[1], 2),
            "avg_days": round(float(t.days.mean()), 1)}


def by_year(t):
    out = []
    for y, g in t.groupby(t.date.dt.year):
        out.append({"year": int(y), "trades": int(len(g)), "made_money_pct": round(100 * (g.net > 0).mean(), 1),
                    "avg_pct": round(100 * g.net.mean(), 2)})
    return out


def hist(t):
    c = pd.cut(100 * t.net, BINS, labels=BIN_LABELS, right=False).value_counts(normalize=True)
    return [{"bucket": b, "share_pct": round(100 * float(c.get(b, 0)), 1)} for b in BIN_LABELS]


def block(t):
    return {"all": stats(t), "2019_23": stats(t[t.date < IS_END]), "2024_26": stats(t[t.date >= IS_END]),
            "years": by_year(t), "hist": hist(t)}


RULES = {
    "sma": (old_rule(B.e_sma_cross, B.x_cross("sma20", "sma50")), lambda s, f: RS.sma_trend_trades(f)),
    "rsi": (old_rule(B.e_rsi_rev, B.x_rsi_rev), dip("rsi_dip")),
    "kk": (kk_old, dip("kk_dip")),
    "strong": (strong_plain, strong_ours),
    "ma200": (from_c2(lambda g: __import__("compare_200dma").plain(g)),
              from_c2(lambda g: __import__("compare_200dma").ours(g, on_close=False))),
}

if __name__ == "__main__":
    # python compare_blog.py [rule ...]: run some rules (memory), merged into the same file
    out = B.D / "blog_compare.json"
    rep = json.load(open(out)) if out.exists() else {}
    rep.update({"method": "Each year's 300 most traded NSE stocks, July 2019 to October 2026, entry at the next open "
                     "(dips at their limit price), 0.5% round-trip cost, open trades left out.",
           "first_day": str(B.START.date()), "last_day": str(B.raw.date.max().date())})
    for k, (usual, ours) in RULES.items():
        if sys.argv[1:] and k not in sys.argv[1:]:
            continue
        U, O = collect(usual), collect(ours)
        rep[k] = {"usual": block(U), "ours": block(O), "example": example(U, O)}
        if k == "strong":
            rep[k]["usual_trail"] = block(collect(strong_trail))
        a, b = rep[k]["usual"]["all"], rep[k]["ours"]["all"]
        print(f"{k:7s} usual {a['trades']:6d} tr {a['made_money_pct']:5.1f}% avg {a['avg_pct']:+6.2f} med {a['median_pct']:+6.2f}"
              f" | ours {b['trades']:6d} tr {b['made_money_pct']:5.1f}% avg {b['avg_pct']:+6.2f} med {b['median_pct']:+6.2f}")
        json.dump(rep, open(out, "w"), indent=1, default=float)
    print("wrote data/blog_compare.json")
