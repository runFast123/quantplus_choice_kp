"""200-day trend, the owner's rule as a buy/sell system (2026-11-04 follow-up to improve_lr.py, ADR-040).

The owner restated the rule: buy when the stock closes above its 200-day moving average AND the linear-regression line
of that moving average is flat or rising; the owner expects buy and sell signals and more of them than the live rule
gives (which adds a straightness test on price and waits up to 60 sessions per trade).

  ON(t)    close > MA200(t) and slope100(MA200)(t) >= -0.25 (% per 20 sessions; flat or rising, as in improve_lr.py)
  MA200    simple (SMA) or exponential (EMA, span 200) moving average
  buy      at the next open after ON turns on (the day before measurable and off)
  sell     state:   at the next open after ON turns off (close at/under MA200, or the line falls)
           state+stop: the same, or the 4 x ATR14 safety stop first
           plan:    the live plan (safety stop or the 60th session), no straightness test
Point-in-time top 300, 0.5 % round trip, open trades left out. Reported for 2019-23 and 2024-26 next to the live rule.
"""
import json

import numpy as np
import pandas as pd

import backtest as B
import improve_lr as L
import signals as S

COST = 0.005
IS_END = L.IS_END


def frame(f):
    f = f.copy()
    f["ema200"] = f.close.ewm(span=200, adjust=False, min_periods=200).mean()
    f["ema_slope100"] = 100 * 20 * L.lr_slope(f.ema200, 100) / f.ema200
    return f


FR = {s: frame(f) for s, f in L.FR.items()}


def on_state(f, ma):
    m, sl = (f.sma200, f.slope100) if ma == "sma" else (f.ema200, f.ema_slope100)
    known = m.notna() & sl.notna()
    on = (f.close > m) & (sl >= -0.25)
    return on.to_numpy(), known.to_numpy()


def trades(f, ma, exit_):
    on, known = on_state(f, ma)
    o, l, c, atr = f.open.to_numpy(), f.low.to_numpy(), f.close.to_numpy(), f.atr.to_numpy()
    n, i, out = len(f), 1, []
    while i < n - 1:
        if not (on[i] and known[i] and known[i - 1] and not on[i - 1]) or np.isnan(atr[i]):
            i += 1
            continue
        j = i + 1
        stop = c[i] - 4 * atr[i]
        k, px, how = None, None, None
        last = n - 1 if exit_ != "plan" else min(j + 59, n - 1)
        for m in range(j, last + 1):
            if exit_ in ("state+stop", "plan") and l[m] <= stop:
                k, px, how = m, min(o[m], stop), "STOP"
                break
            if exit_ in ("state", "state+stop") and not on[m] and m + 1 < n:
                k, px, how = m + 1, o[m + 1], "OFF"
                break
        if k is None:
            if exit_ == "plan" and j + 59 <= n - 1:
                k, px, how = j + 59, c[j + 59], "REVIEW"
            else:
                out.append((f.date.iat[i], np.nan, "OPEN", 0))
                break
        out.append((f.date.iat[i], px / o[j] - 1 - COST, how, k - j + 1))
        i = k + 1
    return out


def collect(ma, exit_, pit=True):
    rows = []
    for s, f in FR.items():
        for d, net, how, days in trades(f, ma, exit_):
            if d < B.START or (pit and s not in S.pit.get(d.year, ())) or how == "OPEN":
                continue
            rows.append((s, d, net, how, days))
    return pd.DataFrame(rows, columns=["symbol", "date", "net", "how", "days"])


def line(t):
    w = t.net > 0
    return {"trades": len(t), "per_year": round(len(t) / (4.5 if t.date.min() < IS_END else 2.83)), "made_money_pct": round(100 * w.mean(), 1),
            "avg_pct": round(100 * t.net.mean(), 2), "median_pct": round(100 * t.net.median(), 2),
            "avg_win_pct": round(100 * t.net[w].mean(), 1), "avg_loss_pct": round(100 * t.net[~w].mean(), 1),
            "avg_days": round(t.days.mean(), 1), "stopped_pct": round(100 * (t.how == "STOP").mean(), 1)}


if __name__ == "__main__":
    out = {}
    for ma in ("sma", "ema"):
        for ex in ("state", "state+stop", "plan"):
            t = collect(ma, ex)
            out[f"{ma}|{ex}"] = {"2019_23": line(t[t.date < IS_END]), "2024_26": line(t[t.date >= IS_END])}
            a, b = out[f"{ma}|{ex}"]["2019_23"], out[f"{ma}|{ex}"]["2024_26"]
            print(f"{ma}|{ex:11s} 19-23 {a['trades']:5d} ({a['per_year']}/yr) made {a['made_money_pct']}% avg {a['avg_pct']:+.2f}% "
                  f"days {a['avg_days']} | 24-26 {b['trades']:5d} made {b['made_money_pct']}% avg {b['avg_pct']:+.2f}% "
                  f"win {b['avg_win_pct']} loss {b['avg_loss_pct']} days {b['avg_days']}", flush=True)
    live = json.load(open(B.D / "ma200_trend_record.json"))
    print("live rule  19-23", live["2019_23"]["trades"], live["2019_23"]["made_money_pct"], live["2019_23"]["avg_pct"],
          "| 24-26", live["2024_26"]["trades"], live["2024_26"]["made_money_pct"], live["2024_26"]["avg_pct"])
    for ma in ("sma", "ema"):
        print(f"SUZLON {ma}|state 2024-26:", [(str(d.date()), round(100 * x, 1), h) for d, x, h, _ in trades(FR["SUZLON"], ma, "state") if d >= pd.Timestamp("2024-01-01")])
    json.dump(out, open(B.D / "improve_lr2.json", "w"), indent=1, default=float)
