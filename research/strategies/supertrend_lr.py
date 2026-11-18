"""The owner's SuperTrend + 195-day regression rule (17 Nov 2026): should it become a signal rule?

Everything below was written down BEFORE the first run. The owner's parameters are used exactly as given; nothing is
chosen or tuned, so both periods are tests (2019-07..2023-12 and the 2024-01..2026-10 check), reported side by side.

The rule (owner's words, from the chat):
  trend filter  the 25-day linear-regression slope of the 195-day simple average of closes is above 0.
  SuperTrend    ATR 10 (Wilder, as TradingView / AmiBroker), multiplier 3.0, on (high + low) / 2.
  setup         a day the SuperTrend turns from red (down) to green (up) while the slope is above 0.
  confirmation  the first later day that CLOSES above the setup day's high + 0.05. If the SuperTrend turns red first,
                the setup is cancelled (a new red-to-green turn makes a new setup).
  buy           the next day's open after the confirmation.
  sell          the next day's open after the first day the SuperTrend turns red. No target, no fixed stop.
  One trade per stock at a time. A trade still open when the prices end is marked at the last close.

Research set, as every other rule: each calendar year's 300 most traded stocks (fair.pit_universe, the six months
before), confirmations from 2019-07 on; costs 0.5 % round trip. Indicators come from candles_long (from 2010), so the
195-day average has its full history on day one.

Reported:
  trades      every signal on its own: count, made money, median and mean after costs, median sessions held, worst,
              share making 50 % or more.
  random      the same exit from random days on the same side of the filter (slope > 0 and SuperTrend green, in the
              research set), as many as the rule's signals, 5 seeds: does the setup + confirmation add anything?
  portfolio   (a) the owner's sizing: at most 6 open positions, 12 % of equity each;
              (b) the house's 10 equal slots, comparable with the trend rules' record in data/stay_in.json.
              New signals take free slots, strongest 6-month return first. Nifty 50 held, for reference.
  overlap     share of its signals within 10 sessions after one of the four live trend rules' buys on the same stock
              (from early_entry.rules()) - is it a new signal or a repeat of ones we already send?

Verdict (written before the run). Recommend adding it only if, in BOTH periods:
  1. the mean trade after costs is above 0 and above the random yardstick's mean; and
  2. the 10-slot portfolio's CAGR is at least the random yardstick's portfolio and at least the Nifty 50's;
  and in 2024-01..2026-10 its 10-slot CAGR is at least the four trend rules' 60-session plan (stay_in.json).
  Otherwise: not added as a rule; at most shown as research.

    python supertrend_lr.py   -> data/supertrend_lr.json
"""
import json
import sys

import numpy as np
import pandas as pd

import backtest as B
import fair as FA

COST = 0.005
MA, LR, ATRN, MULT, TICK = 195, 25, 10, 3.0, 0.05
START, IS_END, END = B.START, B.IS_END, pd.Timestamp("2027-01-01")
PERIODS = {"2019-23": (START, IS_END), "2024-26": (IS_END, END)}

PIT = {y: FA.pit_universe(pd.Timestamp(f"{y}-01-01") if y > 2019 else START) for y in range(2019, 2027)}


def lr_slope(y, n):
    """Least-squares slope of the last n values (per session)."""
    x = np.arange(n) - (n - 1) / 2
    w = x / (x ** 2).sum()
    out = np.full(len(y), np.nan)
    v = y.to_numpy()
    for i in range(n - 1, len(v)):
        seg = v[i - n + 1:i + 1]
        if not np.isnan(seg).any():
            out[i] = (seg * w).sum()
    return out


def supertrend(h, l, c, n=ATRN, m=MULT):
    """Direction +1 (green) / -1 (red), as TradingView's ta.supertrend; 0 before the ATR exists."""
    pc = np.r_[np.nan, c[:-1]]
    tr = np.nanmax(np.vstack([h - l, np.abs(h - pc), np.abs(l - pc)]), axis=0)
    atr = pd.Series(tr).ewm(alpha=1 / n, adjust=False, min_periods=n).mean().to_numpy()
    src = (h + l) / 2
    up0, dn0 = src - m * atr, src + m * atr
    up, dn, d = up0.copy(), dn0.copy(), np.zeros(len(c), dtype=int)
    for i in range(len(c)):
        if np.isnan(atr[i]):
            continue
        if i == 0 or np.isnan(atr[i - 1]):
            d[i] = 1
            continue
        if c[i - 1] > up[i - 1]:
            up[i] = max(up0[i], up[i - 1])
        if c[i - 1] < dn[i - 1]:
            dn[i] = min(dn0[i], dn[i - 1])
        if d[i - 1] == -1 and c[i] > dn[i - 1]:
            d[i] = 1
        elif d[i - 1] == 1 and c[i] < up[i - 1]:
            d[i] = -1
        else:
            d[i] = d[i - 1]
    return d


def frame(f):
    f = f.sort_values("date").reset_index(drop=True)
    f["sma"] = f.close.rolling(MA, min_periods=MA).mean()
    f["slope"] = lr_slope(f.sma, LR)
    f["dir"] = supertrend(f.high.to_numpy(), f.low.to_numpy(), f.close.to_numpy())
    f["ret126"] = f.close / f.close.shift(126) - 1
    sym = f.symbol.iat[0]
    f["pit"] = np.array([sym in PIT.get(y, ()) for y in f.date.dt.year]) & (f.date >= START).to_numpy()
    return f


def exit_from(f, j):
    """Sell at the next open after the first red day on or after the entry day; else the last close."""
    d, o, c = f["dir"].to_numpy(), f.open.to_numpy(), f.close.to_numpy()
    for x in range(j, len(f) - 1):
        if d[x] == -1:
            return x + 1, o[x + 1]
    return len(f) - 1, c[-1]


def trades(f):
    """(signal i = confirmation day, entry j, exit k, exit px) for the exact rule, one at a time."""
    d, slope, h, c = f["dir"].to_numpy(), f.slope.to_numpy(), f.high.to_numpy(), f.close.to_numpy()
    n, out, i = len(f), [], 1
    while i < n:
        if d[i - 1] == -1 and d[i] == 1 and slope[i] > 0:               # setup
            trig, conf = h[i] + TICK, None
            for k in range(i + 1, n):
                if d[k] != 1:
                    break                                               # turned red first: cancelled
                if c[k] > trig:
                    conf = k
                    break
            if conf is None or conf + 1 >= n:
                i += 1
                continue
            j = conf + 1
            k, px = exit_from(f, j)
            out.append((conf, j, k, px))
            i = k if k > i else i + 1                                   # next setup only after this trade is sold
            continue
        i += 1
    return out


def stats(rows):
    r = np.array([x[0] for x in rows])
    held = [x[1] for x in rows]
    if not len(r):
        return {"n": 0}
    return {"n": int(len(r)), "win": round(float((r > 0).mean()) * 100, 1), "median": round(float(np.median(r)) * 100, 2),
            "mean": round(float(r.mean()) * 100, 2), "held_median": int(np.median(held)),
            "worst": round(float(r.min()) * 100, 1), "big50": round(float((r >= 0.5).mean()) * 100, 1)}


def simulate(sigs, frames, closes, lo, hi, slots, frac):
    """Daily portfolio: sigs = list of (symbol, j, k, px, rank key). frac = share of equity per new position."""
    by_date = {}
    for s, j, k, px, key in sigs:
        d = frames[s].date.iat[j]
        if lo <= d < hi:
            by_date.setdefault(d, []).append((key, s, j, k, px))
    dates = sorted(d for d in B.idx.date if lo <= d < hi)
    pos, cash, eq, n = {}, 1.0, [], 0
    for d in dates:
        for s in list(pos):
            j, k, px, alloc, e = pos[s]
            if frames[s].date.iat[k] <= d:
                cash += alloc * (px / e) * (1 - COST / 2)
                del pos[s]
        for _, s, j, k, px in sorted(by_date.get(d, []), key=lambda t: t[0]):
            if len(pos) >= slots or s in pos:
                continue
            e = frames[s].open.iat[j]
            val = cash + sum(a * (closes[t].get(d, e0) / e0) for t, (_, _, _, a, e0) in pos.items())
            alloc = min(cash, val * frac) * (1 - COST / 2)
            if alloc <= 0:
                break
            cash -= alloc / (1 - COST / 2)
            pos[s] = (j, k, px, alloc, e)
            n += 1
        val = cash + sum(a * (closes[t].get(d, e0) / e0) for t, (_, _, _, a, e0) in pos.items())
        eq.append((d, val))
    eq = pd.Series(dict(eq))
    yrs = (eq.index[-1] - eq.index[0]).days / 365.25
    return {"cagr": round(((eq.iloc[-1] / eq.iloc[0]) ** (1 / yrs) - 1) * 100, 2),
            "worst_fall": round(float((eq / eq.cummax() - 1).min()) * 100, 2),
            "total": round(float(eq.iloc[-1] / eq.iloc[0] - 1) * 100, 1), "trades": n}


def nifty(lo, hi):
    s = B.idx.set_index("date").close
    s = s[(s.index >= lo) & (s.index < hi)]
    yrs = (s.index[-1] - s.index[0]).days / 365.25
    return {"cagr": round(((s.iloc[-1] / s.iloc[0]) ** (1 / yrs) - 1) * 100, 2),
            "worst_fall": round(float((s / s.cummax() - 1).min()) * 100, 2)}


def main():
    raw = pd.read_parquet(B.D / "candles_long.parquet").dropna(subset=["open", "high", "low", "close"])
    raw = raw[(raw.close > 0) & (raw.open > 0) & ~raw.symbol.str.startswith("^")]
    frames = {s: frame(f.copy()) for s, f in raw.groupby("symbol") if s in FA.ALL and len(f) > 300}
    closes = {s: f.set_index("date").close for s, f in frames.items()}
    print("stocks", len(frames), flush=True)

    rule = []     # (symbol, i, j, k, px)
    for s, f in frames.items():
        pit = f.pit.to_numpy()
        for i, j, k, px in trades(f):
            if pit[i]:
                rule.append((s, i, j, k, px))
    print("signals", len(rule), flush=True)

    def per_trade(rows, lo, hi):
        out = []
        for s, i, j, k, px in rows:
            f = frames[s]
            if not (lo <= f.date.iat[i] < hi) or k == len(f) - 1:
                continue                                              # outside the period, or still open
            out.append((px / f.open.iat[j] - 1 - COST, k - j + 1))
        return out

    def key(s, i):
        r = frames[s].ret126.iat[i]
        return -(r if not np.isnan(r) else -9)

    # random days on the same side of the filter, same exit
    elig = {s: ((f.slope > 0) & (f["dir"] == 1)).to_numpy() & f.pit.to_numpy() for s, f in frames.items()}
    tot = sum(int(v.sum()) for v in elig.values())
    rnd = []
    for seed in range(5):
        rng = np.random.default_rng(seed)
        p = len(rule) / tot
        rows = []
        for s, f in frames.items():
            busy = -1
            for i in np.flatnonzero(elig[s] & (rng.random(len(f)) < p)):
                if i <= busy or i + 1 >= len(f):
                    continue
                k, px = exit_from(f, i + 1)
                rows.append((s, i, i + 1, k, px))
                busy = k
        rnd.append(rows)

    # overlap with the four live trend rules' buys
    overlap = None
    try:
        import early_entry as E
        E.K.attach()
        live = {}
        for name, t in E.rules().items():
            if name in ("strong_trend", "sma_trend", "ma200_trend", "secular_trend"):
                for r in t.itertuples():
                    fr = E.L.FR[r.symbol] if name == "ma200_trend" else E.F.ALL[r.symbol]
                    dd = pd.Timestamp(fr.date.iat[r.i])
                    live.setdefault(r.symbol, []).append(dd.tz_localize(None) if dd.tzinfo else dd)
        hit = 0
        for s, i, j, k, px in rule:
            ds = frames[s].date
            d, lo_d = ds.iat[i], ds.iat[max(0, i - 10)]
            if any(lo_d <= x <= d for x in live.get(s, ())):
                hit += 1
        overlap = round(hit / max(1, len(rule)) * 100, 1)
    except Exception as e:                                            # report, never hide
        print("overlap skipped:", repr(e), file=sys.stderr)

    out = {"params": {"ma": MA, "lr": LR, "atr": ATRN, "mult": MULT, "tick": TICK, "cost": COST},
           "signals": len(rule), "overlap_live_trend_pct": overlap, "periods": {}}
    for p, (lo, hi) in PERIODS.items():
        rs = [stats(per_trade(r, lo, hi)) for r in rnd]
        sig = [(s, j, k, px, key(s, i)) for s, i, j, k, px in rule]
        rp = [simulate([(s, j, k, px, key(s, i)) for s, i, j, k, px in r], frames, closes, lo, hi, 10, 0.10)["cagr"]
              for r in rnd]
        out["periods"][p] = {
            "trades": stats(per_trade(rule, lo, hi)),
            "random_trades_mean": round(float(np.mean([x["mean"] for x in rs])), 2),
            "random_trades_win": round(float(np.mean([x["win"] for x in rs])), 1),
            "owner_6x12": simulate(sig, frames, closes, lo, hi, 6, 0.12),
            "slots_10": simulate(sig, frames, closes, lo, hi, 10, 0.10),
            "random_slots_10_cagr": round(float(np.mean(rp)), 2),
            "random_slots_10_range": [round(min(rp), 1), round(max(rp), 1)],
            "nifty50": nifty(lo, hi),
        }
        print(p, json.dumps(out["periods"][p]), flush=True)

    ref = json.loads((B.D / "stay_in.json").read_text())["portfolio"]
    ok = True
    for p in PERIODS:
        x = out["periods"][p]
        ok &= x["trades"]["mean"] > 0 and x["trades"]["mean"] > x["random_trades_mean"]
        ok &= x["slots_10"]["cagr"] >= x["random_slots_10_cagr"] and x["slots_10"]["cagr"] >= x["nifty50"]["cagr"]
    ok &= out["periods"]["2024-26"]["slots_10"]["cagr"] >= ref["2024-26"]["plan"]["cagr"]
    out["trend_rules_plan_10slots"] = {p: ref[p]["plan"] for p in PERIODS}
    out["verdict"] = {"add": bool(ok)}
    print("verdict", out["verdict"], "overlap", overlap)
    (B.D / "supertrend_lr.json").write_text(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
