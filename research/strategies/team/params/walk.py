"""Walk-forward parameter re-optimisation (PLAN.md). Runs every pre-registered variant, scores each with
team/evaluate.py, and writes out/summary.csv, out/choices.csv (settings chosen per quarter), out/persistence.csv
(does a grid point's training score predict its next quarter?) and out/stream_<variant>.parquet.

    cd research/strategies && python team/params/walk.py
"""
import numpy as np
import pandas as pd

import engine as E
import evaluate as EV

QS = pd.date_range("2021-01-01", "2026-10-01", freq="QS")          # quarter starts we choose at
HS = QS[QS.month.isin([1, 7])]                                      # half-year starts


def scores(tr, obj):
    """raw score per grid point on its training trades -> (score array, n array, sd array, avg array)."""
    sc, n, sd, avg = np.full(27, np.nan), np.zeros(27, int), np.full(27, np.nan), np.full(27, np.nan)
    for k, g in tr.groupby("cfg"):
        x = g.net.to_numpy()
        n[k], avg[k] = len(x), x.mean()
        sd[k] = x.std(ddof=1) if len(x) > 1 else np.nan
        sc[k] = {"avg": x.mean(), "sum": x.sum(), "made": (x > 0).mean(),
                 "t": x.mean() / sd[k] * np.sqrt(len(x)) if len(x) > 1 and sd[k] > 0 else np.nan}[obj]
    return sc, n, sd, avg


def smooth(raw, n, on=True):
    if not on:
        return raw.copy()
    out = np.full(27, np.nan)
    for k in range(27):
        v = [raw[m] for m in E.neighbours(k) if n[m] >= 10 and not np.isnan(raw[m])]
        out[k] = np.mean(v) if v else np.nan
    return out


def dist(k):
    return sum(abs(a - 1) for a in E.CFGS[k])


def choose(gr, at, spec, incumbent):
    """The grid point to trade from `at` on, using only trades that had closed before `at`."""
    lo = pd.Timestamp("2000-01-01") if spec["win"] is None else at - pd.DateOffset(years=spec["win"])
    tr = gr[(gr.exit_date < at) & (gr.signal_date >= lo)]
    raw, n, sd, avg = scores(tr, spec["obj"])
    sm = smooth(raw, n, spec["smooth"])
    ok = (n >= spec["nmin"]) & ~np.isnan(sm)
    if spec["obj"] == "made":
        ok &= smooth(avg, n, spec["smooth"]) > 0
    if not ok.any():
        return E.TODAY
    cand = [k for k in range(27) if ok[k]]
    best = max(cand, key=lambda k: (sm[k], -dist(k)))
    if spec.get("hyst"):
        cur = incumbent
        if n[cur] >= spec["nmin"] and not np.isnan(sm[cur]):
            # one standard error in the objective's own units: SE of the mean for avg; a t-statistic's SE is 1
            se = {"t": 1.0, "made": np.sqrt(raw[cur] * (1 - raw[cur]) / n[cur])}.get(spec["obj"], sd[cur] / np.sqrt(n[cur]))
            if not sm[best] - sm[cur] > se:
                return cur
    return best


def schedule_for(gr, spec):
    starts = HS if spec["freq"] == "H" else QS
    picks, cur = {}, E.TODAY
    for at in starts:
        if spec.get("freeze") and picks:
            picks[at] = picks[starts[0]]
            continue
        cur = choose(gr, at, spec, cur)
        picks[at] = cur
    return picks


def as_schedule(picks):
    keys = np.array(sorted(picks), dtype="datetime64[ns]")
    vals = np.array([picks[k] for k in sorted(picks)], dtype=int)

    def f(dates):
        pos = np.searchsorted(keys, dates, side="right") - 1
        out = np.full(len(dates), E.TODAY, dtype=int)
        out[pos >= 0] = vals[pos[pos >= 0]]
        return out
    return f


BASE = dict(freq="Q", win=3, obj="avg", smooth=True, nmin=50)
VARIANTS = {
    "V1 primary": {},
    "V2 no neighbourhood avg": dict(smooth=False),
    "V3 objective sum": dict(obj="sum"),
    "V4 objective made%": dict(obj="made"),
    "V5 objective t-stat": dict(obj="t"),
    "V6 2-year window": dict(win=2),
    "V7 expanding window": dict(win=None),
    "V8 half-yearly": dict(freq="H"),
    "V9 hysteresis 1 SE": dict(hyst=True),
    "V10 choose once, freeze": dict(freeze=True),
    "S1 min trades 25": dict(nmin=25),
    "S2 min trades 100": dict(nmin=100),
}


def per_year(d):
    rows = []
    for y, g in d.groupby(d.signal_date.dt.year):
        b = EV._block(g.assign(take=True), len(g))
        rows.append({"year": y, "trades": b["trades"], "made%": b["made%"], "avg%": b["avg%"], "sum%": b["sum%"]})
    return pd.DataFrame(rows).set_index("year")


def persistence(gr, rule):
    """Per quarter: Spearman rank correlation between each grid point's V1 training score (smoothed avg) and its own
    result on trades signalled in that quarter (look-ahead, diagnostic only)."""
    rows = []
    for at in QS:
        tr = gr[(gr.exit_date < at) & (gr.signal_date >= at - pd.DateOffset(years=3))]
        raw, n, _, _ = scores(tr, "avg")
        sm = smooth(raw, n)
        nxt = gr[(gr.signal_date >= at) & (gr.signal_date < at + pd.offsets.QuarterBegin(startingMonth=1))]
        fut = nxt.groupby("cfg").net.mean().reindex(range(27))
        ok = (n >= 50) & fut.notna().to_numpy() & (nxt.groupby("cfg").size().reindex(range(27)).fillna(0).to_numpy() >= 10)
        if ok.sum() >= 8:
            rho = pd.Series(sm[ok]).rank().corr(pd.Series(fut.to_numpy()[ok]).rank())
            rows.append({"rule": rule, "quarter": at.date(), "rho": rho})
    return pd.DataFrame(rows)


if __name__ == "__main__":
    pd.set_option("display.width", 200)
    g = E.grid_trades()
    st = E.load()
    base = EV.baseline()
    EV.report(base, "V0 static (today's settings)")
    summary, choices, streams = [], [], {}
    for name, over in VARIANTS.items():
        spec = {**BASE, **over}
        parts = []
        for rule in E.RULES:
            gr = g[g.rule == rule]
            picks = schedule_for(gr, spec)
            for at, k in picks.items():
                choices.append({"variant": name, "rule": rule, "from": at.date(), "cfg": k, "settings": E.label(rule, k)})
            parts.append(E.run(st, rule, as_schedule(picks)))
        d = pd.concat(parts, ignore_index=True)
        d["take"] = True
        streams[name] = d
        r = EV.report(d, name)
        summary.append(r.assign(variant=name))
    # V11 diagnostic: best fixed grid point per rule on 2021-26 itself (look-ahead)
    parts = []
    for rule in E.RULES:
        gr = g[(g.rule == rule) & (g.signal_date >= EV.START)]
        k = int(gr[gr.groupby("cfg").net.transform("size") >= 50].groupby("cfg").net.mean().idxmax())
        print(f"V11 hindsight best fixed {rule}: {E.label(rule, k)}")
        parts.append(gr[gr.cfg == k])
    d = pd.concat(parts, ignore_index=True).assign(take=True)
    streams["V11 hindsight best fixed (look-ahead)"] = d
    summary.append(EV.report(d, "V11 DIAGNOSTIC hindsight best fixed (look-ahead)").assign(variant="V11 hindsight (look-ahead)"))

    pd.concat(summary).to_csv(E.OUT / "summary.csv", index=False)
    ch = pd.DataFrame(choices)
    ch.to_csv(E.OUT / "choices.csv", index=False)
    pers = pd.concat([persistence(g[g.rule == r], r) for r in E.RULES])
    pers.to_csv(E.OUT / "persistence.csv", index=False)
    for name, d in streams.items():
        d.to_parquet(E.OUT / f"stream_{name.split()[0]}.parquet", index=False)

    print("\n=== stability (quarterly variants): switches = quarters whose settings differ from the quarter before")
    for (v, rule), c in ch.groupby(["variant", "rule"], sort=False):
        ks = c.cfg.to_numpy()
        sw = int((ks[1:] != ks[:-1]).sum())
        jump = np.mean([sum(abs(a - b) for a, b in zip(E.CFGS[x], E.CFGS[y])) for x, y in zip(ks[:-1], ks[1:])]) if len(ks) > 1 else 0
        top = c.settings.value_counts()
        print(f"{v:26s} {rule:13s} periods {len(ks):2d} switches {sw:2d} avg jump {jump:.2f} steps | today's used "
              f"{(ks == E.TODAY).sum():2d} | most used {top.index[0]} x{top.iloc[0]} | distinct {len(top)}")
    print("\n=== does the training winner keep winning? Spearman rho (training smoothed avg vs next quarter), by rule")
    print(pers.groupby("rule").rho.agg(["mean", "median", "count", lambda x: (x > 0).mean()]).round(2))
    print("\n=== per year, ALL rules: static vs V1 primary")
    print(pd.concat({"static": per_year(base), "V1": per_year(streams["V1 primary"])}, axis=1))
