// QuantsPulse Quantitative Pine Script Generator for TradingView v5

export type PineStrategyMode = "core" | "swing";

export function generateCleanPineScript(symbol?: string, mode: PineStrategyMode = "core"): string {
  const sym = symbol ? symbol.toUpperCase().trim() : "NSE Equities";
  const defaultOption = mode === "swing" ? "Fast Swing (Price vs SMA20)" : "QuantsPulse Core (Platform Match)";

  return `//@version=5
// =============================================================================
// QuantsPulse Quantitative Strategy Indicator for TradingView
// Instrument: ${sym}
// =============================================================================
indicator("QuantsPulse Quantitative Signals & Levels (${sym})", overlay=true, max_labels_count=500, max_lines_count=500)

// -----------------------------------------------------------------------------
// 1. USER INPUTS & DISPLAY OPTIONS
// -----------------------------------------------------------------------------
grpDisplay   = "Display Options"
showTable    = input.bool(true, "Show Dashboard Table", group=grpDisplay)
showSignals  = input.bool(true, "Show Buy / Exit Signals", group=grpDisplay)
showTargets  = input.bool(true, "Show Active Targets (T1 / T2 / T3)", group=grpDisplay)
showStops    = input.bool(true, "Show Active Stop Loss", group=grpDisplay)
showSMAs     = input.bool(true, "Show Moving Averages (20 / 50 / 200)", group=grpDisplay)

grpStrategy  = "Strategy Parameters"
stratMode    = input.string("${defaultOption}", "Strategy Mode", options=["QuantsPulse Core (Platform Match)", "Fast Swing (Price vs SMA20)"], group=grpStrategy)
riskPercent  = input.float(3.5, "Stop Loss Risk Budget %", minval=1.0, maxval=12.0, step=0.5, group=grpStrategy)
rsiPeriod    = input.int(14, "RSI Length", minval=5, maxval=50, group=grpStrategy)

// -----------------------------------------------------------------------------
// 2. TECHNICAL INDICATORS
// -----------------------------------------------------------------------------
sma20  = ta.sma(close, 20)
sma50  = ta.sma(close, 50)
sma200 = ta.sma(close, 200)

plot(showSMAs ? sma20 : na, "SMA 20", color=color.new(#3B82F6, 15), linewidth=1)
plot(showSMAs ? sma50 : na, "SMA 50", color=color.new(#F59E0B, 15), linewidth=1)
plot(showSMAs ? sma200 : na, "SMA 200", color=color.new(#8B5CF6, 10), linewidth=2)

rsiVal = ta.rsi(close, rsiPeriod)
volAvg = ta.sma(volume, 20)
bool volOk = na(volume) or volume == 0 or volume > volAvg * 1.1

// -----------------------------------------------------------------------------
// 3. STATEFUL SIGNAL ENGINE (Clean Alternating Signals, Zero Repeats)
// -----------------------------------------------------------------------------
var int tradeState = 0        // 0 = Cash / Out, 1 = In Active Long Trade
var float entryPrice = na
var float stopLoss = na
var float target1 = na
var float target2 = na
var float target3 = na
var string lastSignalLabel = "Cash / Neutral"

// Repainting Protection: Real-time confirmation check
bool isConfirmed = not barstate.isrealtime or barstate.isconfirmed

// QuantsPulse Platform Strategies (Matches Supabase Postgres svc_refresh_market_analytics):
// 1. sma_20_50_cross: SMA 20 crosses SMA 50 (Golden Cross / Death Cross)
// 2. rsi_reversal: RSI dips below 30 and crosses back above 30, or rises above 70 and falls back below 70
bool qpBuyGolden = ta.crossover(sma20, sma50)
bool qpBuyRsi    = ta.crossover(rsiVal, 30)
bool qpExitDeath = ta.crossunder(sma20, sma50)
bool qpExitRsi   = ta.crossunder(rsiVal, 70)

// Fast Swing Alternative (Price vs SMA20 Breakout)
bool fastBuy     = (ta.crossover(rsiVal, 30) and close > ta.ema(close, 9)) or (ta.crossover(close, sma20) and volOk)
bool fastExit    = (low <= stopLoss) or (high >= target3) or (ta.crossunder(close, sma20) and rsiVal < 48)

// Active Rules based on selected Strategy Mode
bool isCoreMode  = stratMode == "QuantsPulse Core (Platform Match)"
bool rawBuy      = isCoreMode ? (qpBuyGolden or qpBuyRsi) : fastBuy
bool rawExit     = isCoreMode ? (qpExitDeath or qpExitRsi or (low <= stopLoss)) : fastExit

bool isBuySignal = rawBuy and tradeState == 0 and isConfirmed

if isBuySignal
    tradeState := 1
    entryPrice := close
    lastSignalLabel := isCoreMode ? (qpBuyGolden ? "SMA 20/50 Golden Cross" : "RSI Oversold Reversal") : (ta.crossover(rsiVal, 30) ? "RSI Oversold Bounce" : "SMA 20 Breakout")
    stopLoss   := close * (1.0 - (riskPercent / 100.0))
    float risk = entryPrice - stopLoss
    target1    := entryPrice + (risk * 0.75)
    target2    := entryPrice + (risk * 2.0)
    target3    := entryPrice + (risk * 3.0)

bool isExitSignal = rawExit and tradeState == 1 and isConfirmed

if isExitSignal
    tradeState := 0
    lastSignalLabel := isCoreMode ? (qpExitDeath ? "SMA 20/50 Death Cross" : qpExitRsi ? "RSI Overbought Exit" : "Stop Loss Hit") : (low <= stopLoss ? "Stop Loss Hit" : high >= target3 ? "Target 3 (+3.0R) Hit" : "Trend Breakdown")

// Clean Signal Markers (Only 1 Buy and 1 Exit per trade cycle)
plotshape(showSignals and isBuySignal, title="BUY Signal", location=location.belowbar, color=color.new(#0B6A4E, 0), style=shape.triangleup, size=size.small, text="BUY")
plotshape(showSignals and isExitSignal, title="EXIT Signal", location=location.abovebar, color=color.new(#A8380B, 0), style=shape.triangledown, size=size.small, text="EXIT")

// -----------------------------------------------------------------------------
// 4. CLEAN TARGETS & STOPS (Only plotted during active trades; no empty staircases)
// -----------------------------------------------------------------------------
plot(tradeState == 1 and showTargets ? target1 : na, "Target 1 (0.75R)", color=color.new(#34D399, 0), style=plot.style_linebr, linewidth=1)
plot(tradeState == 1 and showTargets ? target2 : na, "Target 2 (2.0R)", color=color.new(#10B981, 0), style=plot.style_linebr, linewidth=2)
plot(tradeState == 1 and showTargets ? target3 : na, "Target 3 (3.0R)", color=color.new(#059669, 0), style=plot.style_linebr, linewidth=2)
plot(tradeState == 1 and showStops ? stopLoss : na, "Stop Loss (1.0R)", color=color.new(#EF4444, 0), style=plot.style_linebr, linewidth=2)

// -----------------------------------------------------------------------------
// 5. ON-CHART HUD DASHBOARD TABLE (Compact, Non-Intrusive)
// -----------------------------------------------------------------------------
var table hud = table.new(position.top_right, 2, 7, bgcolor=color.new(#1E1E1E, 15), border_color=color.new(#333333, 0), border_width=1)

if barstate.islast and showTable
    color statusBg = tradeState == 1 ? color.new(#0B6A4E, 15) : color.new(#2E2E2E, 0)
    string statusText = tradeState == 1 ? "ACTIVE LONG" : "CASH / NEUTRAL"
    float returnPct = tradeState == 1 and not na(entryPrice) ? ((close - entryPrice) / entryPrice) * 100 : 0.0
    color returnColor = returnPct >= 0 ? color.new(#34D399, 0) : color.new(#F87171, 0)
    string returnStr = (returnPct >= 0 ? "+" : "") + str.tostring(returnPct, "#.##") + "%"

    table.cell(hud, 0, 0, "QuantsPulse", text_color=color.new(#F26A4B, 0), text_size=size.small)
    table.cell(hud, 1, 0, syminfo.ticker, bgcolor=color.new(#242424, 0), text_color=color.white, text_size=size.small)

    table.cell(hud, 0, 1, "Status", text_color=color.gray, text_size=size.small)
    table.cell(hud, 1, 1, statusText, bgcolor=statusBg, text_color=color.white, text_size=size.small)

    table.cell(hud, 0, 2, "Entry / Return", text_color=color.gray, text_size=size.small)
    table.cell(hud, 1, 2, tradeState == 1 ? str.tostring(entryPrice, "#.##") + " (" + returnStr + ")" : "—", text_color=returnColor, text_size=size.small)

    table.cell(hud, 0, 3, "Stop (1.0R)", text_color=color.gray, text_size=size.small)
    table.cell(hud, 1, 3, tradeState == 1 ? str.tostring(stopLoss, "#.##") + " (-" + str.tostring(riskPercent, "#.#") + "%)" : "—", text_color=color.new(#F87171, 0), text_size=size.small)

    table.cell(hud, 0, 4, "T1 (0.75R)", text_color=color.gray, text_size=size.small)
    table.cell(hud, 1, 4, tradeState == 1 ? str.tostring(target1, "#.##") + (high >= target1 ? " [HIT ✓]" : "") : "—", text_color=color.new(#34D399, 0), text_size=size.small)

    table.cell(hud, 0, 5, "T2 (2.0R)", text_color=color.gray, text_size=size.small)
    table.cell(hud, 1, 5, tradeState == 1 ? str.tostring(target2, "#.##") + (high >= target2 ? " [HIT ✓]" : "") : "—", text_color=color.new(#10B981, 0), text_size=size.small)

    table.cell(hud, 0, 6, "RSI / Trend", text_color=color.gray, text_size=size.small)
    table.cell(hud, 1, 6, str.tostring(rsiVal, "#.#") + " (" + (close > sma50 ? "Bullish" : "Bearish") + ")", text_color=color.white, text_size=size.small)
`;
}
