"""SuperTrend breakout: the tested record of the exact live rule (migration 62, ADR-061), and the signals the SQL must
write on the live-candle copy.

The rule is the owner's AmiBroker formula ("200DMA LR SuperTrend NEXT OPEN ENTRY & EXIT"), ported line by line in
ab_check.py (st_dir_afl, trades_afl): the 25-day regression slope of the 195-day average above 0; SuperTrend (ATR 10,
x3) turns green = setup; a close at or above the setup day's high + 0.05 before SuperTrend turns red = confirmation;
buy at the next open; sell at the next open after the first red SuperTrend day. No stop, no target. It did not pass the
house check (supertrend_lr.py, supertrend_v2.py, st_stock_level.py); the owner chose to add it (18 Nov 2026), and its
record is shown as it is.

    python record_supertrend.py           -> data/supertrend_record.json (each year's 300 most traded, Jul 2019 ..,
                                             0.5 % cost, closed trades; a random day on the same side with the same exit)
    python record_supertrend.py --live    -> data/expected_supertrend_signals.csv from data/live_rows.json (the live
                                             candles, as pglite_supertrend.mjs loads them)
"""
import json
import sys

import numpy as np
import pandas as pd

import ab_check as AB
import backtest as B
import fair as FA
import supertrend_lr as ST

COST = 0.005
RECENT = pd.Timestamp("2024-01-01")


def stats(r):
    r = np.asarray(r)
    if not len(r):
        return {"trades": 0}
    w, l = r[r > 0], r[r <= 0]
    return {"trades": int(len(r)), "made_money_pct": round(float((r > 0).mean()) * 100, 1),
            "avg_pct": round(float(r.mean()) * 100, 2), "median_pct": round(float(np.median(r)) * 100, 2),
            "avg_win_pct": round(float(w.mean()) * 100, 1) if len(w) else None,
            "avg_loss_pct": round(float(l.mean()) * 100, 1) if len(l) else None}


def record():
    raw = pd.read_parquet(B.D / "candles_long.parquet").dropna(subset=["open", "high", "low", "close"])
    raw = raw[(raw.close > 0) & (raw.open > 0) & ~raw.symbol.str.startswith("^")]
    frames = {s: ST.frame(f.copy()) for s, f in raw.groupby("symbol") if s in FA.ALL and len(f) > 300}
    rows, held, opened = [], [], 0
    dirs = {}
    for s, f in frames.items():
        d = AB.st_dir_afl(f.high.to_numpy(), f.low.to_numpy(), f.close.to_numpy())
        dirs[s] = d
        for i, j, k in AB.trades_afl(f, d):
            if f.date.iat[i] < B.START or not f.pit.iat[i]:
                continue
            if k is None:
                opened += 1
                continue
            rows.append((f.date.iat[i], f.open.iat[k] / f.open.iat[j] - 1 - COST))
            held.append(k - j + 1)
    t = pd.DataFrame(rows, columns=["date", "r"])

    # yardstick: a random day with SuperTrend green and the slope above 0 (research set), the same exit, 5 seeds
    rnd_all, rnd_recent = [], []
    for seed in range(5):
        rng = np.random.default_rng(seed)
        elig = {s: ((f.slope > 0).to_numpy() & (dirs[s] == 1) & f.pit.to_numpy()) for s, f in frames.items()}
        p = (len(t) + opened) / max(1, sum(int(v.sum()) for v in elig.values()))
        a, b = [], []
        for s, f in frames.items():
            d, o, busy = dirs[s], f.open.to_numpy(), -1
            for i in np.flatnonzero(elig[s] & (rng.random(len(f)) < p)):
                if i <= busy or i + 1 >= len(f):
                    continue
                k = next((x + 1 for x in range(i + 2, len(f) - 1) if d[x] == -1), None)   # AFL: exit check after the buy day
                if k is None:
                    break
                r = o[k] / o[i + 1] - 1 - COST
                a.append(r)
                if f.date.iat[i] >= RECENT:
                    b.append(r)
                busy = k
        rnd_all.append(stats(a))
        rnd_recent.append(stats(b))

    rep = {
        "period": f"Jul 2019 – {t.date.max():%b %Y}",
        "all": stats(t.r), "recent": stats(t[t.date >= RECENT].r) | {"period": "2024–26"},
        "early": stats(t[t.date < RECENT].r) | {"period": "2019–23"},
        "held_median_sessions": int(np.median(held)), "still_open": opened,
        "random": {"made_money_pct": round(float(np.mean([x["made_money_pct"] for x in rnd_all])), 1),
                   "avg_pct": round(float(np.mean([x["avg_pct"] for x in rnd_all])), 2),
                   "recent_made_money_pct": round(float(np.mean([x["made_money_pct"] for x in rnd_recent])), 1),
                   "recent_avg_pct": round(float(np.mean([x["avg_pct"] for x in rnd_recent])), 2)},
        "yearly": {int(y): stats(g.r) for y, g in t.groupby(t.date.dt.year)},
    }
    (B.D / "supertrend_record.json").write_text(json.dumps(rep, indent=1))
    print(json.dumps({k: v for k, v in rep.items() if k != "yearly"}, indent=1))
    for y, x in rep["yearly"].items():
        print(f"  {y}: {x['trades']:4d} trades, made money {x['made_money_pct']}%, avg {x['avg_pct']:+.2f}%")


def expect_live():
    d = json.loads((B.D / "live_rows.json").read_text())
    names = {s["symbol"] for s in d["symbols"] if s.get("segment") == "equity" and (s.get("mcap_rank") or 9999) <= 500}
    c = pd.DataFrame(d["candles"])
    c = c[c.symbol.isin(names)]
    c["day"] = pd.to_datetime(c.ts, utc=True).dt.tz_convert("Asia/Kolkata").dt.date
    # The live SQL reads private.trusted_candles (the price guard, migration 57): use the same repaired candles, as
    # pglite_supertrend.mjs reports them (data/sql_supertrend_guarded.json; t_* null = the day is left out).
    gp = B.D / "sql_supertrend_guarded.json"
    if gp.exists():
        drop = []
        for x in json.loads(gp.read_text()):
            m = (c.symbol == x["symbol"]) & (c.day.astype(str) == x["day"])
            if x["t_close"] is None:
                drop += list(c.index[m])
                continue
            for col in ("open", "high", "low", "close"):
                c.loc[m, col] = float(x["t_" + col])
        c = c.drop(index=drop)
    out = []
    for s, f in c.sort_values(["symbol", "ts"]).groupby("symbol"):
        f = f.reset_index(drop=True)
        f["slope"] = ST.lr_slope(f.close.rolling(ST.MA, min_periods=ST.MA).mean(), ST.LR)
        dr = AB.st_dir_afl(f.high.to_numpy(float), f.low.to_numpy(float), f.close.to_numpy(float))
        for i, j, k in AB.trades_afl(f, dr, pending=True):
            out.append((s, "buy", f.day.iat[i], ""))
            if k is not None:
                out.append((s, "exit", f.day.iat[k], "ST_RED"))
    e = pd.DataFrame(out, columns=["symbol", "signal_type", "day", "result"])
    e.to_csv(B.D / "expected_supertrend_signals.csv", index=False)
    print("expected supertrend:", (e.signal_type == "buy").sum(), "buys,", (e.signal_type == "exit").sum(), "exits")


if __name__ == "__main__":
    expect_live() if "--live" in sys.argv else record()
