// TradingView Pine Script (v6) for each QuantsPulse signal rule: one script per rule, so the signals on a
// TradingView chart are the signals of the rule the user picked and nothing else. Each script follows the live SQL
// (migrations 33, 38, 41, 45, 55) bar by bar: the same entry, the same safety stop, the same exit, one trade at a time.

export type PineRule = "kk_dip" | "rsi_dip" | "sma_trend" | "strong_trend" | "ma200_trend" | "secular_trend";

export const PINE_RULES: readonly { key: PineRule; label: string; short: string }[] = [
  { key: "kk_dip", label: "KK dip", short: "KK" },
  { key: "sma_trend", label: "SMA 20/50 trend", short: "SMA 20/50" },
  { key: "rsi_dip", label: "RSI dip", short: "RSI" },
  { key: "strong_trend", label: "Strong trend", short: "Strong trend" },
  { key: "ma200_trend", label: "200-day trend", short: "200-day trend" },
  { key: "secular_trend", label: "Secular trend", short: "Secular trend" },
];

/** The chart's rule filter → the rule whose script to copy; null for "all" / "none" (the user picks one). */
export function pineRuleForChart(filter: string): PineRule | null {
  switch (filter) {
    case "kk_breakout":
      return "kk_dip";
    case "sma_cross":
      return "sma_trend";
    case "rsi_reversal":
      return "rsi_dip";
    case "strong_trend":
    case "ma200_trend":
    case "secular_trend":
      return filter;
    default:
      return null;
  }
}

export function pineRuleLabel(rule: PineRule): string {
  return PINE_RULES.find((r) => r.key === rule)!.label;
}

const GAIN = "#0F7B5C";
const LOSS = "#C2410C";

function header(rule: PineRule, sym: string, about: string[]): string {
  const label = pineRuleLabel(rule);
  return `//@version=6
// =============================================================================
// QuantsPulse · ${label} · ${sym}
// One rule only: the buy and exit marks on this chart are the ${label} rule's, the same rule
// QuantsPulse runs every evening on the 500 largest NSE companies.
${about.map((l) => `// ${l}`).join("\n")}
//
// Use it on the DAILY chart of an NSE stock. Research, not advice: a signal is the output of a
// fixed rule, tested on past prices, and no promise about the future.
// Small differences from the QuantsPulse chart can happen: TradingView's price history starts on a
// different day (so a trade open at the start can shift the first signal or two), and its prices
// can differ from the Yahoo end of day prices that QuantsPulse uses.
// =============================================================================
indicator("QuantsPulse ${label} (${sym})", shorttitle="QP ${label}", overlay=true, max_labels_count=500, max_lines_count=500)

grpShow   = "Display"
showMarks = input.bool(true, "Show buy and exit marks", group=grpShow)
showStop  = input.bool(true, "Show the safety stop while holding", group=grpShow)
showTable = input.bool(true, "Show the status table", group=grpShow)
`;
}

const EXIT_LABEL = `if exitNow
    float res = (exitPx / entryPx - 1) * 100
    lastResult := res
    if showMarks
        label.new(bar_index, high, "EXIT\\n" + (res >= 0 ? "▲ " : "▼ ") + str.tostring(math.abs(res), "0.0") + "%\\n" + exitWhy,
                  style=label.style_label_down, color=color.new(res >= 0 ? ${GAIN} : ${LOSS}, 0), textcolor=color.white, size=size.small)
`;

function footer(rule: PineRule, statusText: string): string {
  const label = pineRuleLabel(rule);
  return `
plot(showStop and state == 2 ? stopPx : na, "Safety stop", color=color.new(${LOSS}, 0), style=plot.style_linebr, linewidth=2)

alertcondition(buyNow, "QuantsPulse ${label}: buy", "QuantsPulse ${label}: buy signal on {{ticker}}")
alertcondition(exitNow, "QuantsPulse ${label}: exit", "QuantsPulse ${label}: exit on {{ticker}}")

var table hud = table.new(position.top_right, 2, 4, bgcolor=color.new(#1C1C1C, 10), border_color=color.new(#2C2C2C, 0), border_width=1)
if barstate.islast and showTable
    string status = timeframe.isdaily ? (${statusText}) : "Switch to the daily chart"
    table.cell(hud, 0, 0, "QuantsPulse", text_color=color.new(#F26A4B, 0), text_size=size.small)
    table.cell(hud, 1, 0, "${label}", text_color=color.white, text_size=size.small)
    table.cell(hud, 0, 1, "Status", text_color=color.gray, text_size=size.small)
    table.cell(hud, 1, 1, status, text_color=color.white, text_size=size.small)
    table.cell(hud, 0, 2, "Safety stop", text_color=color.gray, text_size=size.small)
    table.cell(hud, 1, 2, state == 2 ? str.tostring(stopPx, "0.00") : "none", text_color=color.white, text_size=size.small)
    table.cell(hud, 0, 3, "Last result", text_color=color.gray, text_size=size.small)
    table.cell(hud, 1, 3, na(lastResult) ? "none yet" : (lastResult >= 0 ? "▲ " : "▼ ") + str.tostring(math.abs(lastResult), "0.0") + "%", text_color=color.white, text_size=size.small)
`;
}

/** The three trend rules share one plan: buy at the next open, stop = signal close − 4 × ATR14 (simple average
 *  of the true range), out at the stop (or the open, if it gaps under), otherwise at the 60th session's close. */
function trendRule(rule: PineRule, sym: string, about: string[], inputs: string, signal: string): string {
  return `${header(rule, sym, about)}${inputs}
// ---- the plan: shared by the three trend rules
atr = ta.sma(ta.tr(true), 14)                    // ATR 14: the simple average of the true range

var int   state      = 0                         // 0 = no trade, 1 = buy at the next open, 2 = holding
var float stopPx     = na
var float entryPx    = na
var int   entryBar   = na
var float lastResult = na
bool   buyNow  = false
bool   exitNow = false
float  exitPx  = na
string exitWhy = ""

if state == 1                                    // the session after the signal: bought at its open
    state    := 2
    entryPx  := open
    entryBar := bar_index
if state == 2
    int held = bar_index - entryBar + 1
    if low <= stopPx
        exitPx  := math.min(open, stopPx)
        exitWhy := "safety stop"
        exitNow := true
    else if held >= 60
        exitPx  := close
        exitWhy := "60 session review"
        exitNow := true
    if exitNow
        state := 0
${EXIT_LABEL}
bool setup = ${signal}
if state == 0 and not exitNow and barstate.isconfirmed and not na(atr) and setup
    float stp = math.round(close - 4 * atr, 2)
    if stp > 0
        stopPx := stp
        state  := 1
        buyNow := true
        if showMarks
            label.new(bar_index, low, "BUY\\nstop " + str.tostring(stp, "0.00"), style=label.style_label_up,
                      color=color.new(${GAIN}, 0), textcolor=color.white, size=size.small)
${footer(rule, `state == 2 ? "Holding since " + str.tostring(entryPx, "0.00") : state == 1 ? "Buy at the next open" : "No open trade"`)}`;
}

/** The two dip rules share one plan: a buy level at close − 1 × ATR14 for the next session only (bought when the
 *  low trades 0.2% through it, at that level or a lower open), stop = fill − 5 × ATR14, out at the stop, on the
 *  first close above the 5-day average, or at the 10th session's close. ATR and RSI(2) are the exponential
 *  averages QuantsPulse uses, started from the first bar. */
function dipRule(rule: PineRule, sym: string, about: string[], hit: string): string {
  return `${header(rule, sym, about)}
// ---- ATR 14 and RSI 2 exactly as QuantsPulse computes them (exponential averages from the first bar)
float prevClose = nz(close[1], close)
float tr = bar_index == 0 ? high - low : math.max(high - low, math.abs(high - prevClose), math.abs(low - prevClose))
var float atrE = na
atrE := na(atrE) ? tr : atrE + (tr - atrE) / 14
float atr = bar_index >= 13 ? atrE : na

float chg = close - prevClose
var float up = na
var float dn = na
if bar_index == 1
    up := math.max(chg, 0)
    dn := math.max(-chg, 0)
else if bar_index > 1
    up := 0.5 * up + 0.5 * math.max(chg, 0)
    dn := 0.5 * dn + 0.5 * math.max(-chg, 0)
float rsi2 = bar_index >= 2 ? (dn == 0 ? 100 : 100 - 100 / (1 + up / dn)) : na

sma5   = ta.sma(close, 5)
sma200 = ta.sma(close, 200)
lo20   = ta.lowest(low, 20)[1]                   // the lowest low of the 20 sessions before today

bool dipSignal = not na(atr) and not na(sma200) and close > sma200 and ${hit}

// ---- the plan: shared by the two dip rules
var int   state      = 0                         // 0 = no trade, 1 = buy level set for the next session, 2 = holding
var float limPx      = na
var float sigAtr     = na
var float stopPx     = na
var float entryPx    = na
var int   entryBar   = na
var float lastResult = na
bool   buyNow  = false
bool   exitNow = false
float  exitPx  = na
string exitWhy = ""

if state == 1                                    // the session after the signal: did the dip come?
    if low <= limPx * 0.998
        entryPx  := math.min(open, limPx)
        stopPx   := math.round(entryPx - 5 * sigAtr, 2)
        entryBar := bar_index
        state    := 2
        buyNow   := true
        if showMarks
            label.new(bar_index, low, "BUY\\n" + str.tostring(entryPx, "0.00"), style=label.style_label_up,
                      color=color.new(${GAIN}, 0), textcolor=color.white, size=size.small)
    else
        state := 0                               // the dip did not come: no trade
if state == 2
    int held = bar_index - entryBar + 1
    if low <= stopPx
        exitPx  := held > 1 ? math.min(open, stopPx) : stopPx
        exitWhy := "safety stop"
        exitNow := true
    else if not na(sma5) and close > sma5
        exitPx  := close
        exitWhy := "sold on the bounce"
        exitNow := true
    else if held >= 10
        exitPx  := close
        exitWhy := "10 sessions passed"
        exitNow := true
    if exitNow
        state := 0
${EXIT_LABEL}
if state == 0 and not exitNow and barstate.isconfirmed and dipSignal
    float lim = math.round(close - atr, 2)
    if lim > 0
        limPx  := lim
        sigAtr := atr
        state  := 1

plot(state == 1 ? limPx : na, "Dip buy level (next session)", color=color.new(${GAIN}, 0), style=plot.style_circles, linewidth=2)
${footer(rule, `state == 2 ? "Holding since " + str.tostring(entryPx, "0.00") : state == 1 ? "Buy level " + str.tostring(limPx, "0.00") + " next session" : "No open trade"`)}`;
}

const WEATHER = `
// ---- market weather: sunny = Nifty 50 above its 200 day average, its 50 day average above the 200 day,
//      and India VIX at 22 or less (stormy when the Nifty and its 50 day are under the 200 day, or VIX is above 22)
nifty     = request.security("NSE:NIFTY", "D", close)
niftyS50  = request.security("NSE:NIFTY", "D", ta.sma(close, 50))
niftyS200 = request.security("NSE:NIFTY", "D", ta.sma(close, 200))
vix       = request.security("NSE:INDIAVIX", "D", close)
bool stormy = (nifty < niftyS200 and niftyS50 < niftyS200) or (not na(vix) and vix > 22)
bool sunny  = not na(niftyS200) and not na(niftyS50) and not stormy and nifty > niftyS200 and niftyS50 > niftyS200
hi252  = ta.highest(close, 252)[1]               // the highest close of the 252 sessions before today
vol50  = ta.sma(volume, 50)[1]                   // the average volume of the 50 sessions before today
sma50  = ta.sma(close, 50)
plot(sma50, "SMA 50", color=color.new(#5E5A52, 0), linewidth=1)
`;

export function pineScript(rule: PineRule, symbol?: string): string {
  const sym = symbol?.toUpperCase().trim() || "NSE stock";
  switch (rule) {
    case "kk_dip":
      return dipRule(rule, sym, [
        "The rule: in a stock above its 200 day average, a day whose low falls at least 1% under the",
        "lowest low of the 20 sessions before it. Next session, buy only if the price dips to one ATR",
        "under that close (the round dot). Sell at the safety stop (5 ATR under the buy), on the first",
        "close above the 5 day average, or after 10 sessions.",
      ], "not na(lo20) and low <= 0.99 * lo20");
    case "rsi_dip":
      return dipRule(rule, sym, [
        "The rule: in a stock above its 200 day average, RSI 2 closes under 10 (a sharp two day drop).",
        "Next session, buy only if the price dips to one ATR under that close (the round dot). Sell at",
        "the safety stop (5 ATR under the buy), on the first close above the 5 day average, or after",
        "10 sessions.",
      ], "not na(rsi2) and rsi2 < 10");
    case "strong_trend":
      return trendRule(rule, sym, [
        "The rule: the close is above every close of the past 252 sessions (a new 52 week high), on at",
        "least twice the average volume of the 50 sessions before, above the 50 day average, on a day",
        "the market weather is sunny. Buy at the next open; safety stop 4 ATR under the signal close;",
        "out at the stop or after 60 sessions.",
      ], WEATHER, `not na(hi252) and not na(vol50) and close > hi252 and volume >= 2 * vol50 and close > sma50 and sunny`);
    case "sma_trend":
      return trendRule(rule, sym, [
        "The rule: the 20 day average crosses above the 50 day average while the stock is a leader.",
        "On QuantsPulse a leader is in the top 30% of the 500 largest companies by 6 month return.",
        "TradingView cannot rank 500 stocks, so this script uses a stand in you can change: the stock's",
        "6 month return beats the Nifty 50's by at least 15 points (it agreed with the real ranking on",
        "about 9 in 10 crossover days, 2019 to 2026). Buy at the next open; safety stop 4 ATR under the",
        "signal close; out at the stop or after 60 sessions.",
      ], `
leaderGap   = input.float(15, "Leader check: 6 month return above the Nifty 50's by (points)", minval=0, step=1, group="Rule")
sma20       = ta.sma(close, 20)
sma50       = ta.sma(close, 50)
ret126      = (close / close[126] - 1) * 100
niftyRet126 = request.security("NSE:NIFTY", "D", (close / close[126] - 1) * 100)
plot(sma20, "SMA 20", color=color.new(#5E5A52, 0), linewidth=1)
plot(sma50, "SMA 50", color=color.new(#1E1E1E, 0), linewidth=1)
`, `ta.crossover(sma20, sma50) and not na(ret126) and not na(niftyRet126) and ret126 - niftyRet126 >= leaderGap`);
    case "ma200_trend":
      return trendRule(rule, sym, [
        "The rule: the first day the close is above the 200 day average while the straight line fitted",
        "to that average over 100 sessions is flat or rising (falling no more than 0.25% in 20 sessions)",
        "and the last 100 closes climbed steadily (correlation with time of 0.5 or more). Buy at the",
        "next open; safety stop 4 ATR under the signal close; out at the stop or after 60 sessions.",
      ], `
sma200    = ta.sma(close, 200)
slope     = ta.linreg(sma200, 100, 0) - ta.linreg(sma200, 100, 1)   // the fitted line's rise per session
slopePct  = not na(sma200[99]) ? 2000 * slope / sma200 : na       // its change over 20 sessions, in % of the average
rr        = ta.correlation(close, bar_index, 100)
bool known = not na(sma200) and not na(slopePct) and not na(rr)
bool ok    = known and close > sma200 and slopePct >= -0.25 and rr >= 0.5
bool prevKnown = bar_index > 0 and known[1]
bool prevOk    = bar_index > 0 and ok[1]
plot(sma200, "SMA 200", color=color.new(#1E1E1E, 0), linewidth=2)
`, `ok and prevKnown and not prevOk`);
    case "secular_trend":
      return trendRule(rule, sym, [
        "The rule: Secular trend (Pring's Special K, the same as TradingView's Pring's Special K with signal",
        "lengths 50 and 50) crosses above its signal line while it is not lower than 5 days ago and is still",
        "below the line (-150 unless you change it): a deep, long slump starting to turn up. It needs about",
        "825 days of history before its first signal. Buy at the next open; safety stop 4 ATR under the",
        "signal close; out at the stop or after 60 sessions. Add TradingView's Pring's Special K (50, 50) in",
        "a pane below to see the two lines.",
      ], `
secLine  = input.float(-150, "Secular trend line", step=10, group="Rule")
roc(n)   => 100 * (close / close[n] - 1)
secular  = 1 * ta.sma(roc(10), 10) + 2 * ta.sma(roc(15), 10) + 3 * ta.sma(roc(20), 10) + 4 * ta.sma(roc(30), 15)
         + 1 * ta.sma(roc(40), 50) + 2 * ta.sma(roc(65), 65) + 3 * ta.sma(roc(75), 75) + 4 * ta.sma(roc(100), 100)
         + 1 * ta.sma(roc(195), 130) + 2 * ta.sma(roc(265), 130) + 3 * ta.sma(roc(390), 130) + 4 * ta.sma(roc(530), 195)
secSignal = ta.sma(ta.sma(secular, 50), 50)
`, `not na(secSignal[1]) and not na(secular[5]) and ta.crossover(secular, secSignal) and secular >= secular[5] and secular < secLine`);
  }
}
