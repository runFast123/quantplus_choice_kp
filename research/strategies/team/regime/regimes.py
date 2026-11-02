"""Daily market table and the pre-registered regime labels (PLAN.md). Everything is known at that day's close.

    import regimes as G
    m = G.market()                 # one row per date
    lab = G.label(m, "R1")         # Series date -> regime name (fixed definitions)
    lab = G.kmeans_label(m, q0)    # R5: k-means refit on days before quarter start q0
"""
from pathlib import Path

import numpy as np
import pandas as pd

D = Path(__file__).resolve().parents[2] / "data"
FIXED = ["R0", "R1", "R2", "R3", "R4"]
ALL_DEFS = FIXED + ["R5"]
NAMES = {"R0": "weather", "R1": "trend x fear", "R2": "breadth", "R3": "momentum", "R4": "trend x breadth",
         "R5": "k-means 4"}


def _long(name):
    x = pd.read_parquet(D / name)
    x.columns = [c.lower() for c in x.columns]
    return x.sort_values("date").set_index("date").close


def market(vmed_window=252):
    n = _long("NSEI_long.parquet")
    v = _long("INDIAVIX_long.parquet").reindex(n.index, method="ffill")
    m = pd.DataFrame({"nifty": n, "n50": n.rolling(50).mean(), "n200": n.rolling(200).mean(),
                      "r20": n / n.shift(20) - 1, "r60": n / n.shift(60) - 1, "vix": v,
                      "vmed": v.rolling(vmed_window, min_periods=min(120, vmed_window)).median()})
    f = pd.read_parquet(D / "team_features.parquet", columns=["date", "wx", "breadth50"]).drop_duplicates("date")
    f = f.set_index("date").sort_index()
    m = m[m.index >= "2018-01-01"]
    idx = m.index.union(f.index)
    m = m.reindex(idx).ffill()
    m["wx"] = f.wx.reindex(idx).ffill()
    m["b50"] = f.breadth50.reindex(idx).ffill()
    m["d200"] = m.nifty / m.n200 - 1
    m["vrel"] = np.log(m.vix / m.vmed)
    return m


def label(m, d, b_lo=0.40, b_hi=0.70):
    up = m.nifty > m.n200
    if d == "R0":
        return m.wx.map({0: "stormy", 1: "mixed", 2: "sunny"}).fillna("na")
    if d == "R1":
        fear = m.vix > m.vmed
        return pd.Series(np.where(up, "up", "down"), m.index) + np.where(fear, "-nervous", "-calm")
    if d == "R2":
        return pd.Series(np.where(m.b50 < b_lo, "weak", np.where(m.b50 > b_hi, "strong", "normal")), m.index)
    if d == "R3":
        r = np.where((m.r20 > 0) & (m.r60 > 0), "rising", np.where((m.r20 < 0) & (m.r60 < 0), "falling", "mixed"))
        return pd.Series(r, m.index)
    if d == "R4":
        return pd.Series(np.where(up, "up", "down"), m.index) + np.where(m.b50 >= 0.5, "-broad", "-narrow")
    raise ValueError(d)


KM_COLS = ["d200", "r20", "r60", "vrel", "b50"]


def kmeans_label(m, q0, k=4):
    """R5: fit on market days 2019-07-01 .. q0 - 1 day, label every day with the nearest centroid."""
    from sklearn.cluster import KMeans
    x = m[KM_COLS].dropna()
    tr = x[(x.index >= "2019-07-01") & (x.index < q0)]
    mu, sd = tr.mean(), tr.std()
    km = KMeans(n_clusters=k, n_init=10, random_state=0).fit(((tr - mu) / sd).to_numpy())
    lab = km.predict(((x - mu) / sd).to_numpy())
    return pd.Series([f"c{i}" for i in lab], x.index).reindex(m.index).fillna("na")
