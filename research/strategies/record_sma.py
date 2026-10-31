"""SMA 20/50 trend (ADR-037): the tested record of EXACTLY the rule migration 38 runs, and one consistent set of
before / after numbers for all four rules (for the report: data/final_report.json).

  sma_trend  the 20-day average closes above the 50-day average, and the stock is a leader that day: its 126-session
             return in the top 30 % of the 500 largest companies (percent rank >= 0.7);
  plan       entry at the next open; safety stop = signal close - 4 x ATR14 (simple 14-day average true range);
             out at the stop (or the open, if it gaps under), otherwise the close of the 60th session. One trade per stock.
             (The same plan as Strong trend.)
Chosen on 2019-07..2023-12 as the variant with the fewest losing trades (at least 150 a year and a positive average),
the owner's stated goal; improve_sma.py reports every variant, including the one the average-trade criterion picks.
Point-in-time top 300 per year, 0.5 % round-trip cost. 'Made money' = the trade's result after costs was above zero.
"""
import json

import numpy as np
import pandas as pd

import backtest as B
import improve as I
import record as R
import record_dip as RD
import signals as S

F = S.F
COST = 0.005


def sma_trend_trades(f):
    f = f.reset_index(drop=True)
    atr = R.atr_simple(f).to_numpy()
    sig = (B.e_sma_cross(f) & (f.rs_rank >= 0.7)).fillna(False).to_numpy()
    o, l, c = f.open.to_numpy(), f.low.to_numpy(), f.close.to_numpy()
    n, busy, out = len(f), -1, []
    for i in np.flatnonzero(sig):
        if i <= busy or i + 1 >= n or np.isnan(atr[i]):
            continue
        j = i + 1
        stop = c[i] - 4 * atr[i]
        end = min(j + 60, n)
        k, px, how = end - 1, c[end - 1], "REVIEW_60" if j + 60 <= n else "OPEN"
        for m in range(j, end):
            if l[m] <= stop:
                k, px, how = m, min(o[m], stop), "STOP_HIT"
                break
        busy = k
        out.append((f.date.iat[i], px / o[j] - 1 - COST, how, k - j + 1))
    return out


def collect(fn, closed_only=True):
    rows = []
    for s, f in F.ALL.items():
        for d, net, how, days in fn(s, f):
            if d < B.START or s not in S.pit.get(d.year, ()) or (closed_only and how == "OPEN"):
                continue
            rows.append((d, net, how, days))
    return pd.DataFrame(rows, columns=["date", "net", "how", "days"])


def stats(t):
    w = t.net > 0
    return {"trades": int(len(t)), "made_money_pct": round(100 * w.mean(), 1), "avg_pct": round(100 * t.net.mean(), 2),
            "avg_win_pct": round(100 * t.net[w].mean(), 2), "avg_loss_pct": round(100 * t.net[~w].mean(), 2),
            "median_pct": round(100 * t.net.median(), 2), "avg_days": round(t.days.mean(), 1),
            "per_year": round(len(t) / ((t.date.max() - t.date.min()).days / 365.25), 0)}


def periods(t):
    return {"all": stats(t), "2019_23": stats(t[t.date < I.IS_END]), "2024_26": stats(t[t.date >= I.IS_END])}


def expect_live():
    """Independent version of migration 38 on the read-only live-candle copy -> data/expected_sma_signals.csv."""
    from decimal import ROUND_HALF_UP, Decimal
    c = pd.read_parquet(B.D / "live_candles.parquet")
    c["day"] = pd.to_datetime(c.ts, utc=True).dt.tz_convert("Asia/Kolkata").dt.date
    sy = pd.read_csv(B.D / "live_symbols.csv")
    names = set(sy[(sy.segment == "equity") & (sy.mcap_rank <= 500)].symbol)
    c = c[c.symbol.isin(names)].sort_values(["symbol", "ts"])
    c["ret126"] = c.groupby("symbol").close.transform(lambda x: x / x.shift(126) - 1)
    c["rs"] = c.dropna(subset=["ret126"]).groupby("day").ret126.rank(method="max", pct=True)   # = SQL cume_dist
    out = []
    for s, f in c.groupby("symbol"):
        f = f.reset_index(drop=True)
        p100 = (f.close * 100).round().astype("int64")                 # exact sums in paise, like the numeric SQL
        s20, s50 = p100.rolling(20).sum(), p100.rolling(50).sum()
        up = (50 * s20 > 20 * s50) & (50 * s20.shift() <= 20 * s50.shift())
        prev = f.close.shift()
        tr = pd.concat([f.high - f.low, (f.high - prev).abs(), (f.low - prev).abs()], axis=1).max(axis=1)
        atr = tr.rolling(14, min_periods=14).mean()
        o, l, cl = f.open.to_numpy(), f.low.to_numpy(), f.close.to_numpy()
        n, busy = len(f), -1
        for i in range(50, n):
            if i <= busy or not up.iat[i] or pd.isna(f.rs.iat[i]) or f.rs.iat[i] < 0.7 or pd.isna(atr.iat[i]):
                continue
            stop = float(Decimal(str(cl[i] - 4 * atr.iat[i])).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))
            out.append((s, "buy", f.day.iat[i], stop, ""))
            j = i + 1
            if j >= n:
                busy = n
                continue
            k = None
            for m in range(j, min(j + 60, n)):
                if l[m] <= stop:
                    k, how = m, "STOP_HIT"
                    break
            if k is None:
                if j + 59 >= n:
                    busy = n
                    continue
                k, how = j + 59, "REVIEW_60"
            busy = k
            out.append((s, "exit", f.day.iat[k], None, how))
    e = pd.DataFrame(out, columns=["symbol", "signal_type", "day", "stop", "result"])
    e.to_csv(B.D / "expected_sma_signals.csv", index=False)
    print("expected sma_trend:", (e.signal_type == "buy").sum(), "buys,", (e.signal_type == "exit").sum(), "exits")


if __name__ == "__main__" and "--live" in __import__("sys").argv:
    expect_live()
elif __name__ == "__main__":
    for s, f in F.ALL.items():
        f["sma5"] = f.close.rolling(5, min_periods=5).mean()

    def old_rule(entry, exit_):
        def run(s, f):
            f = f.reset_index(drop=True)
            out, busy = [], -1
            for i in np.flatnonzero(entry(f).fillna(False).to_numpy()):
                if i <= busy or i + 1 >= len(f):
                    continue
                j = i + 1
                k, px = exit_(f, j, f.open.iat[j])
                busy = k
                out.append((f.date.iat[i], px / f.open.iat[j] - 1 - COST, "", k - j + 1))
            return out
        return run

    def kk_old(s, f):
        f = f.reset_index(drop=True)
        out, busy = [], -1
        for i, j, e, trig, stop in I.kk_events(f, "buy"):
            if i <= busy or j <= busy or abs(trig - stop) <= 0:
                continue
            k, px = I.x_kk_today(f, j, e, trig, stop)
            busy = k
            out.append((f.date.iat[i], px / e - 1 - COST, "", k - j + 1))
        return out

    def dip(rule):
        def run(s, f):
            tr, _ = RD.trades(RD.frame(f[["date", "open", "high", "low", "close", "volume"]].copy()), rule)
            return [(sd, px / e - 1 - COST, how, 0) for sd, ed, xd, e, px, how in tr if px is not None]
        return run

    strong = pd.read_csv(B.D / "strong_trend_record.csv", parse_dates=["date"])   # record.py: exact Strong trend rule
    strong = strong[strong.how != "open"].assign(net=lambda d: d.trade - COST)

    report = {
        "sma": {"old": periods(collect(old_rule(B.e_sma_cross, lambda f, j, e: B.x_cross("sma20", "sma50")(f, j)))),
                "new": periods(collect(lambda s, f: sma_trend_trades(f)))},
        "rsi": {"old": periods(collect(old_rule(B.e_rsi_rev, lambda f, j, e: B.x_rsi_rev(f, j)))),
                "new": periods(collect(dip("rsi_dip")))},
        "kk": {"old": periods(collect(kk_old)), "new": periods(collect(dip("kk_dip")))},
        "strong": {"new": periods(strong)},
    }
    json.dump(report, open(B.D / "final_report.json", "w"), indent=1, default=float)
    for k, v in report.items():
        for side, p in v.items():
            print(f"{k:6s} {side:3s} " + " | ".join(
                f"{lab}: {x['trades']} tr, {x['made_money_pct']}% made money, avg {x['avg_pct']:+.2f}%" for lab, x in p.items()))
