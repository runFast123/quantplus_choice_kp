"""Stay-in Plan: does holding a trend longer beat the trend rules' 60-session plan? (17 Nov 2026)

The owner's motive: catch a stock around Rs 200 and stay in for the move to Rs 400, instead of selling at Rs 230. The
four trend rules today sell at a safety stop (signal close - 4 x ATR14) or on the 60th session. This tests exits that
let a trend run. Everything below was written down BEFORE the first run.

Signals: the four live trend rules' buys exactly as early_entry.rules() builds them from their record scripts
(strong_trend, sma_trend, ma200_trend, secular_trend; each year's 300 most traded NSE stocks), pooled. Entry at the
next open. Every variant keeps the same safety stop from the first day: signal close - 4 x ATR14 (simple 14-day ATR,
as record.py). A day whose low reaches a stop sells at the stop, or at the open if it opened below it.
  plan        today's plan: the safety stop, or the 60th session's close.
  trail3      chandelier: after each close the stop rises to (highest close since entry - 3 x ATR14 of that day) when
              that is higher; it never falls. No time limit.
  trail5      the same with 5 x ATR14 (looser: rides more shakeouts).
  ma200       out at the first close below the 200-day average (the safety stop still applies). No time limit.
  A trade still open when the prices end is marked at the last close (it counts in the portfolio, not in closed-trade
  results).

Portfolio (portfolio.simulate): Rs split into 10 equal slots; each day new signals take free slots, strongest 6-month
return first; one position per stock; daily marked to market; costs 0.5 % round trip (B.COST set to 0.005 here, as the
records). Periods: choose on 2019-07..2023-12, check on 2024-01..2026-10.

Decision (written before the run):
  1. Of trail3, trail5 and ma200, choose the one with the highest CAGR in 2019-07..2023-12 whose worst fall is no more
     than 5 points deeper than the plan's in that period.
  2. It PASSES if in 2024-01..2026-10 its CAGR is at least the plan's and its worst fall is no more than 5 points deeper
     than the plan's. Otherwise the Stay-in Plan does not become a rule or an exit message: at most the research is
     shown as research. Nothing is tuned after the first run.
Also reported, per variant and period, from every signal taken on its own (not the portfolio): closed trades, made
money, median and mean result, median sessions held, and the share that made 50 % or more.

    python stay_in.py   -> data/stay_in.json
"""
import json

import numpy as np
import pandas as pd

import backtest as B
import early_entry as E
import portfolio as P
import record as R

B.COST = 0.005
TREND = ["strong_trend", "sma_trend", "ma200_trend", "secular_trend"]
OOS_END = pd.Timestamp("2027-01-01")
PERIODS = {"2019-23": (B.START, B.IS_END), "2024-26": (B.IS_END, OOS_END)}
DD_SLACK = 0.05
ATR = {s: R.atr_simple(f).to_numpy() for s, f in B.stocks.items()}


def signal_days():
    """symbol -> set of signal dates (the four trend rules' buys, pooled)."""
    E.K.attach()
    out = {}
    for rule, t in E.rules().items():
        if rule not in TREND:
            continue
        for r in t.itertuples():
            f = E.L.FR[r.symbol] if rule == "ma200_trend" else E.F.ALL[r.symbol]
            d = pd.Timestamp(f.date.iat[r.i])
            out.setdefault(r.symbol, set()).add(d.tz_localize(None) if d.tzinfo is not None else d)
    return out


SIG = None


def entry(f):
    days = SIG.get(f.symbol.iat[0], set())
    return pd.Series(f.date.isin(days).to_numpy(), index=f.index)


def exit_fn(kind):
    def run(f, j):
        s = f.symbol.iat[0]
        atr = ATR[s]
        o, h, lo, c = f.open.to_numpy(), f.high.to_numpy(), f.low.to_numpy(), f.close.to_numpy()
        sma200 = f.sma200.to_numpy()
        i = j - 1
        a = atr[i] if not np.isnan(atr[i]) else 0.0
        stop = c[i] - 4 * a
        hc = c[i]
        n = len(f)
        end = min(j + 60, n) if kind == "plan" else n
        for k in range(j, end):
            if lo[k] <= stop:
                return k, (min(o[k], stop) if k > j else min(o[k], stop))
            if kind == "ma200" and not np.isnan(sma200[k]) and c[k] < sma200[k]:
                return k, c[k]
            if kind in ("trail3", "trail5"):
                hc = max(hc, c[k])
                m = 3 if kind == "trail3" else 5
                if not np.isnan(atr[k]):
                    stop = max(stop, hc - m * atr[k])
        k = end - 1
        return k, c[k]
    return run


VARIANTS = ["plan", "trail3", "trail5", "ma200"]


def portfolio_stats(eq):
    yrs = (eq.index[-1] - eq.index[0]).days / 365.25
    return {"cagr": round(((eq.iloc[-1] / eq.iloc[0]) ** (1 / yrs) - 1) * 100, 2),
            "worst_fall": round(float((eq / eq.cummax() - 1).min()) * 100, 2),
            "total": round(float(eq.iloc[-1] / eq.iloc[0] - 1) * 100, 1)}


def trade_stats(kind, lo, hi):
    """Every signal on its own (no slots): closed trades only."""
    x = exit_fn(kind)
    res, held = [], []
    for s, f in B.stocks.items():
        days = SIG.get(s)
        if not days:
            continue
        for i in np.flatnonzero(f.date.isin(days).to_numpy()):
            d = f.date.iat[i]
            if not (lo <= d < hi) or i + 1 >= len(f):
                continue
            j = i + 1
            k, px = x(f, j)
            if k == len(f) - 1 and kind != "plan":
                continue                                      # still open when the prices end
            res.append(px / f.open.iat[j] - 1 - B.COST)
            held.append(k - j + 1)
    r = np.array(res)
    if not len(r):
        return {"n": 0}
    return {"n": int(len(r)), "win": round(float((r > 0).mean()) * 100, 1), "median": round(float(np.median(r)) * 100, 2),
            "mean": round(float(r.mean()) * 100, 2), "held_median": int(np.median(held)),
            "big50": round(float((r >= 0.5).mean()) * 100, 1)}


def main():
    global SIG
    SIG = signal_days()
    print("signals", sum(len(v) for v in SIG.values()), flush=True)
    out = {"portfolio": {}, "trades": {}}
    for p, (lo, hi) in PERIODS.items():
        for v in VARIANTS:
            eq, n = P.simulate(entry, exit_fn(v), lo, hi)
            st = portfolio_stats(eq) | {"trades": n}
            out["portfolio"].setdefault(p, {})[v] = st
            out["trades"].setdefault(p, {})[v] = trade_stats(v, lo, hi)
            print(f"{p} {v:7s} portfolio {st}  trades {out['trades'][p][v]}", flush=True)

    is_, oos = out["portfolio"]["2019-23"], out["portfolio"]["2024-26"]
    ok = [v for v in ("trail3", "trail5", "ma200") if is_[v]["worst_fall"] >= is_["plan"]["worst_fall"] - DD_SLACK * 100]
    chosen = max(ok, key=lambda v: is_[v]["cagr"]) if ok else None
    passed = bool(chosen) and oos[chosen]["cagr"] >= oos["plan"]["cagr"] and \
        oos[chosen]["worst_fall"] >= oos["plan"]["worst_fall"] - DD_SLACK * 100
    out["decision"] = {"chosen": chosen, "passed": passed}
    print("decision", out["decision"])
    (B.D / "stay_in.json").write_text(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
