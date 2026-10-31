"""Every signal of the four strategies, 2019-07..2026-10, with what the market and the stock looked like on the
signal day (features, all known at that close) and what happened next (labels). Writes data/signals.parquet.

Strategies (buys, plus KK's shorts):
  sma     SMA 20/50 cross up (today's rule)                            horizon 20 sessions
  rsi     RSI 14 crosses back above 30 (today's rule)                  horizon 10 sessions
  kk      KK failed-breakdown buy, exact app rules (backtest-engine.ts) horizon 5 sessions after entry (its window)
  kk_s    KK failed-breakout short                                     horizon 5, direction down
  trend   Strong trend: new 52-week closing high, volume >= 2x its 50-day avg, close above 50-day avg  horizon 20
Wrong signal = following it for its horizon lost money after a 0.5 % round-trip cost.
Point-in-time list: a signal counts only if its stock was in that year's top 300 by traded value, measured on the
6 months BEFORE the year started (no hindsight about which stocks later became big).
"""
import numpy as np
import pandas as pd

import backtest as B
import diagnose as G
import adaptive as A
import fair as F

COST = 0.005
HORIZON = {"sma": 20, "rsi": 10, "kk": 5, "kk_s": 5, "trend": 20}

uni = pd.read_csv(B.D / "universe.csv")
sector_of = dict(zip(uni.symbol, uni.sector.fillna("Other")))

# ---------------------------------------------------------------- market-level features (per date)
ALL = F.ALL
closes = pd.concat({s: f.set_index("date").close for s, f in ALL.items()}, axis=1)
s50 = closes.rolling(50, min_periods=50).mean()
s200 = closes.rolling(200, min_periods=200).mean()
breadth50 = ((closes > s50).sum(axis=1) / s50.notna().sum(axis=1)).rename("breadth50")
breadth200 = ((closes > s200).sum(axis=1) / s200.notna().sum(axis=1)).rename("breadth200")
nif = G.nifty
mkt = pd.DataFrame({
    "nifty_d200": nif / G.s200 - 1,
    "nifty_r20": nif / nif.shift(20) - 1,
    "vix": G.vix.reindex(nif.index, method="ffill"),
})
mkt["vix_chg5"] = mkt.vix / mkt.vix.shift(5) - 1
mkt["wx"] = A.WX.map({"stormy": 0, "mixed": 1, "sunny": 2})
mkt = mkt.join(breadth50).join(breadth200)

r63 = closes / closes.shift(63) - 1
sec = pd.Series(sector_of).reindex(closes.columns).fillna("Other")
sec_ret = r63.T.groupby(sec).mean().T
sec_rank = sec_ret.rank(axis=1, pct=True)

# point-in-time membership, per calendar year
pit = {}
for y in range(2019, 2027):
    lo = pd.Timestamp(f"{y}-01-01") if y > 2019 else B.START
    pit[y] = F.pit_universe(lo)


def kk_signals(f, side):
    """Exact KK rules from web/src/lib/backtest-engine.ts (period 20, extension 1 %, confirm 5, window 5,
    T1 0.75R with half off, T2 2R, stop first). No overlapping trades. Returns rows (signal i, entry j, plan %)."""
    h, l, o, c = f.high.to_numpy(), f.low.to_numpy(), f.open.to_numpy(), f.close.to_numpy()
    n, out, i = len(f), [], 20
    while i < n:
        lo20, hi20 = l[i - 20:i].min(), h[i - 20:i].max()
        hit = (l[i] <= lo20 * 0.99) if side == "buy" else (h[i] >= hi20 * 1.01)
        if not hit:
            i += 1
            continue
        trig, stop = (h[i], l[i]) if side == "buy" else (l[i], h[i])
        j = -1
        for k in range(i + 1, min(i + 5, n - 1) + 1):
            if (side == "buy" and h[k] >= trig) or (side == "sell" and l[k] <= trig):
                j, fill = k, (max(o[k], trig) if side == "buy" else min(o[k], trig))
                break
        risk = abs(trig - stop)
        if j == -1 or risk <= 0:
            i += 1
            continue
        sg = 1 if side == "buy" else -1
        t1, t2 = trig + sg * 0.75 * risk, trig + sg * 2 * risk
        took, px, m_end = False, None, min(j + 5, n - 1)
        for m in range(j, m_end + 1):
            sl = (l[m] <= stop) if side == "buy" else (h[m] >= stop)
            a1 = (h[m] >= t1) if side == "buy" else (l[m] <= t1)
            a2 = (h[m] >= t2) if side == "buy" else (l[m] <= t2)
            if sl:
                px = stop
                break
            if a2 and (took or a1):
                px = t2
                break
            if a1:
                took = True
            if m == m_end:
                px = c[m]
        pnl = sg * (px - fill) / fill
        if took and px != stop:
            pnl = 0.5 * sg * (t1 - fill) / fill + 0.5 * pnl
        elif took and px == stop:
            pnl = 0.5 * sg * (t1 - fill) / fill + 0.5 * pnl
        out.append((i, j, pnl, risk / trig, m - j + 1))
        i = (m + 1) if m is not None else i + 1
    return out


ENTRY = {"sma": B.e_sma_cross, "rsi": B.e_rsi_rev, "trend": A.trend_entry(vol_mult=2.0)}

rows = []
for s, f in ALL.items():
    f = f.reset_index(drop=True)
    d = f.date
    o, c = f.open.to_numpy(), f.close.to_numpy()
    feats = pd.DataFrame({
        "d200": f.close / f.sma200 - 1, "d50": f.close / f.sma50 - 1, "d20": f.close / f.sma20 - 1,
        "slope200": f.sma200 / f.sma200.shift(20) - 1, "rsi14": f.rsi14, "rsi2": f.rsi2,
        "atrpct": f.atr14 / f.close, "volratio": f.volume / f.vol50, "rs_rank": f.rs_rank,
        "r5": f.close / f.close.shift(5) - 1, "r20": f.close / f.close.shift(20) - 1,
        "r126": f.ret126, "dist_hi252": f.close / f.hi252 - 1,
        "clv": ((f.close - f.low) / (f.high - f.low)).where(f.high > f.low, 0.5),
        "gap": f.open / f.close.shift() - 1,
        "sector_rank": sec_rank.get(sector_of.get(s, "Other"), pd.Series(dtype=float)).reindex(d).to_numpy()
        if sector_of.get(s, "Other") in sec_rank else np.nan,
    })
    cands = []
    for name, e in ENTRY.items():
        for i in np.flatnonzero(e(f).fillna(False).to_numpy()):
            hz = HORIZON[name]
            j = i + 1
            if j + hz - 1 < len(f):
                cands.append((name, i, j, c[j + hz - 1] / o[j] - 1 - COST, np.nan, np.nan))
    for name, side in (("kk", "buy"), ("kk_s", "sell")):
        for i, j, pnl, riskpct, days in kk_signals(f, side):
            if j + HORIZON[name] - 1 < len(f):
                cands.append((name, i, j, pnl - COST, riskpct, days))
    for name, i, j, ret, riskpct, days in cands:
        dt = d.iat[i]
        if dt < B.START or s not in pit.get(dt.year, ()):
            continue
        row = {"symbol": s, "date": dt, "strategy": name, "ret": ret, "kk_risk": riskpct, **feats.iloc[i].to_dict()}
        rows.append(row)

sig = pd.DataFrame(rows)
sig = sig.join(mkt, on="date")
# same-day average stock over the same horizon (fairness reference), from the point-in-time list
sig["wrong"] = (sig.ret < 0).astype(int)
sig.to_parquet(B.D / "signals.parquet", index=False)
print(sig.groupby("strategy").agg(n=("ret", "size"), wrong=("wrong", "mean"), avg=("ret", "mean")).round(3))
print("rows", len(sig), "from", sig.date.min(), "to", sig.date.max())
