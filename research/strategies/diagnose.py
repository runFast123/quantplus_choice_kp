"""Where do today's three strategies go wrong? Every trade is tagged with what the market and the stock looked
like on the signal day, then results are split by those tags. Nothing is filtered out: every trade counts.

Tags (all known on the signal day's close):
  weather   Nifty 50 trend: 'up' (above its 200-day avg and 50-day avg above 200-day), 'down' (both below), else 'mixed'
  vix       India VIX: calm < 15, normal 15-22, stormy > 22
  stock     the stock's own trend: above / below its 200-day average
  vol       the stock's own daily swing (ATR as % of price): low / mid / high thirds
"""
import json
import re

import numpy as np
import pandas as pd

import backtest as B

D = B.D
nifty = pd.read_parquet(D / "NSEI_long.parquet")
nifty.columns = [c.lower() for c in nifty.columns]
nifty = nifty.sort_values("date").set_index("date").close
vix = pd.read_parquet(D / "INDIAVIX_long.parquet")
vix.columns = [c.lower() for c in vix.columns]
vix = vix.sort_values("date").set_index("date").close

s50, s200 = nifty.rolling(50).mean(), nifty.rolling(200).mean()
weather = pd.Series(np.where((nifty > s200) & (s50 > s200), "up", np.where((nifty < s200) & (s50 < s200), "down", "mixed")),
                    index=nifty.index)
weather[s200.isna()] = None
vixb = pd.cut(vix, [0, 15, 22, 1000], labels=["calm", "normal", "stormy"]).astype(str)


def tag_market(df, col="date"):
    d = pd.to_datetime(df[col])
    df["weather"] = weather.reindex(d, method="ffill").values
    df["vix"] = vixb.reindex(d, method="ffill").values
    return df


def table(df, by, ret="ret", extra=None):
    g = df.groupby(by, dropna=False)
    out = pd.DataFrame({
        "trades": g.size(),
        "win%": g[ret].apply(lambda x: 100 * (x > 0).mean()).round(1),
        "avg%": g[ret].mean().mul(100).round(2),
        "total%": g[ret].sum().mul(100).round(0),
    })
    if extra:
        out["beat avg stock 20d (pp)"] = g[extra].mean().mul(100).round(2)
    return out


# ---------------------------------------------------------------- SMA cross + RSI reversal (2019-07..2026-10)
fwd = []
for s, f in B.stocks.items():
    o, c, n = f.open.to_numpy(), f.close.to_numpy(), len(f)
    r = np.full(n, np.nan)
    jj = np.arange(n - 20)
    r[jj] = c[jj + 20] / o[jj + 1] - 1
    fwd.append(pd.DataFrame({"symbol": s, "date": f.date.to_numpy(), "r20": r}))
fwd = pd.concat(fwd)
day_avg = fwd.groupby("date").r20.mean()


def stock_tags(t):
    rows = []
    for s, g in t.groupby("symbol"):
        f = B.stocks[s].set_index("date")
        d = pd.to_datetime(g.date)
        rows.append(pd.DataFrame({
            "idx": g.index,
            "stock": np.where(f.close.reindex(d).values > f.sma200.reindex(d).values, "above 200d", "below 200d"),
            "atrpct": (f.atr14 / f.close).reindex(d).values,
            "rsi_at": f.rsi14.reindex(d).values,
            "r20": fwd[fwd.symbol == s].set_index("date").r20.reindex(d).values,
        }))
    x = pd.concat(rows).set_index("idx")
    t = t.join(x)
    t["vol"] = pd.qcut(t.atrpct, 3, labels=["low swing", "mid swing", "high swing"]).astype(str)
    t["x20"] = t.r20 - pd.to_datetime(t.date).map(day_avg).values
    return t


if __name__ == "__main__":
    pd.set_option("display.width", 200)
    for name in ("sma_20_50_cross (today)", "rsi_reversal (today)"):
        e, x = B.STRATS[name]
        t, _ = B.run_strategy(e, x)
        t = tag_market(stock_tags(t))
        t.to_csv(D / f"diag_{name.split()[0]}.csv", index=False)
        print(f"\n\n==================== {name}: {len(t)} trades, 2019-07..2026-10, after 0.25 % cost")
        print(table(t.assign(all="all"), "all", extra="x20"))
        for by in ("weather", "vix", "stock", "vol"):
            print(table(t, by, extra="x20"))
        print(table(t, ["weather", "stock"], extra="x20"))
        # how trades end
        quick = t.days <= 10
        print(f"  ended within 10 sessions: {100*quick.mean():.0f}% of trades, avg {100*t.ret[quick].mean():+.2f}% "
              f"| longer: avg {100*t.ret[~quick].mean():+.2f}%")
        print(f"  biggest 10% of winners make {100*t.ret.nlargest(len(t)//10).sum()/t.ret[t.ret>0].sum():.0f}% of all gains")

    # ---------------------------------------------------------------- KK breakout: the stored 20-year record
    kk = pd.DataFrame(json.load(open(D / "kk_eod_results_fixed.json"))["trades"])
    kk["risk"] = (kk.entry_fill_price - kk.stop_loss).abs()
    kk["ret"] = kk.realized_r_multiple * kk.risk / kk.entry_fill_price - B.COST
    kk["riskpct"] = pd.qcut(kk.risk / kk.entry_fill_price, 3, labels=["tight stop", "mid stop", "wide stop"]).astype(str)
    kk = tag_market(kk, "signal_date")
    kk["date"] = kk.signal_date
    print(f"\n\n==================== KK breakout (stored record): {len(kk)} trades 2006..2026, after 0.25 % cost")
    print(table(kk, "signal"))
    for by in ("weather", "vix", "riskpct"):
        print(table(kk, ["signal", by]))
    print(table(kk, "result"))

    # does the strategy's own recent record predict its next month? (the 'self-adjusting' idea)
    for side in ("BUY", "SELL"):
        k = kk[kk.signal == side].copy()
        k["m"] = pd.to_datetime(k.signal_date).dt.to_period("M")
        m = k.groupby("m").ret.agg(["mean", "size"])
        m["trail12"] = (k.groupby("m").ret.sum().rolling(12).sum() / k.groupby("m").ret.size().rolling(12).sum()).shift(1)
        m = m.dropna()
        good = m[m.trail12 > 0]
        bad = m[m.trail12 <= 0]
        wavg = lambda z: (z["mean"] * z["size"]).sum() / z["size"].sum()
        print(f"  {side}: months after a positive 12-month record avg {100*wavg(good):+.2f}%/trade ({good['size'].sum()} trades) "
              f"| after a negative one {100*wavg(bad):+.2f}% ({bad['size'].sum()} trades) | corr {m['mean'].corr(m.trail12):+.2f}")
