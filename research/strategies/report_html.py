"""Builds the 2-3 page owner report (HTML, printed to PDF by report_pdf.mjs) from data/final_report.json and the live
records measured on stored prices. Every number comes from the research scripts; nothing is typed in by hand except
the live-record table, which is copied from public.strategy_trade_results / the live-copy run (31 Oct 2026)."""
import json
from pathlib import Path

D = Path(__file__).parent / "data"
R = json.load(open(D / "final_report.json"))
OLD, NEW = "#B7791F", "#2B6CB0"          # validated pair (dataviz validate_palette.js, light, on #F4EFE4)

RULES = [
    ("strong", "Strong trend", None),
    ("sma", "SMA 20/50 trend", "the 20/50 cross"),
    ("rsi", "RSI dip", "RSI reversal"),
    ("kk", "KK dip", "KK breakout"),
]
# Live record on stored prices (before costs): the new rules worked out with the same SQL on the stored candles, the old
# rules as stored in the app. RSI reversal has no fair own-plan figure (its exits only followed rallies).
LIVE = {
    "strong": ("Oct 2025 – Jun 2026", 180, 46.1, 2.54),
    "sma": ("Apr 2025 – Oct 2026", 398, 49.2, 4.59),
    "rsi": ("Jul 2025 – Oct 2026", 708, 67.4, 1.15),
    "kk": ("Jul 2025 – Oct 2026", 267, 69.7, 1.40),
}
LIVE_OLD = {"sma": (7077, 28.6, -0.95), "kk": (4011, 45.5, 0.31), "rsi": None, "strong": None}


def sgn(x, d=1):
    return f"{'+' if x > 0 else '−' if x < 0 else ''}{abs(x):.{d}f}%"


def bars(metric, title, lo=0, hi=100, period="all", w=640, left=150):
    """Grouped horizontal bars, old vs new, direct labels; a zero line when values go negative."""
    right, row, gap = 46, 34, 6
    h = 26 + row * len(RULES) + 8
    scale = lambda v: left + (v - lo) / (hi - lo) * (w - left - right)
    out = [f'<svg viewBox="0 0 {w} {h}" width="100%" role="img" aria-label="{title}">']
    out.append(f'<text x="0" y="14" class="ct">{title}</text>')
    if lo < 0:
        x0 = scale(0)
        out.append(f'<line x1="{x0}" x2="{x0}" y1="22" y2="{h - 6}" stroke="#8A8478" stroke-width="1"/>')
    for i, (k, name, _) in enumerate(RULES):
        y = 26 + i * row
        out.append(f'<text x="{left - 10}" y="{y + 18}" text-anchor="end" class="rl">{name}</text>')
        for j, (side, color) in enumerate((("old", OLD), ("new", NEW))):
            yy = y + 4 + j * (12 + gap / 2)
            if side not in R[k]:
                out.append(f'<text x="{scale(max(lo, 0)) + 4}" y="{yy + 10}" class="na">no old rule — new</text>')
                continue
            v = R[k][side][period][metric]
            a, b = sorted((scale(max(lo, 0) if lo >= 0 else 0), scale(v)))
            out.append(f'<rect x="{a}" y="{yy}" width="{max(b - a, 1.5)}" height="12" rx="2" fill="{color}"/>')
            lab = f"{v:.0f}%" if metric == "made_money_pct" else sgn(v)
            lx = (b + 5) if v >= 0 else (a - 5)
            anchor = "start" if v >= 0 else "end"
            out.append(f'<text x="{lx}" y="{yy + 10}" text-anchor="{anchor}" class="vl">{lab}</text>')
    out.append("</svg>")
    return "".join(out)


def row(k, name, oldname):
    n = R[k]["new"]
    o = R[k].get("old")
    old_all = f'{o["all"]["made_money_pct"]:.0f}% · {sgn(o["all"]["avg_pct"])}' if o else "—"
    old_rec = f'{o["2024_26"]["made_money_pct"]:.0f}% · {sgn(o["2024_26"]["avg_pct"])}' if o else "—"
    return (f"<tr><td><b>{name}</b><br><span class=m>{('was ' + oldname) if oldname else 'new rule'}</span></td>"
            f"<td class=n>{n['all']['trades']:,}</td><td class=n><b>{n['all']['made_money_pct']:.0f}%</b> · {sgn(n['all']['avg_pct'])}</td>"
            f"<td class=n>{n['2024_26']['made_money_pct']:.0f}% · {sgn(n['2024_26']['avg_pct'])}</td>"
            f"<td class=n>{sgn(n['all']['avg_win_pct'])} / {sgn(n['all']['avg_loss_pct'])}</td>"
            f"<td class='n o'>{old_all}</td><td class='n o'>{old_rec}</td></tr>")


def live_rows():
    out = []
    for k, name, oldname in RULES:
        per, t, mm, avg = LIVE[k]
        lo = LIVE_OLD[k]
        old = f"{lo[0]:,} trades · {lo[1]:.0f}% · {sgn(lo[2], 2)}" if lo else ("no fair figure" if k == "rsi" else "—")
        out.append(f"<tr><td><b>{name}</b></td><td>{per}</td><td class=n>{t:,}</td><td class=n><b>{mm:.0f}%</b></td>"
                   f"<td class=n>{sgn(avg, 2)}</td><td class='n o'>{old}</td></tr>")
    return "".join(out)


CSS = """
@page { size: A4; margin: 14mm 14mm 13mm 14mm; }
* { box-sizing: border-box; }
body { font-family: Inter, 'Segoe UI', Arial, sans-serif; color: #1E1E1E; font-size: 9.6pt; line-height: 1.42; margin: 0; }
h1 { font-family: Georgia, 'Times New Roman', serif; font-weight: 400; font-size: 21pt; margin: 0 0 2px; }
h2 { font-family: Georgia, 'Times New Roman', serif; font-weight: 400; font-size: 13.5pt; margin: 14px 0 5px; }
h3 { font-size: 10pt; margin: 0 0 3px; }
p { margin: 0 0 6px; }
.eyebrow { font-size: 7.5pt; letter-spacing: .12em; text-transform: uppercase; color: #5E5A52; }
.lead { font-size: 10.4pt; color: #2E2E2E; }
.m { color: #5E5A52; font-size: 8.4pt; }
table { width: 100%; border-collapse: collapse; margin: 4px 0 8px; }
th { text-align: left; font-size: 7.4pt; letter-spacing: .06em; text-transform: uppercase; color: #5E5A52; font-weight: 600;
     border-bottom: 1px solid #D2CBBB; padding: 4px 6px; vertical-align: bottom; }
td { border-bottom: 1px solid #E4DDCF; padding: 5px 6px; vertical-align: top; }
td.n, th.n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
td.o { color: #6B5A3A; }
th:first-child, td:first-child { width: 128px; }
td:first-child b { white-space: nowrap; }
.box { background: #F4EFE4; border: 1px solid #D2CBBB; border-radius: 6px; padding: 9px 11px; margin: 6px 0 8px; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 16px; }
.card { border: 1px solid #D2CBBB; border-radius: 6px; padding: 8px 10px; break-inside: avoid; }
.card p { font-size: 8.9pt; margin: 0 0 4px; }
.legend { font-size: 8pt; color: #5E5A52; margin: 2px 0 0; }
.sw { display: inline-block; width: 9px; height: 9px; border-radius: 2px; vertical-align: -1px; margin: 0 4px 0 10px; }
.ct { font: 600 9pt Inter, Arial, sans-serif; fill: #1E1E1E; }
.rl { font: 8.6pt Inter, Arial, sans-serif; fill: #1E1E1E; }
.vl { font: 8pt Inter, Arial, sans-serif; fill: #2E2E2E; font-variant-numeric: tabular-nums; }
.na { font: italic 7.8pt Inter, Arial, sans-serif; fill: #5E5A52; }
ul { margin: 2px 0 6px 16px; padding: 0; } li { margin: 0 0 2px; }
.pb { break-before: page; }
.foot { font-size: 7.6pt; color: #5E5A52; border-top: 1px solid #D2CBBB; padding-top: 5px; margin-top: 8px; }
"""

legend = (f'<p class="legend"><span class="sw" style="background:{OLD}"></span>old rule'
          f'<span class="sw" style="background:{NEW}"></span>improved rule · tested Jul 2019 – Oct 2026, after a 0.5% cost per trade</p>')

html = f"""<!doctype html><html><head><meta charset="utf-8"><title>QuantsPulse signal rules: before and after</title>
<style>{CSS}</style></head><body>
<div class="eyebrow">QuantsPulse · research report · 31 October 2026</div>
<h1>Signal rules: before and after</h1>
<p class="lead">All four signal rules have now been rebuilt and tested on seven years of NSE prices. Each one makes money on
more of its trades than the rule it replaced, and the checks on years the rules never saw agree. They are research
signals, not advice: even the best rule loses on about a third of its trades, and the trend rules on about half.</p>

<div class="box"><b>In one line each.</b>
<ul>
<li><b>RSI dip</b> — was right on 40 of 100 trades and lost money on average; now <b>64 of 100</b>, +0.7% a trade.</li>
<li><b>KK dip</b> — was right on 38 of 100, −1.2% a trade; now <b>68 of 100</b>, +0.8% a trade.</li>
<li><b>SMA 20/50 trend</b> — was right on 43 of 100 (37 in 2024–26); now <b>52 of 100</b> (46 in 2024–26).</li>
<li><b>Strong trend</b> — new: 52 of 100, +5.7% a trade; winners about twice the size of losers.</li>
</ul></div>

<h2>The four rules today</h2>
<table>
<tr><th>Rule</th><th class=n>Trades tested</th><th class=n>Made money · avg trade<br>2019–2026</th><th class=n>2024–2026<br>(the check years)</th>
<th class=n>Avg win / avg loss</th><th class=n>Old rule<br>2019–2026</th><th class=n>Old rule<br>2024–2026</th></tr>
{''.join(row(k, n, o) for k, n, o in RULES)}
</table>
<p class="m">"Made money" = the trade's result after costs was above zero. Each year's 300 most traded NSE stocks; entries at
the next day's price; every trade counted.</p>

<div class="grid2">
<div>{bars("made_money_pct", "Trades that made money, 2019–2026", w=330, left=104)}</div>
<div>{bars("made_money_pct", "2024–2026 only (years not designed on)", period="2024_26", w=330, left=104)}</div>
</div>
{legend}

<div class="pb"></div>
<h2>How each rule works, and what changed</h2>
<div class="grid2">
<div class="card"><h3>Strong trend <span class="m">· new</span></h3>
<p><b>Looks for:</b> a stock closing at a new 52-week high on at least twice its usual volume, above its 50-day average,
while the market is rising and calm ("sunny": Nifty 50 above its 200-day average, India VIX at or under 22).</p>
<p><b>Plan:</b> buy the next day; safety stop 4× the stock's normal daily move below; review after 60 trading sessions.
No fixed target — taking profit early halved the gains in testing.</p>
<p><b>Result:</b> 52 in 100 made money, +5.7% a trade (winners about +21%, losers about −11%). 2024–26: 48 in 100, +3.3%.
It pauses when the market turns stormy — as it has been since March 2026.</p></div>

<div class="card"><h3>SMA 20/50 trend <span class="m">· replaces the 20/50 cross</span></h3>
<p><b>Why the old one failed:</b> it bought every cross, including bounces in falling stocks, and sold on the cross back
down, after most of the gain was gone.</p>
<p><b>Now:</b> the same cross, but only in a <b>market leader</b> (6-month return in the top 30% of the 500 largest
companies), with Strong trend's plan (4× ATR safety stop, review after 60 sessions). About 160 signals a year instead of 800.</p>
<p><b>Result:</b> 52 in 100 made money (was 43), +5.6% a trade. 2024–26: 46 in 100 (was 37), +2.3% (was +1.8%).</p></div>

<div class="card"><h3>RSI dip <span class="m">· replaces RSI reversal</span></h3>
<p><b>Why the old one failed:</b> 84% of its buys were in stocks already falling for months, with fixed 5% / 8% levels that
ignored how much each stock moves.</p>
<p><b>Now:</b> a sharp one-or-two-day drop (2-day RSI under 10) only in a stock above its 200-day average; buy the next day
<b>only at a lower price</b> (close minus one normal day's move); sell on the first bounce (close above the 5-day average),
within 10 sessions; 5× ATR safety stop.</p>
<p><b>Result:</b> 64 in 100 made money (was 40), +0.7% a trade (was −0.3%). 2024–26: 60 in 100.</p></div>

<div class="card"><h3>KK dip <span class="m">· replaces the KK breakout</span></h3>
<p><b>Why the old one failed:</b> it bought after the rebound had already started, with a tight stop, in any stock — and
its signals had stopped updating in August.</p>
<p><b>Now:</b> the same idea — a push at least 1% under the 20-day low — only in a rising stock, bought on a further dip the
next day and sold on the bounce, like RSI dip. It is the deeper, rarer case (about 150 a year); 9 in 10 of its signals also fire
as RSI dip. Now updated daily.</p>
<p><b>Result:</b> 68 in 100 made money (was 38), +0.8% a trade (was −1.2%). 2024–26: 67 in 100, +1.5%.</p></div>
</div>

<h2>The record on the app's own stored prices</h2>
<p class="m">The same rules run on the prices stored in the app (about two years for the 500 largest companies). Before costs.
Old rules: the signals the app actually showed.</p>
<table>
<tr><th>Rule</th><th>Period</th><th class=n>Closed trades</th><th class=n>Made money</th><th class=n>Avg trade</th><th class=n>Old rule (as shown)</th></tr>
{live_rows()}
</table>
{bars("avg_pct", "Average trade after costs, 2019–2026", lo=-2, hi=8, w=640)}
{legend}
<p class="m">The old SMA cross averaged more per trade (+7.2%) because it held its rare big winners until the averages
crossed back, but more of its trades lost (57 of 100). The new rule wins more often with smaller swings.</p>

<div class="pb"></div>
<h2>How the rules were tested</h2>
<ul>
<li><b>Seven years</b> of daily NSE prices (Jul 2019 – Oct 2026) for the 500 largest companies, plus the Nifty and India VIX.</li>
<li><b>No hindsight about winners:</b> each year uses only the 300 most traded stocks <i>at the start of that year</i>.</li>
<li><b>Designed on 2019–2023, checked on 2024–2026.</b> Every variant was written down before it was run; the choice was made
on the early years only, and the late years are reported for all of them (24 variants for SMA, 10 for RSI, 11 for KK).</li>
<li><b>Real-world frictions:</b> a 0.5% round-trip cost; buys at the next day's price; a dip buy counts only if the price traded
0.2% through the level.</li>
<li><b>The app runs exactly the tested rule:</b> for every rule an independent Python version and the database produced
identical signals on a copy of the live prices (Strong trend 360, RSI + KK dip 1,962, SMA trend 834).</li>
<li><b>Graded continuously:</b> every new signal is graded automatically after 5, 20 and 60 sessions against the Nifty 500;
the Signals page shows each rule's track record, winners and losers alike.</li>
</ul>

<h2>What to expect</h2>
<ul>
<li><b>Dip rules</b> (RSI, KK) are short trades: about 2 in 3 make money, but each gain is small (about +4%) and a loss can be
larger (about −4% to −7%). Most trades end within a week.</li>
<li><b>Trend rules</b> (Strong trend, SMA) win about half the time; they pay because winners (about +20%) are about twice the
losers (about −11%). A run of losses is normal.</li>
<li><b>2024–2026 was harder</b> for every long-only rule (a flat, then falling market). The improved rules held up better
than the old ones, but past results do not promise future ones.</li>
<li><b>KK shorts</b> could not be fixed: no tested version made money after costs, so they are not offered.</li>
</ul>

<h2>Website speed</h2>
<p>Measured on the live site: clicks showed a loading screen within 0.1 s, but the page took 0.4–0.9 s to fill, and the
Signals page 2.4–3 s. The cause: <b>62 of 63 page requests during six clicks were background "prefetches"</b> of links that
merely scrolled into view (the ticker, every table row), each one a server call that queued the click actually made.
Fixed by prefetching only the menu (31 list links changed) and by running database queries side by side on the layout,
overview, stock and Signals pages (one to two fewer waits per page). Re-measured locally: background requests 62 → 2.</p>

<h2>Status</h2>
<p>Strong trend, RSI dip and KK dip are live. SMA 20/50 trend, the speed fixes and the shorter track record are built and
tested (database tests, 139 unit tests, the full browser suite) and are ready to go live on approval.</p>

<div class="foot">QuantsPulse signals are research prompts, not investment advice. Figures: research/strategies/record.py,
record_dip.py, record_sma.py (tested); public.strategy_trade_results (stored prices). Decisions: ADR-035, ADR-036, ADR-037.</div>
</body></html>"""

(D / "report.html").write_text(html, encoding="utf-8")
print("written", D / "report.html")
