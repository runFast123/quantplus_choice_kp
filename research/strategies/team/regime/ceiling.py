"""Hindsight ceiling (LOOK-AHEAD, upper bound only): with perfect knowledge of 2021-26, switch off (rule, regime) cells
in order of lowest made% while ALL sum% stays >= 90 % of static in 2021-26. How much made% could regime switching buy?"""
import sys
from pathlib import Path
import pandas as pd
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent)); sys.path.insert(0, str(HERE))
import evaluate as E, regimes as G
t = E.load(); mkt = G.market()
oos = t[t.signal_date >= "2021-01-01"]
S0 = oos.net.sum()
for d in G.FIXED:
    o = oos.assign(reg=G.label(mkt, d).reindex(oos.signal_date).to_numpy())
    cells = o.groupby(["rule", "reg"]).net.agg(made=lambda x: (x > 0).mean(), s="sum").sort_values("made")
    off, best = set(), (100 * (o.net > 0).mean(), 1.0, 0)
    for key, row in cells.iterrows():
        trial = off | {key}
        keep = o[[(r, k) not in trial for r, k in zip(o.rule, o.reg)]]
        if keep.net.sum() < 0.9 * S0:
            continue
        off = trial
        mm = 100 * (keep.net > 0).mean()
        if mm > best[0]:
            best = (mm, keep.net.sum() / S0, len(off))
    print(f"{d} {G.NAMES[d]:16s} best hindsight made% {best[0]:.1f} (static {100*(o.net>0).mean():.1f}), "
          f"sum kept {best[1]:.2f}, cells off {best[2]}")
