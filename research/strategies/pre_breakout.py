"""Pre-breakout: a NEW candidate rule built to flag a stock BEFORE its breakout, at a lower price (12 Nov 2026).

The owner's claim: "a normal analyst buys the breakout (say Rs 400); our system flags the stock before the breakout, at a
lower price." early_entry.py found the six live rules are NOT earlier than random days. This script designs a rule for
exactly that job and tests whether it earns the claim. Tested on past prices only; nothing here changes a live rule.
Everything below was written down BEFORE the first run.

Data and research set (as record_secular.py / early_entry.py)
  Prices: data/candles_long.parquet (Yahoo, split- and dividend-adjusted, from 2010, so 2019 signals have a full
  200-day / 126-day history). Stocks: the research stocks (signals.F.ALL); a signal counts only if the stock was in
  that year's point-in-time top 300 by traded value (signals.pit) and the signal day is 2019-07-01 or later.
  Nifty 50: data/NSEI_long.parquet. Cost 0.5 % round trip on every trade result.

Building blocks (all known at the signal day's close, day i)
  hi50       highest HIGH of the 50 sessions before day i
  breakout   a CLOSE above hi50 (the same 50-day breakout early_entry.py uses); the analyst buys the next open
  under(X)   hi50 * (1 - X) <= close <= hi50 (close within X % below the prior 50-session high, not above it), and no
             breakout day in the 10 sessions up to and including day i (a base under resistance, not a fresh breakout)
  tight(T)   (highest high - lowest low of the last 15 sessions incl. i) / close <= T
  vcp        ATR10 / ATR50 < 0.7 (simple average true ranges: volatility contraction)
  dry        20-day average volume < 50-day average volume (volume dry-up in the base)
  Trend contexts
    C50   close > 50-day average and the 50-day average is higher than 10 sessions ago
    C200  C50 and close > 200-day average, 200-day average higher than 20 sessions ago, 50-day above 200-day
    CRS   C200 and relative strength vs the Nifty (6-month = 126-session return of the stock / of the Nifty) in the top
          third (pct rank >= 2/3) of that day's point-in-time top-300 stocks
Signal: the FIRST day the variant's setup holds (it did not hold the session before), and the stock has no open trade
  under the same variant (one trade per stock at a time; with the first-day trigger this gives one signal per base).
Plan: entry at the next open (day j = i + 1). Safety stop, pre-registered per variant:
    base   lowest low of the 15 sessions up to day i, minus 0.5 %  (just under the base)
    atr    close - 4 x ATR14 (simple), as the live trend rules
  Out at the stop (at the open if it gaps under), otherwise at the close of the 60th session (j + 59). Open trades
  (fewer than 60 sessions of data left and no stop) are counted as signals but not in trade results.

Pre-registered variants (14)
  P01 C200  under 3 %  tight 10 %                   base
  P02 C200  under 5 %  tight 12 %                   base
  P03 C200  under 8 %  tight 15 %                   base
  P04 C200  under 5 %  vcp                          base
  P05 C200  under 5 %  vcp + dry                    base
  P06 CRS   under 5 %  tight 12 %                   base
  P07 CRS   under 5 %  vcp                          base
  P08 CRS   under 5 %  vcp + dry                    base
  P09 CRS   under 3 %  vcp + dry                    base
  P10 CRS   under 8 %  vcp + dry                    base
  P11 CRS   under 5 %  tight 12 % + vcp + dry       base   (the full "volatility contraction" pattern)
  P12 C50   under 5 %  tight 12 % + dry             base
  P13 = P08 with the atr stop
  P14 = P02 with the atr stop

Measures, per variant, 2019-07..2023-12 and 2024-01..2026-10 separately (by signal date)
  1 breakout rate: P(a breakout within 20 sessions after day i) and within 60 (signals with the full window only)
    Yardstick (main): random days from the same trend context (C50 / C200 / CRS) in the same research set, 3,000 per
    seed, 5 seeds pooled, put through the same plan with the same stop logic and one trade per stock at a time.
    Yardstick (extra, for information only, not used in any decision): random days in the same context AND under(X)
    (near the high, no recent breakout) - shows whether the tightness / volume parts add anything beyond "near the high".
  2 head start, for signals followed by a breakout within 60 sessions: (open of b+1) / (rule entry) - 1, in %, and the
    sessions (b + 1) - j; median.
  3 the analyst: for each signal followed by a breakout (first breakout day b, i < b <= i + 60), buy the SAME stock at
    the open of b + 1, stop by the same logic computed at day b (base: lowest low of the 15 sessions up to b, minus
    0.5 %; atr: close_b - 4 x ATR14_b), out at the stop or the close of the 60th session. Analyst trades are counted
    once per (stock, breakout day). Signals without a breakout within 60 sessions: the analyst does nothing; the rule's
    trade (often a loss) is still counted against the rule. Reported: closed trades, made-money %, median and mean
    result after costs, total (sum of results, % points). Paired: on signals where both trades closed, the rule's
    mean vs the analyst's mean.
  4 the live Strong trend record (record.py, R.t): closed trades, made money %, mean and median after costs.
Choice (on 2019-23 only): among variants with >= 150 closed trades AND breakout-within-20 rate >= the main random
  yardstick's + 10 points, the highest mean result after costs (ties: more trades). Its 2024-26 numbers are reported
  untouched. If no variant qualifies, that is the answer; the highest-mean variant is then shown only as "best of a
  failed set".
The claim is EARNED only if, for the chosen variant, in BOTH periods: (a) breakout-within-20 >= random + 10 points,
  (b) median head start > 0 %, (c) the rule's mean result per trade after costs > the analyst's AND the rule's total >
  the analyst's total, (d) the rule's mean > the main random yardstick's mean.
Examples (chosen variant, all years, closed trades): (1) among trades that made money and were followed by a breakout
  within 60 sessions, the one whose head start is closest to that group's median head start (ties: most recent);
  (2) one honest failure: the most recent trade that hit its stop with no breakout within 60 sessions.

    python pre_breakout.py   -> data/pre_breakout.json
"""
import json

import numpy as np
import pandas as pd

import backtest as B
import record as R
import signals as S

COST = 0.005
IS_END = pd.Timestamp("2024-01-01")
START = B.START
SEEDS = 5
RAND_N = 3000
HOLD = 60
BASE_N = 15
NO_BO = 10

V = {   # name: (context, under X, tight T or None, vcp, dry, stop)
    "P01": ("C200", 0.03, 0.10, False, False, "base"),
    "P02": ("C200", 0.05, 0.12, False, False, "base"),
    "P03": ("C200", 0.08, 0.15, False, False, "base"),
    "P04": ("C200", 0.05, None, True, False, "base"),
    "P05": ("C200", 0.05, None, True, True, "base"),
    "P06": ("CRS", 0.05, 0.12, False, False, "base"),
    "P07": ("CRS", 0.05, None, True, False, "base"),
    "P08": ("CRS", 0.05, None, True, True, "base"),
    "P09": ("CRS", 0.03, None, True, True, "base"),
    "P10": ("CRS", 0.08, None, True, True, "base"),
    "P11": ("CRS", 0.05, 0.12, True, True, "base"),
    "P12": ("C50", 0.05, 0.12, False, True, "base"),
    "P13": ("CRS", 0.05, None, True, True, "atr"),
    "P14": ("C200", 0.05, 0.12, False, False, "atr"),
}
NAMES = dict(pd.read_csv(B.D / "universe.csv").drop_duplicates("symbol")[["symbol", "name"]].values)


# ------------------------------------------------------------------ frames from the long price file
def naive(x):
    x = pd.to_datetime(x)
    return x.dt.tz_localize(None) if x.dt.tz is not None else x


def frames():
    long = pd.read_parquet(B.D / "candles_long.parquet").dropna(subset=["open", "high", "low", "close"])
    long = long[(long.close > 0) & (long.open > 0)]
    long["date"] = pd.to_datetime(long.date).dt.tz_localize(None) if getattr(pd.to_datetime(long.date).dt, "tz", None) \
        else pd.to_datetime(long.date)
    nif = pd.read_parquet(B.D / "NSEI_long.parquet")
    nif = nif.assign(date=pd.to_datetime(nif.Date).dt.tz_localize(None) if getattr(pd.to_datetime(nif.Date).dt, "tz", None)
                     else pd.to_datetime(nif.Date)).set_index("date").Close.sort_index()
    nif = nif[~nif.index.duplicated()]
    nret = nif / nif.shift(126) - 1
    out = {}
    for s, g in long.groupby("symbol"):
        if s not in S.F.ALL:
            continue
        g = g.sort_values("date").drop_duplicates("date").reset_index(drop=True)
        c, h, l, v = g.close, g.high, g.low, g.volume
        g["hi50"] = h.rolling(50, min_periods=50).max().shift(1)
        g["bo"] = (c > g.hi50).fillna(False)
        tr = pd.concat([h - l, (h - c.shift()).abs(), (l - c.shift()).abs()], axis=1).max(axis=1)
        g["atr14"] = tr.rolling(14, min_periods=14).mean()
        g["vcp"] = (tr.rolling(10, min_periods=10).mean() / tr.rolling(50, min_periods=50).mean()) < 0.7
        g["range15"] = (h.rolling(BASE_N).max() - l.rolling(BASE_N).min()) / c
        g["low15"] = l.rolling(BASE_N).min()
        g["dry"] = v.rolling(20).mean() < v.rolling(50).mean()
        g["sma50"], g["sma200"] = c.rolling(50).mean(), c.rolling(200).mean()
        g["recent_bo"] = g.bo.astype(int).rolling(NO_BO, min_periods=1).max().astype(bool)
        nr = nret.reindex(g.date, method="ffill").to_numpy()
        g["rs"] = (1 + c / c.shift(126) - 1) / (1 + nr)
        g["pit"] = np.array([s in S.pit.get(y, ()) for y in g.date.dt.year]) & (g.date >= START).to_numpy()
        out[s] = g
    # relative-strength rank among that day's point-in-time stocks
    panel = pd.concat({s: g.set_index("date").rs.where(g.set_index("date").pit) for s, g in out.items()}, axis=1, sort=True)
    rk = panel.rank(axis=1, pct=True)
    for s, g in out.items():
        g["rs_rank"] = rk[s].reindex(g.date).to_numpy()
        c50 = (g.close > g.sma50) & (g.sma50 > g.sma50.shift(10))
        c200 = c50 & (g.close > g.sma200) & (g.sma200 > g.sma200.shift(20)) & (g.sma50 > g.sma200)
        g["C50"], g["C200"] = c50.fillna(False), c200.fillna(False)
        g["CRS"] = (c200 & (g.rs_rank >= 2 / 3)).fillna(False)
    return out


def under(g, x):
    return ((g.close <= g.hi50) & (g.close >= g.hi50 * (1 - x)) & ~g.recent_bo).fillna(False)


def setup(g, ctx, x, t, vcp, dry):
    m = g[ctx] & under(g, x)
    if t is not None:
        m &= (g.range15 <= t).fillna(False)
    if vcp:
        m &= g.vcp.fillna(False)
    if dry:
        m &= g.dry.fillna(False)
    return m.to_numpy()


def stop_at(g, i, kind):
    if kind == "base":
        return g.low15.iat[i] * 0.995
    return g.close.iat[i] - 4 * g.atr14.iat[i]


# ------------------------------------------------------------------ the plan
def trade(o, l, c, j, st, n):
    """(exit index | None, exit price | None, how) from entry index j with stop st; 60 sessions."""
    end = min(j + HOLD, n)
    hit = np.flatnonzero(l[j:end] <= st)
    if len(hit):
        k = j + int(hit[0])
        return k, min(o[k], st), "stop"
    if j + HOLD > n:
        return None, None, "open"
    return j + HOLD - 1, c[j + HOLD - 1], "time"


def run(g, idx, kind, analyst=True):
    o, l, c = g.open.to_numpy(), g.low.to_numpy(), g.close.to_numpy()
    bo = g.bo.to_numpy()
    n, busy, rows = len(g), -1, []
    bo_pos = np.flatnonzero(bo)
    for i in idx:
        if i <= busy or i + 1 >= n:
            continue
        st = stop_at(g, i, kind)
        if not np.isfinite(st) or st <= 0 or st >= c[i]:
            continue
        j = i + 1
        k, px, how = trade(o, l, c, j, st, n)
        busy = n if k is None else k
        nb = bo_pos[np.searchsorted(bo_pos, i, side="right"):]
        b = int(nb[0]) if len(nb) else None
        r = {"symbol": g.symbol.iat[0], "i": int(i), "j": j, "date": g.date.iat[i], "entry": o[j], "stop": st,
             "k": k, "how": how, "net": np.nan if k is None else px / o[j] - 1 - COST,
             "full20": i + 20 <= n - 1, "full60": i + HOLD <= n - 1,
             "bo20": b is not None and b <= i + 20, "bo60": b is not None and b <= i + HOLD}
        if analyst and r["bo60"] and b + 1 < n:
            aj = b + 1
            ast = stop_at(g, b, kind)
            ak, apx, ahow = trade(o, l, c, aj, ast, n) if np.isfinite(ast) and 0 < ast < c[b] else (None, None, "nostop")
            r.update({"b": b, "hs": o[aj] / o[j] - 1, "sess": aj - j, "a_entry": o[aj], "a_stop": ast, "a_k": ak,
                      "a_how": ahow, "a_net": np.nan if ak is None else apx / o[aj] - 1 - COST})
        rows.append(r)
    return rows


# ------------------------------------------------------------------ summaries
def tstats(x):
    x = pd.Series(x).dropna()
    if x.empty:
        return {"trades": 0}
    return {"trades": int(len(x)), "made_money_pct": round(100 * (x > 0).mean(), 1), "mean_pct": round(100 * x.mean(), 2),
            "median_pct": round(100 * x.median(), 2), "total_pts": round(100 * x.sum(), 1)}


def pct(m):
    m = pd.Series(m)
    return None if m.empty else round(100 * float(m.mean()), 1)


def summ(t, seeds=1, analyst=True):
    if t.empty:
        return {"signals": 0}
    w20, w60 = t[t.full20], t[t.full60]
    out = {"signals": int(round(len(t) / seeds)), "bo20_pct": pct(w20.bo20), "bo60_pct": pct(w60.bo60),
           "rule": tstats(t.net), "stopped_pct": pct(t[t.how != "open"].how == "stop")}
    st = out["rule"]
    if seeds > 1 and st.get("trades"):
        st["trades"] = int(round(st["trades"] / seeds))
        st["total_pts"] = round(st["total_pts"] / seeds, 1)
    if not analyst:
        return out
    fo = t[t.bo60 & t["hs"].notna()] if "hs" in t else t.iloc[:0]
    out["head_pct_median"] = None if fo.empty else round(100 * fo["hs"].median(), 2)
    out["head_sessions_median"] = None if fo.empty else float(fo.sess.median())
    out["head_positive_pct"] = pct(fo["hs"] > 0) if len(fo) else None
    nb = w60[~w60.bo60]
    out["no_breakout_60_pct"] = pct(~w60.bo60)
    out["rule_no_breakout"] = tstats(nb.net)
    out["rule_with_breakout"] = tstats(fo.net)
    an = fo.drop_duplicates(["symbol", "b"])
    out["analyst"] = tstats(an.a_net)
    both = fo.dropna(subset=["net", "a_net"])
    out["paired"] = {"pairs": int(len(both)), "rule_mean_pct": round(100 * both.net.mean(), 2) if len(both) else None,
                     "analyst_mean_pct": round(100 * both.a_net.mean(), 2) if len(both) else None,
                     "rule_beat_analyst_pct": pct(both.net > both.a_net) if len(both) else None}
    return out


def periods(t, seeds=1, analyst=True):
    return {"2019_23": summ(t[t.date < IS_END], seeds, analyst), "2024_26": summ(t[t.date >= IS_END], seeds, analyst)}


# ------------------------------------------------------------------ random yardsticks
_rcache = {}


def random_pool(G, ctx, kind, x=None):
    key = (ctx, kind, x)
    if key in _rcache:
        return _rcache[key]
    masks = {s: (g[ctx] & (under(g, x) if x is not None else True) & g.pit).to_numpy() for s, g in G.items()}
    tot = sum(int(m.sum()) for m in masks.values())
    p = RAND_N / max(1, tot)
    rows = []
    for seed in range(SEEDS):
        rng = np.random.default_rng(7919 * seed + 17)
        for s, g in G.items():
            m = masks[s]
            picks = np.flatnonzero(m & (rng.random(len(m)) < p))
            if len(picks):
                rows += run(g, picks, kind, analyst=False)
    t = pd.DataFrame(rows)
    _rcache[key] = t
    return t


def strong_trend():
    t = R.t[R.t.how != "open"].copy()
    t["net"] = t.trade - COST
    return {"2019_23": tstats(t[t.date < IS_END].net), "2024_26": tstats(t[t.date >= IS_END].net)}


def example(G, r):
    g = G[r.symbol]
    d = lambda x: str(pd.Timestamp(g.date.iat[int(x)]).date())
    e = {"symbol": r.symbol, "name": NAMES.get(r.symbol, r.symbol), "signal_date": d(r.i), "close_on_signal": round(g.close.iat[r.i], 2),
         "prior_50_session_high": round(g.hi50.iat[r.i], 2), "rule_entry_date": d(r.j), "rule_entry_price": round(r.entry, 2),
         "safety_stop": round(r.stop, 2), "rule_exit_date": d(r.k), "rule_exit_how": r.how,
         "rule_result_after_costs_pct": round(100 * r.net, 2)}
    if r.bo60:
        e.update({"breakout_date": d(r.b), "analyst_entry_date": d(r.b + 1), "analyst_entry_price": round(r.a_entry, 2),
                  "head_start_pct": round(100 * r["hs"], 1), "head_start_sessions": int(r.sess),
                  "analyst_stop": round(r.a_stop, 2), "analyst_exit_how": r.a_how,
                  "analyst_result_after_costs_pct": None if pd.isna(r.a_net) else round(100 * r.a_net, 2)})
    else:
        e["breakout_within_60_sessions"] = False
    return e


def main():
    G = frames()
    print("frames", len(G), flush=True)
    res, sigs = {}, {}
    for name, (ctx, x, tt, vcp, dry, kind) in V.items():
        rows = []
        for s, g in G.items():
            m = setup(g, ctx, x, tt, vcp, dry)
            first = m & ~np.r_[False, m[:-1]] & g.pit.to_numpy()
            rows += run(g, np.flatnonzero(first), kind)
        t = pd.DataFrame(rows)
        sigs[name] = t
        rc, rn = random_pool(G, ctx, kind), random_pool(G, ctx, kind, x)
        res[name] = {"spec": {"context": ctx, "under_pct": 100 * x, "tight_pct": None if tt is None else 100 * tt,
                              "vcp": vcp, "dry": dry, "stop": kind},
                     "rule": periods(t), "random_context": periods(rc, SEEDS, analyst=False),
                     "random_near_high_info": periods(rn, SEEDS, analyst=False)}
        a, b = res[name]["rule"]["2019_23"], res[name]["random_context"]["2019_23"]
        print(f"{name} {ctx:4s} sig {a['signals']:5d} tr {a['rule'].get('trades',0):5d} bo20 {a['bo20_pct']} (rnd {b['bo20_pct']}) "
              f"head {a['head_pct_median']} mean {a['rule'].get('mean_pct')} (rnd {b['rule'].get('mean_pct')}) "
              f"analyst {a['analyst'].get('mean_pct')}", flush=True)

    # choice on 2019-23 (pre-registered)
    ok = []
    for name, r in res.items():
        a, b = r["rule"]["2019_23"], r["random_context"]["2019_23"]
        if a["rule"].get("trades", 0) >= 150 and a["bo20_pct"] is not None and a["bo20_pct"] >= b["bo20_pct"] + 10:
            ok.append(name)
    key = lambda n: (res[n]["rule"]["2019_23"]["rule"]["mean_pct"], res[n]["rule"]["2019_23"]["rule"]["trades"])
    chosen = max(ok, key=key) if ok else None
    best_failed = None if ok else max(res, key=key)
    pick = chosen or best_failed

    def verdict(per):
        a, b = res[pick]["rule"][per], res[pick]["random_context"][per]
        c = {"a_breakout20_beats_random_by_10": a["bo20_pct"] >= b["bo20_pct"] + 10,
             "b_head_start_positive": (a["head_pct_median"] or 0) > 0,
             "c_beats_analyst_mean_and_total": a["rule"]["mean_pct"] > a["analyst"]["mean_pct"]
             and a["rule"]["total_pts"] > a["analyst"]["total_pts"],
             "d_beats_random_mean": a["rule"]["mean_pct"] > b["rule"]["mean_pct"]}
        c = {k: bool(v) for k, v in c.items()}
        c["all"] = all(c.values())
        return c

    ver = {p: verdict(p) for p in ("2019_23", "2024_26")}
    earned = bool(chosen) and ver["2019_23"]["all"] and ver["2024_26"]["all"]

    t = sigs[pick].dropna(subset=["net"])
    won = t[(t.net > 0) & t.bo60 & t["hs"].notna()].copy()
    med = won["hs"].median()
    won["dist"] = (won["hs"] - med).abs()
    ex1 = won.sort_values(["dist", "date"], ascending=[True, False]).iloc[0]
    fail = t[(t.how == "stop") & ~t.bo60 & t.full60].sort_values("date")
    examples = [{"why": f"made money and broke out; head start closest to the median of that group ({100*med:.1f} %)",
                 **example(G, ex1)}]
    if len(fail):
        examples.append({"why": "most recent trade that hit its stop with no breakout within 60 sessions", **example(G, fail.iloc[-1])})

    out = {"design": {"tested_on": "past prices", "cost_round_trip": COST, "hold_sessions": HOLD, "base_sessions": BASE_N,
                      "no_breakout_lookback": NO_BO, "random_per_seed": RAND_N, "random_seeds": SEEDS,
                      "split": "signal date < / >= 2024-01-01", "prices": "Yahoo split- and dividend-adjusted",
                      "breakout": "close above the highest high of the prior 50 sessions; analyst buys the next open"},
           "variants": res, "chosen": chosen, "qualified_on_2019_23": ok, "best_of_failed_set": best_failed,
           "verdict_checks": ver, "claim_earned": earned, "strong_trend_record": strong_trend(), "examples": examples}
    json.dump(out, open(B.D / "pre_breakout.json", "w"), indent=1, default=lambda o: o.item() if hasattr(o, "item") else str(o))

    print(f"\n{'var':4s} {'per':8s} {'tr':>5s} {'bo20':>5s} {'rnd':>5s} {'near':>5s} {'bo60':>5s} {'rnd':>5s} {'head%':>6s} {'sess':>5s} "
          f"{'mm%':>5s} {'mean':>6s} {'rndM':>6s} {'total':>7s} | {'aTr':>4s} {'aMM%':>5s} {'aMed':>6s} {'aMean':>6s} {'aTot':>7s} | noBO% pairR pairA")
    g = lambda d, k: "-" if d.get(k) is None else d[k]
    for name, r in res.items():
        for per in ("2019_23", "2024_26"):
            a, b, nh = r["rule"][per], r["random_context"][per], r["random_near_high_info"][per]
            an, pr = a.get("analyst", {}), a.get("paired", {})
            print(f"{name:4s} {per:8s} {g(a['rule'],'trades'):>5} {g(a,'bo20_pct'):>5} {g(b,'bo20_pct'):>5} {g(nh,'bo20_pct'):>5} "
                  f"{g(a,'bo60_pct'):>5} {g(b,'bo60_pct'):>5} {g(a,'head_pct_median'):>6} {g(a,'head_sessions_median'):>5} "
                  f"{g(a['rule'],'made_money_pct'):>5} {g(a['rule'],'mean_pct'):>6} {g(b['rule'],'mean_pct'):>6} {g(a['rule'],'total_pts'):>7} | "
                  f"{g(an,'trades'):>4} {g(an,'made_money_pct'):>5} {g(an,'median_pct'):>6} {g(an,'mean_pct'):>6} {g(an,'total_pts'):>7} | "
                  f"{g(a,'no_breakout_60_pct')} {g(pr,'rule_mean_pct')} {g(pr,'analyst_mean_pct')}")
    print("\nrandom context means/mm:", {k: {p: (v[p]['rule'].get('made_money_pct'), v[p]['rule'].get('median_pct'))
                                           for p in v} for k, v in {n: r['random_context'] for n, r in res.items()}.items()})
    print("strong trend record:", json.dumps(out["strong_trend_record"]))
    print("qualified:", ok, "chosen:", chosen, "best_failed:", best_failed)
    print("verdict:", json.dumps(ver), "earned:", earned)
    print("examples:", json.dumps(examples, indent=1, default=str))


if __name__ == "__main__":
    main()
