# =====================================================================================================================
# PRE-REGISTERED (2026-11-01, before running this file): the n_same_day look-ahead check and its one fix.
# Claim: n_same_day = log1p(number of FILLED rsi_dip trades with that signal_date) uses session d+1 (a dip trade exists
# only if the next session's low trades 0.2 % through the limit: record_dip.trades `if l[j] > lim * 0.998: continue`).
# (1) Evidence: per signal day, setups vs fills; correlation of the fill rate and of each count with the next-session
#     Nifty 50 move (close d+1 / close d - 1, and low d+1 / close d - 1).
# (2) The one fix, nothing else changed (D*** code: tier_model.py with platt_a > 1e-6, C 0.05, 6 rsi_dip blocks, ...):
#     n_same_day := log(1 + number of rsi_dip SETUPS at that close among the point-in-time top 300), setup =
#     rsi2 < 10 and d200 > 0 in team_features.parquet, filled or not; the signal itself counts as one (added if its
#     own row is not flagged). Ranks 301-500 signals: top-300 setups + 1 (itself), as before.
#     Report for OLD and NEW: walk-forward High - Low made% gap 2021-26 / 2024-26 (+ shuffled-within-year null p),
#     quarters with High > Low, per-year tier table; top 300 and ranks 301-500. No other variant will be run.
# =====================================================================================================================
from pathlib import Path

import numpy as np
import pandas as pd

import round2 as R
import tier_model as T

HERE = Path(__file__).resolve().parent
DATA = HERE.parents[1] / "data"
pd.set_option("display.width", 230)

t = pd.read_parquet(DATA / "team_trades.parquet")
t = t[t.rule == "rsi_dip"].copy()
t["signal_date"] = pd.to_datetime(t.signal_date)
t = t.sort_values(["signal_date", "symbol"], kind="mergesort").reset_index(drop=True)
t["quarter"] = t.signal_date.dt.to_period("Q").dt.start_time
ext = pd.read_parquet(R.OUT / "r2_ext_trades.parquet")
ext = ext[ext.rule == "rsi_dip"].copy()
ext["quarter"] = ext.signal_date.dt.to_period("Q").dt.start_time
hr = {q: T.hr_rule(t, q) for q in pd.date_range("2019-07-01", "2026-10-01", freq="QS")}
for d in (t, ext):
    d["hr_rule"] = d.quarter.map(hr)
    d["y"] = (d.net > 0).astype(int)

# setups among the point-in-time top 300
st = R.stocks()
ranks = R.pit_ranks(st)
pit = {y: set(r[:300]) for y, r in ranks.items()}
f = pd.read_parquet(DATA / "team_features.parquet", columns=["symbol", "date", "rsi2", "d200"])
f["date"] = pd.to_datetime(f.date)
f = f[f.date >= "2019-07-01"]
f["in300"] = [s in pit.get(y, ()) for s, y in zip(f.symbol, f.date.dt.year)]
f["setup"] = (f.rsi2 < 10) & (f.d200 > 0)
setups = f[f.in300 & f.setup].groupby("date").size()
fills = t.groupby("signal_date").size()

# OLD (as shipped in D***) and NEW n_same_day
own = (t.rsi2 < 10) & (t.d200 > 0)
t["n_old"] = np.log1p(t.signal_date.map(fills))
t["n_new"] = np.log1p(t.signal_date.map(setups).fillna(0) + np.where(own, 0, 1))
ext["n_old"] = np.log1p(ext.signal_date.map(fills).fillna(0) + 1)
ext["n_new"] = np.log1p(ext.signal_date.map(setups).fillna(0) + 1)
print(f"own row flagged as a setup: {100 * own.mean():.1f} % of top-300 rsi_dip trades")

# (1) evidence
nif = st.get("^NSEI")
cand = pd.read_parquet(DATA / "candles.parquet")
nf = cand[cand.symbol == "^NSEI"].sort_values("date").assign(date=lambda x: pd.to_datetime(x.date)).set_index("date")
nxt_c = nf.close.shift(-1) / nf.close - 1
nxt_l = nf.low.shift(-1) / nf.close - 1
day = pd.DataFrame({"setups": setups, "fills": fills}).dropna()
day = day[day.index >= "2019-07-01"]
day["fill_rate"] = day.fills / day.setups
day["next_close"], day["next_low"] = nxt_c.reindex(day.index), nxt_l.reindex(day.index)
print("\n(1) per signal day (days with >= 1 fill):", len(day), "days; median setups", day.setups.median(),
      "fills", day.fills.median())
print("    corr with the NEXT session's Nifty move   close->close   close->low")
for c in ("fill_rate", "fills", "setups"):
    x = np.log1p(day[c]) if c != "fill_rate" else day[c]
    print(f"    {c:10s} {x.corr(day.next_close):+.3f}        {x.corr(day.next_low):+.3f}")
print("    corr(old n_same_day, new) on top-300 trades:", round(t.n_old.corr(t.n_new), 3))


# (2) walk-forward, OLD vs NEW
def walk(col):
    out = []
    for Q in pd.date_range("2021-01-01", "2026-10-01", freq="QS"):
        tr = t.assign(n_same_day=t[col])
        m = T.fit(tr, asof=Q)
        for uni, te in (("top300", tr), ("r301_500", ext.assign(n_same_day=ext[col]))):
            te = te[(te.quarter == Q) & (te.signal_date < "2026-11-01")]
            if len(te):
                s = T.score(m, te)
                out.append(te[["symbol", "signal_date", "quarter", "net", "y"]].assign(uni=uni, p=s.p, tier=s.tier))
    return pd.concat(out, ignore_index=True)


rng = np.random.default_rng(0)
res = {}
for col in ("n_old", "n_new"):
    w = walk(col)
    res[col] = w
    print(f"\n(2) {'OLD (filled count, D***)' if col == 'n_old' else 'NEW (setup count)'}")
    for uni in ("top300", "r301_500"):
        g0 = w[w.uni == uni].assign(rule="rsi_dip")
        for per, lo in (("2021-26", "2021-01-01"), ("2024-26", "2024-01-01")):
            g = g0[g0.signal_date >= lo]
            by = g.groupby("tier").y.agg(["size", "mean"])
            gap, med, p, nh, nl = R.null_gap(g, "rsi_dip", pd.Timestamp(lo), rng)
            q = g[g.tier.isin(["High", "Low"])].groupby(["quarter", "tier"]).y.mean().unstack().dropna()
            print(f"  {uni:8s} {per}: " + "  ".join(f"{k} {100 * v['mean']:.1f}% ({int(v['size'])})" for k, v in by.iterrows())
                  + f" | High-Low {gap:+.1f} (null p {p:.3f}); High > Low in {(q.High > q.Low).sum()} of {len(q)} quarters")
        yr = g0.assign(year=g0.signal_date.dt.year).groupby(["year", "tier"]).y.agg(n="size", made="mean")
        yr["cell"] = [f"{100 * m:.0f}% ({n})" for n, m in zip(yr.n, yr.made)]
        tab = yr.cell.unstack("tier")
        gp = g0.assign(year=g0.signal_date.dt.year).groupby("year").apply(
            lambda h: 100 * (h.y[h.tier == "High"].mean() - h.y[h.tier == "Low"].mean()), include_groups=False)
        tab["High-Low"] = gp.round(1)
        print(f"  per year {uni}:\n" + tab.to_string())
