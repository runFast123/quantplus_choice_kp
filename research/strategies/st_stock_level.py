"""Stock-by-stock test of the owner's SuperTrend + 195-day regression rule (18 Nov 2026).

The owner asked for the rule run on each stock on its own, the way a chart backtest does it, instead of a portfolio.
Trades come from ab_check.trades_afl (the AmiBroker formula ported line by line; it agrees with supertrend_lr.py on
99.7 % of trades). Each stock: every trade in the period (signal day inside it), full money in each trade, results
compounded; a trade still open at the end is marked at the last close. Costs 0.5 % round trip.

Per period (2019-07..2023-12, 2024-01..2026-10, and the whole 2019-07..2026-10), two stock lists:
  top300  only signals while the stock was in that year's 300 most traded (our research set, no hindsight)
  all474  every stock in our data (today's list, as an AmiBroker watchlist would be: has hindsight)
Reported: stocks traded; stocks where the rule made money; median and mean stock result; stocks that beat simply
holding the same stock over the same period; all trades: count, made money, mean, median, average win / loss, profit
factor (gross profit / gross loss); and Rs 1,00,000 in every trade: total profit.

Double check: prints three trades (fixed picks: the first, middle and last of the 2024-26 list by date) with the
candles that decide them, so each step can be checked by hand.

    python st_stock_level.py   -> data/st_stock_level.json
"""
import json

import numpy as np
import pandas as pd

import ab_check as AB
import backtest as B
import fair as FA
import supertrend_lr as ST

COST = 0.005
PERIODS = {"2019-23": (B.START, B.IS_END), "2024-26": (B.IS_END, ST.END), "2019-26": (B.START, ST.END)}


def main():
    raw = pd.read_parquet(B.D / "candles_long.parquet").dropna(subset=["open", "high", "low", "close"])
    raw = raw[(raw.close > 0) & (raw.open > 0) & ~raw.symbol.str.startswith("^")]
    frames = {s: ST.frame(f.copy()) for s, f in raw.groupby("symbol") if s in FA.ALL and len(f) > 300}
    dirs, tr = {}, {}
    for s, f in frames.items():
        d = AB.st_dir_afl(f.high.to_numpy(), f.low.to_numpy(), f.close.to_numpy())
        dirs[s] = d
        tr[s] = AB.trades_afl(f, d)                                     # (confirm i, buy j, sell k or None)

    out = {}
    all_rows = []
    for uni in ("top300", "all474"):
        for p, (lo, hi) in PERIODS.items():
            per_stock, trades = [], []
            for s, f in frames.items():
                rs = []
                for i, j, k in tr[s]:
                    d = f.date.iat[i]
                    if not (lo <= d < hi) or (uni == "top300" and not f.pit.iat[i]):
                        continue
                    px = f.open.iat[k] if k is not None else f.close.iat[-1]
                    r = px / f.open.iat[j] - 1 - COST
                    rs.append(r)
                    trades.append(r)
                    if uni == "top300" and p == "2024-26":
                        all_rows.append((d, s, i, j, k, r))
                if not rs:
                    continue
                w = f[(f.date >= lo) & (f.date < hi)]
                hold = w.close.iat[-1] / w.open.iat[0] - 1
                per_stock.append((s, float(np.prod([1 + r for r in rs]) - 1), float(hold), len(rs)))
            st = np.array([x[1] for x in per_stock])
            hd = np.array([x[2] for x in per_stock])
            t = np.array(trades)
            win, loss = t[t > 0], t[t <= 0]
            res = {
                "stocks": len(per_stock),
                "stocks_made_money_pct": round(float((st > 0).mean()) * 100, 1),
                "stock_result_median_pct": round(float(np.median(st)) * 100, 1),
                "stock_result_mean_pct": round(float(st.mean()) * 100, 1),
                "stocks_beat_holding_pct": round(float((st > hd).mean()) * 100, 1),
                "holding_median_pct": round(float(np.median(hd)) * 100, 1),
                "trades": int(len(t)),
                "trades_made_money_pct": round(float((t > 0).mean()) * 100, 1),
                "trade_mean_pct": round(float(t.mean()) * 100, 2),
                "trade_median_pct": round(float(np.median(t)) * 100, 2),
                "avg_win_pct": round(float(win.mean()) * 100, 1),
                "avg_loss_pct": round(float(loss.mean()) * 100, 1),
                "profit_factor": round(float(win.sum() / -loss.sum()), 2),
                "rs1lakh_each_total_profit": int(round(t.sum() * 100_000)),
            }
            print(f"{uni}|{p}", json.dumps(res), flush=True)
            res["best_stocks"] = sorted(per_stock, key=lambda x: -x[1])[:5]
            res["worst_stocks"] = sorted(per_stock, key=lambda x: x[1])[:5]
            out[f"{uni}|{p}"] = res

    # double check: three trades with the candles that decide them
    all_rows.sort()
    picks = [all_rows[0], all_rows[len(all_rows) // 2], all_rows[-1]]
    checks = []
    for d, s, i, j, k, r in picks:
        f, dr = frames[s], dirs[s]
        setup = max(x for x in range(1, i) if dr[x] == 1 and dr[x - 1] == -1)
        red = next((x for x in range(j + 1, len(f)) if dr[x] == -1), None)
        c = {"symbol": s,
             "setup_day": str(f.date.iat[setup].date()), "setup_high": round(float(f.high.iat[setup]), 2),
             "setup_slope": round(float(f.slope.iat[setup]), 4), "dir_day_before_and_setup": [int(dr[setup - 1]), int(dr[setup])],
             "trigger": round(float(f.high.iat[setup]) + 0.05, 2),
             "closes_after_setup_to_confirm": [round(float(x), 2) for x in f.close.iloc[setup + 1:i + 1]],
             "confirm_day": str(f.date.iat[i].date()), "confirm_close": round(float(f.close.iat[i]), 2),
             "buy_day": str(f.date.iat[j].date()), "buy_open": round(float(f.open.iat[j]), 2),
             "first_red_day": str(f.date.iat[red].date()) if red is not None else None,
             "sell_day": str(f.date.iat[k].date()) if k is not None else "still open",
             "sell_price": round(float(f.open.iat[k] if k is not None else f.close.iat[-1]), 2),
             "result_after_costs_pct": round(r * 100, 2)}
        checks.append(c)
        print("CHECK", json.dumps(c), flush=True)
    out["checks"] = checks
    (B.D / "st_stock_level.json").write_text(json.dumps(out, indent=1, default=str))


if __name__ == "__main__":
    main()
