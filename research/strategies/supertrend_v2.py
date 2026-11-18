"""Round 2 of the owner's SuperTrend + 195-day regression rule (17 Nov 2026).

Round 1 (supertrend_lr.py) failed: the entry did no better than a random uptrend day with the same exit, there was no
stop (worst trade -63 %), and 2024-26 made 4.5 % a year in 10 slots against 15.5 % for the live trend rules.
Everything below was written down BEFORE the first run of this file. Four changed versions, nothing else:

  V1 stop     the owner's rule + the house safety stop from the first day: signal close - 4 x ATR14 (simple 14-day
              ATR, as record.py). A day whose low reaches it sells at the stop, or at the open if it opened below.
              Exit otherwise unchanged (next open after the first red SuperTrend day).
  V2 plan     the owner's entry with the live trend rules' plan: the same safety stop, or the 60th session's close.
  V3 ma200    the owner's entry with the Stay-in exit: the same safety stop, or the first close below the 200-day
              average (sold at that close). No time limit.
  V4 leader   V1 plus an entry filter: the stock's 6-month return is in the top 30 % of the research set that day
              (rs_rank >= 0.7, as SMA 20/50 trend).
Entry, research set, costs (0.5 %), portfolio (10 equal slots, strongest 6-month return first) and periods are as in
round 1. Each version's yardstick: random days on the same side of its filters (slope > 0, SuperTrend green, and for
V4 rs_rank >= 0.7), as many as its signals, through the SAME exit, 5 seeds.

Decision (written before the run):
  1. Choose on 2019-07..2023-12: among versions whose mean trade beats their random yardstick and whose 10-slot worst
     fall is no more than 5 points deeper than the live trend rules' plan (-27.94 % -> -32.94 %), the highest 10-slot
     CAGR. None qualifying = fail.
  2. The chosen version PASSES only if in 2024-01..2026-10: mean trade > 0 and above its random yardstick; 10-slot
     CAGR at least its random yardstick's, the Nifty 50's and the live trend rules' plan (15.54 %); worst fall no more
     than 5 points deeper than the plan's (-22.41 % -> -27.41 %).
  A pass means it could be proposed as a new rule (with the owner's go-ahead); a fail means it stays research.
  Nothing is tuned after this run.

    python supertrend_v2.py   -> data/supertrend_v2.json
"""
import json

import numpy as np
import pandas as pd

import backtest as B
import fair as FA
import supertrend_lr as ST

COST = ST.COST
VERSIONS = ["V1_stop", "V2_plan", "V3_ma200", "V4_leader"]
EXIT = {"V1_stop": "st", "V2_plan": "plan", "V3_ma200": "ma200", "V4_leader": "st"}


def prep(f):
    h, l, c = f.high, f.low, f.close
    tr = pd.concat([h - l, (h - c.shift()).abs(), (l - c.shift()).abs()], axis=1).max(axis=1)
    f["atr14"] = tr.rolling(14, min_periods=14).mean()
    f["sma200"] = c.rolling(200, min_periods=200).mean()
    return f


def exit_v(f, i, j, kind):
    """(exit index k, exit price). Safety stop from the entry day, then the version's exit."""
    o, lo, c, d = f.open.to_numpy(), f.low.to_numpy(), f.close.to_numpy(), f["dir"].to_numpy()
    a = f.atr14.iat[i]
    stop = c[i] - 4 * a if not np.isnan(a) else -np.inf
    sma = f.sma200.to_numpy()
    n = len(f)
    end = min(j + 60, n) if kind == "plan" else n
    for k in range(j, end):
        if lo[k] <= stop:
            return k, min(o[k], stop)
        if kind == "st" and d[k] == -1 and k + 1 < n:
            return k + 1, o[k + 1]
        if kind == "ma200" and not np.isnan(sma[k]) and c[k] < sma[k]:
            return k, c[k]
    k = end - 1
    return k, c[k]


def trades(f, kind, leader):
    d, slope, h, c = f["dir"].to_numpy(), f.slope.to_numpy(), f.high.to_numpy(), f.close.to_numpy()
    rs = f.rs_rank.to_numpy()
    n, out, i = len(f), [], 1
    while i < n:
        if d[i - 1] == -1 and d[i] == 1 and slope[i] > 0:
            trig, conf = h[i] + ST.TICK, None
            for k in range(i + 1, n):
                if d[k] != 1:
                    break
                if c[k] > trig:
                    conf = k
                    break
            if conf is None or conf + 1 >= n or (leader and not rs[conf] >= 0.7):
                i += 1
                continue
            j = conf + 1
            k, px = exit_v(f, conf, j, kind)
            out.append((conf, j, k, px))
            i = k if k > i else i + 1
            continue
        i += 1
    return out


def main():
    raw = pd.read_parquet(B.D / "candles_long.parquet").dropna(subset=["open", "high", "low", "close"])
    raw = raw[(raw.close > 0) & (raw.open > 0) & ~raw.symbol.str.startswith("^")]
    frames = {s: prep(ST.frame(f.copy())) for s, f in raw.groupby("symbol") if s in FA.ALL and len(f) > 300}
    panel = pd.concat({s: f.set_index("date").ret126 for s, f in frames.items()}, axis=1)
    pit = pd.concat({s: f.set_index("date").pit for s, f in frames.items()}, axis=1).fillna(False).astype(bool)
    rank = panel.where(pit).rank(axis=1, pct=True)                     # within the research set that day
    for s, f in frames.items():
        f["rs_rank"] = f.date.map(rank[s]).to_numpy()
    closes = {s: f.set_index("date").close for s, f in frames.items()}
    print("stocks", len(frames), flush=True)

    def key(s, i):
        r = frames[s].ret126.iat[i]
        return -(r if not np.isnan(r) else -9)

    def per_trade(rows, lo, hi):
        out = []
        for s, i, j, k, px in rows:
            f = frames[s]
            if not (lo <= f.date.iat[i] < hi) or (k == len(f) - 1 and px == f.close.iat[-1]):
                continue
            out.append((px / f.open.iat[j] - 1 - COST, k - j + 1))
        return out

    ref = json.loads((B.D / "stay_in.json").read_text())["portfolio"]
    out = {"versions": {}, "trend_rules_plan_10slots": {p: ref[p]["plan"] for p in ST.PERIODS}}
    for v in VERSIONS:
        kind, leader = EXIT[v], v == "V4_leader"
        rule = [(s, i, j, k, px) for s, f in frames.items() for i, j, k, px in trades(f, kind, leader) if f.pit.iat[i]]
        elig = {}
        for s, f in frames.items():
            m = (f.slope > 0) & (f["dir"] == 1)
            if leader:
                m &= f.rs_rank >= 0.7
            elig[s] = m.to_numpy() & f.pit.to_numpy()
        p_ = len(rule) / max(1, sum(int(x.sum()) for x in elig.values()))
        rnd = []
        for seed in range(5):
            rng = np.random.default_rng(seed)
            rows = []
            for s, f in frames.items():
                busy = -1
                for i in np.flatnonzero(elig[s] & (rng.random(len(f)) < p_)):
                    if i <= busy or i + 1 >= len(f):
                        continue
                    k, px = exit_v(f, i, i + 1, kind)
                    rows.append((s, i, i + 1, k, px))
                    busy = k
            rnd.append(rows)
        res = {"signals": len(rule)}
        for p, (lo, hi) in ST.PERIODS.items():
            sig = [(s, j, k, px, key(s, i)) for s, i, j, k, px in rule]
            rp = [ST.simulate([(s, j, k, px, key(s, i)) for s, i, j, k, px in r], frames, closes, lo, hi, 10, 0.10)["cagr"]
                  for r in rnd]
            res[p] = {
                "trades": ST.stats(per_trade(rule, lo, hi)),
                "random_trades_mean": round(float(np.mean([ST.stats(per_trade(r, lo, hi))["mean"] for r in rnd])), 2),
                "slots_10": ST.simulate(sig, frames, closes, lo, hi, 10, 0.10),
                "owner_6x12": ST.simulate(sig, frames, closes, lo, hi, 6, 0.12),
                "random_slots_10_cagr": round(float(np.mean(rp)), 2),
                "random_slots_10_range": [round(min(rp), 1), round(max(rp), 1)],
                "nifty50": ST.nifty(lo, hi),
            }
        out["versions"][v] = res
        print(v, json.dumps(res), flush=True)

    is_ = {v: out["versions"][v]["2019-23"] for v in VERSIONS}
    ok = [v for v in VERSIONS if is_[v]["trades"]["mean"] > is_[v]["random_trades_mean"]
          and is_[v]["slots_10"]["worst_fall"] >= ref["2019-23"]["plan"]["worst_fall"] - 5]
    chosen = max(ok, key=lambda v: is_[v]["slots_10"]["cagr"]) if ok else None
    passed = False
    if chosen:
        o = out["versions"][chosen]["2024-26"]
        passed = (o["trades"]["mean"] > 0 and o["trades"]["mean"] > o["random_trades_mean"]
                  and o["slots_10"]["cagr"] >= max(o["random_slots_10_cagr"], o["nifty50"]["cagr"], ref["2024-26"]["plan"]["cagr"])
                  and o["slots_10"]["worst_fall"] >= ref["2024-26"]["plan"]["worst_fall"] - 5)
    out["decision"] = {"qualified_2019_23": ok, "chosen": chosen, "passed": bool(passed)}
    print("decision", out["decision"])
    (B.D / "supertrend_v2.json").write_text(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
