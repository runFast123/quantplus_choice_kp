"""Builds the owner report on the sixth rule, Secular trend (HTML -> data/report.html, printed to PDF by report_pdf.mjs).
Tested figures: record_secular.py (data/secular_record.json). Random-day yardstick: secular_trend.py ("random day below
-150, hold60", 2019-23 and 2024-26). Live trades: a read-only snapshot of public.signal_outcomes + signal_trades with each
stock's last stored close (data/secular_live_trades.json, 9 Nov 2026)."""
import json
from datetime import datetime, timedelta
from pathlib import Path

from report_html import CSS, sgn

D = Path(__file__).parent / "data"
R = json.load(open(D / "secular_record.json"))
LIVE = json.load(open(D / "secular_live_trades.json"))
GAIN, LOSS = "#0F7B5C", "#C2410C"                    # MASTER.md gain/loss marks (validated)
GAIN_INK, LOSS_INK, MUTED_INK = "#0B6A4E", "#A8380B", "#5E5A52"
# secular_trend.py, "random day below -150, hold60" (same plan, a random day on the same side of the line)
RANDOM = {"2019_23": (1645, 58.7, 10.21), "2024_26": (453, 34.2, -0.50)}
PENDING = [("KANSAINER", "Kansai Nerolac Paints", "Basic Materials"), ("DEVYANI", "Devyani International", "Consumer Cyclical")]   # signalled 6 Nov, buy at the 9 Nov open


def ist(s):
    return (datetime.fromisoformat(s.replace("Z", "+00:00")) + timedelta(hours=5, minutes=30)).date()


def d(x):
    return x.strftime("%d %b").lstrip("0")


def arrow(x):
    return "▲" if x > 0 else "▼" if x < 0 else ""


def signed(x, dp=1):
    ink = GAIN_INK if x > 0 else LOSS_INK if x < 0 else MUTED_INK
    return f'<span style="color:{ink}">{arrow(x)} {sgn(x, dp)}</span>'


# ---------------------------------------------------------------- yearly chart: average trade, by year
def yearly_chart(w=640, h=165):
    ys = R["yearly"]
    years = sorted(ys)
    lo, hi = -5, 15
    L, Rt, T, B = 30, 8, 26, 34
    bw = (w - L - Rt) / len(years)
    Y = lambda v: T + (hi - v) / (hi - lo) * (h - T - B)
    o = [f'<svg viewBox="0 0 {w} {h}" width="100%" role="img" aria-label="Average trade by year">',
         f'<text x="0" y="12" class="ct">Average trade after costs, by year</text>']
    for g in (-5, 0, 5, 10, 15):
        o.append(f'<line x1="{L}" x2="{w - Rt}" y1="{Y(g):.1f}" y2="{Y(g):.1f}" stroke="{"#8A8478" if g == 0 else "#E4DDCF"}" stroke-width="1"/>')
        lab = "0%" if g == 0 else f"{g:+d}%".replace("-", "−")
        o.append(f'<text x="{L - 4}" y="{Y(g) + 3:.1f}" text-anchor="end" class="na" style="font-style:normal">{lab}</text>')
    for i, yr in enumerate(years):
        v, n = ys[yr]["avg_pct"], ys[yr]["trades"]
        x = L + i * bw + bw * 0.22
        bwid = bw * 0.56
        top, bot = sorted((Y(v), Y(0)))
        o.append(f'<rect x="{x:.1f}" y="{top:.1f}" width="{bwid:.1f}" height="{max(bot - top, 1.5):.1f}" rx="3" fill="{GAIN if v >= 0 else LOSS}"/>')
        ly = top - 4 if v >= 0 else bot + 11
        o.append(f'<text x="{x + bwid / 2:.1f}" y="{ly:.1f}" text-anchor="middle" class="vl">{arrow(v)} {sgn(v)}</text>')
        label = {"2019": "2019*", "2026": "2026*"}.get(yr, yr)
        o.append(f'<text x="{x + bwid / 2:.1f}" y="{h - 18}" text-anchor="middle" class="rl">{label}</text>')
        o.append(f'<text x="{x + bwid / 2:.1f}" y="{h - 6}" text-anchor="middle" class="na" style="font-style:normal">{n} trades</text>')
    o.append("</svg>")
    return "".join(o)


def rec_row(name, r):
    return (f"<tr><td><b>{name}</b></td><td class=n>{r['trades']}</td><td class=n>{r['made_money_pct']:.0f} in 100</td>"
            f"<td class=n>{signed(r['avg_pct'])}</td><td class=n>{signed(r['avg_win_pct'], 0)} / {signed(r['avg_loss_pct'], 0)}</td>"
            f"<td class=n>{r['per_year']:.0f}</td></tr>")


def rand_row(name, k):
    n, made, avg = RANDOM[k]
    return (f'<tr><td class=o>{name}</td><td class=n>{n}</td><td class=n>{made:.0f} in 100</td><td class=n>{signed(avg)}</td>'
            f'<td class=n>—</td><td class=n>—</td></tr>')


# ---------------------------------------------------------------- live trades
rows, open_res, closed = [], [], []
for t in LIVE:
    entry, last = float(t["entry_price"]), float(t["last_close"])
    if t["result_pct"] is not None:
        res, state = float(t["result_pct"]), f"Closed {d(ist(t['exit_day']))} · safety stop"
        closed.append(res)
    else:
        res, state = (last / entry - 1) * 100, "Open"
        open_res.append(res)
    last_cell = "—" if t["result_pct"] is not None else f"₹{last:,.2f}"
    rows.append(f"<tr><td><b>{t['symbol']}</b> <span class=m>{t['name']}</span></td><td class=m>{t['sector']}</td>"
                f"<td class=n>{d(ist(t['sd']))}</td><td class=n>₹{entry:,.2f}</td><td class=n>₹{float(t['stop']):,.2f}</td>"
                f"<td class=n>{last_cell}</td><td class=n>{signed(res)}</td><td>{state}</td></tr>")
for sym, name, sector in PENDING:
    rows.append(f"<tr><td><b>{sym}</b> <span class=m>{name}</span></td><td class=m>{sector}</td><td class=n>6 Nov</td>"
                f"<td colspan=4 class=m>Buys at the 9 Nov open, so no price yet</td><td>Waiting</td></tr>")
last_day = d(ist(LIVE[0]["last_day"]))
up = sum(r > 0 for r in open_res)
tech = sum(t["sector"] == "Technology" for t in LIVE)
a, e, l = R["all"], R["2019_23"], R["2024_26"]
y20 = R["yearly"]["2020"]

html = f"""<!doctype html><html><head><meta charset="utf-8"><title>QuantsPulse Secular trend report</title>
<style>{CSS}
td:first-child {{ width: auto; }}
table.live td, table.live th {{ font-size: 8.2pt; padding: 3px 5px; }}
table.live td.m {{ font-size: 7.6pt; }}
</style></head><body>
<div class="eyebrow">QuantsPulse · research report · 9 November 2026</div>
<h1>Secular trend, the sixth rule</h1>
<p class="lead">Secular trend looks for a stock in a <b>deep, long slump that is starting to turn up</b>. It is the
owner's rule, built from Martin Pring's Special K. It was added to QuantsPulse on 9 November 2026 and worked out on the
stored prices, which gave its first signal on 15 October. This report says
what it does, how it did when tested on past prices, and how its first live trades are going. It is research, not advice.</p>

<div class="box"><b>In short.</b>
<ul>
<li>Tested on {a['trades']} past trades (Jul 2019 to Oct 2026): <b>{a['made_money_pct']:.0f} in 100 made money</b>,
{sgn(a['avg_pct'])} a trade after costs. Winners averaged {sgn(a['avg_win_pct'], 0)}, losers {sgn(a['avg_loss_pct'], 0)}.</li>
<li>Most of that came from the <b>2020 rebound</b> ({y20['trades']} of the {a['trades']} trades). From 2024 to
Oct 2026 it made money on <b>{l['made_money_pct']:.0f} in 100</b>, {sgn(l['avg_pct'])} a trade.</li>
<li>Live so far: {len(LIVE)} trades since 15 Oct. {up} of the {len(open_res)} open ones are up; the one that closed
lost {sgn(closed[0])}. That is far too few trades to judge yet.</li>
</ul></div>

<h2>How it works</h2>
<div class="grid2">
<div class="card"><h3>What it looks for</h3>
<p>The Secular trend line adds up how fast a stock's price has changed over 12 time spans, from 10 days up to about
two years. A value <b>below −150</b> means the stock has been falling for a long time.</p>
<p>A buy signal comes when the line <b>crosses above its signal line</b> (its 50-day average, averaged again over 50
days) while it is still below −150 and is not lower than it was 5 days ago.</p></div>
<div class="card"><h3>The plan</h3>
<p><b>Buy:</b> at the next day's opening price.</p>
<p><b>Safety stop:</b> 4 times the stock's normal daily move below the signal day's close. If the price falls there, the
trade ends.</p>
<p><b>Otherwise:</b> out on the 60th trading day. Only the 500 largest companies, one trade per stock at a time. This is
the same plan as the other trend rules, and the owner may change the exit later.</p></div>
</div>

<h2>Tested record</h2>
<table>
<tr><th>Period</th><th class=n>Trades</th><th class=n>Made money</th><th class=n>Average trade</th>
<th class=n>Avg win / avg loss</th><th class=n>Trades a year</th></tr>
{rec_row("Jul 2019 – Oct 2026", a)}
{rec_row("2019 – 2023", e)}
{rand_row("Random day below −150", "2019_23")}
{rec_row("2024 – Oct 2026", l)}
{rand_row("Random day below −150", "2024_26")}
</table>
<p class="m">"Made money" means the result after a 0.5% cost per trade was above zero. Each year's 300 most traded NSE
stocks. "Random day below −150" buys on a random day while the line is below −150 and uses the same plan: it shows how
much comes from the rule's signal and how much from simply buying a stock in a deep slump.</p>
{yearly_chart()}
<p class="m" style="margin-top:-2px">* 2019 starts in July and 2026 ends in October.</p>

<div class="pb"></div>
<h2>What the record tells us</h2>
<ul>
<li><b>The good years were the rebound.</b> 2020 alone gave {y20['trades']} trades at {sgn(y20['avg_pct'])} each. Deep
slumps were everywhere after the March 2020 crash, and almost everything bounced.</li>
<li><b>From 2019 to 2023 the signal did not beat a random day.</b> Buying any day below −150 did as well
({RANDOM['2019_23'][1]:.0f} in 100, {sgn(RANDOM['2019_23'][2])}). The deep slump did the work, not the cross.</li>
<li><b>From 2024 to Oct 2026 the signal did a little better than a random day:</b> {l['made_money_pct']:.0f} in 100 and
{sgn(l['avg_pct'])}, against {RANDOM['2024_26'][1]:.0f} in 100 and {sgn(RANDOM['2024_26'][2])}. The edge is small and rests
on {l['trades']} trades.</li>
<li><b>Most trades lose a little, a few win big.</b> From 2024 to Oct 2026 the middle trade lost {sgn(abs(l['median_pct']))[1:]}; the
average is positive because the winners ({sgn(l['avg_win_pct'], 0)}) are about twice the size of the losers.</li>
</ul>

<h2>Live trades so far</h2>
<table class="live">
<tr><th>Stock</th><th>Sector</th><th class=n>Signal</th><th class=n>Bought at</th><th class=n>Safety stop</th><th class=n>Last close</th>
<th class=n>Result</th><th>State</th></tr>
{''.join(rows)}
</table>
<p class="m">Last close is {last_day} 2026. Open results are before costs and change every day; a 60-day trade is not
finished until the stop or the 60th day.</p>
<ul>
<li><b>{tech} of the {len(LIVE)} trades are technology companies.</b> They tend to rise and fall together, so this is
closer to one bet on IT than to {len(LIVE)} separate bets.</li>
<li>The rule's health check on the Signals page shows "too few trades" until 40 trades have finished. At about 30 trades
a year, that will take more than a year.</li>
</ul>

<h2>Limits</h2>
<ul>
<li>It needs about 3.3 years of prices before its signal line has a value, so the app has no Secular trend signals
before 15 Oct 2026 and no chart history for it yet.</li>
<li>The test used dividend-adjusted prices; the app uses split-adjusted prices, so the line can differ slightly.</li>
<li>Prices are end-of-day from Yahoo Finance. Tested on today's 500 largest companies, which flatters every rule a little.</li>
</ul>
<div class="foot">QuantsPulse signals are research prompts, not investment advice. Past results do not say what will happen.
Figures: research/strategies/record_secular.py and secular_trend.py; live trades from the QuantsPulse database, 9 Nov 2026.</div>
</body></html>"""

open(D / "report.html", "w", encoding="utf8").write(html)
print("report.html written")
