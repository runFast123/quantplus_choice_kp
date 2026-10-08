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

export interface StrategyResult {
  trades: StrategyTrade[];
  totalTrades: number;
  winRatePct: number;
  totalReturnPct: number;
  maxDrawdownPct: number;
  profitFactor: number;
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
