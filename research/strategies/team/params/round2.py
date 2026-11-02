"""ROUND 2 PLAN (params) - pre-registered 2026-11-01, written before any round-2 number was computed.

Three new variants, no more. They use the round-1 shadow grid (out/grid_trades.parquet, exact live rule code; grid centre
== data/team_trades.parquet). Nothing here imports `signals` (it rewrites data/signals.parquet).

R1  Static trend plan, chosen by AVERAGE NET PER TRADE on the design years only.
    Trend rules (strong_trend, sma_trend), entry filter fixed at today's (volume 2x / leader cut-off 0.7); the 3 x 3
    plan sub-grid stop {3, 4, 5} x ATR14 x review {40, 60, 90} sessions. Design cohort = signals 2019-07-01 ..
    2023-08-16, so every plan's trades (90 sessions at most) closed by 2023-12-29: complete cohorts, nothing from
    2024 seen. Score each plan, average with its one-step neighbours (stop +-1, review +-1), pick the best smoothed
    plan per rule (ties -> nearest to today's 4 / 60). Freeze it.
R2  Same as R1, chosen by RETURN PER 100 DAYS IN A TRADE (sum net / sum days held x 100) - longer holds tie up money,
    so this objective cannot win by holding longer.
    Check for R1 and R2: 2024-01-01 .. 2026-10-31 untouched, against today's 4 x ATR / 60 sessions. Reported per trend
    rule and ALL (the dip rules stay static): made%, avg%, sum%, worst5% (evaluate.py), average days held, return per
    100 days in a trade, plus a block bootstrap by signal month (2,000 draws, the same months for both plans) of
    avg(new) - avg(today). A trend rule ADOPTS the new plan only if, on 2024-26: made% >= today's - 1, avg% and sum%
    higher, return per 100 trade-days not lower, worst5% not worse by more than 2 points, bootstrap p(avg diff <= 0)
    < 0.05. (2021-26 rows contain the design years 2021-23: in-sample, shown for completeness only.)
R3  C4 check - is "where today's settings rank" informative? Complete cohorts only. For each rule and each quarter
    start Q in 2021Q1 .. 2025Q2 (so the next 12 months are complete before the data ends): training = signals in
    [Q - 3 years, Q - L) with L = 140 calendar days for the trend rules (90 sessions + 5 embargo) and 30 days for the
    dips (15 + 5); assert every training trade exited before Q. Outcome = signals in [Q, Q + 12 months). Score = avg net
    per grid point (27 points, >= 30 trades in both windows). Report per rule: (a) mean Spearman rho between the
    training and outcome scores across grid points, with a permutation null (outcome labels shuffled within each
    quarter, 1,000 draws); (b) today's training rank vs its outcome rank; (c) regret = outcome avg of the training-best
    point minus today's, share of quarters it is > 0. C4 is "informative" only if, in >= 3 of 4 rules, rho > 0 with
    permutation p < 0.05 AND the training-best beats today's next year in > 60 % of quarters. Quarters overlap (12-month
    outcomes, quarterly steps), so the p-values are optimistic; said in the deliverable.
Descriptive (not variants): the evidence lag a 90-session plan adds for health / metalabel feedback, and the censoring
severity (made% of trend trades closed in the last 100 days before each quarter, 60- vs 90-session plan).

    cd research/strategies && python team/params/round2.py
"""
import numpy as np
import pandas as pd

import engine as E
import evaluate as EV

DESIGN_LO, DESIGN_HI = pd.Timestamp("2019-07-01"), pd.Timestamp("2023-08-17")
TREND = ("strong_trend", "sma_trend")
SUB = [E.cid(1, b, c) for b in range(3) for c in range(3)]       # entry fixed at today's, plan varies
rng = np.random.default_rng(20261101)


def per100(x):
    return 100 * x.net.sum() / x.days.sum() * 100


def plan_choice(g, rule, obj):
    d = g[(g.rule == rule) & g.cfg.isin(SUB) & (g.signal_date >= DESIGN_LO) & (g.signal_date < DESIGN_HI)]
    assert d.exit_date.max() < pd.Timestamp("2024-01-01"), "design cohort not complete"
    raw = {k: (x.net.mean() if obj == "avg" else per100(x)) for k, x in d.groupby("cfg")}
    sm = {}
    for k in SUB:
        _, b, c = E.CFGS[k]
        nb = [k] + [E.cid(1, b + db, c + dc) for db, dc in ((-1, 0), (1, 0), (0, -1), (0, 1))
                    if 0 <= b + db <= 2 and 0 <= c + dc <= 2]
        sm[k] = np.mean([raw[m] for m in nb])
    best = max(SUB, key=lambda k: (sm[k], -sum(abs(a - 1) for a in E.CFGS[k])))
    table = pd.DataFrame({"plan": [E.label(rule, k).split("/", 1)[1] for k in SUB],
                          "design n": [int((d.cfg == k).sum()) for k in SUB],
                          "raw": [raw[k] * (100 if obj == "avg" else 1) for k in SUB],
                          "smoothed": [sm[k] * (100 if obj == "avg" else 1) for k in SUB]}).round(2)
    return best, table


def extras(d, lab):
    rows = []
    for period, lo in (("2021-26", EV.START), ("2024-26", EV.RECENT)):
        for rule in list(TREND) + ["ALL"]:
            x = d[d.signal_date >= lo] if rule == "ALL" else d[(d.signal_date >= lo) & (d.rule == rule)]
            rows.append({"variant": lab, "period": period, "rule": rule, "avg days": round(x.days.mean(), 1),
                         "per 100 trade-days %": round(per100(x), 2)})
    return pd.DataFrame(rows)


def boot(new, old, n=2000):
    """Block bootstrap by signal month, 2024-26: P(avg(new) - avg(today) <= 0), same months for both."""
    new, old = new[new.signal_date >= EV.RECENT], old[old.signal_date >= EV.RECENT]
    mn, mo = new.signal_date.dt.to_period("M"), old.signal_date.dt.to_period("M")
    months = np.array(sorted(set(mn) | set(mo)))
    gn = {m: x.net.to_numpy() for m, x in new.groupby(mn)}
    go = {m: x.net.to_numpy() for m, x in old.groupby(mo)}
    diffs = []
    for _ in range(n):
        pick = rng.choice(months, len(months))
        a = np.concatenate([gn.get(m, np.empty(0)) for m in pick])
        b = np.concatenate([go.get(m, np.empty(0)) for m in pick])
        diffs.append(a.mean() - b.mean())
    diffs = np.array(diffs)
    return round(float((diffs <= 0).mean()), 3), round(100 * float(np.percentile(diffs, 5)), 2), round(100 * float(np.percentile(diffs, 95)), 2)


def c4(g):
    rows, pers = [], []
    qs = pd.date_range("2021-01-01", "2025-04-01", freq="QS")
    for rule in E.RULES:
        L = pd.Timedelta(days=140 if rule in TREND else 30)
        gr = g[g.rule == rule]
        for Q in qs:
            tr = gr[(gr.signal_date >= Q - pd.DateOffset(years=3)) & (gr.signal_date < Q - L)]
            late = int((tr.exit_date >= Q).sum())
            nx = gr[(gr.signal_date >= Q) & (gr.signal_date < Q + pd.DateOffset(months=12))]
            a, na = tr.groupby("cfg").net.mean(), tr.groupby("cfg").size()
            b, nb = nx.groupby("cfg").net.mean(), nx.groupby("cfg").size()
            ok = [k for k in range(27) if na.get(k, 0) >= 30 and nb.get(k, 0) >= 30]
            if len(ok) < 8 or E.TODAY not in ok:
                continue
            a, b = a[ok], b[ok]
            rho = a.rank().corr(b.rank())
            best = int(a.idxmax())
            rows.append({"rule": rule, "Q": Q.date(), "late": late, "n_pts": len(ok), "rho": rho,
                         "today_rank_train": int(a.rank(ascending=False)[E.TODAY]),
                         "today_rank_next": int(b.rank(ascending=False)[E.TODAY]),
                         "best": E.label(rule, best), "regret": b[best] - b[E.TODAY]})
            pers.append((rule, a.to_numpy(), b.to_numpy()))
    r = pd.DataFrame(rows)
    out = []
    for rule, x in r.groupby("rule", sort=False):
        obs = x.rho.mean()
        sets = [(a, b) for rr, a, b in pers if rr == rule]
        null = []
        for _ in range(1000):
            null.append(np.mean([pd.Series(a).rank().corr(pd.Series(rng.permutation(b)).rank()) for a, b in sets]))
        out.append({"rule": rule, "quarters": len(x), "mean rho": round(obs, 2), "rho>0 share": round((x.rho > 0).mean(), 2),
                    "perm p": round(float((np.array(null) >= obs).mean()), 3),
                    "today rank train (median)": x.today_rank_train.median(), "today rank next (median)": x.today_rank_next.median(),
                    "rank corr train~next": round(x.today_rank_train.corr(x.today_rank_next, method="spearman"), 2),
                    "best beats today next yr": round((x.regret > 0).mean(), 2),
                    "avg regret % (best - today)": round(100 * x.regret.mean(), 2), "late trades": int(x.late.sum())})
    return r, pd.DataFrame(out)


def lag_and_censoring(g):
    """Made% of trend trades that had closed in the 100 days before each quarter start vs their whole cohort."""
    out = []
    for rule in TREND:
        for hold_ix, H in ((1, 60), (2, 90)):
            gr = g[(g.rule == rule) & (g.cfg == E.cid(1, 1, hold_ix))]
            recent, cohort = [], []
            for Q in pd.date_range("2021-01-01", "2026-07-01", freq="QS"):
                w = gr[(gr.signal_date >= Q - pd.Timedelta(days=100)) & (gr.signal_date < Q)]
                recent.append(w[w.exit_date < Q].net.to_numpy())
                cohort.append(w.net.to_numpy())
            rc, ch = np.concatenate(recent), np.concatenate(cohort)
            out.append({"rule": rule, "plan": f"4 ATR / {H}", "closed-so-far made%": round(100 * (rc > 0).mean(), 1),
                        "closed share": round(len(rc) / len(ch), 2), "whole cohort made%": round(100 * (ch > 0).mean(), 1),
                        "complete-cohort lag (sessions)": H + 5})
    return pd.DataFrame(out)


if __name__ == "__main__":
    pd.set_option("display.width", 220)
    g = E.grid_trades()
    base = EV.baseline()
    ex = [extras(base, "static 4/60")]
    for name, obj in (("R1 avg", "avg"), ("R2 per-100-days", "per100")):
        parts, picks = [base[~base.rule.isin(TREND)]], {}
        for rule in TREND:
            k, tab = plan_choice(g, rule, obj)
            picks[rule] = k
            print(f"\n{name} {rule}: design-years table (raw / smoothed {'avg %' if obj == 'avg' else 'per 100 trade-days %'})")
            print(tab.to_string(index=False))
            print(f"-> chosen plan {E.label(rule, k).split('/', 1)[1]}  (today 4/60)")
            parts.append(g[(g.rule == rule) & (g.cfg == k) & (g.signal_date >= EV.START)])
        d = pd.concat(parts, ignore_index=True).assign(take=True)
        EV.report(d, f"{name}: trend plan chosen on 2019-07..2023-08 cohorts, checked 2024-26")
        ex.append(extras(d, name))
        for rule in TREND:
            if picks[rule] != E.TODAY:
                p, lo, hi = boot(d[d.rule == rule], base[base.rule == rule])
                print(f"   bootstrap {rule} 2024-26 avg(new)-avg(today): p(<=0) = {p}, 90% range {lo} .. {hi} points")
            else:
                print(f"   {rule}: chose today's plan; nothing to test")
    print("\n=== days held and return per 100 days in a trade")
    print(pd.concat(ex).pivot_table(index=["period", "rule"], columns="variant", values=["avg days", "per 100 trade-days %"]).to_string())
    r, s = c4(g)
    r.to_csv(E.OUT / "round2_c4_quarters.csv", index=False)
    print("\n=== R3: C4 monitor check (complete cohorts, 12-month outcomes)")
    print(s.to_string(index=False))
    print("\n=== censoring severity and feedback lag (descriptive)")
    print(lag_and_censoring(g).to_string(index=False))
