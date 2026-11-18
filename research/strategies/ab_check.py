"""Cross-check (18 Nov 2026): the owner's AmiBroker formula ("200DMA LR SuperTrend NEXT OPEN ENTRY & EXIT",
Downloads/formula.html) ported line by line, against supertrend_lr.py's version of the same rule.

Port notes (AFL -> Python, literal):
  STDir     starts at 0; from bar ATR_Period on: if yesterday's dir <= 0, up when C > yesterday's UpperFinal, else down;
            if yesterday's dir was up, down when C < yesterday's LowerFinal. Bands as in the AFL.
  ATR       AmiBroker's ATR(10) = Wilder's smoothing of the true range.
  setup     BullCross (dir 1 today, -1 yesterday) AND LinRegSlope(MA(C,195), 25) > 0, only when not in a trade and
            not on a sell bar.
  confirm   C >= setup high + 0.05 (>= here; supertrend_lr.py used >), cancelled when dir != 1 first.
  buy       next bar's open. The buy bar itself is not checked for an exit (block 1 runs before the buy).
  sell      the first bar after the buy with dir == -1 marks the exit; sell at the next bar's open.
  sizing    12 % of equity, at most 6 open positions; ties on a day go in symbol order (no PositionScore in the AFL).

Reports how many trades the two versions share (same buy and sell day), and the results both ways, with 0 % and
0.5 % costs (AmiBroker's commission is in settings.html, which we don't have), on our research set (each year's top
300) and on all 474 stocks (today's list, as a watchlist would be).

    python ab_check.py   -> data/ab_check.json
"""
import json

import numpy as np
import pandas as pd

import backtest as B
import fair as FA
import supertrend_lr as ST


def st_dir_afl(h, l, c, n=10, m=3.0):
    pc = np.r_[np.nan, c[:-1]]
    tr = np.nanmax(np.vstack([h - l, np.abs(h - pc), np.abs(l - pc)]), axis=0)
    atr = np.full(len(c), np.nan)
    if len(c) > n:
        atr[n - 1] = tr[:n].mean()                                   # Wilder seed: simple mean of the first n
        for i in range(n, len(c)):
            atr[i] = (atr[i - 1] * (n - 1) + tr[i]) / n
    mid = (h + l) / 2
    ub, lb = mid + m * atr, mid - m * atr
    uf, lf = ub.copy(), lb.copy()
    d = np.zeros(len(c), dtype=int)
    for i in range(max(n, 1), len(c)):
        if np.isnan(ub[i]) or np.isnan(uf[i - 1]):
            continue
        uf[i] = ub[i] if (ub[i] < uf[i - 1] or c[i - 1] > uf[i - 1]) else uf[i - 1]
        lf[i] = lb[i] if (lb[i] > lf[i - 1] or c[i - 1] < lf[i - 1]) else lf[i - 1]
        if d[i - 1] <= 0:
            d[i] = 1 if c[i] > uf[i - 1] else -1
        else:
            d[i] = -1 if c[i] < lf[i - 1] else 1
    return d


def trades_afl(f, d, pending=False):
    """The AFL trading loop, literally. Returns (confirm bar, buy bar, sell bar or None); with pending=True also a
    confirmation on the last bar, whose buy is the next (not yet stored) open, as (confirm bar, None, None)."""
    h, c = f.high.to_numpy(), f.close.to_numpy()
    slope = np.nan_to_num(f.slope.to_numpy())
    valid = np.r_[False, (d[1:] == 1) & (d[:-1] == -1)] & (slope > 0)
    n = len(f)
    waiting = ready_buy = ready_sell = in_trade = 0
    setup_bar = confirm_bar = exit_bar = -1
    setup_high = 0.0
    out, cur = [], None
    for i in range(1, n):
        sold = False
        if in_trade:
            if ready_sell and i > exit_bar:
                cur[2] = i
                out.append(tuple(cur))
                in_trade = ready_sell = 0
                sold = True
            elif not ready_sell and d[i] == -1:
                ready_sell, exit_bar = 1, i
        if not in_trade and not sold:
            if ready_buy and i > confirm_bar:
                cur = [confirm_bar, i, None]
                in_trade, ready_buy = 1, 0
            if not in_trade and valid[i]:
                waiting, ready_buy, setup_bar, setup_high = 1, 0, i, h[i]
            if waiting and d[i] != 1:
                waiting = 0
            if waiting and i > setup_bar and c[i] >= setup_high + 0.05:
                ready_buy, confirm_bar, waiting = 1, i, 0
    if in_trade:
        out.append((cur[0], cur[1], None))
    elif pending and ready_buy:
        out.append((confirm_bar, None, None))
    return out


def main():
    raw = pd.read_parquet(B.D / "candles_long.parquet").dropna(subset=["open", "high", "low", "close"])
    raw = raw[(raw.close > 0) & (raw.open > 0) & ~raw.symbol.str.startswith("^")]
    frames = {s: ST.frame(f.copy()) for s, f in raw.groupby("symbol") if s in FA.ALL and len(f) > 300}
    closes = {s: f.set_index("date").close for s, f in frames.items()}

    ours, afl, same_dir = {}, {}, 0
    tot_days = 0
    for s, f in frames.items():
        d = st_dir_afl(f.high.to_numpy(), f.low.to_numpy(), f.close.to_numpy())
        m = (f.date >= pd.Timestamp("2018-01-01")).to_numpy()
        same_dir += int((d[m] == f["dir"].to_numpy()[m]).sum())
        tot_days += int(m.sum())
        n = len(f)
        afl[s] = [(i, j, k if k is not None else n - 1, f.open.iat[k] if k is not None else f.close.iat[-1])
                  for i, j, k in trades_afl(f, d)]
        ours[s] = ST.trades(f)

    def rows(tr, pit_only):
        out = []
        for s, t in tr.items():
            f = frames[s]
            for i, j, k, px in t:
                if f.date.iat[i] < B.START or (pit_only and not f.pit.iat[i]):
                    continue
                out.append((s, i, j, k, px))
        return out

    o_set = {(s, frames[s].date.iat[j], frames[s].date.iat[k]) for s, i, j, k, px in rows(ours, False)}
    a_set = {(s, frames[s].date.iat[j], frames[s].date.iat[k]) for s, i, j, k, px in rows(afl, False)}
    res = {"supertrend_direction_same_days_pct": round(same_dir / tot_days * 100, 2),
           "trades_ours": len(o_set), "trades_afl": len(a_set), "trades_identical": len(o_set & a_set)}
    print(res, flush=True)

    periods = dict(ST.PERIODS) | {"2019-26": (B.START, ST.END)}
    for label, tr in (("ours", ours), ("afl", afl)):
        for uni in ("top300", "all474"):
            rs = rows(tr, uni == "top300")
            for cost in (0.0, 0.005):
                ST.COST = cost
                for p, (lo, hi) in periods.items():
                    sig_rs = [(s, j, k, px, -(frames[s].ret126.iat[i] if not np.isnan(frames[s].ret126.iat[i]) else -9))
                              for s, i, j, k, px in rs]
                    sig_ab = [(s, j, k, px, s) for s, i, j, k, px in rs]
                    tt = [(px / frames[s].open.iat[j] - 1 - cost, k - j + 1) for s, i, j, k, px in rs
                          if lo <= frames[s].date.iat[i] < hi and k != len(frames[s]) - 1]
                    key = f"{label}|{uni}|cost{cost}|{p}"
                    res[key] = {"trades": ST.stats(tt),
                                "6x12_symbol_order": ST.simulate(sig_ab, frames, closes, lo, hi, 6, 0.12),
                                "6x12_strongest_first": ST.simulate(sig_rs, frames, closes, lo, hi, 6, 0.12)}
                    print(key, json.dumps(res[key]), flush=True)
    (B.D / "ab_check.json").write_text(json.dumps(res, indent=1, default=str))


if __name__ == "__main__":
    main()
