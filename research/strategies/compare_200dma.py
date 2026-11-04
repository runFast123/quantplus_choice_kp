"""Owner report (2026-11-04): a plain 200-day moving average trade vs our 200-day trend (the moving average + its
linear-regression line). Profit and loss on closing prices; the safety stop counts only when a day CLOSES at or under it
(a day that dips under the stop and closes above it is not a loss), and the trade is sold at that close.

  plain      buy at the next open after the close crosses above the 200-day average; sell at the next open after the
             close crosses back under it (the classic 200-day average trade, no stop)
  ours       the live 200-day trend rule (migration 41): the first day the close is above the 200-day average, the
             regression line of that average over 100 days is flat or rising, and the last 100 closes climb steadily
             (Pearson's R >= 0.5); sold when a day closes under the safety stop (4 x ATR14 under the signal close), or at
             the close of the 60th session
  ours_low   the same with the stop taken on the day's low (the rule as it runs today), for comparison
Each year's 300 most traded NSE stocks, 0.5 % round-trip cost, open trades left out. Writes data/compare_200dma.json.
"""
import json

import numpy as np
import pandas as pd

import backtest as B
import improve_lr as L
import record_lr as RL
import signals as S

COST = 0.005
IS_END = L.IS_END
FR = RL.FR


def plain(f):
    m, c, o = f.sma200.to_numpy(), f.close.to_numpy(), f.open.to_numpy()
    n, out, i = len(f), [], 1
    while i < n - 1:
        if np.isnan(m[i]) or np.isnan(m[i - 1]) or not (c[i] > m[i] and c[i - 1] <= m[i - 1]):
            i += 1
            continue
        j = i + 1
        k = next((x for x in range(j, n - 1) if c[x] < m[x]), None)
        if k is None:
            out.append((i, f.date.iat[i], np.nan, "OPEN", 0))
            break
        out.append((i, f.date.iat[i], o[k + 1] / o[j] - 1 - COST, "CROSS_DOWN", k + 1 - j + 1))
        i = k + 2
    return out


def ours(f, on_close=True):
    sig = RL.ma200_signal(f)
    o, l, c, atr = f.open.to_numpy(), f.low.to_numpy(), f.close.to_numpy(), f.atr.to_numpy()
    n, busy, out = len(f), -1, []
    for i in np.flatnonzero(sig):
        if i <= busy or i + 1 >= n or np.isnan(atr[i]):
            continue
        j, stop = i + 1, c[i] - 4 * atr[i]
        end = min(j + 60, n)
        k, px, how = end - 1, c[end - 1], ("REVIEW" if j + 60 <= n else "OPEN")
        for m in range(j, end):
            if on_close and c[m] <= stop:
                k, px, how = m, c[m], "STOP"
                break
            if not on_close and l[m] <= stop:
                k, px, how = m, min(o[m], stop), "STOP"
                break
        busy = k
        out.append((i, f.date.iat[i], px / o[j] - 1 - COST, how, k - j + 1))
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
            "avg_pct": round(100 * t.net.mean(), 2), "avg_win_pct": round(100 * t.net[w].mean(), 1),
            "avg_loss_pct": round(100 * t.net[~w].mean(), 1), "avg_days": round(t.days.mean()),
            "profit_per_lakh": round(100000 * t.net.mean()), "stopped_pct": round(100 * (t.how == "STOP").mean(), 1)}


def periods(t):
    return {"2019_23": stats(t[t.date < IS_END], 4.5), "2024_26": stats(t[t.date >= IS_END], 2.83), "all": stats(t, 7.33)}


if __name__ == "__main__":
    P, O, OL = collect(plain), collect(ours), collect(lambda f: ours(f, on_close=False))
    # Which signals each one takes: an ours buy "shared" when plain also bought the same stock within 5 sessions.
    near = lambda a, b: {(s, i) for s, i in zip(a.symbol, a.i) if any(abs(i - x) <= 5 for x in b.get(s, ()))}
    pi = P.groupby("symbol").i.apply(list).to_dict()
    oi = O.groupby("symbol").i.apply(list).to_dict()
    o_shared = near(O, pi)
    p_shared = near(P, oi)
    O["kind"] = [("both" if (s, i) in o_shared else "ours only") for s, i in zip(O.symbol, O.i)]
    P["kind"] = [("both" if (s, i) in p_shared else "plain only") for s, i in zip(P.symbol, P.i)]
    rep = {"plain": periods(P), "ours": periods(O), "ours_low_stop": periods(OL),
           "ours_only": stats(O[O.kind == "ours only"], 7.33), "ours_shared": stats(O[O.kind == "both"], 7.33),
           "plain_only": stats(P[P.kind == "plain only"], 7.33), "plain_shared": stats(P[P.kind == "both"], 7.33)}
    # A day that dipped under the stop but closed above it: how many of ours would the low-based stop have sold?
    rep["saved_by_close_stop"] = int(((OL.how == "STOP").sum()) - ((O.how == "STOP").sum()))
    ex = {}
    for s in ("SUZLON", "ADANIPORTS", "MARUTI"):
        ex[s] = {"plain": [(str(d.date()), round(100 * x, 1)) for _, d, x, h, _ in plain(FR[s]) if d >= pd.Timestamp("2024-01-01") and h != "OPEN"],
                 "ours": [(str(d.date()), round(100 * x, 1), h) for _, d, x, h, _ in ours(FR[s]) if d >= pd.Timestamp("2024-01-01") and h != "OPEN"]}
    rep["examples"] = ex
    json.dump(rep, open(B.D / "compare_200dma.json", "w"), indent=1, default=float)
    for k in ("plain", "ours", "ours_low_stop"):
        for p in ("2019_23", "2024_26", "all"):
            print(k, p, rep[k][p])
    for k in ("ours_only", "ours_shared", "plain_only", "plain_shared", "saved_by_close_stop"):
        print(k, rep[k])
    print(json.dumps(ex))
