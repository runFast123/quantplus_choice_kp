"""Strategy health monitor (researcher "health", team/BRIEF.md, pre-registered in PLAN.md).

Each rule keeps a report card built ONLY from its trades that closed before the decision day (exit_date < signal_date);
the card sets a status per rule: Healthy (size 1), On watch (size 0.5) or Paused (not taken). Paused rules keep being
graded in the shadow, so evidence never starves. Scored with team/evaluate.py.

    cd research/strategies/team/health && python health.py            # all variants + diagnostics
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import beta as beta_dist, norm

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import evaluate as E  # noqa: E402

RULES = E.RULES
MIN_N = 20
SIZE = {0: 1.0, 1: 0.5, 2: 0.0}            # Healthy, On watch, Paused
COST = 0.005

# ---------------------------------------------------------------- data
T = E.load().reset_index(drop=True)
T["tid"] = np.arange(len(T))
UNI = pd.read_csv(E.D / "universe.csv")
SECTOR = dict(zip(UNI.symbol, UNI.sector.fillna("Other")))
T["sector"] = T.symbol.map(SECTOR).fillna("Other")


def ledger(rule):
    """The rule's closed trades in exit order (ties: signal_date, symbol)."""
    return T[T.rule == rule].sort_values(["exit_date", "signal_date", "symbol"]).reset_index(drop=True)


LEDGER = {r: ledger(r) for r in RULES}


# ---------------------------------------------------------------- prefix statistics: state after the first k closed trades
def v1_rolling(x, N=50, t_pause=-1.0):
    st = np.zeros(len(x) + 1, int)
    for k in range(len(x) + 1):
        w = x[max(0, k - N):k]
        if len(w) < MIN_N:
            continue
        m, se = w.mean(), w.std(ddof=1) / np.sqrt(len(w))
        st[k] = 2 if (m < 0 and m / se < t_pause) else (1 if m < 0 else 0)
    return st, None


def v2_ewma(x, H=25, t_pause=-1.0):
    lam = 0.5 ** (1 / H)
    st = np.zeros(len(x) + 1, int)
    W = S = Q = W2 = 0.0
    for k in range(1, len(x) + 1):
        v = x[k - 1]
        W, S, Q, W2 = lam * W + 1, lam * S + v, lam * Q + v * v, lam * lam * W2 + 1
        if k < MIN_N:
            continue
        m = S / W
        var = max(Q / W - m * m, 1e-12)
        se = np.sqrt(var / (W * W / W2))
        st[k] = 2 if (m < 0 and m / se < t_pause) else (1 if m < 0 else 0)
    return st, None


def v3_beta(x, H=25, n0=10, p_watch=0.5, p_pause=0.8):
    lam = 0.5 ** (1 / H)
    st = np.zeros(len(x) + 1, int)
    Wn = Ln = 0.0
    for k in range(1, len(x) + 1):
        win = x[k - 1] > 0
        Wn, Ln = lam * Wn + win, lam * Ln + (not win)
        if k < MIN_N:
            continue
        h = x[:k]
        p0 = (h > 0).mean()
        aw, al = h[h > 0].mean(), abs(h[h <= 0].mean())
        pstar = al / (aw + al)
        P = beta_dist.cdf(pstar, n0 * p0 + Wn, n0 * (1 - p0) + Ln)
        st[k] = 2 if P > p_pause else (1 if P > p_watch else 0)
    return st, None


def v4_cusum(x, k_ref=0.25, h=4.0):
    st = np.zeros(len(x) + 1, int)
    S, paused = 0.0, False
    for k in range(1, len(x) + 1):
        prior = x[:k - 1]
        if len(prior) >= MIN_N:
            mu0, sd0 = prior.mean(), prior.std(ddof=1)
            S = min(h, max(0.0, S + (mu0 - x[k - 1]) / sd0 - k_ref))
            if S >= h:
                paused = True
            elif paused and S < h / 2:
                paused = False
        st[k] = 2 if paused else (1 if S > h / 2 else 0)
    return st, None


def v5_sprt(x, delta=0.10, a=0.1):
    A, B = np.log((1 - a) / a), np.log(a / (1 - a))
    st = np.zeros(len(x) + 1, int)
    L, paused = 0.0, False
    for k in range(1, len(x) + 1):
        prior = x[:k - 1]
        if len(prior) >= MIN_N:
            p0 = (prior > 0).mean()
            p1 = max(p0 - delta, 0.01)
            L += np.log(p1 / p0) if x[k - 1] > 0 else np.log((1 - p1) / (1 - p0))
            L = min(A, max(B, L))
            if L >= A:
                paused = True
            elif paused and L <= 0:
                paused = False
        st[k] = 2 if paused else (1 if L >= A / 2 else 0)
    return st, None


def v6_prob_edge(x, N=50, floor=0.25):
    st = np.zeros(len(x) + 1, int)
    sz = np.ones(len(x) + 1)
    for k in range(len(x) + 1):
        w = x[max(0, k - N):k]
        if len(w) < MIN_N:
            continue
        sz[k] = max(floor, norm.cdf(w.mean() / (w.std(ddof=1) / np.sqrt(len(w)))))
    return st, sz


PREFIX = {"V1": v1_rolling, "V2": v2_ewma, "V3": v3_beta, "V4": v4_cusum, "V5": v5_sprt, "V6": v6_prob_edge}


def prefix_method(fn, freeze_quarter=False, **kw):
    """Apply a prefix statistic: each trade gets the state after the closed trades with exit_date < its day."""
    out = []
    for r in RULES:
        L = LEDGER[r]
        st, sz = fn(L.net.to_numpy(), **kw)
        sz = np.array([SIZE[s] for s in st]) if sz is None else sz
        g = T[T.rule == r]
        day = g.signal_date.dt.to_period("Q").dt.start_time if freeze_quarter else g.signal_date
        k = np.searchsorted(L.exit_date.to_numpy(), day.to_numpy(), side="left")
        out.append(pd.DataFrame({"tid": g.tid.to_numpy(), "status": st[k], "size": sz[k]}))
    return _finish(pd.concat(out))


def _finish(s):
    d = T.merge(s, on="tid")
    d["take"] = d["size"] > 0
    return d


# ---------------------------------------------------------------- V7 Thompson bandit across rules (return per day held)
def v7_bandit(N=50, floor=0.25, draws=2000, seed=7):
    rng = np.random.default_rng(seed)
    days = np.sort(T.signal_date.unique())
    stats = {}
    for r in RULES:
        L = LEDGER[r]
        rpd = (L.net / L.days.clip(lower=1)).to_numpy()
        k = np.searchsorted(L.exit_date.to_numpy(), days, side="left")
        stats[r] = (rpd, k)
    rows = []
    for i, d in enumerate(days):
        mus, ses, ok = [], [], []
        for r in RULES:
            rpd, k = stats[r]
            w = rpd[max(0, k[i] - N):k[i]]
            ok.append(len(w) >= MIN_N)
            mus.append(w.mean() if len(w) >= MIN_N else 0.0)
            ses.append(w.std(ddof=1) / np.sqrt(len(w)) if len(w) >= MIN_N else 1.0)
        if not all(ok):
            rows += [(d, r, 1.0) for r in RULES]
            continue
        z = rng.normal(np.array(mus), np.array(ses), size=(draws, len(RULES)))
        share = np.bincount(z.argmax(1), minlength=len(RULES)) / draws
        sz = np.maximum(floor, share / share.max())
        rows += [(d, r, sz[j]) for j, r in enumerate(RULES)]
    m = pd.DataFrame(rows, columns=["signal_date", "rule", "size"])
    d = T.merge(m, on=["signal_date", "rule"])
    d["status"] = 0
    d["take"] = True
    return d


# ---------------------------------------------------------------- V8 / V9 bucket health (rule x weather, rule x sector)
def bucket_method(col, n_bucket, max_age_days=None, N=50):
    base = prefix_method(v1_rolling, N=N).set_index("tid")
    out = []
    for r in RULES:
        L = LEDGER[r]
        ex = L.exit_date.to_numpy()
        g = T[T.rule == r]
        for tid, d, b in zip(g.tid, g.signal_date, g[col]):
            sel = (ex < np.datetime64(d)) & (L[col].to_numpy() == b)
            if max_age_days:
                sel &= ex >= np.datetime64(d - pd.Timedelta(days=max_age_days))
            w = L.net.to_numpy()[sel][-n_bucket:]
            if len(w) < n_bucket:
                st = base.at[tid, "status"]
            else:
                m, se = w.mean(), w.std(ddof=1) / np.sqrt(len(w))
                st = 2 if (m < 0 and m / se < -1) else (1 if m < 0 else 0)
            out.append((tid, st, SIZE[st]))
    return _finish(pd.DataFrame(out, columns=["tid", "status", "size"]))


# ---------------------------------------------------------------- V10 mark-to-market of still-open signals
def _close_lookup():
    c = pd.read_parquet(E.D / "candles.parquet", columns=["symbol", "date", "open", "close"])
    c["date"] = pd.to_datetime(c.date)
    return {s: (g.date.to_numpy(), g.open.to_numpy(), g.close.to_numpy()) for s, g in c.sort_values("date").groupby("symbol")}


def v10_mtm(N=50):
    px = _close_lookup()
    trend = T.rule.isin(["strong_trend", "sma_trend"])

    def at(sym, day, field):  # last session <= day (field 2 = close) or exactly day (field 1 = open)
        ds, o, c = px[sym]
        i = np.searchsorted(ds, np.datetime64(day), side="right") - 1
        return (o if field == 1 else c)[i], ds[i]

    entry = []
    for _, t in T.iterrows():
        if trend.iat[_]:
            entry.append(at(t.symbol, t.entry_date, 1)[0])
        else:
            entry.append(at(t.symbol, t.signal_date, 2)[0] * (1 - t.atrpct))
    T_ = T.assign(entry_px=entry)
    out = []
    for r in RULES:
        g = T_[T_.rule == r].sort_values(["signal_date", "symbol"])
        sd, ex = g.signal_date.to_numpy(), g.exit_date.to_numpy()
        net, sym, ep = g.net.to_numpy(), g.symbol.to_numpy(), g.entry_px.to_numpy()
        cache = {}
        for tid, d in zip(g.tid, g.signal_date):
            dd = np.datetime64(d)
            if dd not in cache:
                idx = np.flatnonzero(sd < dd)[-N:]
                vals = []
                for j in idx:
                    if ex[j] < dd:
                        vals.append(net[j])
                    else:
                        c, _d = at(sym[j], d, 2)
                        vals.append(c / ep[j] - 1 - COST)
                w = np.array(vals)
                if len(w) < MIN_N:
                    cache[dd] = 0
                else:
                    m, se = w.mean(), w.std(ddof=1) / np.sqrt(len(w))
                    cache[dd] = 2 if (m < 0 and m / se < -1) else (1 if m < 0 else 0)
            out.append((tid, cache[dd], SIZE[cache[dd]]))
    return _finish(pd.DataFrame(out, columns=["tid", "status", "size"]))


# ---------------------------------------------------------------- diagnostics (reporting only; scoring is evaluate.py)
def diagnostics(d, name):
    d = d[(d.signal_date >= E.START) & (d.signal_date < E.END)].copy()
    d["w"] = d["size"].where(d["take"], 0.0)
    paused = d[~d["take"]]
    watch = d[d["take"] & (d["size"] < 1)]
    pq = d.assign(q=d.signal_date.dt.to_period("Q")).groupby("q").apply(lambda g: (g.net * g.w).sum(), include_groups=False)
    bq = d.assign(q=d.signal_date.dt.to_period("Q")).groupby("q").net.sum()
    cum = d.sort_values("exit_date").assign(c=lambda x: (x.net * x.w).cumsum()).c
    cumb = d.sort_values("exit_date").net.cumsum()
    dd, ddb = (cum - cum.cummax()).min(), (cumb - cumb.cummax()).min()
    print(f"--- {name}: paused {len(paused)} trades (made {100 * (paused.net > 0).mean():.1f} %, avg {100 * paused.net.mean():+.2f} %, "
          f"sum {100 * paused.net.sum():+.0f} %); on watch / part-size {len(watch)} (avg {100 * watch.net.mean():+.2f} %)"
          if len(paused) else f"--- {name}: nothing paused; part-size {len(watch)} (avg {100 * watch.net.mean():+.2f} %)")
    print(f"    worst quarter sum% {100 * pq.min():+.0f} (static {100 * bq.min():+.0f}); max drawdown of cum sum% {100 * dd:.0f} "
          f"(static {100 * ddb:.0f})")
    return {"paused": len(paused), "worstQ": round(100 * pq.min()), "maxDD": round(100 * dd)}


def per_year(d, name):
    d = d[(d.signal_date >= E.START) & (d.signal_date < E.END)]
    base = E.baseline()
    rows = []
    for y in range(2021, 2027):
        g, b = d[d.signal_date.dt.year == y], base[base.signal_date.dt.year == y]
        r, s = E._block(g, len(b)), E._block(b, len(b))
        rows.append({"year": y, "kept": r["kept"], "made%": r["made%"], "static made%": s["made%"], "sum%": r["sum%"],
                     "static sum%": s["sum%"], "avg%": r["avg%"], "static avg%": s["avg%"]})
    out = pd.DataFrame(rows)
    print(f"--- per year, {name}\n{out.to_string(index=False)}")
    return out


def switches(fn, **kw):
    """Whipsaw: status changes per rule-year and share of days Paused, on the daily status series (2021-26)."""
    res = {}
    for r in RULES:
        L = LEDGER[r]
        st, _ = fn(L.net.to_numpy(), **kw)
        days = pd.bdate_range(E.START, E.END - pd.Timedelta(days=1))
        k = np.searchsorted(L.exit_date.to_numpy(), days.to_numpy(), side="left")
        s = st[k]
        res[r] = {"switches/yr": round((np.diff(s) != 0).sum() / (len(days) / 261), 1),
                  "paused%days": round(100 * (s == 2).mean(), 1), "watch%days": round(100 * (s == 1).mean(), 1)}
    return pd.DataFrame(res).T


def summary_row(name, rep):
    a = rep[(rep.rule == "ALL")].set_index("period")
    return {"variant": name, "made21": a.at["2021-26", "made%"], "sum21": a.at["2021-26", "sum%"],
            "avg21": a.at["2021-26", "avg%"], "made24": a.at["2024-26", "made%"], "sum24": a.at["2024-26", "sum%"],
            "avg24": a.at["2024-26", "avg%"], "kept21": a.at["2021-26", "kept"]}


if __name__ == "__main__":
    pd.set_option("display.width", 200)
    static = E.report(E.baseline(), "static rules (today)")
    static_sum = static[(static.rule == "ALL") & (static.period == "2021-26")]["sum%"].iat[0]
    variants = {
        "V1 rolling-50 mean": lambda: prefix_method(v1_rolling),
        "V2 EWMA hl25": lambda: prefix_method(v2_ewma),
        "V3 Beta win-rate": lambda: prefix_method(v3_beta),
        "V4 CUSUM k.25 h4": lambda: prefix_method(v4_cusum),
        "V5 SPRT d.10": lambda: prefix_method(v5_sprt),
        "V6 P(edge) sizing": lambda: prefix_method(v6_prob_edge),
        "V7 Thompson bandit": v7_bandit,
        "V8 rule x weather": lambda: bucket_method("wx", 30),
        "V9 rule x sector": lambda: bucket_method("sector", 20, max_age_days=365),
        "V10 mark-to-market": v10_mtm,
    }
    rows, decs = [], {}
    for name, f in variants.items():
        d = f()
        decs[name] = d
        rep = E.report(d, name)
        diagnostics(d, name)
        rows.append(summary_row(name, rep))
    summ = pd.DataFrame(rows)
    print("\n=== summary (ALL rules)\n" + summ.to_string(index=False))
    elig = summ[summ.sum21 >= 0.9 * static_sum]
    best = elig.sort_values(["made21", "made24"], ascending=False).variant.iat[0] if len(elig) else None
    print(f"\nbest by the pre-registered rule (sum% >= 90 % of static {static_sum:.0f}): {best}")
    summ.to_csv(HERE / "summary.csv", index=False)
