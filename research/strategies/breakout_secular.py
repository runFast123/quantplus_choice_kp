"""Secular trend with a breakout confirmation (the owner's idea, 9 Nov 2026). Written down before running:

  signal        the live Secular trend signal (record_secular.entries): crosses above its signal line, flat or rising,
                below -150. Safety stop = signal close - 4 x ATR14, as now.
  confirmation  the first session after the signal day, within W sessions, whose CLOSE is above the signal day's HIGH.
                If the low reaches the safety stop first (checked before the close on the same day), or nothing
                confirms within W sessions, there is no trade.
  plan          entry at the open after the confirming close; out at the same safety stop (or the open, if it gaps
                under), otherwise the close of the 60th session after entry. One trade per stock at a time.
  W             10 sessions is the main version (chosen before running); 5, 20 and 60 are reported too.
  yardsticks    the rule as it is now (no confirmation), and random days below -150 put through the same confirmation
                (about as many days as the rule's signals, 5 seeds pooled), to tell the confirmation's effect from
                simply buying later.
Same research set as record_secular.py: each year's 300 most traded stocks, 2019-2026, 0.5 % round-trip cost; nothing is
tuned, so 2019-23 and 2024-26 are both reported. 'Made money' = the result after costs was above zero.

    python breakout_secular.py   -> data/secular_breakout.json
"""
import json

import numpy as np
import pandas as pd

import backtest as B
import record as R
import record_sma as RS
import specialk as K
from record_secular import COST, LEVEL, entries, stop_of

WINDOWS = (5, 10, 20, 60)
MAIN = 10


def plan(f: pd.DataFrame, picks: np.ndarray, atr: np.ndarray, window: int | None):
    """[(signal index, entry index, exit index, exit price, how)] — window None = no confirmation (the rule as now)."""
    o, h, l, c = f.open.to_numpy(), f.high.to_numpy(), f.low.to_numpy(), f.close.to_numpy()
    n, busy, out = len(f), -1, []
    for i in picks:
        if i <= busy or np.isnan(atr[i]):
            continue
        stop = stop_of(c[i], atr[i])
        if stop <= 0:
            continue
        if window is None:
            conf = i
        else:
            conf, dead = None, None
            for m in range(i + 1, min(i + 1 + window, n)):
                if l[m] <= stop:
                    dead = m
                    break
                if c[m] > h[i]:
                    conf = m
                    break
            if conf is None:
                if dead is not None:
                    busy = dead
                continue
        j = conf + 1
        if j >= n:
            busy = n
            continue
        k, px, how = None, None, None
        for m in range(j, min(j + 60, n)):
            if l[m] <= stop:
                k, px, how = m, min(o[m], stop), "STOP_HIT"
                break
        if k is None:
            if j + 60 > n:
                busy = n
                continue
            k, px, how = j + 59, c[j + 59], "REVIEW_60"
        busy = k
        out.append((i, j, k, px, how))
    return out


def run(window, chooser):
    def fn(s, f):
        g = f.reset_index(drop=True)
        atr = R.atr_simple(g).to_numpy()
        picks = chooser(s, g)
        return [(g.date.iat[i], px / g.open.iat[j] - 1 - COST, how, k - j + 1) for i, j, k, px, how in plan(g, picks, atr, window)]
    return RS.collect(fn)


def rule_picks(s, g):
    return np.flatnonzero(entries(g.sk, g.sk_sig).fillna(False).to_numpy())


def main():
    K.attach()
    out = {"rule_now": RS.periods(run(None, rule_picks))}
    for w in WINDOWS:
        out[f"confirm_{w}"] = RS.periods(run(w, rule_picks))

    # Random days on the same side of -150 (signal line known), about as many as the rule's signals, same confirmation.
    frames = RS.F.ALL
    elig = {s: np.flatnonzero(((f.sk < LEVEL) & f.sk_sig.notna()).to_numpy()) for s, f in frames.items()}
    n_sig = sum(len(rule_picks(s, f.reset_index(drop=True))) for s, f in frames.items())
    p = n_sig / max(1, sum(len(v) for v in elig.values()))
    for label, w in (("random_now", None), (f"random_confirm_{MAIN}", MAIN)):
        res = []
        for seed in range(5):
            rng = np.random.default_rng(seed)
            draws = {s: v[rng.random(len(v)) < p] for s, v in elig.items()}
            res.append(run(w, lambda s, g, d=draws: d[s]))
        r = RS.periods(pd.concat(res))
        for per in r:                                 # five seeds pooled: counts per seed
            r[per]["trades"] = round(r[per]["trades"] / 5)
            r[per]["per_year"] = round(r[per]["per_year"] / 5)
        out[label] = r
    out["design"] = {"main_window": MAIN, "windows": list(WINDOWS), "level": LEVEL, "cost": COST, "random_seeds": 5}
    json.dump(out, open(B.D / "secular_breakout.json", "w"), indent=1, default=float)

    print(f"{'version':22s} {'period':8s} {'trades':>6s} {'/yr':>4s} {'made':>6s} {'avg':>7s} {'median':>7s} {'win':>6s} {'loss':>6s} days")
    for k, v in out.items():
        if k == "design":
            continue
        for per in ("all", "2019_23", "2024_26"):
            x = v[per]
            print(f"{k:22s} {per:8s} {x['trades']:6d} {x['per_year']:4.0f} {x['made_money_pct']:5.1f}% {x['avg_pct']:+6.2f}% "
                  f"{x['median_pct']:+6.2f}% {x['avg_win_pct']:+5.1f}% {x['avg_loss_pct']:+5.1f}% {x['avg_days']}")


if __name__ == "__main__":
    main()
