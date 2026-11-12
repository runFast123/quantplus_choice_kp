"""Do our rules get in before the breakout, and at a lower price? (the owner's USP claim, 12 Nov 2026)

Claim tested: "A normal analyst waits for a breakout and buys it, say at Rs 400. Our rules signal the stock earlier, at
Rs 200, before the breakout." Tested on past prices only. Everything below was written down BEFORE the first run.

Rules (the six live rules, taken from their own record scripts, not re-implemented):
  strong_trend  record.py (the trades table it builds, R.t)          plan: next open, stop close - 4 x ATR14, 60 sessions
  sma_trend     record_sma.sma_trend_trades                          same plan
  ma200_trend   improve_lr.trades(record_lr.ma200_signal, "plan")    same plan
  secular_trend record_secular.trades (Special K from prices since 2010)  same plan
  rsi_dip       record_dip.trades(frame, "rsi_dip")   limit fill next session, stop fill - 5 x ATR14 (EWM), out <= 10 sessions
  kk_dip        record_dip.trades(frame, "kk_dip")    same plan
  Rule entry = the record's own entry (next open for the trend rules, the limit fill for the dip rules); one trade per
  stock at a time, as in each record. Research set as in the records: each year's 300 most traded stocks, signals
  2019-07..2026-10, 0.5 % round-trip cost on trade results.

Breakout yardstick (the "normal analyst"):
  breakout day  a CLOSE above the highest HIGH of the N sessions before it; the analyst buys at the next open.
  N             50 is the main yardstick (a base breakout); 20 and 250 (the 52-week high) are reported too.
                The prior-N highs are computed on the long price file (from 2010) so 2019 signals have a full lookback.
  For each rule signal (day i, rule entry day j): the first breakout day b with i < b <= i + 250.
    followed        a breakout was found (measured only on signals with the full 250-session window after them;
                    signals too recent for that are counted but left out of the shares; also "within 60 sessions")
    head start      price: (analyst's entry = open of b+1) / (rule entry price) - 1, in %;  sessions: (b+1) - j
                    median and quartiles; plus the share where the analyst paid MORE than the rule (head start > 0)
    stopped first   the rule's own safety-stop level was touched (low <= stop) on any session from j to b: the cost of
                    being early (a rule follower would have been stopped out before the breakout came)
    still held      the rule's own plan still held the stock on the analyst's entry day (exit day >= b+1): whether the
                    rule's trade actually captured the head start (the trend plans last 60 sessions, the dips <= 10)
    already broken  a breakout happened on the signal day or in the 20 sessions before it (the analyst was already in
                    or could have been: the rule was not early for these)
    trade result    the rule's own trade after costs (closed trades only), for signals with and without a later breakout
Random-day yardstick (a random day is also "before" the next breakout, so the claim only holds if the rule beats it):
  days drawn from the same stocks and years (point-in-time top 300, 2019-07..), on the same side of the rule's
  precondition, about as many as the rule's signals per seed, 5 seeds pooled; put through the rule's own plan:
    strong_trend   market 'sunny' and close above its 50-day average, a year of history  (the rule's filters minus the trigger)
    sma_trend      a leader: 6-month return in the top 30 % (rs_rank >= 0.7)
    ma200_trend    close above the 200-day average, regression measures known (as record_lr's random day)
    secular_trend  Special K below -150, signal line known (as breakout_secular's random day)
    rsi_dip/kk_dip close above the 200-day average; the random day goes through the dip rule's own limit-order fill
                   (record_dip.trades with the trigger replaced by the random pick), so only filled days count
  Plan for the trend-rule random days: breakout_secular.plan(window None) = the records' plan.
Split by signal date: 2019-07..2023-12 and 2024-01..2026-10 (the 250-session window means 2024-26 in practice covers
signals up to about Oct 2025). Nothing is tuned here, so both periods are reported as they are.
Examples for the website (mechanical): N = 50, all years; the 3 rules with the largest median head start; in each, the
followed signal whose head start is closest to that rule's median (ties: the most recent). One honest failure: in the
rule with the largest median head start, the most recent signal whose stop was touched and that had no breakout within
250 sessions. Prices are Yahoo's split- and dividend-adjusted prices, so rupee levels can differ from the prices quoted
on the day.

    python early_entry.py   -> data/early_entry.json
"""
import json

import numpy as np
import pandas as pd

import backtest as B
import breakout_secular as BS
import improve_lr as L
import record as R
import record_dip as RD
import record_lr as RL
import record_secular as RSec
import record_sma as RS
import signals as S
import specialk as K

COST = 0.005
NS = (20, 50, 250)
MAIN = 50
WIN = 250
PRIOR = 20
SEEDS = 5
IS_END = pd.Timestamp("2024-01-01")
F = S.F
RULES = ["strong_trend", "sma_trend", "ma200_trend", "secular_trend", "rsi_dip", "kk_dip"]
PIT = {s: np.array([s in S.pit.get(y, ()) for y in f.date.dt.year]) & (f.date >= B.START).to_numpy() for s, f in F.ALL.items()}
NAMES = dict(pd.read_csv(B.D / "universe.csv").drop_duplicates("symbol")[["symbol", "name"]].values)


# ------------------------------------------------------------------ breakout flags (from the long price file)
def breakout_flags():
    long = pd.read_parquet(B.D / "candles_long.parquet").dropna(subset=["open", "high", "low", "close"])
    long = long[(long.close > 0) & (long.open > 0)]
    long["date"] = pd.to_datetime(long.date).dt.tz_localize(None)
    out = {}
    lg = {s: g.sort_values("date") for s, g in long.groupby("symbol")}
    for s, f in F.ALL.items():
        dates = pd.to_datetime(f.date).dt.tz_localize(None) if f.date.dt.tz is not None else pd.to_datetime(f.date)
        flags = {}
        for n in NS:
            g = lg.get(s)
            if g is not None and len(g) > n:
                bo = pd.Series((g.close > g.high.rolling(n, min_periods=n).max().shift(1)).to_numpy(), index=g.date.to_numpy())
                bo = bo[~bo.index.duplicated()].reindex(dates.to_numpy())
            else:
                bo = pd.Series(np.nan, index=dates.to_numpy())
            own = (f.close > f.high.rolling(n, min_periods=n).max().shift(1)).to_numpy()   # fallback where long is missing
            v = bo.to_numpy(dtype=object)
            miss = pd.isna(v)
            v = np.where(miss, own, v).astype(bool)
            flags[n] = v
        out[s] = flags
    return out


def next_true(flag):
    """nxt[i] = the first index b > i with flag[b], else len."""
    n = len(flag)
    pos = np.where(flag, np.arange(n), n)
    nxt = np.minimum.accumulate(pos[::-1])[::-1]          # first True at or after i
    return np.r_[nxt[1:], n]                               # strictly after i


# ------------------------------------------------------------------ rule signals from the records
def in_set(s, d):
    return d >= B.START and s in S.pit.get(d.year, ())


def sig_row(s, i, j, entry, stop, net, k):
    return {"symbol": s, "i": int(i), "j": int(j), "entry": float(entry), "stop": float(stop),
            "net": float(net) if net is not None and not pd.isna(net) else np.nan, "k": None if k is None else int(k)}


def rules():
    out = {r: [] for r in RULES}
    pos = {s: pd.Series(np.arange(len(f)), index=f.date.to_numpy()) for s, f in F.ALL.items()}
    atr_s = {s: R.atr_simple(f).to_numpy() for s, f in F.ALL.items()}

    for r in R.t.itertuples():                                     # record.py's exact Strong trend trades
        f = F.ALL[r.symbol]
        i = int(pos[r.symbol][r.date])
        j = i + 1
        k = j + int(r.days) - 1
        net = r.trade - COST if r.how != "open" else np.nan
        out["strong_trend"].append(sig_row(r.symbol, i, j, f.open.iat[j], f.close.iat[i] - 4 * atr_s[r.symbol][i], net,
                                           None if r.how == "open" else k))

    for s, f in F.ALL.items():
        g = f.reset_index(drop=True)
        for d, net, how, days in RS.sma_trend_trades(g):
            if not in_set(s, d):
                continue
            i = int(pos[s][d]); j = i + 1
            out["sma_trend"].append(sig_row(s, i, j, g.open.iat[j], g.close.iat[i] - 4 * atr_s[s][i],
                                            None if how == "OPEN" else net, None if how == "OPEN" else j + days - 1))

    for s, f in L.FR.items():
        for i, d, net, how, days in L.trades(f, RL.ma200_signal(f), "plan"):
            if not in_set(s, d):
                continue
            j = i + 1
            out["ma200_trend"].append(sig_row(s, i, j, f.open.iat[j], f.close.iat[i] - 4 * f.atr.iat[i],
                                              None if how == "OPEN" else net, None if how == "OPEN" else j + days - 1))

    for s, f in F.ALL.items():
        g = f.reset_index(drop=True)
        for i, j, k, stop, px, how in RSec.trades(g, g.sk, g.sk_sig):
            if j is None or not in_set(s, g.date.iat[i]):
                continue
            net = px / g.open.iat[j] - 1 - COST if px is not None else None
            out["secular_trend"].append(sig_row(s, i, j, g.open.iat[j], stop, net, k))

    for s, f in F.ALL.items():
        fr = RD.frame(f[["date", "open", "high", "low", "close", "volume"]].copy())
        for rule in ("rsi_dip", "kk_dip"):
            tr, _ = RD.trades(fr, rule)
            for sd, ed, xd, e, px, how in tr:
                if not in_set(s, sd):
                    continue
                i, j = int(pos[s][sd]), int(pos[s][ed])
                k = int(pos[s][xd]) if xd is not None else None
                net = px / e - 1 - COST if px is not None else None
                out[rule].append(sig_row(s, i, j, e, e - 5 * fr.atr.iat[i], net, k))
    return {r: pd.DataFrame(v) for r, v in out.items()}


# ------------------------------------------------------------------ random days through the rule's own plan
def eligible(rule, s, f):
    """Boolean mask of days a random pick may land on (precondition side + research set)."""
    pit = PIT[s]
    if rule == "strong_trend":
        m = (f.wx == "sunny") & (f.close > f.sma50) & f.close.rolling(252, min_periods=252).max().shift(1).notna()
    elif rule == "sma_trend":
        m = (f.rs_rank >= 0.7) & f.sma50.notna()
    elif rule == "ma200_trend":
        g = L.FR[s]
        m = (g.close > g.sma200) & g.slope100.notna() & g.r_px.notna()
    elif rule == "secular_trend":
        m = (f.sk < RSec.LEVEL) & f.sk_sig.notna()
    else:
        m = f.close > f.close.rolling(200, min_periods=200).mean()
    return m.fillna(False).to_numpy() & pit


def random_signals(rule, n_target, seed, elig, frs):
    tot = sum(int(v.sum()) for v in elig.values())
    p = n_target / max(1, tot)
    rng = np.random.default_rng(1000 * seed + RULES.index(rule))
    rows = []
    for s, f in F.ALL.items():
        e = elig[s]
        picks = np.flatnonzero(e & (rng.random(len(e)) < p))
        if len(picks) == 0:
            continue
        g = f.reset_index(drop=True)
        if rule in ("rsi_dip", "kk_dip"):
            fr = frs[s].copy()
            z = np.full(len(fr), 50.0)
            z[picks] = 0.0
            fr["rsi2"] = z                                     # trigger replaced by the random pick; same limit fill
            pos = pd.Series(np.arange(len(fr)), index=fr.date.to_numpy())
            tr, _ = RD.trades(fr, "rsi_dip")
            for sd, ed, xd, e_, px, how in tr:
                i, j = int(pos[sd]), int(pos[ed])
                rows.append(sig_row(s, i, j, e_, e_ - 5 * fr.atr.iat[i], None if px is None else px / e_ - 1 - COST,
                                    None if xd is None else int(pos[xd])))
        else:
            atr = R.atr_simple(g).to_numpy()
            for i, j, k, px, how in BS.plan(g, picks, atr, None):
                rows.append(sig_row(s, i, j, g.open.iat[j], RSec.stop_of(g.close.iat[i], atr[i]),
                                    px / g.open.iat[j] - 1 - COST, k))
    return pd.DataFrame(rows)


# ------------------------------------------------------------------ measures per signal
def measure(t, flags):
    """Adds, per N: b (breakout day or -1), full window, head %, sessions, stopped first, still held, already broken."""
    if t.empty:
        return t
    t = t.copy()
    t["date"] = [F.ALL[s].date.iat[i] for s, i in zip(t.symbol, t.i)]
    nxt_cache = {}
    cols = {f"{c}{n}": [] for n in NS for c in ("bo", "head", "sess", "stop1st", "held", "prior", "full", "bo60", "full60")}
    for r in t.itertuples():
        f = F.ALL[r.symbol]
        o, lo = f.open.to_numpy(), f.low.to_numpy()
        nlen = len(f)
        for n in NS:
            key = (r.symbol, n)
            if key not in nxt_cache:
                nxt_cache[key] = next_true(flags[r.symbol][n])
            fl = flags[r.symbol][n]
            b = int(nxt_cache[key][r.i])
            full = r.i + WIN + 1 <= nlen - 1
            full60 = r.i + 60 + 1 <= nlen - 1
            found = b <= r.i + WIN and b + 1 < nlen
            cols[f"full{n}"].append(full)
            cols[f"full60{n}"].append(full60)
            cols[f"bo{n}"].append(found)
            cols[f"bo60{n}"].append(found and b <= r.i + 60)
            cols[f"prior{n}"].append(bool(fl[max(0, r.i - PRIOR):r.i + 1].any()))
            if found:
                cols[f"head{n}"].append(o[b + 1] / r.entry - 1)
                cols[f"sess{n}"].append(b + 1 - r.j)
                cols[f"stop1st{n}"].append(bool((lo[r.j:b + 1] <= r.stop).any()) if b >= r.j else False)
                cols[f"held{n}"].append(bool(pd.isna(r.k) or r.k >= b + 1))   # open trade = still held
            else:
                cols[f"head{n}"].append(np.nan)
                cols[f"sess{n}"].append(np.nan)
                end = min(r.i + WIN, nlen - 1)
                cols[f"stop1st{n}"].append(bool((lo[r.j:end + 1] <= r.stop).any()))
                cols[f"held{n}"].append(False)
    for c, v in cols.items():
        t[c] = v
    return t


def q(x, p):
    return None if len(x) == 0 else round(float(np.percentile(x, p)), 2)


def summarise(t, n, seeds=1):
    if t.empty:
        return {"signals": 0}
    w = t[t[f"full{n}"]]
    fo = w[w[f"bo{n}"]]
    nf = w[~w[f"bo{n}"]]
    w60 = t[t[f"full60{n}"]]
    hp = 100 * fo[f"head{n}"].to_numpy()
    hs = fo[f"sess{n}"].to_numpy()

    def tr(x):
        x = x.net.dropna()
        return {"trades": int(round(len(x) / seeds)), "made_money_pct": None if x.empty else round(100 * (x > 0).mean(), 1),
                "avg_pct": None if x.empty else round(100 * x.mean(), 2), "median_pct": None if x.empty else round(100 * x.median(), 2)}

    pct = lambda m: None if len(m) == 0 else round(100 * float(np.mean(m)), 1)
    return {
        "signals": int(round(len(t) / seeds)), "full_window": int(round(len(w) / seeds)),
        "followed_pct": pct(w[f"bo{n}"]), "followed_60_pct": pct(w60[f"bo60{n}"]),
        "already_broken_pct": pct(t[f"prior{n}"]),
        "head_pct_median": q(hp, 50), "head_pct_q25": q(hp, 25), "head_pct_q75": q(hp, 75),
        "head_positive_pct": pct(hp > 0),
        "head_sessions_median": q(hs, 50), "head_sessions_q25": q(hs, 25), "head_sessions_q75": q(hs, 75),
        "stopped_before_breakout_pct": pct(fo[f"stop1st{n}"]),
        "still_held_at_breakout_pct": pct(fo[f"held{n}"]),
        "stopped_no_breakout_pct": pct((~w[f"bo{n}"]) & w[f"stop1st{n}"]),
        "trade_followed": tr(fo), "trade_not_followed": tr(nf),
    }


def periods(t, n, seeds=1):
    if t.empty:
        return {}
    return {"all": summarise(t, n, seeds), "2019_23": summarise(t[t.date < IS_END], n, seeds),
            "2024_26": summarise(t[t.date >= IS_END], n, seeds)}


def example(r, n, flags):
    f = F.ALL[r.symbol]
    b = int(r.j + r[f"sess{n}"]) if not pd.isna(r[f"sess{n}"]) else None      # the analyst's entry day (b + 1 in measure)
    d = lambda x: str(pd.Timestamp(f.date.iat[x]).date())
    out = {"symbol": r.symbol, "name": NAMES.get(r.symbol, r.symbol), "signal_date": d(r.i), "rule_entry_date": d(r.j),
           "rule_entry_price": round(r.entry, 2), "safety_stop": round(r.stop, 2),
           "stop_touched_before_breakout": bool(r[f"stop1st{n}"]),
           "rule_trade_after_costs_pct": None if pd.isna(r.net) else round(100 * r.net, 2),
           "rule_trade_exit_date": None if r.k is None or pd.isna(r.k) else d(int(r.k))}
    if b is not None:
        out.update({"breakout_date": d(b - 1), "breakout_entry_date": d(b), "breakout_entry_price": round(float(f.open.iat[b]), 2),
                    "head_start_pct": round(100 * r[f"head{n}"], 1), "head_start_sessions": int(r[f"sess{n}"])})
        assert abs(f.open.iat[b] / r.entry - 1 - r[f"head{n}"]) < 1e-9
    else:
        out.update({"breakout_date": None, "breakout_within_sessions": WIN})
    return out


def main():
    K.attach()
    flags = breakout_flags()
    print("breakout flags ready", flush=True)
    sigs = {r: measure(t, flags) for r, t in rules().items()}
    print({r: len(t) for r, t in sigs.items()}, flush=True)

    frs = {s: RD.frame(f[["date", "open", "high", "low", "close", "volume"]].copy()) for s, f in F.ALL.items()}
    res, rnd_all = {}, {}
    for rule, t in sigs.items():
        elig = {s: eligible(rule, s, f) for s, f in F.ALL.items()}
        rnd = pd.concat([random_signals(rule, len(t), seed, elig, frs) for seed in range(SEEDS)], ignore_index=True)
        rnd = measure(rnd, flags)
        rnd_all[rule] = rnd
        res[rule] = {f"N{n}": {"rule": periods(t, n), "random": periods(rnd, n, SEEDS)} for n in NS}
        a = res[rule][f"N{MAIN}"]
        print(f"{rule:14s} rule {json.dumps(a['rule']['all'])}\n{'':14s} rand {json.dumps(a['random']['all'])}", flush=True)

    # examples (N = 50, all years)
    med = {r: res[r][f"N{MAIN}"]["rule"]["all"]["head_pct_median"] for r in sigs}
    top = sorted([r for r in med if med[r] is not None], key=lambda r: med[r], reverse=True)[:3]
    examples = []
    for r in top:
        t = sigs[r]
        fo = t[t[f"full{MAIN}"] & t[f"bo{MAIN}"]].copy()
        fo["dist"] = (100 * fo[f"head{MAIN}"] - med[r]).abs()
        pick = fo.sort_values(["dist", "date"], ascending=[True, False]).iloc[0]
        examples.append({"rule": r, "why": f"median-head-start signal of {r} (rule median {med[r]}%)", **example(pick, MAIN, flags)})
    t = sigs[top[0]]
    fail = t[t[f"full{MAIN}"] & ~t[f"bo{MAIN}"] & t[f"stop1st{MAIN}"]].sort_values("date")
    failure = None
    if len(fail):
        failure = {"rule": top[0], "why": f"most recent {top[0]} signal whose stop was touched with no {MAIN}-day breakout "
                   f"within {WIN} sessions", **example(fail.iloc[-1], MAIN, flags)}

    out = {"design": {"breakout": "close above the highest high of the prior N sessions; analyst buys the next open",
                      "N": list(NS), "main_N": MAIN, "window_sessions": WIN, "already_broken_lookback": PRIOR,
                      "random_seeds": SEEDS, "cost_round_trip": COST, "split": "signal date < / >= 2024-01-01",
                      "prices": "Yahoo split- and dividend-adjusted", "tested_on": "past prices"},
           "results": res, "examples": examples, "failure": failure}
    json.dump(out, open(B.D / "early_entry.json", "w"), indent=1, default=float)

    print(f"\n{'rule':14s} {'N':>4s} {'per':8s} {'sig':>5s} {'fol%':>5s} {'r':>5s} {'head%':>6s} {'r':>6s} {'sess':>5s} {'r':>5s} "
          f"{'stop%':>5s} {'r':>5s} {'held%':>5s} {'prior%':>6s} {'r':>5s} {'tradeF':>7s} {'tradeN':>7s} {'rF':>6s} {'rN':>6s}")
    for rule in sigs:
        for n in NS:
            for per in ("all", "2019_23", "2024_26"):
                a, b = res[rule][f"N{n}"]["rule"][per], res[rule][f"N{n}"]["random"][per]
                if not a or not a.get("signals"):
                    continue
                g = lambda x, k: "-" if x.get(k) is None else x[k]
                print(f"{rule:14s} {n:4d} {per:8s} {a['signals']:5d} {g(a,'followed_pct'):>5} {g(b,'followed_pct'):>5} "
                      f"{g(a,'head_pct_median'):>6} {g(b,'head_pct_median'):>6} {g(a,'head_sessions_median'):>5} "
                      f"{g(b,'head_sessions_median'):>5} {g(a,'stopped_before_breakout_pct'):>5} {g(b,'stopped_before_breakout_pct'):>5} "
                      f"{g(a,'still_held_at_breakout_pct'):>5} {g(a,'already_broken_pct'):>6} {g(b,'already_broken_pct'):>5} "
                      f"{g(a['trade_followed'],'avg_pct'):>7} {g(a['trade_not_followed'],'avg_pct'):>7} "
                      f"{g(b['trade_followed'],'avg_pct'):>6} {g(b['trade_not_followed'],'avg_pct'):>6}")
    print("\nexamples:", json.dumps(examples, indent=1), "\nfailure:", json.dumps(failure, indent=1))


if __name__ == "__main__":
    main()
