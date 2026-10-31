import numpy as np, pandas as pd
import signals as S
import record as R
B, F = S.B, S.F
out = []
for kstop in (2.0, 2.5, 3.0, 4.0, 5.0, None):
    for hold in (40, 60):
        rows = []
        for s, f in F.ALL.items():
            f = f.reset_index(drop=True)
            hi = f.close.rolling(252, min_periods=252).max().shift(1)
            atr = R.atr_simple(f)
            wx = R.WX.reindex(pd.to_datetime(f.date), method="ffill").to_numpy()
            sig = ((f.close > hi) & (f.volume >= 2 * f.vol50) & (f.close > f.sma50) & (wx == "sunny")).to_numpy()
            busy = -1
            for i in np.flatnonzero(sig):
                d = f.date.iat[i]
                if d < B.START or i + 1 >= len(f) or i <= busy or s not in S.pit.get(d.year, ()):
                    continue
                j = i + 1
                stop = f.close.iat[i] - kstop * atr.iat[i] if kstop else -1
                end = min(j + hold, len(f))
                k, px, how = end - 1, f.close.iat[end - 1], "review"
                for m in range(j, end):
                    if f.low.iat[m] <= stop:
                        k, px, how = m, min(f.open.iat[m], stop), "stop"; break
                busy = k
                rows.append((d, px / f.open.iat[j] - 1 - 0.005, how))
        t = pd.DataFrame(rows, columns=["d", "net", "how"])
        for lab, g in (("2019-23", t[t.d < "2024-01-01"]), ("2024-26", t[t.d >= "2024-01-01"])):
            out.append((f"{kstop}xATR" if kstop else "no stop", hold, lab, len(g), 100*(g.net>0).mean(), 100*g.net.mean(), 100*g.net.median(), 100*(g.how=="stop").mean(), 100*g.net.quantile(0.1)))
o = pd.DataFrame(out, columns=["stop","hold","period","n","made money %","avg %","median %","stopped %","worst 10% at"])
print(o.round(1).to_string(index=False))
