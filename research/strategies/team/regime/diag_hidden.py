"""Diagnostic (not a variant): what did the hidden trades of each D1 variant actually do out of sample?"""
import sys
from pathlib import Path
import pandas as pd
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent)); sys.path.insert(0, str(HERE))
import evaluate as E, regimes as G, walk as W
t = E.load(); mkt = G.market(); cache = {}
for d in G.ALL_DEFS:
    dec, log = W.run(t, d, "D1", mkt=mkt, cache=cache)
    h = dec[~dec["take"]]
    g = h.groupby(["rule", "reg"]).agg(n=("net", "size"), made=("net", lambda x: round(100 * (x > 0).mean(), 1)),
                                     avg=("net", lambda x: round(100 * x.mean(), 2)), sum=("net", lambda x: round(100 * x.sum())),
                                     first=("signal_date", "min"), last=("signal_date", "max"))
    print(f"\n## {d} {G.NAMES[d]}: hidden trades out of sample"); print(g.to_string())
