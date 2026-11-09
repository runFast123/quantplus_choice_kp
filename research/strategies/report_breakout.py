"""Owner report, simple: Secular trend without and with the breakout rule, side by side (HTML -> data/report.html,
printed to PDF by report_pdf.mjs). Every number comes from breakout_secular.py (data/secular_breakout.json): 'without' is
the rule as it is now, 'with' is the main test (a close above the signal day's high within 10 trading days)."""
import json
from pathlib import Path

from report_html import CSS, sgn

D = Path(__file__).parent / "data"
R = json.load(open(D / "secular_breakout.json"))
GAIN, LOSS = "#0F7B5C", "#C2410C"
GAIN_INK, LOSS_INK, MUTED_INK = "#0B6A4E", "#A8380B", "#5E5A52"
WITHOUT, WITH = "#8A8478", "#2B6CB0"
A, B = R["rule_now"], R["confirm_10"]


def arrow(x):
    return "▲" if x > 0 else "▼" if x < 0 else ""


def signed(x, dp=1):
    ink = GAIN_INK if x > 0 else LOSS_INK if x < 0 else MUTED_INK
    return f'<span style="color:{ink}">{arrow(x)} {sgn(x, dp)}</span>'


STAKE = 10_000


def total(r):
    """Profit after costs if ₹10,000 went into every trade."""
    return r["trades"] * r["avg_pct"] / 100 * STAKE


def inr(n):
    """Indian grouping: 3,07,350."""
    s = f"{abs(round(n)):d}"
    head, tail = s[:-3], s[-3:]
    while len(head) > 2:
        tail = head[-2:] + "," + tail
        head = head[:-2]
    body = (head + "," + tail) if head else tail
    return f"{'+' if n > 0 else '−' if n < 0 else ''}₹{body}"


def money(n):
    ink = GAIN_INK if n > 0 else LOSS_INK if n < 0 else MUTED_INK
    return f'<span style="color:{ink}">{arrow(n)} {inr(n)}</span>'


def verdict(better: bool | None):
    word, ink = {True: ("Better", GAIN_INK), False: ("Worse", LOSS_INK), None: ("About the same", MUTED_INK)}[better]
    return f'<span style="color:{ink};font-weight:600">{word}</span>'


def compare(period, title):
    a, b = A[period], B[period]
    same = lambda x, y, tol: None if abs(x - y) <= tol else y > x
    rows = [
        ("Trades", f"{a['trades']}", f"{b['trades']}", f'<span style="color:{MUTED_INK}">{a["trades"] - b["trades"]} fewer</span>'),
        ("Trades that made money", f"{a['made_money_pct']:.0f} in 100", f"{b['made_money_pct']:.0f} in 100",
         verdict(same(a["made_money_pct"], b["made_money_pct"], 2))),
        ("Average result per trade", signed(a["avg_pct"]), signed(b["avg_pct"]), verdict(same(a["avg_pct"], b["avg_pct"], 0.3))),
        ("Middle trade (half did better)", signed(a["median_pct"]), signed(b["median_pct"]),
         verdict(same(a["median_pct"], b["median_pct"], 0.3))),
        ("Profit with ₹10,000 in every trade", money(total(a)), money(total(b)), verdict(same(total(a), total(b), 1000))),
    ]
    body = "".join(f"<tr><td>{n}</td><td class=n>{x}</td><td class=n><b>{y}</b></td><td>{v}</td></tr>" for n, x, y, v in rows)
    return (f'<h2>{title}</h2><table class="cmp"><tr><th></th><th class=n>Without</th><th class=n>With breakout rule</th>'
            f"<th>Change</th></tr>{body}</table>")


def bars(w=640):
    left, right, row = 190, 70, 46
    h = 28 + row * 2
    hi = max(A["2019_23"]["avg_pct"], B["2019_23"]["avg_pct"], A["2024_26"]["avg_pct"], B["2024_26"]["avg_pct"]) * 1.1
    X = lambda v: left + v / hi * (w - left - right)
    o = [f'<svg viewBox="0 0 {w} {h}" width="100%" role="img" aria-label="Average result per trade, without and with">',
         '<text x="0" y="12" class="ct">Average result per trade, after costs</text>']
    for i, (per, name) in enumerate((("2024_26", "2024 – Oct 2026"), ("2019_23", "2019 – 2023"))):
        y = 24 + i * row
        o.append(f'<text x="{left - 10}" y="{y + 20}" text-anchor="end" class="rl">{name}</text>')
        for j, (src, color, lab) in enumerate(((A, WITHOUT, "without"), (B, WITH, "with"))):
            v = src[per]["avg_pct"]
            yy = y + 4 + j * 18
            o.append(f'<rect x="{left}" y="{yy}" width="{max(X(v) - left, 1.5):.1f}" height="14" rx="3" fill="{color}"/>')
            o.append(f'<text x="{X(v) + 6:.1f}" y="{yy + 11}" class="vl">{arrow(v)} {sgn(v)} {lab}</text>')
    o.append("</svg>")
    return "".join(o)


skip = round(10 * (1 - B["2024_26"]["trades"] / A["2024_26"]["trades"]))

html = f"""<!doctype html><html><head><meta charset="utf-8"><title>QuantsPulse Secular trend breakout rule</title>
<style>{CSS}
table.cmp td, table.cmp th {{ font-size: 10pt; padding: 6px 8px; }}
table.cmp td:first-child {{ width: 210px; }}
.big {{ font-size: 11pt; }}
</style></head><body>
<div class="eyebrow">QuantsPulse · research report · 9 November 2026</div>
<h1>Secular trend: with and without the breakout rule</h1>
<p class="lead"><b>The breakout rule</b> (your idea): after a Secular trend signal, don't buy straight away. Wait for a
day that <b>closes above the signal day's high</b>, then buy the next morning. If that doesn't happen within 10 trading
days, or the price falls to the safety stop first, skip the trade.</p>

<div class="box big"><b>The answer in one line:</b> in recent years the breakout rule made each trade a little better,
but it did not make the rule right more often, it skipped about {skip} in 10 signals, and with so few trades the
difference could be luck. <b>We suggest keeping the rule as it is for now</b> and checking again as live trades finish.</div>

{compare("2024_26", "Recent years: 2024 – Oct 2026")}
{compare("2019_23", "Earlier years: 2019 – 2023")}

{bars()}

<h2>What it means</h2>
<ul>
<li><b>Recent years:</b> fewer trades, a little better each ({sgn(A['2024_26']['avg_pct'])} becomes
{sgn(B['2024_26']['avg_pct'])}), but still only about 4 in 10 made money.</li>
<li><b>Earlier years:</b> no real difference per trade, and less money in total ({inr(total(B['2019_23']))} instead of
{inr(total(A['2019_23']))} with ₹10,000 a trade), because it skipped good trades too.</li>
<li><b>Too few trades to be sure.</b> {B['2024_26']['trades']} recent trades is not enough to tell a real improvement from
luck. Waiting for a strong close also helped random buys in the same kind of slump, so it is not special to this rule.</li>
</ul>
<div class="foot">How it was tested: the same past prices and stocks as the rule's own record (each year's 300 most traded
NSE stocks, July 2019 to October 2026), the same safety stop and 60-day exit, a 0.5% cost on every trade, nothing tuned on
the results. Waiting 5, 20 or 60 days instead of 10 gave much the same answer. Figures: research/strategies/
breakout_secular.py. QuantsPulse signals are research prompts, not investment advice.</div>
</body></html>"""

open(D / "report.html", "w", encoding="utf8").write(html)
print("report.html written")
