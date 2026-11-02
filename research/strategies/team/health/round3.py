"""ROUND 3 PLAN (researcher "health") -- written before anything in this file was run. Rules: team/ROUND3.md.

Check: C1' trend badge EXACTLY as round-2 R2 (no change): per trend rule x house weather (wx on the signal day), the 30
most recent complete-cohort trades (signal_date < day - 7 - 35 days), each graded at 20 sessions (its stop result if
stopped by session 20, else the session-20 close vs the entry open, minus the 0.5 % cost); fewer than 30 -> the rule's
last 50; fewer than 20 -> Healthy. mean < 0 and t < -1 -> Weak; mean < 0 -> On watch; else Healthy.

Independent stocks: each year's point-in-time ranks 301-500 by traded value (fair.pit_universe(lo, 500) minus
fair.pit_universe(lo, 300), the same ranking that built the top 300). Trend trades rebuilt with the SAME code that built
team_trades: team/build_dataset.strong_trades / sma_trades (record.py, record_sma.py), same START, same OPEN exclusion.
Reproduction check first: the same run on ranks 1-300 must reproduce team_trades' trend trades.
  PRIMARY  the card is built from the 301-500 trend trades themselves and labels them (R2's procedure, new stocks).
  SECONDARY the top-300 card (frozen R2 labels' source) labels the 301-500 signals (no 301-500 outcome is learned).
Statistic: made%(Healthy) - made%(Weak), 2021-26 and 2024-26, per rule and both trend rules together.
Nulls (1,000 draws each, p = share of draws >= observed):
  (1) trade shuffle: labels permuted within rule x signal-year;
  (2) whole-month swap (regime's episode test): within rule x year the months are permuted, and each trade of month i
      draws its label at random (with replacement) from the labels of the month it was swapped with.
Decision (ROUND3.md, applied to the PRIMARY run, both trend rules together): PASS only if gap >= 5 points in both periods
AND p < 0.05 against both nulls in both periods. Per-rule rows are reported, not used to rescue a fail.
Housekeeping: `import signals` rewrites data/signals.parquet -> it is backed up first and restored, and its SHA-256 is
asserted equal to the original. Outputs (team/health/ only): r3_trend_trades.parquet, round3_out.txt.

    cd research/strategies/team/health && python round3.py
"""
import hashlib
import shutil
import sys
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]                       # research/strategies
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(HERE.parent))
import health as H  # noqa: E402
from health import E  # noqa: E402

pd.set_option("display.width", 200)
CACHE = HERE / "r3_trend_trades.parquet"
SIG = ROOT / "data" / "signals.parquet"
TREND = ["strong_trend", "sma_trend"]
EMB, SPAN, NB, FALLBACK, TW = 7, 35, 30, 50, -1.0        # R2, unchanged
DRAWS = 1000


def sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()


def rebuild():
    if CACHE.exists():
        return pd.read_parquet(CACHE)
    # importing signals rewrites data/signals.parquet and record.py rewrites data/strong_trend_record.csv: back both up,
    # restore them afterwards, and check every file in data/ against its hash from before the run.
    files = [SIG, ROOT / "data" / "strong_trend_record.csv"]
    before = {p.name: sha(p) for p in (ROOT / "data").iterdir() if p.is_file()}
    bks = {p: HERE / f"_backup_{p.name}" for p in files}
    for p, b in bks.items():
        shutil.copy2(p, b)
    try:
        import build_dataset as BD           # imports signals -> rewrites data/signals.parquet
        S, B, F = BD.S, BD.B, BD.F
        p500 = {y: F.pit_universe(pd.Timestamp(f"{y}-01-01") if y > 2019 else B.START, top=500) for y in range(2019, 2027)}
        rows = []
        for rule, fn in (("strong_trend", BD.strong_trades), ("sma_trend", BD.sma_trades)):
            for s, f in F.ALL.items():
                for sd, ed, xd, net, how, days in fn(s, f):
                    if sd < B.START or how == "OPEN":
                        continue
                    uni = "top300" if s in S.pit.get(sd.year, ()) else ("r301_500" if s in p500.get(sd.year, ()) else None)
                    if uni:
                        rows.append((rule, s, sd, ed, xd, net, how, days, uni))
        t = pd.DataFrame(rows, columns=["rule", "symbol", "signal_date", "entry_date", "exit_date", "net", "how", "days", "uni"])
        for c in ("signal_date", "entry_date", "exit_date"):
            t[c] = pd.to_datetime(t[c])
        wx = S.mkt.wx.copy()
        wx.index = pd.to_datetime(wx.index)
        t["wx"] = t.signal_date.map(wx)
        t.to_parquet(CACHE, index=False)
    finally:
        for p, b in bks.items():
            if sha(p) != before[p.name]:
                shutil.copy2(b, p)
        after = {p.name: sha(p) for p in (ROOT / "data").iterdir() if p.is_file()}
        assert after == before, f"data/ differs: {[k for k in set(before) | set(after) if before.get(k) != after.get(k)]}"
        for b in bks.values():
            b.unlink()
        print(f"data/ restored: all {len(after)} files match their hashes from before the run "
              f"(signals.parquet {before[SIG.name][:12]}...)")
    return t


def card(ledger, targets, px):
    """R2's C1' card (trend rules), learning from `ledger`, labelling `targets`. Same code path as round2.card."""
    def grade(t):
        g, kn = t.net.to_numpy().copy(), t.exit_date.to_numpy().copy()
        for i in np.flatnonzero((t.days > 20).to_numpy()):
            r = t.iloc[i]
            ds, o, c = px[r.symbol]
            j = np.searchsorted(ds, np.datetime64(r.entry_date))
            g[i], kn[i] = c[j + 19] / o[j] - 1 - H.COST, ds[j + 19]
        return g, kn
    out = np.zeros(len(targets), int)
    for r in TREND:
        L = ledger[ledger.rule == r].sort_values("signal_date", kind="stable")
        gr, kn = grade(L)
        sd, bb = L.signal_date.to_numpy(), L.wx.to_numpy()
        ti = np.flatnonzero((targets.rule == r).to_numpy())
        for i in ti:
            d, b = targets.signal_date.to_numpy()[i], targets.wx.to_numpy()[i]
            k = np.searchsorted(sd, d - np.timedelta64(EMB + SPAN, "D"), side="left")
            assert (kn[:k] < d).all(), "a cohort trade's grade was not yet known"
            w = gr[:k][bb[:k] == b][-NB:]
            if len(w) < NB:
                w = gr[:k][-FALLBACK:]
                if len(w) < H.MIN_N:
                    continue
            m, se = w.mean(), w.std(ddof=1) / np.sqrt(len(w))
            out[i] = 2 if (m < 0 and m / se < TW) else (1 if m < 0 else 0)
    return out


def gap(st, win):
    a, b = win[st == 0], win[st == 2]
    return 100 * (a.mean() - b.mean()) if len(a) and len(b) else np.nan


def tests(d, name, seed=0):
    rows = []
    for per, lo in (("2021-26", E.START), ("2024-26", E.RECENT)):
        for grp in (["strong_trend"], ["sma_trend"], TREND):
            x = d[(d.signal_date >= lo) & (d.signal_date < E.END) & d.rule.isin(grp)].reset_index(drop=True)
            st, win = x.status.to_numpy(), (x.net > 0).to_numpy()
            real = gap(st, win)
            yr, mon = x.signal_date.dt.year.to_numpy(), x.signal_date.dt.to_period("M").astype(str).to_numpy()
            cells = [g.index.to_numpy() for _, g in x.groupby([x.rule, yr])]
            months = [[np.flatnonzero(((x.rule == r) & (mon == m)).to_numpy()) for m in np.unique(mon[ix])]
                      for (r, _), ix in x.groupby([x.rule, yr]).indices.items()]
            rng = np.random.default_rng(seed)
            s1, s2 = np.empty(DRAWS), np.empty(DRAWS)
            for k in range(DRAWS):
                a = st.copy()
                for ix in cells:
                    a[ix] = st[rng.permutation(ix)]
                s1[k] = gap(a, win)
                b = st.copy()
                for ms in months:
                    for src, dst in zip(rng.permutation(len(ms)), range(len(ms))):
                        b[ms[dst]] = rng.choice(st[ms[src]], size=len(ms[dst]), replace=True)
                s2[k] = gap(b, win)
            n = {lab: int((st == s).sum()) for s, lab in ((0, "nH"), (1, "nW"), (2, "nK"))}
            rows.append({"run": name, "period": per, "rules": "both" if len(grp) == 2 else grp[0],
                         "Healthy made": round(100 * win[st == 0].mean(), 1), "Weak made": round(100 * win[st == 2].mean(), 1)
                         if (st == 2).any() else np.nan, "n Healthy": n["nH"], "n OnWatch": n["nW"], "n Weak": n["nK"],
                         "gap": round(real, 1), "null yr": round(np.nanmean(s1), 1), "p yr": round(np.mean(s1 >= real), 3),
                         "null month": round(np.nanmean(s2), 1), "p month": round(np.mean(s2 >= real), 3)})
    return rows


if __name__ == "__main__":
    t = rebuild()
    ref = E.load()
    ref = ref[ref.rule.isin(TREND)]
    a = t[t.uni == "top300"]
    m = a.merge(ref, on=["rule", "symbol", "signal_date"], how="outer", indicator=True, suffixes=("", "_ref"))
    both = m[m._merge == "both"]
    print(f"reproduction ranks 1-300: rebuilt {len(a)}, team_trades {len(ref)}, matched {len(both)}, "
          f"max |net diff| {(both.net - both.net_ref).abs().max():.1e}, wx equal {(both.wx == both.wx_ref).mean():.3f}")
    x = t[t.uni == "r301_500"].reset_index(drop=True)
    print("ranks 301-500 trend trades:", x.groupby("rule").size().to_dict(),
          "| 2021-26:", x[x.signal_date >= E.START].groupby("rule").size().to_dict())
    px = H._close_lookup()

    # the code path reproduces round-2 R2 on the top 300
    top = E.load().reset_index(drop=True)
    r2 = pd.read_csv(HERE / "round2_R2.csv")
    top["status"] = card(top, top, px)
    same = (top.loc[top.rule.isin(TREND), "status"].to_numpy() == r2.loc[r2.rule.isin(TREND), "status"].to_numpy()).mean()
    print(f"round-2 R2 trend statuses reproduced: {100 * same:.1f} %")

    x["status"] = card(x, x, px)                       # PRIMARY
    x2 = x.copy()
    x2["status"] = card(a.assign(wx=a.wx), x, px)      # SECONDARY: the top-300 card on 301-500 signals
    rows = tests(x, "PRIMARY 301-500 own card") + tests(x2, "SECONDARY top-300 card") + \
        tests(top[top.rule.isin(TREND)], "context: top 300 (round-2 R2)")
    out = pd.DataFrame(rows)
    print("\n=== C1' Weak vs Healthy: made%(Healthy) - made%(Weak); nulls: rule x year shuffle, whole-month swap")
    print(out.to_string(index=False))
    p = out[(out.run.str.startswith("PRIMARY")) & (out.rules == "both")]
    ok = (p.gap >= 5).all() and (p["p yr"] < 0.05).all() and (p["p month"] < 0.05).all()
    print(f"\nDECISION (pre-registered, PRIMARY, both trend rules): {'PASS' if ok else 'FAIL'}")
