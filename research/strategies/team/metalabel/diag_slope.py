"""Diagnosis: Platt slope sign per quarter/rule and the OOS AUC of the raw (uncalibrated) score."""
import numpy as np
import pandas as pd
from sklearn.metrics import roc_auc_score

import meta as M

def run(kind, cohort):
    emb = 7
    t = M.load()
    t["hr_rule"] = M.hr_cohort(t, emb) if cohort else M.hr_strict(t, emb)
    t["hold"] = pd.to_timedelta(t.rule.map(M.HOLD), unit="D")
    feats = M.BASE + M.DERIVED
    rows, raws = [], []
    for Q in M.QS:
        Qn = Q + pd.offsets.QuarterBegin(startingMonth=1)
        te = t[(t.signal_date >= Q) & (t.signal_date < Qn)].copy()
        tr = t[t.signal_date < Q - pd.Timedelta(days=emb) - t.hold] if cohort else t[t.exit_date < Q - pd.Timedelta(days=emb)]
        tr = tr.sort_values("signal_date").reset_index(drop=True)
        oof = M.purged_oof(kind, tr, feats, emb, None)
        cal = M.calibrators(tr.rule.to_numpy(), oof, tr.y.to_numpy())
        te["raw"] = M.raw_scores(kind, tr, te, feats)
        for r in M.RULES:
            m = (tr.rule == r).to_numpy() & ~np.isnan(oof)
            rows.append({"Q": Q, "rule": r, "slope": cal[r][0] if r in cal else np.nan,
                         "oof_raw_auc": roc_auc_score(tr.y[m], oof[m])})
        raws.append(te[["rule", "y", "raw", "signal_date"]])
    s, raw = pd.DataFrame(rows), pd.concat(raws)
    print(f"\n== {kind} cohort={cohort}")
    print("share of quarters with NEGATIVE Platt slope:", s.groupby("rule").slope.apply(lambda x: (x < 0).mean()).round(2).to_dict())
    print("mean OOF raw AUC (training):", s.groupby("rule").oof_raw_auc.mean().round(3).to_dict())
    raw = raw[raw.raw.notna()]
    print("OOS AUC of the RAW score:", {r: round(roc_auc_score(g.y, g.raw), 3) for r, g in raw.groupby("rule")})

for kind in ("hgb", "lr"):
    for cohort in (False, True):
        run(kind, cohort)
