import type { Candle } from "./types";
import type { RawChartMarker } from "./trade-plan";

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

export type KkResultType =
  | "TARGET_1_HIT_TIME_EXIT"
  | "TARGET_2_HIT"
  | "SL_HIT"
  | "SL_HIT_AFTER_TARGET_1"
  | "TIME_EXIT"
  | "OPEN_DATA_END";

export interface DetailedStrategyTrade extends StrategyTrade {
  exitReason: "strategy" | "stop_loss" | "take_profit" | "end_of_period";
  returnOnCapital: number;
  resultType?: KkResultType;
  realizedR?: number;
  signalType?: "BUY" | "SELL";
  target1Price?: number;
  target2Price?: number;
  stopLossPrice?: number;
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
  type: "sma_cross" | "rsi_reversal" | "breakout" | "kk_breakout";
  fastMa?: number;
  slowMa?: number;
  rsiPeriod?: number;
  rsiOversold?: number;
  rsiOverbought?: number;
  breakoutPeriod?: number;
  stopLossPct?: number;
  takeProfitPct?: number;
  initialCapital?: number;
  // KK 20-bar extreme breakout parameters
  kkPeriod?: number;
  kkExtensionPct?: number;
  kkConfirmationBars?: number;
  kkTradeWindowBars?: number;
  kkTarget1Fraction?: number;
  kkTarget1R?: number;
  kkTarget2R?: number;
  kkDirection?: "buy" | "both" | "sell";
  kkAllowOverlapping?: boolean;
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

  // Precompute SMA 20, SMA 50, and Wilder RSI 14
  const sma20: (number | null)[] = closes.map((_, i) =>
    i >= 19 ? closes.slice(i - 19, i + 1).reduce((a, b) => a + b, 0) / 20 : null,
  );
  const sma50: (number | null)[] = closes.map((_, i) =>
    i >= 49 ? closes.slice(i - 49, i + 1).reduce((a, b) => a + b, 0) / 50 : null,
  );
  const rsi14 = strategy === "rsi_pullback" ? computeRsi(closes, 14) : [];

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
      // Wilder RSI 14 Mean Reversion: Buy on recovery above 30, Exit on fall below 70
      const prevRsi = rsi14[i - 1];
      const currRsi = rsi14[i];
      if (prevRsi != null && currRsi != null) {
        buySignal = prevRsi < 30 && currRsi >= 30;
        sellSignal = prevRsi > 70 && currRsi <= 70;
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

/**
 * Simulates the 20-bar Extreme Breakout & Confirmation strategy (from kk_eod_results)
 * with asymmetric R targets (T1: +0.75R with 50% scale-out, T2: +2.00R, 5-bar time exit).
 */
export function simulateKkStrategy(
  candles: Candle[],
  params: AdvancedStrategyParams,
): DetailedStrategyResult | null {
  const period = Math.max(5, Math.min(100, params.kkPeriod ?? 20));
  const extensionPct = Math.max(0.1, Math.min(10.0, params.kkExtensionPct ?? 1.0));
  const confBars = Math.max(1, Math.min(15, params.kkConfirmationBars ?? 5));
  const tradeBars = Math.max(1, Math.min(20, params.kkTradeWindowBars ?? 5));
  const target1Fraction = Math.max(0.1, Math.min(0.9, params.kkTarget1Fraction ?? 0.5));
  const target1R = Math.max(0.2, Math.min(5.0, params.kkTarget1R ?? 0.75));
  const target2R = Math.max(0.5, Math.min(10.0, params.kkTarget2R ?? 2.00));
  const direction = params.kkDirection ?? "buy";
  const allowOverlapping = Boolean(params.kkAllowOverlapping);
  const initialCapital = Math.max(1000, params.initialCapital ?? 100000);

  const minBars = period + confBars + tradeBars + 5;
  if (!candles || candles.length < minBars) return null;

  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const opens = candles.map((c) => c.open ?? c.close);
  const dates = candles.map((c) => String(c.ts).slice(0, 10));

  const trades: DetailedStrategyTrade[] = [];
  const equityCurve: EquityPoint[] = [];

  let cash = initialCapital;
  let peakEquity = initialCapital;
  let maxDrawdownPct = 0;

  const benchmarkStartPrice = closes[period];

  let i = period;
  while (i < candles.length) {
    const currentDrawdown = peakEquity > 0 ? ((peakEquity - cash) / peakEquity) * 100 : 0;
    if (currentDrawdown > maxDrawdownPct) maxDrawdownPct = currentDrawdown;
    const benchmarkVal =
      benchmarkStartPrice > 0 ? initialCapital * (closes[i] / benchmarkStartPrice) : initialCapital;

    equityCurve.push({
      date: dates[i],
      equity: Math.round(cash),
      benchmark: Math.round(benchmarkVal),
      drawdownPct: Number(currentDrawdown.toFixed(2)),
    });

    // Check if bar i is a Signal Bar
    const priorHigh = Math.max(...highs.slice(i - period, i));
    const priorLow = Math.min(...lows.slice(i - period, i));

    const isBuySignal = direction !== "sell" && lows[i] <= priorLow * (1 - extensionPct / 100);
    const isSellSignal = direction !== "buy" && highs[i] >= priorHigh * (1 + extensionPct / 100);

    if (!isBuySignal && !isSellSignal) {
      i++;
      continue;
    }

    const sigType: "BUY" | "SELL" = isBuySignal ? "BUY" : "SELL";
    const triggerPrice = sigType === "BUY" ? highs[i] : lows[i];
    const initialStop = sigType === "BUY" ? lows[i] : highs[i];

    // Look for confirmation within confBars forward
    let entryBar = -1;
    let entryFillPrice = 0;
    const maxConfBar = Math.min(i + confBars, candles.length - 1);

    for (let k = i + 1; k <= maxConfBar; k++) {
      if (sigType === "BUY") {
        if (highs[k] >= triggerPrice) {
          entryBar = k;
          entryFillPrice = opens[k] > triggerPrice ? opens[k] : triggerPrice;
          break;
        }
      } else {
        if (lows[k] <= triggerPrice) {
          entryBar = k;
          entryFillPrice = opens[k] < triggerPrice ? opens[k] : triggerPrice;
          break;
        }
      }
    }

    if (entryBar === -1) {
      i++;
      continue;
    }

    const plannedRisk = Math.abs(triggerPrice - initialStop);
    if (plannedRisk <= 0) {
      i++;
      continue;
    }

    // Targets are anchored to the planned entry trigger (signal bar extreme), per empirical dataset
    const target1Price = Number(
      (sigType === "BUY" ? triggerPrice + target1R * plannedRisk : triggerPrice - target1R * plannedRisk).toFixed(2),
    );
    const target2Price = Number(
      (sigType === "BUY" ? triggerPrice + target2R * plannedRisk : triggerPrice - target2R * plannedRisk).toFixed(2),
    );
    const stopLossPrice = Number(initialStop.toFixed(2));

    let t1Hit = false;
    let exitBar = -1;
    let exitPrice = 0;
    let resultType: KkResultType = "TIME_EXIT";
    let exitReason: DetailedStrategyTrade["exitReason"] = "strategy";

    // Trade window is 5 sessions after entry day
    const maxTradeBar = Math.min(entryBar + tradeBars, candles.length - 1);

    for (let m = entryBar; m <= maxTradeBar; m++) {
      if (m > entryBar) {
        const currentPnl =
          sigType === "BUY"
            ? ((closes[m] - entryFillPrice) / entryFillPrice) * 100
            : ((entryFillPrice - closes[m]) / entryFillPrice) * 100;
        const currentVal = cash * (1 + currentPnl / 100);
        if (currentVal > peakEquity) peakEquity = currentVal;
        const dd = peakEquity > 0 ? ((peakEquity - currentVal) / peakEquity) * 100 : 0;
        if (dd > maxDrawdownPct) maxDrawdownPct = dd;
        const bench =
          benchmarkStartPrice > 0 ? initialCapital * (closes[m] / benchmarkStartPrice) : initialCapital;
        equityCurve.push({
          date: dates[m],
          equity: Math.round(currentVal),
          benchmark: Math.round(bench),
          drawdownPct: Number(dd.toFixed(2)),
        });
      }

      if (sigType === "BUY") {
        const slHitThisBar = lows[m] <= stopLossPrice;
        const t1HitThisBar = highs[m] >= target1Price;
        const t2HitThisBar = highs[m] >= target2Price;

        // Same bar policy: "stop_first"
        if (t1Hit) {
          if (slHitThisBar) {
            resultType = "SL_HIT_AFTER_TARGET_1";
            exitReason = "stop_loss";
            exitPrice = stopLossPrice;
            exitBar = m;
            break;
          }
          if (t2HitThisBar) {
            resultType = "TARGET_2_HIT";
            exitReason = "take_profit";
            exitPrice = target2Price;
            exitBar = m;
            break;
          }
        } else {
          if (slHitThisBar) {
            resultType = "SL_HIT";
            exitReason = "stop_loss";
            exitPrice = stopLossPrice;
            exitBar = m;
            break;
          } else if (t2HitThisBar && t1HitThisBar) {
            resultType = "TARGET_2_HIT";
            exitReason = "take_profit";
            exitPrice = target2Price;
            exitBar = m;
            break;
          } else if (t1HitThisBar) {
            t1Hit = true;
          }
        }
      } else {
        const slHitThisBar = highs[m] >= stopLossPrice;
        const t1HitThisBar = lows[m] <= target1Price;
        const t2HitThisBar = lows[m] <= target2Price;

        if (t1Hit) {
          if (slHitThisBar) {
            resultType = "SL_HIT_AFTER_TARGET_1";
            exitReason = "stop_loss";
            exitPrice = stopLossPrice;
            exitBar = m;
            break;
          }
          if (t2HitThisBar) {
            resultType = "TARGET_2_HIT";
            exitReason = "take_profit";
            exitPrice = target2Price;
            exitBar = m;
            break;
          }
        } else {
          if (slHitThisBar) {
            resultType = "SL_HIT";
            exitReason = "stop_loss";
            exitPrice = stopLossPrice;
            exitBar = m;
            break;
          } else if (t2HitThisBar && t1HitThisBar) {
            resultType = "TARGET_2_HIT";
            exitReason = "take_profit";
            exitPrice = target2Price;
            exitBar = m;
            break;
          } else if (t1HitThisBar) {
            t1Hit = true;
          }
        }
      }

      if (m === maxTradeBar) {
        exitBar = m;
        exitPrice = closes[m];
        resultType = t1Hit ? "TARGET_1_HIT_TIME_EXIT" : "TIME_EXIT";
        exitReason = m === candles.length - 1 ? "end_of_period" : "strategy";
        break;
      }
    }

    // Exact empirical realized R and PnL calculation matching kk_eod_results_fixed.json
    const rT1 =
      sigType === "BUY"
        ? (target1Price - entryFillPrice) / plannedRisk
        : (entryFillPrice - target1Price) / plannedRisk;
    const rExit =
      sigType === "BUY"
        ? (exitPrice - entryFillPrice) / plannedRisk
        : (entryFillPrice - exitPrice) / plannedRisk;

    const realizedR =
      t1Hit && resultType !== "SL_HIT"
        ? target1Fraction * rT1 + (1 - target1Fraction) * rExit
        : rExit;

    const pnlT1 =
      sigType === "BUY"
        ? ((target1Price - entryFillPrice) / entryFillPrice) * 100
        : ((entryFillPrice - target1Price) / entryFillPrice) * 100;
    const pnlExit =
      sigType === "BUY"
        ? ((exitPrice - entryFillPrice) / entryFillPrice) * 100
        : ((entryFillPrice - exitPrice) / entryFillPrice) * 100;

    const tradePnlPct =
      t1Hit && resultType !== "SL_HIT"
        ? target1Fraction * pnlT1 + (1 - target1Fraction) * pnlExit
        : pnlExit;

    const tradeReturnOnCapital = cash * (tradePnlPct / 100);
    cash = Math.max(0, cash + tradeReturnOnCapital);
    if (cash > peakEquity) peakEquity = cash;

    trades.push({
      entryDate: dates[entryBar],
      entryPrice: Number(entryFillPrice.toFixed(2)),
      exitDate: dates[exitBar],
      exitPrice: Number(exitPrice.toFixed(2)),
      pnlPct: Number(tradePnlPct.toFixed(2)),
      barsHeld: Math.max(1, exitBar - entryBar + 1),
      isWin: tradePnlPct > 0,
      exitReason,
      returnOnCapital: Number(tradeReturnOnCapital.toFixed(2)),
      resultType,
      realizedR: Number(realizedR.toFixed(3)),
      signalType: sigType,
      target1Price,
      target2Price,
      stopLossPrice,
    });

    i = allowOverlapping ? i + 1 : exitBar + 1;
  }

  const finalCapital = cash;
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

/** Detailed quantitative simulation with customizable indicators, risk rules, and equity curve */
export function simulateCustomStrategy(
  candles: Candle[],
  params: AdvancedStrategyParams,
): DetailedStrategyResult | null {
  const type = params.type || "sma_cross";
  if (type === "kk_breakout") {
    return simulateKkStrategy(candles, params);
  }

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
          buyTrigger = r1 < rsiOversold && r0 >= rsiOversold;
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
            exitTrigger = r1 > rsiOverbought && r0 <= rsiOverbought;
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

  if (type === "kk_breakout") {
    const period = params.kkPeriod ?? 20;
    const extPct = params.kkExtensionPct ?? 1.0;
    const confBars = params.kkConfirmationBars ?? 5;
    const tradeBars = params.kkTradeWindowBars ?? 5;
    const t1R = params.kkTarget1R ?? 0.75;
    const t2R = params.kkTarget2R ?? 2.0;

    return `//@version=5
strategy("QuantsPulse KK Asymmetric Breakout: ${symbol}", overlay=true, margin_long=100, default_qty_type=strategy.percent_of_equity, default_qty_value=100)

lookbackPeriod = input.int(${period}, "Lookback Period", minval=5)
extensionPct = input.float(${extPct}, "Extension Threshold %", minval=0.1, step=0.1)
confWindow = input.int(${confBars}, "Confirmation Window Bars", minval=1, maxval=15)
maxHoldBars = input.int(${tradeBars}, "Max Trade Holding Bars", minval=1, maxval=20)
t1_R = input.float(${t1R}, "Target 1 (R Multiple)", step=0.25)
t2_R = input.float(${t2R}, "Target 2 (R Multiple)", step=0.25)

highestHigh = ta.highest(high[1], lookbackPeriod)
lowestLow = ta.lowest(low[1], lookbackPeriod)

// 20-bar exhaustion signals
buySignal = low <= lowestLow * (1.0 - extensionPct / 100.0)

var float buyTrigger = na
var float buyStop = na
var int signalAge = 0

if (buySignal and strategy.position_size == 0)
    buyTrigger := high
    buyStop := low
    signalAge := 0
else if (not na(buyTrigger))
    signalAge := signalAge + 1
    if (signalAge > confWindow or strategy.position_size > 0)
        buyTrigger := na
        buyStop := na

// Breakout confirmation entry
buyConfirm = not na(buyTrigger) and (high >= buyTrigger) and strategy.position_size == 0

if (buyConfirm)
    strategy.entry("Long", strategy.long)

var float entryP = na
var float slP = na
var float t1P = na
var float t2P = na
var int barsInTrade = 0

if (ta.change(strategy.position_size) > 0)
    entryP := strategy.position_avg_price
    slP := buyStop
    risk = entryP - slP
    t1P := entryP + t1_R * risk
    t2P := entryP + t2_R * risk
    barsInTrade := 0

if (strategy.position_size > 0)
    barsInTrade := barsInTrade + 1
    // Scale out 50% at Target 1 (+0.75R)
    strategy.exit("T1", "Long", qty_percent=50, limit=t1P)
    // Exit remaining at Target 2 (+2.0R) or Stop Loss (-1.0R)
    strategy.exit("T2/SL", "Long", limit=t2P, stop=slP)
    // Enforce 5-bar time exit
    if (barsInTrade >= maxHoldBars)
        strategy.close("Long", comment="5d Time Exit")
`;
  }

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

export const DEFAULT_KK_PARAMS: AdvancedStrategyParams = {
  type: "kk_breakout",
  kkPeriod: 20,
  kkExtensionPct: 1.0,
  kkConfirmationBars: 5,
  kkTradeWindowBars: 5,
  kkTarget1R: 0.75,
  kkTarget2R: 2.0,
  kkTarget1Fraction: 0.5,
  kkDirection: "buy",
  kkAllowOverlapping: false,
  initialCapital: 100000,
};

/**
 * Generates verified chart markers (entry, targets, stop-loss, and time exits)
 * from the KK 20-bar extreme breakout strategy for direct candlestick chart overlay.
 */
export function generateKkChartMarkers(
  candles: Candle[],
  params?: Partial<AdvancedStrategyParams>,
): RawChartMarker[] {
  if (!candles || candles.length < 35) return [];

  const res = simulateKkStrategy(candles, {
    ...DEFAULT_KK_PARAMS,
    kkDirection: "both",
    kkAllowOverlapping: true,
    ...params,
  });

  if (!res || !res.trades.length) return [];

  const markers: RawChartMarker[] = [];
  const dateToTsMap = new Map<string, string>();
  for (const c of candles) {
    const d = String(c.ts).slice(0, 10);
    if (!dateToTsMap.has(d)) dateToTsMap.set(d, c.ts);
  }

  for (const t of res.trades) {
    const entryTs = dateToTsMap.get(t.entryDate) ?? t.entryDate;
    const exitTs = dateToTsMap.get(t.exitDate) ?? t.exitDate;
    const isBuy = t.signalType !== "SELL";

    // 1. Entry Marker
    markers.push({
      ts: entryTs,
      kind: isBuy ? "buy" : "exit",
      label: isBuy ? "KK 20d Breakout Buy" : "KK 20d Breakdown Sell",
      strategy: "kk_breakout",
      price: t.entryPrice,
      stop: t.stopLossPrice,
      target1: t.target1Price,
      target2: t.target2Price,
      barsHeld: t.barsHeld,
    });

    // 2. Exit / Target Marker (skip if currently active in-progress bar)
    if (t.exitReason !== "end_of_period") {
      let exitLabel = isBuy ? "KK Exit" : "KK Cover";
      if (t.resultType === "TARGET_2_HIT") {
        exitLabel = isBuy ? "KK Target 2 (+2.0R)" : "KK Target 2 Cover (+2.0R)";
      } else if (t.resultType === "TARGET_1_HIT_TIME_EXIT") {
        exitLabel = isBuy ? "KK T1 (+0.75R) + Time Exit" : "KK T1 Cover + Time Exit";
      } else if (t.resultType === "SL_HIT_AFTER_TARGET_1") {
        exitLabel = isBuy ? "KK T1 (+0.75R) + SL Hit" : "KK T1 Cover + SL Hit";
      } else if (t.resultType === "SL_HIT") {
        exitLabel = isBuy ? "KK Stop Loss (-1.0R)" : "KK Stop Loss Cover";
      } else {
        exitLabel = isBuy ? "KK 5-Day Time Exit" : "KK 5-Day Time Cover";
      }

      markers.push({
        ts: exitTs,
        kind: isBuy ? "exit" : "buy",
        label: exitLabel,
        strategy: "kk_breakout",
        price: t.exitPrice,
        stop: t.stopLossPrice,
        target1: t.target1Price,
        target2: t.target2Price,
        realizedR: t.realizedR,
        pnlPct: t.pnlPct,
        resultType: t.resultType,
        barsHeld: t.barsHeld,
      });
    }
  }

  return markers;
}

