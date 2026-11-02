"""Second robustness pass: (1) is the health selection better than RANDOM selection of the same number of trades per
rule x year (permutation null)? (2) sensitivity grid with n=20 instead of 15 (15 is below the pre-registered minimum of
20 closed trades, so robust.py's n=15 rows silently fell back to V1), for daily V8 and quarter-frozen V11;
(3) reaction speed vs whipsaw per window. Reporting only; scoring is team/evaluate.py.

    cd research/strategies/team/health && python robust2.py
"""
import numpy as np
import pandas as pd

import health as H
from health import E
from robust import v8, row, bucket_series

pd.set_option("display.width", 200)
B = E.baseline()


def stats(d):
    """ALL-rules 2021-26 numbers for the null test: made%, sum%, worst quarter, max drawdown (exit order)."""
    w = d["size"].where(d["take"], 0.0)
    t = d["take"]
    made = 100 * (d.net[t] > 0).mean()
    s = 100 * (d.net * w).sum()
    q = (d.net * w).groupby(d.signal_date.dt.to_period("Q")).sum().min() * 100
    o = np.argsort(d.exit_date.to_numpy(), kind="stable")
    c = np.cumsum((d.net * w).to_numpy()[o])
    return made, s, q, 100 * (c - np.maximum.accumulate(c)).min()


def null_test(d, name, draws=1000, seed=11, by_year=True):
    """Shuffle WHICH trades get each status inside every rule x year cell (or rule only), same counts; recompute."""
    d = d[(d.signal_date >= E.START) & (d.signal_date < E.END)].reset_index(drop=True)
    real = stats(d)
    rng = np.random.default_rng(seed)
    keys = [d.rule, d.signal_date.dt.year] if by_year else [d.rule]
    cells = [g.index.to_numpy() for _, g in d.groupby(keys)]
    size, take = d["size"].to_numpy().copy(), d["take"].to_numpy().copy()
    sims = []
    for _ in range(draws):
        s2, t2 = size.copy(), take.copy()
        for ix in cells:
            p = rng.permutation(ix)
            s2[ix], t2[ix] = size[p], take[p]
        sims.append(stats(d.assign(size=s2, take=t2)))
    sims = np.array(sims)
    lab = ["made%", "sum%", "worst quarter", "max drawdown"]
    out = {"variant": name}
    for i, l in enumerate(lab):
        out[l] = round(real[i], 1)
        out[l + " random mean"] = round(sims[:, i].mean(), 1)
        out[l + " p(random>=)"] = round((sims[:, i] >= real[i]).mean(), 3)
    return out


if __name__ == "__main__":
    res = [null_test(H.prefix_method(H.v1_rolling), "V1 rule-level rolling-50"),
           null_test(H.prefix_method(H.v4_cusum), "V4 CUSUM"),
           null_test(H.prefix_method(H.v5_sprt), "V5 SPRT"),
           null_test(v8(), "V8 rule x weather (daily)"),
           null_test(v8(freeze_quarter=True), "V11 = V8 quarter-frozen"),
           null_test(v8(t_pause=-np.inf), "V8 watch-only (half size, no pause)")]
    r = pd.DataFrame(res).set_index("variant").T
    print("=== permutation null: same number of paused / half-size trades per rule x year, chosen at random (1,000 draws)")
    print("    p(random>=) small = health beats random on that line (for worst quarter / drawdown, higher = better)")
    print(r.to_string())
    res = [null_test(H.prefix_method(H.v5_sprt), "V5 SPRT", by_year=False),
           null_test(v8(), "V8 rule x weather (daily)", by_year=False),
           null_test(v8(freeze_quarter=True), "V11 = V8 quarter-frozen", by_year=False),
           null_test(v8(t_pause=-np.inf), "V8 watch-only (half size, no pause)", by_year=False)]
    print("\n=== same, shuffled within rule over the whole 2021-26 (also credits WHEN in the 6 years it pauses)")
    print(pd.DataFrame(res).set_index("variant").T.to_string())

    rows = []
    for fq in (False, True):
        for nb in (20, 30, 60):
            for tp in (-0.5, -1.0, -2.0):
                d = v8(n_bucket=nb, t_pause=tp, freeze_quarter=fq)
                tag = f"{'V11 quarterly' if fq else 'V8 daily'} n={nb} t={tp}"
                rows.append(row(tag, E.report(d, "", show=False)) | H.diagnostics(d, tag))
    print("\n=== sensitivity (ALL rules; static: made 59.2 / 55.9, sum 17559 / 4512, worst quarter -974, max DD -1751)")
    print(pd.DataFrame(rows).to_string(index=False))

    print("\n=== reaction speed vs whipsaw: switches per year per rule x weather bucket")
    for nb in (20, 30, 60):
        s = bucket_series(n_bucket=nb)
        print(f"n={nb}: median switches/yr {s['switches/yr'].median():.1f}, max {s['switches/yr'].max():.1f}; "
              f"paused share of judged days (signal-weighted) "
              f"{(s['paused%'] * s['signals 21-26']).sum() / s['signals 21-26'].sum():.0f} %")
