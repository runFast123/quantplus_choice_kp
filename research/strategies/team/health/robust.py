"""Robustness of the pre-registered winner (V8 rule x market weather): per year, sensitivity, quarter-frozen (V11),
where the pauses land, and whipsaw. Reporting only; scoring is team/evaluate.py.

    cd research/strategies/team/health && python robust.py
"""
import numpy as np
import pandas as pd

import health as H
from health import E, LEDGER, RULES, T, SIZE, MIN_N

pd.set_option("display.width", 200)


def v8(n_bucket=30, t_pause=-1.0, N=50, freeze_quarter=False, col="wx"):
    """rule x bucket rolling mean; fallback to the rule-level rolling-N status when the bucket is thin."""
    base = H.prefix_method(H.v1_rolling, N=N, t_pause=t_pause, freeze_quarter=freeze_quarter).set_index("tid")
    out = []
    for r in RULES:
        L = LEDGER[r]
        ex, net, b_all = L.exit_date.to_numpy(), L.net.to_numpy(), L[col].to_numpy()
        g = T[T.rule == r]
        day = g.signal_date.dt.to_period("Q").dt.start_time if freeze_quarter else g.signal_date
        for tid, d, b in zip(g.tid, day, g[col]):
            w = net[(ex < np.datetime64(d)) & (b_all == b)][-n_bucket:]
            if len(w) < max(n_bucket, MIN_N):
                st = base.at[tid, "status"]
            else:
                m, se = w.mean(), w.std(ddof=1) / np.sqrt(len(w))
                st = 2 if (m < 0 and m / se < t_pause) else (1 if m < 0 else 0)
            out.append((tid, st, SIZE[st]))
    return H._finish(pd.DataFrame(out, columns=["tid", "status", "size"]))


def bucket_series(n_bucket=30, t_pause=-1.0):
    """Daily status per rule x weather bucket (what the Signals page would show), 2021-26."""
    days = pd.bdate_range(E.START, E.END - pd.Timedelta(days=1)).to_numpy()
    rows = []
    for r in RULES:
        L = LEDGER[r]
        for b in sorted(L.wx.dropna().unique()):
            Lb = L[L.wx == b]
            if (T[(T.rule == r) & (T.signal_date >= E.START)].wx == b).sum() == 0:
                continue
            x, ex = Lb.net.to_numpy(), Lb.exit_date.to_numpy()
            st = np.zeros(len(days), int)
            for i, d in enumerate(days):
                w = x[ex < d][-n_bucket:]
                if len(w) >= n_bucket:
                    m, se = w.mean(), w.std(ddof=1) / np.sqrt(len(w))
                    st[i] = 2 if (m < 0 and m / se < t_pause) else (1 if m < 0 else 0)
                else:
                    st[i] = -1
            known = st >= 0
            rows.append({"rule": r, "weather": {0: "stormy", 1: "mixed", 2: "sunny"}[int(b)],
                         "signals 21-26": int(((T.rule == r) & (T.wx == b) & (T.signal_date >= E.START)).sum()),
                         "judged%days": round(100 * known.mean(), 0),
                         "healthy%": round(100 * (st == 0).sum() / max(known.sum(), 1), 0),
                         "watch%": round(100 * (st == 1).sum() / max(known.sum(), 1), 0),
                         "paused%": round(100 * (st == 2).sum() / max(known.sum(), 1), 0),
                         "switches/yr": round((np.diff(st[known]) != 0).sum() / (len(days) / 261), 1)})
    return pd.DataFrame(rows)


def where_pauses(d):
    d = d[(d.signal_date >= E.START) & (d.signal_date < E.END)].copy()
    d["state"] = d.status.map({0: "healthy", 1: "watch", 2: "paused"})
    return d.groupby(["rule", "wx", "state"]).net.agg(trades="size", made=lambda x: round(100 * (x > 0).mean(), 1),
                                                       avg=lambda x: round(100 * x.mean(), 2)).unstack("state")


def row(name, rep):
    a = rep[rep.rule == "ALL"].set_index("period")
    return {"setting": name, "kept": a.at["2021-26", "kept"], "made21": a.at["2021-26", "made%"],
            "sum21": a.at["2021-26", "sum%"], "avg21": a.at["2021-26", "avg%"], "made24": a.at["2024-26", "made%"],
            "sum24": a.at["2024-26", "sum%"], "avg24": a.at["2024-26", "avg%"]}


if __name__ == "__main__":
    best = v8()
    E.report(best, "V8 rule x weather (n=30, t=-1) -- check equals health.py")
    H.per_year(best, "V8")
    H.per_year(E.baseline().assign(size=1.0), "static")

    print("\n=== where the V8 statuses land (2021-26 signals; avg net % per status)")
    print(where_pauses(best).to_string())
    print("\n=== V8 daily status per rule x weather (share of judged days), 2021-26")
    print(bucket_series().to_string(index=False))

    rows = []
    for nb in (20, 30, 60):  # 15 is below the pre-registered 20-trade minimum (would silently fall back to V1)
        for tp in (-0.5, -1.0, -2.0):
            d = v8(n_bucket=nb, t_pause=tp)
            rows.append(row(f"n={nb} t={tp}", E.report(d, "", show=False)) | H.diagnostics(d, f"n={nb} t={tp}"))
    d = v8(n_bucket=30, t_pause=-np.inf)  # never pause: watch only (half size when the bucket's mean < 0)
    rows.append(row("n=30 watch-only", E.report(d, "", show=False)) | H.diagnostics(d, "watch-only"))
    print("\n=== sensitivity (ALL rules)\n" + pd.DataFrame(rows).to_string(index=False))

    q = v8(freeze_quarter=True)
    E.report(q, "V11 = V8 frozen at each quarter start (ledger exit_date < quarter start)")
    H.diagnostics(q, "V11")
    H.per_year(q, "V11")
