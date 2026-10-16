import type { Candle } from "./types";

export interface SipMonthEntry {
  date: string;
  price: number;
  units: number;
  cumulativeInvested: number;
  cumulativeUnits: number;
  currentValue: number;
}

export interface SipResult {
  totalInvested: number;
  finalValue: number;
  totalUnits: number;
  roiPct: number;
  durationMonths: number;
  entries: SipMonthEntry[];
  lumpSumFinalValue: number;
  lumpSumRoiPct: number;
}

export interface StrategyTrade {
  entryDate: string;
  entryPrice: number;
  exitDate: string;
  exitPrice: number;
  pnlPct: number;
  barsHeld: number;
  isWin: boolean;
}

export interface DetailedStrategyTrade extends StrategyTrade {
  exitReason: "strategy" | "stop_loss" | "take_profit" | "end_of_period";
  returnOnCapital: number;
}

export interface StrategyResult {
  trades: StrategyTrade[];
  totalTrades: number;
  winRatePct: number;
  totalReturnPct: number;
  maxDrawdownPct: number;
  profitFactor: number;
}

export interface EquityPoint {
  date: string;
  equity: number;
  benchmark: number;
  drawdownPct: number;
}

export interface AdvancedStrategyParams {
  type: "sma_cross" | "rsi_reversal" | "breakout";
  fastMa?: number;
  slowMa?: number;
  rsiPeriod?: number;
  rsiOversold?: number;
  rsiOverbought?: number;
  breakoutPeriod?: number;
  stopLossPct?: number;
  takeProfitPct?: number;
  initialCapital?: number;
}

export interface DetailedStrategyResult {
  trades: DetailedStrategyTrade[];
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRatePct: number;
  totalReturnPct: number;
  benchmarkReturnPct: number;
  alphaPct: number;
  maxDrawdownPct: number;
  profitFactor: number;
  avgWinPct: number;
  avgLossPct: number;
  payoffRatio: number;
  expectancyPct: number;
  avgBarsHeld: number;
  equityCurve: EquityPoint[];
  finalCapital: number;
}

/** Pure SMA calculator */
export function computeSma(values: number[], period: number): (number | null)[] {
  const result: (number | null)[] = new Array(values.length).fill(null);
  if (period <= 0 || values.length < period) return result;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) {
      sum -= values[i - period];
    }
    if (i >= period - 1) {
      result[i] = sum / period;
    }
  }
  return result;
}

/** Pure Wilder's smoothed RSI calculator matching QuantsPulse standard */
export function computeRsi(closes: number[], period = 14): (number | null)[] {
  const result: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length <= period) return result;

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  const firstRs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  result[period] = 100 - 100 / (1 + firstRs);

  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    result[i] = 100 - 100 / (1 + rs);
  }

  return result;
}

/** Simulate systematic monthly SIP vs Lump Sum investment over candle history */
export function simulateSip(
  candles: Candle[],
  monthlyAmount = 10000,
): SipResult | null {
  if (!candles || candles.length < 20 || monthlyAmount <= 0) return null;

  // Group by YYYY-MM
  const monthMap = new Map<string, Candle>();
  for (const c of candles) {
    const ym = String(c.ts).slice(0, 7);
    if (!monthMap.has(ym)) {
      monthMap.set(ym, c);
    }
  }

  const sortedMonths = [...monthMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  if (sortedMonths.length === 0) return null;

  const latestPrice = candles[candles.length - 1].close;
  const firstPrice = sortedMonths[0][1].close;

  let cumulativeInvested = 0;
  let cumulativeUnits = 0;
  const entries: SipMonthEntry[] = [];

  for (const [ym, candle] of sortedMonths) {
    const p = candle.close;
    if (p <= 0) continue;
    const units = monthlyAmount / p;
    cumulativeInvested += monthlyAmount;
    cumulativeUnits += units;
    entries.push({
      date: ym,
      price: p,
      units,
      cumulativeInvested,
      cumulativeUnits,
      currentValue: cumulativeUnits * latestPrice,
    });
  }

  const finalValue = cumulativeUnits * latestPrice;
  const roiPct = cumulativeInvested > 0 ? ((finalValue - cumulativeInvested) / cumulativeInvested) * 100 : 0;

  // Lump sum benchmark: invest totalInvested upfront at first price
  const lumpUnits = firstPrice > 0 ? cumulativeInvested / firstPrice : 0;
  const lumpSumFinalValue = lumpUnits * latestPrice;
  const lumpSumRoiPct = cumulativeInvested > 0 ? ((lumpSumFinalValue - cumulativeInvested) / cumulativeInvested) * 100 : 0;

  return {
    totalInvested: cumulativeInvested,
    finalValue,
    totalUnits: cumulativeUnits,
    roiPct: Number(roiPct.toFixed(2)),
    durationMonths: entries.length,
    entries,
    lumpSumFinalValue,
    lumpSumRoiPct: Number(lumpSumRoiPct.toFixed(2)),
  };
}

/** Simulate simple technical strategy over candles (SMA 20/50 cross or RSI dip-buy) */
export function simulateTechnicalStrategy(
  candles: Candle[],
  strategy: "sma_cross" | "rsi_pullback" = "sma_cross",
): StrategyResult | null {
  if (!candles || candles.length < 55) return null;

  const closes = candles.map((c) => c.close);
  const trades: StrategyTrade[] = [];

  let inPosition = false;
  let entryPrice = 0;
  let entryDate = "";
  let entryBar = 0;

  // Precompute SMA 20 and SMA 50
  const sma20: (number | null)[] = closes.map((_, i) =>
    i >= 19 ? closes.slice(i - 19, i + 1).reduce((a, b) => a + b, 0) / 20 : null,
  );
  const sma50: (number | null)[] = closes.map((_, i) =>
    i >= 49 ? closes.slice(i - 49, i + 1).reduce((a, b) => a + b, 0) / 50 : null,
  );

  for (let i = 50; i < candles.length; i++) {
    const price = closes[i];
    const date = String(candles[i].ts).slice(0, 10);

    let buySignal = false;
    let sellSignal = false;

    if (strategy === "sma_cross") {
      const s20 = sma20[i];
      const s50 = sma50[i];
      const prev20 = sma20[i - 1];
      const prev50 = sma50[i - 1];

      if (s20 != null && s50 != null && prev20 != null && prev50 != null) {
        // Golden Cross
        buySignal = prev20 <= prev50 && s20 > s50;
        // Death Cross
        sellSignal = prev20 >= prev50 && s20 < s50;
      }
    } else {
      // RSI pullback: buy when price touches below SMA 20 with subsequent recovery
      const s20 = sma20[i];
      if (s20 != null) {
        buySignal = price > s20 && closes[i - 1] <= (sma20[i - 1] ?? s20);
        sellSignal = price < s20 * 0.96; // 4% stop/trailing breach
      }
    }

    if (!inPosition && buySignal) {
      inPosition = true;
      entryPrice = price;
      entryDate = date;
      entryBar = i;
    } else if (inPosition && (sellSignal || i === candles.length - 1)) {
      const pnlPct = ((price - entryPrice) / entryPrice) * 100;
      trades.push({
        entryDate,
        entryPrice,
        exitDate: date,
        exitPrice: price,
        pnlPct: Number(pnlPct.toFixed(2)),
        barsHeld: i - entryBar,
        isWin: pnlPct > 0,
      });
      inPosition = false;
    }
  }

  if (trades.length === 0) {
    return {
      trades: [],
      totalTrades: 0,
      winRatePct: 0,
      totalReturnPct: 0,
      maxDrawdownPct: 0,
      profitFactor: 0,
    };
  }

  const wins = trades.filter((t) => t.isWin);
  const winRatePct = (wins.length / trades.length) * 100;
  const totalReturnPct = trades.reduce((acc, t) => acc + t.pnlPct, 0);

  const grossGains = wins.reduce((acc, t) => acc + t.pnlPct, 0);
  const grossLosses = Math.abs(
    trades.filter((t) => !t.isWin).reduce((acc, t) => acc + t.pnlPct, 0),
  );
  const profitFactor = grossLosses > 0 ? grossGains / grossLosses : grossGains > 0 ? 99 : 1;

  // Max Drawdown calculation
  let peak = 0;
  let runningEquity = 0;
  let maxDd = 0;

  for (const t of trades) {
    runningEquity += t.pnlPct;
    if (runningEquity > peak) peak = runningEquity;
    const dd = peak - runningEquity;
    if (dd > maxDd) maxDd = dd;
  }

    return {
    trades,
    totalTrades: trades.length,
    winRatePct: Number(winRatePct.toFixed(1)),
    totalReturnPct: Number(totalReturnPct.toFixed(2)),
    maxDrawdownPct: Number(maxDd.toFixed(2)),
    profitFactor: Number(profitFactor.toFixed(2)),
  };
}

/** Detailed quantitative simulation with customizable indicators, risk rules, and equity curve */
export function simulateCustomStrategy(
  candles: Candle[],
  params: AdvancedStrategyParams,
): DetailedStrategyResult | null {
  const type = params.type || "sma_cross";
  const fastMa = Math.max(2, Math.min(100, params.fastMa ?? 20));
  const slowMa = Math.max(fastMa + 1, Math.min(250, params.slowMa ?? 50));
  const rsiPeriod = Math.max(2, Math.min(50, params.rsiPeriod ?? 14));
  const rsiOversold = Math.max(10, Math.min(50, params.rsiOversold ?? 30));
  const rsiOverbought = Math.max(50, Math.min(90, params.rsiOverbought ?? 70));
  const breakoutPeriod = Math.max(5, Math.min(100, params.breakoutPeriod ?? 20));
  const stopLossPct = Math.max(0, params.stopLossPct ?? 0);
  const takeProfitPct = Math.max(0, params.takeProfitPct ?? 0);
  const initialCapital = Math.max(1000, params.initialCapital ?? 100000);

  const minBars = Math.max(
    type === "sma_cross" ? slowMa + 5 : type === "rsi_reversal" ? rsiPeriod + 10 : breakoutPeriod + 5,
    30,
  );

  if (!candles || candles.length < minBars) return null;

  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);

  const fastSeries = type === "sma_cross" ? computeSma(closes, fastMa) : [];
  const slowSeries = type === "sma_cross" ? computeSma(closes, slowMa) : [];
  const rsiSeries = type === "rsi_reversal" ? computeRsi(closes, rsiPeriod) : [];

  const startBar = Math.max(
    type === "sma_cross" ? slowMa : type === "rsi_reversal" ? rsiPeriod + 1 : breakoutPeriod,
    20,
  );

  const trades: DetailedStrategyTrade[] = [];
  const equityCurve: EquityPoint[] = [];

  let inPosition = false;
  let entryPrice = 0;
  let entryDate = "";
  let entryBar = 0;
  let units = 0;
  let cash = initialCapital;
  let peakEquity = initialCapital;
  let maxDrawdownPct = 0;

  const benchmarkStartPrice = closes[startBar];

  for (let i = startBar; i < candles.length; i++) {
    const currentClose = closes[i];
    const currentDate = String(candles[i].ts).slice(0, 10);

    if (!inPosition) {
      let buyTrigger = false;

      if (type === "sma_cross") {
        const f0 = fastSeries[i];
        const s0 = slowSeries[i];
        const f1 = fastSeries[i - 1];
        const s1 = slowSeries[i - 1];
        if (f0 != null && s0 != null && f1 != null && s1 != null) {
          buyTrigger = f1 <= s1 && f0 > s0;
        }
      } else if (type === "rsi_reversal") {
        const r0 = rsiSeries[i];
        const r1 = rsiSeries[i - 1];
        if (r0 != null && r1 != null) {
          buyTrigger = r1 <= rsiOversold && r0 > rsiOversold;
        }
      } else if (type === "breakout") {
        const highestPast = Math.max(...highs.slice(i - breakoutPeriod, i));
        buyTrigger = currentClose > highestPast;
      }

      if (buyTrigger) {
        inPosition = true;
        entryPrice = currentClose;
        entryDate = currentDate;
        entryBar = i;
        units = cash / currentClose;
        cash = 0;
      }
    } else {
      let exitTrigger = false;
      let exitPrice = currentClose;
      let exitReason: DetailedStrategyTrade["exitReason"] = "strategy";

      // 1. Stop loss check
      if (stopLossPct > 0) {
        const stopPrice = entryPrice * (1 - stopLossPct / 100);
        if (lows[i] <= stopPrice) {
          exitTrigger = true;
          exitPrice = Number(stopPrice.toFixed(2));
          exitReason = "stop_loss";
        }
      }

      // 2. Take profit check
      if (!exitTrigger && takeProfitPct > 0) {
        const targetPrice = entryPrice * (1 + takeProfitPct / 100);
        if (highs[i] >= targetPrice) {
          exitTrigger = true;
          exitPrice = Number(targetPrice.toFixed(2));
          exitReason = "take_profit";
        }
      }

      // 3. Strategy exit signal check
      if (!exitTrigger) {
        if (type === "sma_cross") {
          const f0 = fastSeries[i];
          const s0 = slowSeries[i];
          const f1 = fastSeries[i - 1];
          const s1 = slowSeries[i - 1];
          if (f0 != null && s0 != null && f1 != null && s1 != null) {
            exitTrigger = f1 >= s1 && f0 < s0;
          }
        } else if (type === "rsi_reversal") {
          const r0 = rsiSeries[i];
          const r1 = rsiSeries[i - 1];
          if (r0 != null && r1 != null) {
            exitTrigger = r1 >= rsiOverbought && r0 < rsiOverbought;
          }
        } else if (type === "breakout") {
          const exitChannel = Math.max(5, Math.floor(breakoutPeriod / 2));
          const lowestPast = Math.min(...lows.slice(i - exitChannel, i));
          exitTrigger = currentClose < lowestPast;
        }
      }

      // 4. End of data check
      if (!exitTrigger && i === candles.length - 1) {
        exitTrigger = true;
        exitPrice = currentClose;
        exitReason = "end_of_period";
      }

      if (exitTrigger) {
        const pnlPct = ((exitPrice - entryPrice) / entryPrice) * 100;
        cash = units * exitPrice;
        trades.push({
          entryDate,
          entryPrice,
          exitDate: currentDate,
          exitPrice,
          pnlPct: Number(pnlPct.toFixed(2)),
          barsHeld: Math.max(1, i - entryBar),
          isWin: pnlPct > 0,
          exitReason,
          returnOnCapital: Number((cash - initialCapital).toFixed(2)),
        });
        inPosition = false;
        units = 0;
      }
    }

    const currentPortfolioValue = inPosition ? units * currentClose : cash;
    if (currentPortfolioValue > peakEquity) {
      peakEquity = currentPortfolioValue;
    }
    const currentDrawdown =
      peakEquity > 0 ? ((peakEquity - currentPortfolioValue) / peakEquity) * 100 : 0;
    if (currentDrawdown > maxDrawdownPct) {
      maxDrawdownPct = currentDrawdown;
    }

    const benchmarkValue =
      benchmarkStartPrice > 0
        ? initialCapital * (currentClose / benchmarkStartPrice)
        : initialCapital;

    equityCurve.push({
      date: currentDate,
      equity: Math.round(currentPortfolioValue),
      benchmark: Math.round(benchmarkValue),
      drawdownPct: Number(currentDrawdown.toFixed(2)),
    });
  }

  const finalCapital = inPosition ? units * closes[closes.length - 1] : cash;
  const totalReturnPct = ((finalCapital - initialCapital) / initialCapital) * 100;
  const benchmarkReturnPct =
    benchmarkStartPrice > 0
      ? ((closes[closes.length - 1] - benchmarkStartPrice) / benchmarkStartPrice) * 100
      : 0;

  const wins = trades.filter((t) => t.isWin);
  const losses = trades.filter((t) => !t.isWin);
  const winningTrades = wins.length;
  const losingTrades = losses.length;
  const winRatePct = trades.length > 0 ? (winningTrades / trades.length) * 100 : 0;

  const grossGains = wins.reduce((acc, t) => acc + t.pnlPct, 0);
  const grossLosses = Math.abs(losses.reduce((acc, t) => acc + t.pnlPct, 0));
  const profitFactor = grossLosses > 0 ? grossGains / grossLosses : grossGains > 0 ? 99 : 1;

  const avgWinPct = winningTrades > 0 ? grossGains / winningTrades : 0;
  const avgLossPct = losingTrades > 0 ? grossLosses / losingTrades : 0;
  const payoffRatio = avgLossPct > 0 ? avgWinPct / avgLossPct : avgWinPct > 0 ? 99 : 1;

  const expectancyPct =
    trades.length > 0
      ? (winRatePct / 100) * avgWinPct - ((100 - winRatePct) / 100) * avgLossPct
      : 0;

  const avgBarsHeld =
    trades.length > 0
      ? Math.round(trades.reduce((acc, t) => acc + t.barsHeld, 0) / trades.length)
      : 0;

  return {
    trades,
    totalTrades: trades.length,
    winningTrades,
    losingTrades,
    winRatePct: Number(winRatePct.toFixed(1)),
    totalReturnPct: Number(totalReturnPct.toFixed(2)),
    benchmarkReturnPct: Number(benchmarkReturnPct.toFixed(2)),
    alphaPct: Number((totalReturnPct - benchmarkReturnPct).toFixed(2)),
    maxDrawdownPct: Number(maxDrawdownPct.toFixed(2)),
    profitFactor: Number(profitFactor.toFixed(2)),
    avgWinPct: Number(avgWinPct.toFixed(2)),
    avgLossPct: Number(avgLossPct.toFixed(2)),
    payoffRatio: Number(payoffRatio.toFixed(2)),
    expectancyPct: Number(expectancyPct.toFixed(2)),
    avgBarsHeld,
    equityCurve,
    finalCapital: Math.round(finalCapital),
  };
}

/** Generates clean Pine Script v5 strategy for TradingView */
export function generateBacktestPineScript(
  params: AdvancedStrategyParams,
  symbol = "NSE",
): string {
  const type = params.type || "sma_cross";
  const fast = params.fastMa ?? 20;
  const slow = params.slowMa ?? 50;
  const rsiLen = params.rsiPeriod ?? 14;
  const rsiBuy = params.rsiOversold ?? 30;
  const rsiSell = params.rsiOverbought ?? 70;
  const boLen = params.breakoutPeriod ?? 20;
  const stopLoss = params.stopLossPct ?? 0;
  const takeProfit = params.takeProfitPct ?? 0;

  if (type === "rsi_reversal") {
    return `//@version=5
strategy("QuantsPulse RSI Mean Reversion: ${symbol}", overlay=true, margin_long=100, default_qty_type=strategy.percent_of_equity, default_qty_value=100)

rsiLength = input.int(${rsiLen}, "RSI Length", minval=2)
oversold = input.int(${rsiBuy}, "Oversold Buy Threshold", minval=10, maxval=50)
overbought = input.int(${rsiSell}, "Overbought Exit Threshold", minval=50, maxval=90)
stopPct = input.float(${stopLoss}, "Stop Loss % (0 = Disabled)", minval=0.0, step=0.5)
targetPct = input.float(${takeProfit}, "Take Profit % (0 = Disabled)", minval=0.0, step=0.5)

rsiVal = ta.rsi(close, rsiLength)
buyCond = ta.crossover(rsiVal, oversold)
exitCond = ta.crossunder(rsiVal, overbought)

if (buyCond)
    strategy.entry("Long", strategy.long)

if (stopPct > 0 or targetPct > 0)
    stopLvl = stopPct > 0 ? strategy.position_avg_price * (1 - stopPct / 100) : na
    profitLvl = targetPct > 0 ? strategy.position_avg_price * (1 + targetPct / 100) : na
    strategy.exit("Bracket", "Long", stop=stopLvl, limit=profitLvl)

if (exitCond)
    strategy.close("Long", comment="RSI Exit")
`;
  }

  if (type === "breakout") {
    return `//@version=5
strategy("QuantsPulse Donchian Breakout: ${symbol}", overlay=true, margin_long=100, default_qty_type=strategy.percent_of_equity, default_qty_value=100)

breakoutLen = input.int(${boLen}, "Breakout Lookback Length", minval=5)
exitLen = math.max(5, math.floor(breakoutLen / 2))
stopPct = input.float(${stopLoss}, "Stop Loss % (0 = Disabled)", minval=0.0, step=0.5)
targetPct = input.float(${takeProfit}, "Take Profit % (0 = Disabled)", minval=0.0, step=0.5)

highestHigh = ta.highest(high[1], breakoutLen)
lowestLow = ta.lowest(low[1], exitLen)

buyCond = close > highestHigh
exitCond = close < lowestLow

if (buyCond)
    strategy.entry("Long", strategy.long)

if (stopPct > 0 or targetPct > 0)
    stopLvl = stopPct > 0 ? strategy.position_avg_price * (1 - stopPct / 100) : na
    profitLvl = targetPct > 0 ? strategy.position_avg_price * (1 + targetPct / 100) : na
    strategy.exit("Bracket", "Long", stop=stopLvl, limit=profitLvl)

if (exitCond)
    strategy.close("Long", comment="Channel Exit")
`;
  }

  // Default: Dual MA Cross
  return `//@version=5
strategy("QuantsPulse MA Cross: ${symbol}", overlay=true, margin_long=100, default_qty_type=strategy.percent_of_equity, default_qty_value=100)

fastLength = input.int(${fast}, "Fast MA Period", minval=2)
slowLength = input.int(${slow}, "Slow MA Period", minval=5)
stopPct = input.float(${stopLoss}, "Stop Loss % (0 = Disabled)", minval=0.0, step=0.5)
targetPct = input.float(${takeProfit}, "Take Profit % (0 = Disabled)", minval=0.0, step=0.5)

fastMA = ta.sma(close, fastLength)
slowMA = ta.sma(close, slowLength)

buyCond = ta.crossover(fastMA, slowMA)
exitCond = ta.crossunder(fastMA, slowMA)

plot(fastMA, color=color.new(color.orange, 0), title="Fast MA")
plot(slowMA, color=color.new(color.blue, 0), title="Slow MA")

if (buyCond)
    strategy.entry("Long", strategy.long)

if (stopPct > 0 or targetPct > 0)
    stopLvl = stopPct > 0 ? strategy.position_avg_price * (1 - stopPct / 100) : na
    profitLvl = targetPct > 0 ? strategy.position_avg_price * (1 + targetPct / 100) : na
    strategy.exit("Bracket", "Long", stop=stopLvl, limit=profitLvl)

if (exitCond)
    strategy.close("Long", comment="Death Cross")
`;
}

