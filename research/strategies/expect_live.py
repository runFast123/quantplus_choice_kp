"""Independent re-implementation of migration 33's weather + Strong trend rule, run on the live-candle copy.
Writes data/expected_signals.csv (symbol, signal_type, day, stop, result) for comparison with the SQL."""
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

import numpy as np
import pandas as pd

D = Path(__file__).parent / "data"
c = pd.read_parquet(D / "live_candles.parquet")
c["ts"] = pd.to_datetime(c.ts, utc=True)
c["day"] = c.ts.dt.tz_convert("Asia/Kolkata").dt.date
sy = pd.read_csv(D / "live_symbols.csv")

nf = c[c.symbol == "NIFTY"].sort_values("ts").reset_index(drop=True)
vx = c[c.symbol == "INDIAVIX"].sort_values("ts").set_index("ts").close
s50 = nf.close.rolling(50, min_periods=50).mean()
s200 = nf.close.rolling(200, min_periods=200).mean()
state = {}
for i, r in nf.iterrows():
    w = vx[(vx.index <= r.ts) & (vx.index > r.ts - pd.Timedelta(days=7))]
    v = w.iloc[-1] if len(w) else None
    if np.isnan(s200[i]) or np.isnan(s50[i]):
        st = None
    elif (r.close < s200[i] and s50[i] < s200[i]) or (v is not None and v > 22):
        st = "stormy"
    elif r.close > s200[i] and s50[i] > s200[i]:
        st = "sunny"
    else:
        st = "mixed"
    state[r.day] = st
print("weather days", len(state), {k: sum(1 for x in state.values() if x == k) for k in ("sunny", "mixed", "stormy", None)})
print("latest weather", max(state), state[max(state)])


def r2(x):
    return float(Decimal(str(x)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


out = []
eq = sy[(sy.segment == "equity") & (sy.mcap_rank <= 500)].symbol
for s in eq:
    f = c[c.symbol == s].sort_values("ts").reset_index(drop=True)
    n = len(f)
    if n < 254:
        continue
    o, h, l, cl, v = (f[k].astype(float).to_numpy() for k in ("open", "high", "low", "close", "volume"))
    prev = np.r_[np.nan, cl[:-1]]
    tr = np.nanmax(np.vstack([h - l, np.abs(h - prev), np.abs(l - prev)]), axis=0)
    busy = -1
    for i in range(n):
        if i <= busy or i < 252 or i < 50 or i < 13:
            continue
        if state.get(f.day[i]) != "sunny":
            continue
        hi = cl[i - 252:i].max()
        vol50 = v[i - 50:i].mean()
        sma50 = cl[max(0, i - 49):i + 1].mean()
        atr = tr[i - 13:i + 1].mean()
        if not (cl[i] > hi and v[i] >= 2 * vol50 and cl[i] > sma50):
            continue
        stop = r2(cl[i] - 4 * atr)
        if stop <= 0:
            continue
        out.append((s, "buy", f.day[i], stop, None))
        j = i + 1
        if j >= n:
            busy = n
            continue
        k = None
        for m in range(j, min(j + 60, n)):
            if l[m] <= stop:
                k, how = m, "STOP_HIT"
                break
        if k is None:
            if j + 59 >= n:
                busy = n
                continue
            k, how = j + 59, "REVIEW_60"
        busy = k
        out.append((s, "exit", f.day[k], None, how))

e = pd.DataFrame(out, columns=["symbol", "signal_type", "day", "stop", "result"])
e.to_csv(D / "expected_signals.csv", index=False)
print("expected:", (e.signal_type == "buy").sum(), "buys,", (e.signal_type == "exit").sum(), "exits;",
      "open now:", (e.signal_type == "buy").sum() - (e.signal_type == "exit").sum(), "| first", e.day.min(), "last", e.day.max())
