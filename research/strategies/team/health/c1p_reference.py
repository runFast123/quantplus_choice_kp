"""C1' trend badge: production reference for SQL parity (no new modelling; the round-2 R2 / round-3 card unchanged).

Writes team/health/out/c1p_reference.csv (research grade = exact) and out/c1p_reference_livegrade.csv (the grade the
live table can give: stop / entry - 1 instead of min(stop-day open, stop) / entry - 1), one row per top-300 trend signal
from 2021-01-01: rule, symbol, signal_date, weather, grade, status, n_used, mean, t (card statistics as of the signal
day; grade = that signal's own 20-session grade). Reads data/ only (no `import signals`), writes only in team/health/.

    cd research/strategies/team/health && python c1p_reference.py
"""
from pathlib import Path

import numpy as np
import pandas as pd

import health as H
from health import E

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
TREND = ["strong_trend", "sma_trend"]
EMB, SPAN, NB, FALLBACK, TW, MIN_N, COST = 7, 35, 30, 50, -1.0, 20, 0.005
WX = {0.0: "stormy", 1.0: "mixed", 2.0: "sunny"}


def frames():
    c = pd.read_parquet(E.D / "candles.parquet")
    c["date"] = pd.to_datetime(c.date)
    out = {}
    for s, f in c.groupby("symbol"):
        f = f.sort_values("date").reset_index(drop=True)
        tr = pd.concat([f.high - f.low, (f.high - f.close.shift()).abs(), (f.low - f.close.shift()).abs()], axis=1).max(axis=1)
        f["atr"] = tr.rolling(14, min_periods=14).mean()          # record.atr_simple
        out[s] = f
    return out


def grades(t, fr):
    """research grade (exact) and live-table grade, plus the date each became known; also checks the rebuilt stop."""
    g, gl, kn, chk = [], [], [], []
    for r in t.itertuples():
        f = fr[r.symbol]
        i = int(np.searchsorted(f.date.to_numpy(), np.datetime64(r.signal_date)))
        j = i + 1
        assert f.date.iat[j] == r.entry_date
        o = f.open.iat[j]
        stop = f.close.iat[i] - 4 * f.atr.iat[i]
        if r.days <= 20:                                          # stopped within sessions 1..20 (= stop_hit_20)
            k = j + r.days - 1
            chk.append(abs(r.net - (min(f.open.iat[k], stop) / o - 1 - COST)))
            g.append(r.net)
            gl.append(stop / o - 1 - COST)
            kn.append(f.date.iat[k])
        else:                                                     # r20 = close of session 20 / entry - 1
            g.append(f.close.iat[j + 19] / o - 1 - COST)
            gl.append(g[-1])
            kn.append(f.date.iat[j + 19])
    return np.array(g), np.array(gl), np.array(kn, dtype="datetime64[ns]"), max(chk)


def card(t, grade, known, tie_desc=False):
    """Status as of each signal day from complete cohorts; returns status, n_used, mean, t."""
    st, nu, mu, tt = np.zeros(len(t), int), np.zeros(len(t), int), np.full(len(t), np.nan), np.full(len(t), np.nan)
    for r in TREND:
        ix = np.flatnonzero((t.rule == r).to_numpy())
        sym = t.symbol.to_numpy()[ix]
        key = pd.DataFrame({"d": t.signal_date.to_numpy()[ix], "s": sym})
        o = ix[key.sort_values(["d", "s"], ascending=[True, not tie_desc], kind="stable").index.to_numpy()]
        sd, gr, kn, bb = t.signal_date.to_numpy()[o], grade[o], known[o], t.wx.to_numpy()[o]
        for i in ix:
            d, b = t.signal_date.to_numpy()[i], t.wx.to_numpy()[i]
            k = np.searchsorted(sd, d - np.timedelta64(EMB + SPAN, "D"), side="left")   # signal_date < d - 42 days
            assert (kn[:k] < d).all()
            w = gr[:k][bb[:k] == b][-NB:]                       # NaN weather never matches -> fallback
            if len(w) < NB:
                w = gr[:k][-FALLBACK:]
            nu[i] = len(w)
            if len(w) < MIN_N:
                continue
            m, se = w.mean(), w.std(ddof=1) / np.sqrt(len(w))
            mu[i], tt[i] = m, m / se
            st[i] = 2 if (m < 0 and m / se < TW) else (1 if m < 0 else 0)
    return st, nu, mu, tt


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    t = E.load()
    t = t[t.rule.isin(TREND)].reset_index(drop=True)              # parquet order: rule, then symbol, then date
    fr = frames()
    g, gl, kn, chk = grades(t, fr)
    print(f"rebuilt stop reproduces every stopped trade's net: max |diff| {chk:.1e}")
    span = (pd.Series(kn) - t.signal_date).dt.days
    print(f"signal day -> grade known: max {span.max()} calendar days (cut-off 42)")
    st, nu, mu, tt = card(t, g, kn)
    r2 = pd.read_csv(HERE / "round2_R2.csv")
    r2 = r2[r2.rule.isin(TREND)].reset_index(drop=True)
    print(f"matches round-2 R2 statuses: {(st == r2.status.to_numpy()).mean() * 100:.1f} %")
    sl, *_ = card(t, gl, kn)
    st_tie, *_ = card(t, g, kn, tie_desc=True)
    oos = (t.signal_date >= E.START).to_numpy()
    lab = np.array(["Healthy", "On watch", "Weak"])
    print(f"2021-26 signals {oos.sum()}: labels that flip with the live grade (stop / entry - 1): "
          f"{(st != sl)[oos].sum()} (Weak <-> not Weak: {((st == 2) != (sl == 2))[oos].sum()}); "
          f"gap-down stops in 2019-26: {(g != gl).sum()} of {(t.days <= 20).sum()} stopped by session 20")
    print(f"labels that flip if ties at the 30th trade are broken the other way: {(st != st_tie)[oos].sum()}")
    print(f"no judgement (< 20 complete trades): {(nu[oos] < MIN_N).sum()}; weather missing: {t.wx.isna()[oos].sum()}")
    for gname, s_ in (("research", st), ("live grade", sl)):
        x = t[oos].assign(s=s_[oos], y=lambda v: v.signal_date.dt.year)
        print(f"Weak share by year ({gname}): " + ", ".join(
            f"{y} {100 * (v.s == 2).mean():.0f}%" for y, v in x.groupby("y")))
        w = (x.net > 0)
        print(f"  made% Weak {100 * w[x.s == 2].mean():.1f} vs not-Weak {100 * w[x.s != 2].mean():.1f} "
              f"(Healthy only {100 * w[x.s == 0].mean():.1f}); 2025-26 Weak n {((x.s == 2) & (x.y >= 2025)).sum()}")
    for name, s_, gg in (("c1p_reference.csv", st, g), ("c1p_reference_livegrade.csv", sl, gl)):
        _, n_, m_, t_ = card(t, gg, kn)
        ref = pd.DataFrame({"rule": t.rule, "symbol": t.symbol, "signal_date": t.signal_date.dt.date,
                            "weather": t.wx.map(WX), "grade": np.round(gg, 8), "status": lab[s_], "n_used": n_,
                            "mean": np.round(m_, 8), "t": np.round(t_, 6)})[oos]
        ref.to_csv(OUT / name, index=False)
        print(f"wrote out/{name}: {len(ref)} rows")
