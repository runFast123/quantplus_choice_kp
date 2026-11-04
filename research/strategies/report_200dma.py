"""Owner report (2026-11-04): a plain 200-day moving average trade vs QuantsPulse's 200-day trend, two pages.
Numbers from compare_200dma.py (SMA, stop on the close) and record_ema.py (the EMA version the owner chose).
Writes data/report.html; report_pdf.mjs prints it."""
import json
from pathlib import Path

from report_html import CSS, sgn

D = Path(__file__).parent / "data"
C = json.load(open(D / "compare_200dma.json"))
E = json.load(open(D / "record_ema.json"))
SRC = json.load(open(D / "compare_sources.json"))
OURS, PLAIN, EMA = "#2B6CB0", "#B7791F", "#7A7568"   # validated pair (dataviz, light, on #F4EFE4) + a neutral


def day(d):
    import datetime as dt
    return dt.date.fromisoformat(d).strftime("%d %b %Y").lstrip("0")


def src_cell(key):
    r = SRC[key]["2024_26"]
    return f"<td class=n><b>{r['made_money_pct']:.0f}</b> in 100 · {lakh(r['avg_pct'])}</td>"


def lakh(x):
    v = round(1000 * x)                                  # avg_pct x ₹1,00,000 / 100
    return f"{'+' if v > 0 else '−' if v < 0 else ''}₹{abs(v):,}"


def col(s):
    return (f"<td class=n>{s['per_year']}</td><td class=n><b>{s['made_money_pct']:.0f}</b> in 100</td>"
            f"<td class=n><b>{lakh(s['avg_pct'])}</b></td><td class=n>{sgn(s['avg_win_pct'])} / {sgn(s['avg_loss_pct'])}</td>"
            f"<td class=n>{s['avg_days']} days</td>")


def bars(rows, title, w=640):
    """Made money in 100 trades, 2024-26: one bar each, direct labels."""
    left, row = 250, 30
    h = 24 + row * len(rows)
    x = lambda v: left + v / 100 * (w - left - 60)
    out = [f'<svg viewBox="0 0 {w} {h}" width="100%" role="img" aria-label="{title}"><text x="0" y="14" class="ct">{title}</text>']
    for i, (name, v, color) in enumerate(rows):
        y = 26 + i * row
        out.append(f'<text x="{left - 10}" y="{y + 13}" text-anchor="end" class="rl">{name}</text>')
        out.append(f'<rect x="{left}" y="{y + 2}" width="{x(v) - left:.1f}" height="14" rx="2" fill="{color}"/>')
        out.append(f'<text x="{x(v) + 6:.1f}" y="{y + 13}" class="vl">{v:.0f} in 100</text>')
    out.append("</svg>")
    return "".join(out)


p, o, e = C["plain"], C["ours"], E["ours"]
rnd = C["random_close_stop"]
low = C["ours_low_stop"]
ex = C["examples"]["SUZLON"]
share = round(100 * C["ours_only"]["trades"] / (C["ours_only"]["trades"] + C["ours_shared"]["trades"]))

html = f"""<!doctype html><html><head><meta charset="utf-8"><title>Plain 200-day average vs 200-day trend</title>
<style>{CSS} .big {{ font-size: 15pt; font-family: Georgia, serif; }} .two {{ display: grid; grid-template-columns: 1fr 1fr; gap: 10px 16px; }} th:first-child, td:first-child {{ width: 230px; }}
.trades {{ margin: 0; padding: 0; list-style: none; }} .trades li {{ margin: 0 0 1px; }}</style></head><body>
<div class="eyebrow">QuantsPulse · comparison · 4 November 2026</div>
<h1>A plain 200-day average vs our 200-day trend</h1>
<p class="lead">A plain 200-day average trade buys every time the price crosses above the average and sells every time it
crosses back. Our 200-day trend buys only when the price is above the average <b>and</b> the regression line of that average
is flat or rising, then holds with a safety stop. On the same stocks and years, the plain trade lost money and ours made it.</p>

<div class="two">
<div class="box"><span class="m">Plain 200-day average, 2024–26</span><br><span class="big">{p['2024_26']['made_money_pct']:.0f} in 100</span> trades made money<br>
<b>{lakh(p['2024_26']['avg_pct'])}</b> per ₹1 lakh traded, after costs</div>
<div class="box"><span class="m">Our 200-day trend, 2024–26</span><br><span class="big">{o['2024_26']['made_money_pct']:.0f} in 100</span> trades made money<br>
<b>{lakh(o['2024_26']['avg_pct'])}</b> per ₹1 lakh traded, after costs</div>
</div>

<h2>Profit and loss, trade by trade</h2>
<table>
<tr><th>Way of trading</th><th class=n>Trades a year</th><th class=n>Made money</th><th class=n>Profit per<br>₹1 lakh a trade</th>
<th class=n>Avg win / avg loss</th><th class=n>Held</th></tr>
<tr><td colspan=6 class="m"><b>2024 – Oct 2026</b> — years none of these were designed on</td></tr>
<tr><td>Plain 200-day average</td>{col(p['2024_26'])}</tr>
<tr><td><b>Our 200-day trend</b> (simple average + its line + steady climb)</td>{col(o['2024_26'])}</tr>
<tr><td>Our trend with an EMA, no steady-climb check</td>{col(e['2024_26'])}</tr>
<tr><td class="m">Buying on a random day above the average, our plan</td>{col(rnd['2024_26'])}</tr>
<tr><td colspan=6 class="m"><b>2019 – Oct 2026</b> — all years (each rule from its first possible signal)</td></tr>
<tr><td>Plain 200-day average</td>{col(p['all'])}</tr>
<tr><td><b>Our 200-day trend</b></td>{col(o['all'])}</tr>
<tr><td>Our trend with an EMA, no steady-climb check</td>{col(e['all'])}</tr>
</table>
<p class="m">Each year's 300 most traded NSE stocks; buy at the next morning's price; 0.5% cost on every trade; every trade
counted. The plain trade's 2020–23 average is lifted by a few huge winners in the 2020–21 rally: 4 in 5 of its trades
still lost.</p>
{bars([("Plain 200-day average", p['2024_26']['made_money_pct'], PLAIN),
       ("Our trend, EMA, no steady-climb check", e['2024_26']['made_money_pct'], EMA),
       ("Random day above the average", rnd['2024_26']['made_money_pct'], EMA),
       ("Our 200-day trend", o['2024_26']['made_money_pct'], OURS)], "Trades that made money, 2024–26")}

<div class="pb"></div>
<h2>Why ours does better</h2>
<ul>
<li><b>It ignores the false starts.</b> The plain trade buys about {p['2024_26']['per_year']} times a year, mostly when the price
pokes above a falling average and drops back days later: {100 - p['2024_26']['made_money_pct']:.0f} in 100 of those trades lose.
Ours skips every cross while the average's line points down.</li>
<li><b>It catches turns the plain trade misses.</b> {share} in 100 of our buys come on a day the plain trade does not buy:
the price is already above the average and the line has just turned flat or up.</li>
<li><b>It gives a trade room.</b> The plain trade is sold on the first close under the average (held {p['2024_26']['avg_days']}
days on average lately); ours holds up to 60 sessions unless the safety stop is broken on a close.</li>
</ul>

<h2>The stop counts on the close</h2>
<p>The safety stop sits 4 times the stock's normal daily move under the buy price. A trade is sold only when a day
<b>closes</b> at or under it, at that close. A day that dips under the stop and closes back above it is not a loss: the
trade carries on. Over the seven years this kept {C['saved_by_close_stop']} trades alive that a stop on the day's low would
have sold, and lifted 2024–26 from {low['2024_26']['made_money_pct']:.0f} to {o['2024_26']['made_money_pct']:.0f} in 100 trades
making money ({lakh(low['2024_26']['avg_pct'])} to {lakh(o['2024_26']['avg_pct'])} per ₹1 lakh).</p>

<h2>One stock: SUZLON since 2024</h2>
<table>
<tr><th>Plain 200-day average</th><th>Our 200-day trend</th></tr>
<tr><td><ul class="trades">{''.join(f"<li>Bought {day(d)}: <b>{sgn(x)}</b></li>" for d, x in ex['plain'])}</ul></td>
<td><ul class="trades">{''.join(f"<li>Bought {day(d)}: <b>{sgn(x)}</b> ({'60-session review' if h == 'REVIEW' else 'stop on a close'})</li>" for d, x, h in ex['ours'])}</ul></td></tr>
</table>
<p class="m">The plain trade bought six crosses and lost on all six; ours bought twice and held the July 2024 run.</p>

<h2>What to keep in mind</h2>
<ul>
<li>Our trend wins about half its trades; it makes money because winners (about {sgn(o['all']['avg_win_pct'], 0)}) are bigger
than losers (about {sgn(o['all']['avg_loss_pct'], 0)}).</li>
<li>With an EMA and no steady-climb check it gives more signals ({e['2024_26']['per_year']} a year) but in 2024–26 it broke
about even and did worse than a random day above the average; the simple average with the steady-climb check did best.</li>
<li>Tested on past prices; not a promise. Research, not advice.</li>
</ul>
<div class="pb"></div>
<h2>Built on the close, the high or the low?</h2>
<p>A moving average can be built on each day's closing price, its high or its low. We ran every version on all three.
The buy and the safety stop still use the close.</p>
<table>
<tr><th>Way of trading (2024 – Oct 2026)</th><th class=n>Average on the close</th><th class=n>On the high</th><th class=n>On the low</th></tr>
{''.join(f"<tr><td>{name}</td>" + ''.join(src_cell(f'{src}|{key}') for src in ('close', 'high', 'low')) + "</tr>" for name, key in (("Plain 200-day SMA", "plain SMA"), ("Plain 200-day EMA", "plain EMA"), ("<b>Our trend, SMA + steady climb</b>", "ours SMA"), ("Our trend, EMA (live choice)", "ours EMA")))}
</table>
<p class="m">Each cell: trades that made money · profit per ₹1 lakh a trade, after costs. All years (2019 – Oct 2026):
{'; '.join(f"{n} {SRC[f'close|{k}']['all']['made_money_pct']:.0f} / {SRC[f'high|{k}']['all']['made_money_pct']:.0f} / {SRC[f'low|{k}']['all']['made_money_pct']:.0f} in 100 (close / high / low)" for n, k in (("our SMA trend", "ours SMA"), ("our EMA trend", "ours EMA")))}.</p>
<ul>
<li><b>The plain trades lose on every price</b>: the false starts come from crossing a falling average, whichever price builds it.</li>
<li><b>Our SMA trend hardly changes</b> ({SRC['close|ours SMA']['2024_26']['made_money_pct']:.0f}, {SRC['high|ours SMA']['2024_26']['made_money_pct']:.0f} and
{SRC['low|ours SMA']['2024_26']['made_money_pct']:.0f} in 100): the regression line and the steady-climb check do the work.</li>
<li><b>Our EMA trend does best on the high</b> ({SRC['high|ours EMA']['2024_26']['made_money_pct']:.0f} in 100, {lakh(SRC['high|ours EMA']['2024_26']['avg_pct'])}
instead of {lakh(SRC['close|ours EMA']['2024_26']['avg_pct'])} on the close): an average of the highs sits higher, so the close
has to clear more before it buys. It is still behind the SMA trend.</li>
</ul>
<div class="foot">Figures: research/strategies/compare_200dma.py, record_ema.py and compare_sources.py. QuantsPulse signals are research prompts, not investment advice.</div>
</body></html>"""

open(D / "report.html", "w", encoding="utf8").write(html)
print("report.html written")
