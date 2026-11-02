"""POST-HOC V26 (chosen after seeing V18-V25 out of sample, so it carries selection bias): the forward-calibrated
checker applied to the two dip rules only; trend signals are always taken. Sensitivity over the skip share and the
model, and per year. Scored with team/evaluate.py."""
import pandas as pd

import meta as M
import run_all as RA

E = M.E
pd.set_option("display.width", 200)


def dip_only(kind, x):
    pred, cuts = M.walk(kind=kind, cohort=True, fwd=True)
    d = M.decide(pred, cuts, policy=x)
    d.loc[~d.rule.isin(["rsi_dip", "kk_dip"]), "take"] = True
    return d


if __name__ == "__main__":
    for kind in ("lr", "hgb"):
        for x in ("10", "20", "30"):
            rep = E.report(dip_only(kind, x), f"V26 {kind} dip-only skip {x}%", show=(kind, x) == ("lr", "20"))
            for per in ("2021-26", "2024-26"):
                r = rep[(rep.period == per) & rep.rule.isin(["rsi_dip", "kk_dip", "ALL"])].set_index("rule")
                print(f"  {kind} skip {x}% {per}: " + " | ".join(
                    f"{k} made {v['made%']:.1f} ({v['vs static made%']:+.1f}) sum {v['sum%']:.0f} ({v['vs static sum%']:+.0f})"
                    for k, v in r.iterrows()))
    d = dip_only("lr", "20")
    py = RA.per_year(d)
    print("\nV26 lr 20 % per year (dip rules and ALL):")
    print(py[py.rule.isin(["rsi_dip", "kk_dip", "ALL"])].pivot(index="year", columns="rule",
                                                               values=["kept", "dmade", "dsum"]).to_string())
    print("null random skip (same count per rule-quarter):", RA.null_skip(d))
