"""Builds the owner report on the fifth rule, 200-day trend (HTML -> data/report.html, printed to PDF by report_pdf.mjs).
Every number comes from improve_lr.py (data/improve_lr.json) and record_lr.py (data/ma200_trend_record.json); the two
example trades are drawn from the research candles."""
import json
from pathlib import Path

import numpy as np
import pandas as pd

from report_html import CSS, sgn

D = Path(__file__).parent / "data"
V = json.load(open(D / "improve_lr.json"))["variants"]
R = json.load(open(D / "ma200_trend_record.json"))
RULE, RAND = "#2B6CB0", "#B7791F"          # validated pair (dataviz validate_palette.js, light, on #F4EFE4)
INK, MUTED, LOSS = "#1E1E1E", "#8A8478", "#C2410C"
PICK = "turn_on|flat|N100|r0.5|plan"


def pct(x):
    return f"{x:.0f}%"


# ---------------------------------------------------------------- example trades
raw = pd.read_parquet(D / "candles.parquet")


def example(sym, day, w=330, h=180):
    f = raw[raw.symbol == sym].sort_values("date").reset_index(drop=True)
    f["sma200"] = f.close.rolling(200).mean()
    atr = pd.concat([f.high - f.low, (f.high - f.close.shift()).abs(), (f.low - f.close.shift()).abs()], axis=1).max(axis=1).rolling(14).mean()
    i = int(f.index[f.date == pd.Timestamp(day)][0])
    j, stop = i + 1, f.close.iat[i] - 4 * atr.iat[i]
    k = min(j + 59, len(f) - 1)
    for m in range(j, k + 1):
        if f.low.iat[m] <= stop:
            k = m
            break
    lo_i, hi_i = i - 160, min(k + 12, len(f) - 1)
    g = f.iloc[lo_i:hi_i + 1]
    y = f.sma200.iloc[i - 99:i + 1].to_numpy()
    xs = np.arange(100) - 49.5
    b = (xs * (y - y.mean())).sum() / (xs * xs).sum()
    reg = (y.mean() + b * xs[0], y.mean() + b * xs[-1])
    vals = pd.concat([g.close, g.sma200.dropna(), pd.Series([stop])])
    vmin, vmax = vals.min() * 0.97, vals.max() * 1.03
    L, Rt, T, B = 6, 44, 34, 14
    X = lambda idx: L + (idx - lo_i) / (hi_i - lo_i) * (w - L - Rt)
    Y = lambda v: T + (vmax - v) / (vmax - vmin) * (h - T - B)
    path = lambda ser: " ".join(f"{'M' if n == 0 else 'L'}{X(ix):.1f},{Y(v):.1f}" for n, (ix, v) in enumerate(ser.items()) if not np.isnan(v))
    net = f.close.iat[k] / f.open.iat[j] - 1 if f.low.iat[k] > stop else min(f.open.iat[k], stop) / f.open.iat[j] - 1
    net -= 0.005
    how = "safety stop" if f.low.iat[k] <= stop else "60-session review"
    o = [f'<svg viewBox="0 0 {w} {h}" width="100%" role="img" aria-label="{sym} example">']
    o.append(f'<text x="0" y="12" class="ct">{sym} · bought {pd.Timestamp(f.date.iat[j]).strftime("%d %b %Y")}</text>')
    o.append(f'<text x="0" y="25" class="vl">{sgn(100 * net)} after costs, out at the {how}</text>')
    o.append(f'<rect x="{X(j):.1f}" y="{T}" width="{X(k) - X(j):.1f}" height="{h - T - B}" fill="#F4EFE4"/>')
    o.append(f'<path d="{path(g.sma200)}" fill="none" stroke="{RULE}" stroke-width="2"/>')
    o.append(f'<path d="{path(g.close)}" fill="none" stroke="{INK}" stroke-width="1.2"/>')
    o.append(f'<line x1="{X(i - 99):.1f}" y1="{Y(reg[0]):.1f}" x2="{X(i):.1f}" y2="{Y(reg[1]):.1f}" stroke="{RAND}" stroke-width="2" stroke-dasharray="4 3"/>')
    o.append(f'<line x1="{X(j):.1f}" y1="{Y(stop):.1f}" x2="{X(k):.1f}" y2="{Y(stop):.1f}" stroke="{LOSS}" stroke-width="1" stroke-dasharray="2 2"/>')
    o.append(f'<text x="{X(j) - 3:.1f}" y="{Y(stop) + 3:.1f}" text-anchor="end" class="na">stop</text>')
    o.append(f'<circle cx="{X(i):.1f}" cy="{Y(f.close.iat[i]):.1f}" r="4" fill="{INK}" stroke="#fff" stroke-width="2"/>')
    o.append(f'<text x="{X(i) - 6:.1f}" y="{Y(f.close.iat[i]) - 8:.1f}" text-anchor="end" class="vl">signal</text>')
    o.append(f'<text x="{w - Rt + 4}" y="{Y(g.sma200.dropna().iat[-1]) + 3:.1f}" class="vl" fill="{RULE}">200-day</text>')
    o.append("</svg>")
    return "".join(o)


# ---------------------------------------------------------------- year bars: the rule vs a random day above the 200-day
def years(w=660, h=150):
    ys = sorted(R["by_year"])
    L, T, B = 30, 26, 22
    gw = (w - L) / len(ys)
    Y = lambda v: T + (100 - v) / 100 * (h - T - B)
    o = [f'<svg viewBox="0 0 {w} {h}" width="100%" role="img" aria-label="Trades that made money, by year">']
    o.append('<text x="0" y="12" class="ct">Trades that made money, by year (after costs)</text>')
    for v in (0, 50, 100):
        o.append(f'<line x1="{L}" x2="{w}" y1="{Y(v):.1f}" y2="{Y(v):.1f}" stroke="#E4DDCF" stroke-width="1"/>')
        o.append(f'<text x="{L - 4}" y="{Y(v) + 3:.1f}" text-anchor="end" class="vl">{v}</text>')
    for n, y in enumerate(ys):
        r = R["by_year"][y]
        x0 = L + n * gw + gw * 0.18
        bw = gw * 0.3
        for m, (v, c) in enumerate(((r["made_money_pct"], RULE), (r["random_made_money_pct"], RAND))):
            x = x0 + m * (bw + 2)
            o.append(f'<rect x="{x:.1f}" y="{Y(v):.1f}" width="{bw:.1f}" height="{Y(0) - Y(v):.1f}" rx="2" fill="{c}"/>')
            o.append(f'<text x="{x + bw / 2:.1f}" y="{Y(v) - 3:.1f}" text-anchor="middle" class="vl">{v:.0f}</text>')
        lab = f"{y}{' (to Oct)' if y == '2026' else ''}"
        o.append(f'<text x="{x0 + bw:.1f}" y="{h - 6}" text-anchor="middle" class="rl">{lab}</text>')
    o.append("</svg>")
    return "".join(o)


def vrow(name, key, note=""):
    a, b = V[key]["2019_23"], V[key]["2024_26"]
    return (f"<tr><td>{name}</td><td class=n>{a['trades']:,}</td><td class=n>{pct(a['made_money_pct'])} · {sgn(a['avg_pct'])}</td>"
            f"<td class=n>{pct(b['made_money_pct'])} · {sgn(b['avg_pct'])}</td><td class=m>{note}</td></tr>")


a, d, c = R["all"], R["2019_23"], R["2024_26"]
rd, rc = R["random_above_200d"]["2019_23"], R["random_above_200d"]["2024_26"]
wx = R["by_weather"]
ended = R["ended"]
stopped = round(100 * ended.get("STOP_HIT", 0) / sum(ended.values()))

html = f"""<!doctype html><html><head><meta charset="utf-8"><title>QuantsPulse 200-day trend rule</title>
<style>{CSS} .ex {{ break-inside: avoid; }} .legend {{ margin-bottom: 8px; }}</style></head><body>
<div class="eyebrow">QuantsPulse · research report · 3 November 2026</div>
<h1>200-day trend: the fifth signal rule</h1>
<p class="lead">A stock that is above its 200-day average, while that average is flat or rising, is in a long-term uptrend.
The rule buys the day all of that first comes true, using a regression line (as in TradingView's Linear Regression
Channel) to judge the direction. On past NSE prices it made money on {pct(a['made_money_pct'])} of its {a['trades']:,} trades,
{sgn(a['avg_pct'])} a trade after costs. In 2024–26, the years it was not chosen on, it beat buying on a random day above
the 200-day average: {pct(c['made_money_pct'])} against {pct(rc['made_money_pct'])}. It is research, not advice: about half its recent trades lost money.</p>

<div class="box"><b>In one line each.</b>
<ul>
<li><b>Looks for</b> — the close above the 200-day average, that average's regression line flat or rising, and the last
100 days' prices leaning up in a fairly straight line.</li>
<li><b>Plan</b> — buy the next morning; safety stop 4× the stock's normal daily move below; review after 60 trading
sessions (the same plan as Strong trend and SMA 20/50 trend).</li>
<li><b>Tested</b> — {a['trades']:,} trades, Mar 2020 – Oct 2026: {pct(a['made_money_pct'])} made money, winners about
{sgn(a['avg_win_pct'], 0)}, losers about {sgn(a['avg_loss_pct'], 0)}. 2024–26: {pct(c['made_money_pct'])}, {sgn(c['avg_pct'])} a trade.</li>
<li><b>New, not a copy</b> — only {R['overlap_pct']:.0f}% of its buys came within a week of a Strong trend or SMA 20/50 trend
buy in the same stock.</li>
</ul></div>

<h2>How the rule reads a chart</h2>
<p>Three checks on every close, for each of the 500 largest companies. The rule fires on the <b>first</b> day all three
pass after a day when they did not, so a stock gives one signal when its trend turns, not one every day.</p>
<table>
<tr><th>Check</th><th>What it means</th><th>Exactly</th></tr>
<tr><td><b>1 · Above the 200-day</b></td><td>The price is above its long-term average.</td><td class=m>close &gt; average of the last 200 closes</td></tr>
<tr><td><b>2 · The 200-day is flat or rising</b></td><td>A straight line fitted to the 200-day average over the last 100 days
does not point down.</td><td class=m>least-squares slope × 20 sessions ≥ −0.25% of the average (flat counts)</td></tr>
<tr><td><b>3 · A steady climb</b></td><td>The last 100 closes lean up in a fairly straight line, not a jumpy bounce.</td>
<td class=m>Pearson's R of close against time ≥ 0.5 (the R your channel indicator shows)</td></tr>
</table>
<div class="grid2 ex">
<div>{example("MARUTI", "2025-07-10")}</div>
<div>{example("RELIANCE", "2025-12-02")}</div>
</div>
<p class="legend"><span class="sw" style="background:{INK}"></span>close<span class="sw" style="background:{RULE}"></span>200-day
average<span class="sw" style="background:{RAND}"></span>its regression line over the last 100 days (dashed)
· shaded = the trade. Two real trades: one that worked and one that hit its stop. Examples, not picks.</p>

<div class="pb"></div>
<h2>How it did on past prices</h2>
<table>
<tr><th>Version</th><th class=n>Trades<br>2019–23</th><th class=n>2019–23 (chosen on)<br>made money · avg</th>
<th class=n>2024–26 (check)<br>made money · avg</th><th>Note</th></tr>
<tr><td><b>200-day trend</b></td><td class=n>{d['trades']:,}</td><td class=n><b>{pct(d['made_money_pct'])}</b> · {sgn(d['avg_pct'])}</td>
<td class=n><b>{pct(c['made_money_pct'])}</b> · {sgn(c['avg_pct'])}</td><td class=m>the rule going live</td></tr>
<tr><td>Random day above the 200-day</td><td class=n>—</td><td class=n>{pct(rd['made_money_pct'])} · {sgn(rd['avg_pct'])}</td>
<td class=n>{pct(rc['made_money_pct'])} · {sgn(rc['avg_pct'])}</td><td class=m>same plan, same stocks and days; 5 random draws</td></tr>
{vrow("Close crosses the 200-day, no slope test", "bare_cross|plan", "what checks 2 and 3 add")}
</table>
{years()}
<p class="legend"><span class="sw" style="background:{RULE}"></span>200-day trend<span class="sw" style="background:{RAND}"></span>random
day above the 200-day average, same plan · each year's 300 most traded NSE stocks · 0.5% cost a trade</p>
<p>It did better than a random day in every year except 2020, 2021 and 2024, when it was level with it: a strong
market lifted every stock above its average. It helps most in uneven markets (2022, 2025, 2026). The regression
checks matter: without them, crossing the 200-day made money on {pct(V['bare_cross|plan']['2024_26']['made_money_pct'])} of trades in 2024–26.</p>
<div class="grid2">
<div><h3>By market weather on the signal day</h3>
<table><tr><th>Weather</th><th class=n>Trades</th><th class=n>Made money · avg</th></tr>
{''.join(f"<tr><td>{k.title()}</td><td class=n>{v['trades']:,}</td><td class=n>{pct(v['made_money_pct'])} · {sgn(v['avg_pct'])}</td></tr>" for k, v in sorted(wx.items(), key=lambda x: ['sunny','mixed','stormy'].index(x[0])))}
</table>
<p class="m">Unlike Strong trend it does not need a sunny market, so it keeps working when the Nifty is weak.</p></div>
<div><h3>How trades ended</h3>
<p>{100 - stopped}% reached the 60-session review and {stopped}% hit the safety stop. A trade lasts about
{a['avg_days']:.0f} sessions on average. Winners averaged {sgn(a['avg_win_pct'])} and losers {sgn(a['avg_loss_pct'])}: like
every trend rule it works because winners are bigger than losers, not because it is usually right.</p></div>
</div>

<h2>What else was tested</h2>
<p>48 versions were written down before any test was run, and one was chosen on 2019–23 by the rule used for the other
rules: the fewest losing trades, at least 150 a year, a positive average. The check years 2024–26 are reported for all.</p>
<table>
<tr><th>Version</th><th class=n>Trades<br>2019–23</th><th class=n>2019–23</th><th class=n>2024–26</th><th>Note</th></tr>
{vrow("Only a rising line", "turn_on|rising|N100|r0.5|plan", "almost the same")}
{vrow("Also “about to rise”", "turn_on|turning|N100|r0.5|plan", "turning up from a small fall: no better")}
{vrow("Line over 50 days", "turn_on|flat|N50|r0.5|plan", "fewer right in 2019–23, a little more in 2024–26")}
{vrow("No steady-climb check", "turn_on|flat|N100|any|plan", "check 3 adds about 5 points")}
{vrow("Sell when the trend turns", "turn_on|flat|N100|r0.5|trend", "big wins in 2020–23, mostly losers since (long trades still open are left out)")}
</table>
<p class="m">Also tried after the choice, and kept for the quarterly review rather than switched on: adding SMA 20/50
trend's market-leader filter made money on more trades in 2024–26 (about 50%) but fewer in 2019–23 (60%), so by the
rule fixed in advance it was not chosen.</p>

<div class="pb"></div>
<h2>Where it shows in the app</h2>
<ul>
<li><b>Signals</b> — a fifth rule card under “The five rules” with its health, its record on this site and its tested
record; its buys appear in Fresh buys and the signal list with a safety stop and a review date.</li>
<li><b>Self-checking</b> — every day its last 40 finished trades are compared with its tested rate (56 in 100), and every
losing trade is sorted by cause (the market fell, the stock fell, or a small loss). If it drifts outside its normal
range it is flagged for review; it is never changed or switched off on its own.</li>
<li><b>Stock page</b> — “Our rules now” and the plan tab show an open 200-day trend trade with its stop and review day;
the chart marks its buys and exits (tag “200D”).</li>
<li><b>Dry Run</b> — a “Long-term trend up” filter to try a plan built from its signals.</li>
<li><b>Admin</b> — its health sits with the other rules in the signal-checks review.</li>
</ul>
<h2>Checks done before going live</h2>
<ul>
<li>The database version and an independent Python version produced the same 666 signals (350 buys, 316 exits) on a
copy of the live prices.</li>
<li>Database tests (a stock that should fire, a bounce under a falling average that should not, a company outside the
500 largest), the full database suite, unit tests, and the app's screens at phone, tablet and desktop widths.</li>
</ul>
<h2>Limits</h2>
<ul>
<li>The rule needs 300 sessions of history (200 for the average, 100 for its line), so the test starts in March 2020
and a newly listed stock waits more than a year for its first signal.</li>
<li>2019–23 includes the strong 2020–21 rally; the honest guide is 2024–26: {pct(c['made_money_pct'])} made money, {sgn(c['avg_pct'])} a
trade, a small edge over a random day ({pct(rc['made_money_pct'])}, {sgn(rc['avg_pct'])}).</li>
<li>Tested on today's 500 largest companies, which flatters every rule a little; prices are end-of-day from Yahoo.</li>
<li>A note on the TradingView script: there <i>trend = sign(start − end)</i>, so a negative value means the line rises.
QuantsPulse uses the plain slope, where positive means rising.</li>
</ul>
<div class="foot">QuantsPulse signals are research prompts, not investment advice. Past results do not say what will happen.
Figures: research/strategies/improve_lr.py, record_lr.py; each year's 300 most traded NSE stocks; 0.5% round-trip cost.</div>
</body></html>"""

open(D / "report.html", "w", encoding="utf8").write(html)
print("report.html written")
