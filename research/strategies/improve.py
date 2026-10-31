"""Can RSI reversal and KK be fixed? Pre-registered variants, each aimed at a failure found by diagnose.py.
Choose on 2019-07..2023-12, report 2024-01..2026-10 for every variant (no hiding). Point-in-time top 300 per
year, 0.5 % round-trip cost, signal at the close, entry at the next open (or at a limit price the next day).
'Wrong' = the trade lost money after costs on the variant's own plan.
"""
import numpy as np
import pandas as pd

import signals as S

B, F, A = S.B, S.F, S.A
COST = 0.005
IS_END = pd.Timestamp("2024-01-01")


# ------------------------------------------------------------------ exits: (frame, entry index j, entry price) -> (k, px)
def x_today_rsi(f, j, e):          # today's RSI plan: stop -5 %, target +8 %, or RSI cools from above 70
    for k in range(j, len(f)):
        if f.low.iat[k] <= e * 0.95:
            return k, min(f.open.iat[k], e * 0.95) if k > j else e * 0.95
        if f.high.iat[k] >= e * 1.08:
            return k, max(f.open.iat[k], e * 1.08) if k > j else e * 1.08
        if f.rsi14.iat[k - 1] > 70 and f.rsi14.iat[k] <= 70:
            return k, f.close.iat[k]
    return len(f) - 1, f.close.iat[-1]


def x_bounce(max_days=10, stop_atr=None):
    """Sell into the first bounce: the first close above the 5-day average, or after max_days; optional ATR stop."""
    def run(f, j, e):
        stop = e - stop_atr * f.atr14.iat[j - 1] if stop_atr else None
        end = min(j + max_days, len(f))
        for k in range(j, end):
            if stop is not None and f.low.iat[k] <= stop:
                return k, min(f.open.iat[k], stop) if k > j else stop
            if f.close.iat[k] > f.sma5.iat[k]:
                return k, f.close.iat[k]
        return end - 1, f.close.iat[end - 1]
    return run


def x_kk_today(f, j, e, trig, stop):   # KK: half off at +0.75R, rest at +2R, stop first, 5-session window
    risk = trig - stop
    t1, t2 = trig + 0.75 * risk, trig + 2 * risk
    took = False
    end = min(j + 5, len(f) - 1)
    for m in range(j, end + 1):
        if f.low.iat[m] <= stop:
            return m, (0.5 * t1 + 0.5 * stop) if took else stop
        if f.high.iat[m] >= t2 and (took or f.high.iat[m] >= t1):
            return m, (0.5 * t1 + 0.5 * t2) if took else t2
        if f.high.iat[m] >= t1:
            took = True
    px = f.close.iat[end]
    return end, (0.5 * t1 + 0.5 * px) if took else px


def x_kk_short_today(f, j, e, trig, stop):
    risk = stop - trig
    t1, t2 = trig - 0.75 * risk, trig - 2 * risk
    took = False
    end = min(j + 5, len(f) - 1)
    for m in range(j, end + 1):
        if f.high.iat[m] >= stop:
            return m, (0.5 * t1 + 0.5 * stop) if took else stop
        if f.low.iat[m] <= t2 and (took or f.low.iat[m] <= t1):
            return m, (0.5 * t1 + 0.5 * t2) if took else t2
        if f.low.iat[m] <= t1:
            took = True
    px = f.close.iat[end]
    return end, (0.5 * t1 + 0.5 * px) if took else px


def x_kk_bounce(max_days=10):           # KK entry, sell into strength: first close above the 5-day average
    def run(f, j, e, trig, stop):
        end = min(j + max_days, len(f))
        for m in range(j, end):
            if f.low.iat[m] <= stop:
                return m, min(f.open.iat[m], stop) if m > j else stop
            if m > j and f.close.iat[m] > f.sma5.iat[m] and f.close.iat[m] > e:
                return m, f.close.iat[m]
        return end - 1, f.close.iat[end - 1]
    return run


def x_kk_short_fade(max_days=10):
    def run(f, j, e, trig, stop):
        end = min(j + max_days, len(f))
        for m in range(j, end):
            if f.high.iat[m] >= stop:
                return m, max(f.open.iat[m], stop) if m > j else stop
            if m > j and f.close.iat[m] < f.sma5.iat[m] and f.close.iat[m] < e:
                return m, f.close.iat[m]
        return end - 1, f.close.iat[end - 1]
    return run


# ------------------------------------------------------------------ runners
def run_close_rule(entry, exit_, limit_atr=None):
    """Signal at close i; entry next open, or (limit) only if the next day trades down to close - k*ATR."""
    rows = []
    for s, f in F.ALL.items():
        f = f.reset_index(drop=True)
        sig = entry(f).fillna(False).to_numpy()
        busy = -1
        for i in np.flatnonzero(sig):
            d = f.date.iat[i]
            if d < B.START or i + 1 >= len(f) or i <= busy or s not in S.pit.get(d.year, ()):
                continue
            j = i + 1
            if limit_atr:
                lim = f.close.iat[i] - limit_atr * f.atr14.iat[i]
                if f.low.iat[j] > lim:
                    continue                      # no fill: the dip did not come
                e = min(f.open.iat[j], lim)
            else:
                e = f.open.iat[j]
            k, px = exit_(f, j, e)
            busy = k
            rows.append((d, px / e - 1 - COST, k - j + 1))
    return pd.DataFrame(rows, columns=["date", "net", "days"])


def kk_events(f, side):
    """KK signal + confirmation exactly as the app (backtest-engine.ts): yields (i, j, fill, trigger, stop)."""
    h, l, o = f.high.to_numpy(), f.low.to_numpy(), f.open.to_numpy()
    n = len(f)
    for i in range(20, n):
        lo20, hi20 = l[i - 20:i].min(), h[i - 20:i].max()
        if side == "buy" and l[i] <= lo20 * 0.99:
            trig, stop = h[i], l[i]
            for k in range(i + 1, min(i + 5, n - 1) + 1):
                if h[k] >= trig:
                    yield i, k, max(o[k], trig), trig, stop
                    break
        if side == "sell" and h[i] >= hi20 * 1.01:
            trig, stop = l[i], h[i]
            for k in range(i + 1, min(i + 5, n - 1) + 1):
                if l[k] <= trig:
                    yield i, k, min(o[k], trig), trig, stop
                    break


def run_kk(side, filt, exit_):
    rows = []
    for s, f in F.ALL.items():
        f = f.reset_index(drop=True)
        ok = filt(f).fillna(False).to_numpy()
        busy = -1
        for i, j, e, trig, stop in kk_events(f, side):
            d = f.date.iat[i]
            if d < B.START or i <= busy or j <= busy or s not in S.pit.get(d.year, ()) or not ok[i]:
                continue
            if abs(trig - stop) <= 0:
                continue
            k, px = exit_(f, j, e, trig, stop)
            busy = k
            r = px / e - 1 if side == "buy" else 1 - px / e
            rows.append((d, r - COST, k - j + 1))
    return pd.DataFrame(rows, columns=["date", "net", "days"])


def summary(t):
    def one(g):
        if g.empty:
            return "no trades"
        w = g.net > 0
        pf = g.net[w].sum() / -g.net[~w].sum() if (~w).any() else np.inf
        yrs = (g.date.max() - g.date.min()).days / 365.25 or 1
        return (f"{len(g):5d} ({len(g)/yrs:4.0f}/yr) wrong {100*(1-w.mean()):4.1f}% avg {100*g.net.mean():+5.2f}% "
                f"PF {pf:4.2f} days {g.days.mean():4.1f}")
    return f"2019-23: {one(t[t.date < IS_END])} | 2024-26: {one(t[t.date >= IS_END])}"


not_stormy = lambda f: f.wx != "stormy"
up = lambda f: f.close > f.sma200
rsi14_up = lambda f: (f.rsi14.shift() < 30) & (f.rsi14 >= 30)
rsi2_low = lambda f: f.rsi2 < 10

RSI = {
    "R0 today: RSI14 back above 30; -5%/+8%/RSI70": (rsi14_up, x_today_rsi, None),
    "R1 R0, uptrend stocks only (above 200d)": (lambda f: rsi14_up(f) & up(f), x_today_rsi, None),
    "R2 R0 trigger, sell into first bounce (10d max)": (rsi14_up, x_bounce(10), None),
    "R3 R2 + dip entry (limit 0.5 ATR under close)": (rsi14_up, x_bounce(10), 0.5),
    "R4 R3 + not stormy": (lambda f: rsi14_up(f) & not_stormy(f), x_bounce(10), 0.5),
    "R5 RSI2<10 in uptrend, sell into bounce": (lambda f: rsi2_low(f) & up(f), x_bounce(10), None),
    "R6 R5 + dip entry 0.5 ATR": (lambda f: rsi2_low(f) & up(f), x_bounce(10), 0.5),
    "R7 R6 + not stormy": (lambda f: rsi2_low(f) & up(f) & not_stormy(f), x_bounce(10), 0.5),
    "R8 R6 + 3 ATR stop": (lambda f: rsi2_low(f) & up(f), x_bounce(10, 3.0), 0.5),
    "R9 R6 + dip entry 1.0 ATR": (lambda f: rsi2_low(f) & up(f), x_bounce(10), 1.0),
}
KK = {
    "K0 today: buys": ("buy", lambda f: f.close > 0, x_kk_today),
    "K1 buys in uptrend stocks": ("buy", up, x_kk_today),
    "K2 K1 + not stormy": ("buy", lambda f: up(f) & not_stormy(f), x_kk_today),
    "K3 K2 + signal day range <= 1.5 ATR": ("buy", lambda f: up(f) & not_stormy(f) & ((f.high - f.low) <= 1.5 * f.atr14.shift()), x_kk_today),
    "K4 today's entry, sell into strength (10d)": ("buy", lambda f: f.close > 0, x_kk_bounce(10)),
    "K5 K2 + sell into strength": ("buy", lambda f: up(f) & not_stormy(f), x_kk_bounce(10)),
    "K6 K3 + sell into strength": ("buy", lambda f: up(f) & not_stormy(f) & ((f.high - f.low) <= 1.5 * f.atr14.shift()), x_kk_bounce(10)),
    "S0 today: shorts": ("sell", lambda f: f.close > 0, x_kk_short_today),
    "S1 shorts in downtrend stocks (below 200d)": ("sell", lambda f: f.close < f.sma200, x_kk_short_today),
    "S2 S1 + market not sunny": ("sell", lambda f: (f.close < f.sma200) & (f.wx != "sunny"), x_kk_short_today),
    "S3 S1 + cover into weakness (10d)": ("sell", lambda f: f.close < f.sma200, x_kk_short_fade(10)),
}

if __name__ == "__main__":
    for s, f in F.ALL.items():
        f["sma5"] = f.close.rolling(5, min_periods=5).mean()
    print("RSI reversal variants")
    for name, (e, x, lim) in RSI.items():
        t = run_close_rule(e, x, lim)
        t.to_csv(B.D / f"improve_{name.split()[0]}.csv", index=False)
        print(f"  {name:48s} {summary(t)}")
    print("\nKK variants")
    for name, (side, filt, x) in KK.items():
        t = run_kk(side, filt, x)
        t.to_csv(B.D / f"improve_{name.split()[0]}.csv", index=False)
        print(f"  {name:48s} {summary(t)}")
