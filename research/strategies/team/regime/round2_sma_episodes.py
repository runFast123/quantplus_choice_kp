"""Diagnostic only (not a variant): how many separate episodes carry N1's one passing rule (sma_trend)?"""
import warnings
warnings.filterwarnings("ignore")
import numpy as np
import pandas as pd
import importlib.util
from pathlib import Path
HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("r2", HERE / "round2.py"); R = importlib.util.module_from_spec(spec)
spec.loader.exec_module(R)
for name, d in (("N1 trend x fear", "R1"), ("N2 weather", "R0")):
    pk, pr, lab = R.state_labels(R.G.label(R.MKT, d))
    o = R.OOS.assign(lab=lab, st=R.G.label(R.MKT, d).reindex(R.OOS.signal_date).to_numpy())
    s = o[o.rule == "sma_trend"]
    s = s.assign(yr=s.signal_date.dt.year, mon=s.signal_date.dt.to_period("M"))
    print(f"\n== sma_trend, {name}")
    print("by year: made% better / worse (n)")
    print(s.groupby(["yr", "lab"]).y.agg(lambda x: f"{100*x.mean():.0f}% ({len(x)})").unstack().to_string())
    print("distinct signal months: better", s[s.lab == 1].mon.nunique(), " worse", s[s.lab == 0].mon.nunique())
    print("state x label counts:\n", s.groupby(["st", "lab"]).size().unstack(fill_value=0).to_string())
    mm = s.groupby(["mon", "lab"]).y.mean().unstack()
    print("month-level means: better", round(100 * mm[1].mean(), 1), "worse", round(100 * mm[0].mean(), 1),
          "| months with both labels:", int(mm.dropna().shape[0]))
