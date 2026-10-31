"""Walk-forward test of a self-learning 'signal checker' (meta-labelling).

Every quarter from 2021 Q1 the checker is retrained on signals whose outcome was ALREADY known (signal date at
least 45 calendar days before the quarter starts - the 'graded so far' set). It then scores the next quarter's
signals the day they fire. Only those scores are evaluated, so every number below is out of sample: the checker
never saw the outcome of a signal it scored. This is exactly how it would run live.

Kept = signals the checker rates in the safest X % of what it saw in training (threshold set from the training
set, never from the quarter being scored).
"""
import warnings

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.tree import DecisionTreeClassifier, export_text

warnings.filterwarnings("ignore")
D = __import__("pathlib").Path(__file__).parent / "data"
sig = pd.read_parquet(D / "signals.parquet").sort_values("date").reset_index(drop=True)

FEATS = ["d200", "d50", "d20", "slope200", "rsi14", "rsi2", "atrpct", "volratio", "rs_rank", "r5", "r20", "r126",
         "dist_hi252", "clv", "gap", "sector_rank", "nifty_d200", "nifty_r20", "vix", "vix_chg5", "wx",
         "breadth50", "breadth200", "kk_risk"]
NAMES = {"sma": "SMA 20/50 cross", "rsi": "RSI reversal", "kk": "KK buy", "kk_s": "KK short", "trend": "Strong trend"}
KEEP = (0.5, 0.3)

quarters = pd.date_range("2021-01-01", "2026-10-01", freq="QS")


def model():
    return HistGradientBoostingClassifier(max_depth=3, learning_rate=0.05, max_iter=200, min_samples_leaf=200,
                                          l2_regularization=1.0, random_state=0)


scores = []
for strat in NAMES:
    s = sig[sig.strategy == strat]
    fs = [c for c in FEATS if s[c].notna().mean() > 0.5 and s[c].nunique() > 2]
    for q0 in quarters:
        q1 = q0 + pd.offsets.QuarterBegin(1)
        train = s[s.date < q0 - pd.Timedelta(days=45)]
        test = s[(s.date >= q0) & (s.date < q1)]
        if len(train) < 400 or test.empty:
            continue
        m = model().fit(train[fs], train.wrong)
        p_train = m.predict_proba(train[fs])[:, 1]
        p = m.predict_proba(test[fs])[:, 1]
        cut = {k: np.quantile(p_train, k) for k in KEEP}
        out = test[["date", "strategy", "ret", "wrong", "wx"]].copy()
        out["p_wrong"] = p
        for k in KEEP:
            out[f"keep{int(k*100)}"] = p <= cut[k]
        scores.append(out)
sc = pd.concat(scores)
sc.to_parquet(D / "engine_scores.parquet", index=False)


def line(g):
    return f"{len(g):6d} sig  wrong {100*g.wrong.mean():4.1f}%  avg {100*g.ret.mean():+5.2f}%"


print("OUT-OF-SAMPLE 2021 Q1 .. 2026 Q3 (point-in-time top 300, 0.5 % cost). 'wrong' = lost money over its horizon")
for strat, name in NAMES.items():
    g = sc[sc.strategy == strat]
    print(f"\n=== {name}")
    print(f"  every signal (today)        {line(g)}")
    print(f"  only in sunny weather       {line(g[g.wx == 2])}")
    for k in KEEP:
        kept = g[g[f'keep{int(k*100)}']]
        drop = g[~g[f'keep{int(k*100)}']]
        cut = 100 * (1 - kept.wrong.sum() / g.wrong.sum())
        print(f"  checker keeps safest {int(k*100)}%   {line(kept)}   | dropped: {line(drop)} | wrong signals removed {cut:.0f}%")
    y = g.assign(y=g.date.dt.year).groupby("y")
    print("  by year, wrong% all -> kept30:", "  ".join(
        f"{yy}: {100*v.wrong.mean():.0f}->{100*v[v.keep30].wrong.mean():.0f} ({v.keep30.sum()})" for yy, v in y))

# a small explainable tree per strategy (trained on 2019-07..2022-12 only) - shows WHY signals go wrong
print("\n\nWHY SIGNALS GO WRONG - a depth-3 tree per strategy, fitted on 2019-07..2022-12, checked on 2023..2026")
for strat, name in NAMES.items():
    s = sig[sig.strategy == strat]
    tr, te = s[s.date < "2023-01-01"], s[s.date >= "2023-01-01"]
    fs = [c for c in FEATS if s[c].notna().mean() > 0.5 and s[c].nunique() > 2]
    t = DecisionTreeClassifier(max_depth=3, min_samples_leaf=300, random_state=0).fit(tr[fs].fillna(-9), tr.wrong)
    print(f"\n=== {name}: base wrong rate {100*tr.wrong.mean():.0f}% (fit) / {100*te.wrong.mean():.0f}% (check)")
    print(export_text(t, feature_names=fs, show_weights=False, decimals=3))
    leaf_tr = t.apply(tr[fs].fillna(-9))
    leaf_te = t.apply(te[fs].fillna(-9))
    for leaf in sorted(set(leaf_tr)):
        a, b = tr[leaf_tr == leaf], te[leaf_te == leaf]
        print(f"   leaf {leaf}: fit {len(a):5d} wrong {100*a.wrong.mean():3.0f}% | check {len(b):5d} wrong "
              f"{100*b.wrong.mean() if len(b) else float('nan'):3.0f}% avg {100*b.ret.mean() if len(b) else float('nan'):+.2f}%")
