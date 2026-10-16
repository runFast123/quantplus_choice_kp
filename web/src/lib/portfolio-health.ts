/**
 * Quantitative Portfolio Health & Risk Analysis Engine.
 * Computes deterministic institutional risk metrics:
 * - Herfindahl-Hirschman Index (HHI) & Effective Number of Holdings (N_eff)
 * - Single-stock & top-3 concentration ratios (CR1, CR3)
 * - Sector exposure vs institutional prudential caps
 * - Technical RSI exhaustion & oversold dispersion
 * - Underwater cost-basis gap analysis
 * - Composite 0-100 Portfolio Health Score
 */

export interface HealthPosition {
  symbol: string;
  quantity: number;
  avgPrice: number;
  lastPrice: number;
  value: number;
  invested?: number;
  totalPnl?: number;
  totalPct?: number;
  sector?: string | null;
  rsi?: number | null;
  changePct?: number | null;
}

export type PortfolioDiagnosticFocus =
  | "comprehensive"
  | "risk_audit"
  | "rebalancing"
  | "tax_cost_basis";

export type ConcentrationRating = "well_diversified" | "moderately_concentrated" | "highly_concentrated";

export type HealthVerdict =
  | "Institutional Grade"
  | "Strong & Balanced"
  | "Moderate Concentration"
  | "High Concentration Risk";

export interface SectorAllocation {
  sector: string;
  value: number;
  weightPct: number;
}

export interface RiskFlag {
  id: string;
  type: "warning" | "caution" | "positive";
  title: string;
  description: string;
  symbol?: string;
}

export interface PortfolioHealthReport {
  totalValue: number;
  totalInvested: number;
  totalPnl: number;
  totalPnlPct: number;
  positionCount: number;
  hhi: number;
  effectiveN: number;
  concentrationRating: ConcentrationRating;
  topHolding: { symbol: string; weightPct: number; value: number } | null;
  top3WeightPct: number;
  sectors: SectorAllocation[];
  topSector: SectorAllocation | null;
  rsiExhaustionCount: number;
  rsiOversoldCount: number;
  underwaterCount: number;
  winnerCount: number;
  loserCount: number;
  scores: {
    diversification: number; // max 30
    sectorBalance: number;   // max 25
    technicalHealth: number; // max 25
    capitalPreservation: number; // max 20
    overall: number;         // 0 - 100
  };
  verdict: HealthVerdict;
  riskFlags: RiskFlag[];
}

export function calculatePortfolioHealth(positions: HealthPosition[]): PortfolioHealthReport {
  if (!positions.length) {
    return {
      totalValue: 0,
      totalInvested: 0,
      totalPnl: 0,
      totalPnlPct: 0,
      positionCount: 0,
      hhi: 0,
      effectiveN: 0,
      concentrationRating: "well_diversified",
      topHolding: null,
      top3WeightPct: 0,
      sectors: [],
      topSector: null,
      rsiExhaustionCount: 0,
      rsiOversoldCount: 0,
      underwaterCount: 0,
      winnerCount: 0,
      loserCount: 0,
      scores: {
        diversification: 0,
        sectorBalance: 0,
        technicalHealth: 0,
        capitalPreservation: 0,
        overall: 0,
      },
      verdict: "High Concentration Risk",
      riskFlags: [],
    };
  }

  let totalValue = 0;
  let totalInvested = 0;

  for (const pos of positions) {
    totalValue += pos.value;
    const inv = pos.invested != null ? pos.invested : pos.quantity * pos.avgPrice;
    totalInvested += inv;
  }

  const totalPnl = totalValue - totalInvested;
  const totalPnlPct = totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0;

  // Position weights & HHI
  const sorted = [...positions].sort((a, b) => b.value - a.value);
  let hhi = 0;
  const sectorMap = new Map<string, number>();
  let rsiExhaustionCount = 0;
  let rsiOversoldCount = 0;
  let underwaterCount = 0;
  let winnerCount = 0;
  let loserCount = 0;
  let deepUnderwaterValue = 0;

  for (const pos of sorted) {
    const weightPct = totalValue > 0 ? (pos.value / totalValue) * 100 : 0;
    hhi += weightPct * weightPct;

    const sectorName = pos.sector || "Other";
    sectorMap.set(sectorName, (sectorMap.get(sectorName) ?? 0) + pos.value);

    if (pos.rsi != null) {
      if (pos.rsi >= 70) rsiExhaustionCount++;
      else if (pos.rsi <= 30) rsiOversoldCount++;
    }

    if (pos.avgPrice > 0) {
      const discountPct = ((pos.avgPrice - pos.lastPrice) / pos.avgPrice) * 100;
      if (discountPct >= 10) underwaterCount++;
      if (discountPct >= 15) deepUnderwaterValue += pos.value;
    }

    const pnl = pos.totalPnl != null ? pos.totalPnl : pos.value - (pos.quantity * pos.avgPrice);
    if (pnl >= 0) winnerCount++;
    else loserCount++;
  }

  const effectiveN = hhi > 0 ? Number((10000 / hhi).toFixed(1)) : 0;

  const concentrationRating: ConcentrationRating =
    hhi < 1500
      ? "well_diversified"
      : hhi <= 2500
        ? "moderately_concentrated"
        : "highly_concentrated";

  const topHolding = sorted.length > 0
    ? {
        symbol: sorted[0].symbol,
        weightPct: totalValue > 0 ? Number(((sorted[0].value / totalValue) * 100).toFixed(1)) : 0,
        value: sorted[0].value,
      }
    : null;

  const top3WeightPct = totalValue > 0
    ? Number(((sorted.slice(0, 3).reduce((acc, p) => acc + p.value, 0) / totalValue) * 100).toFixed(1))
    : 0;

  const sectors: SectorAllocation[] = [...sectorMap.entries()]
    .map(([sector, value]) => ({
      sector,
      value,
      weightPct: totalValue > 0 ? Number(((value / totalValue) * 100).toFixed(1)) : 0,
    }))
    .sort((a, b) => b.value - a.value);

  const topSector = sectors.length > 0 ? sectors[0] : null;

  // 1. Diversification Score (0 - 30)
  let divScore = 0;
  // Breadth (holding count) - 10 pts
  if (positions.length >= 12) divScore += 10;
  else if (positions.length >= 8) divScore += 7;
  else if (positions.length >= 4) divScore += 4;
  else divScore += 1;

  // HHI - 10 pts
  if (hhi < 1200) divScore += 10;
  else if (hhi < 1800) divScore += 8;
  else if (hhi <= 2500) divScore += 5;
  else divScore += 2;

  // Single stock max weight - 10 pts
  const maxWeight = topHolding?.weightPct ?? 100;
  if (maxWeight <= 12) divScore += 10;
  else if (maxWeight <= 20) divScore += 7;
  else if (maxWeight <= 30) divScore += 4;
  else divScore += 1;

  // 2. Sector Balance Score (0 - 25)
  let secScore = 0;
  // Sector count - 10 pts
  if (sectors.length >= 5) secScore += 10;
  else if (sectors.length >= 4) secScore += 8;
  else if (sectors.length >= 3) secScore += 5;
  else secScore += 2;

  // Top sector weight - 15 pts
  const topSecWeight = topSector?.weightPct ?? 100;
  if (topSecWeight <= 25) secScore += 15;
  else if (topSecWeight <= 35) secScore += 11;
  else if (topSecWeight <= 45) secScore += 6;
  else secScore += 2;

  // 3. Technical & Momentum Health (0 - 25)
  let techScore = 0;
  const winRate = positions.length > 0 ? (winnerCount / positions.length) * 100 : 0;
  if (winRate >= 70) techScore += 15;
  else if (winRate >= 50) techScore += 11;
  else if (winRate >= 35) techScore += 7;
  else techScore += 3;

  // Overbought exhaustion penalty
  if (rsiExhaustionCount === 0) techScore += 10;
  else if (rsiExhaustionCount === 1) techScore += 7;
  else if (rsiExhaustionCount === 2) techScore += 4;
  else techScore += 1;

  // 4. Capital Preservation & Loss Containment (0 - 20)
  let presScore = 0;
  const deepUnderwaterPct = totalValue > 0 ? (deepUnderwaterValue / totalValue) * 100 : 0;
  if (deepUnderwaterPct === 0) presScore += 20;
  else if (deepUnderwaterPct <= 10) presScore += 15;
  else if (deepUnderwaterPct <= 25) presScore += 9;
  else presScore += 3;

  const overall = Math.min(100, Math.max(0, divScore + secScore + techScore + presScore));

  let verdict: HealthVerdict = "Moderate Concentration";
  if (overall >= 85) verdict = "Institutional Grade";
  else if (overall >= 70) verdict = "Strong & Balanced";
  else if (overall < 55) verdict = "High Concentration Risk";

  // Generate Risk Flags
  const riskFlags: RiskFlag[] = [];

  if (topHolding && topHolding.weightPct > 20) {
    riskFlags.push({
      id: "single-stock-risk",
      type: "warning",
      symbol: topHolding.symbol,
      title: `High Single-Stock Exposure: ${topHolding.symbol} (${topHolding.weightPct}%)`,
      description: `Single position exceeds the institutional 15% risk threshold. A sharp drawdown in ${topHolding.symbol} will disproportionately impact portfolio NAV.`,
    });
  }

  if (topSector && topSector.weightPct > 35) {
    riskFlags.push({
      id: "sector-concentration",
      type: "warning",
      title: `Sector Concentration: ${topSector.sector} (${topSector.weightPct}%)`,
      description: `Sector allocation exceeds 35%. Vulnerable to sector-specific macro headwinds, regulatory actions, or cyclical rotation.`,
    });
  }

  if (rsiExhaustionCount > 0) {
    riskFlags.push({
      id: "rsi-exhaustion",
      type: "caution",
      title: `RSI Overbought Exhaustion (${rsiExhaustionCount} stock${rsiExhaustionCount > 1 ? "s" : ""})`,
      description: `${rsiExhaustionCount} holding(s) trading above RSI 70. Risk/reward is stretched; review for systematic trimming or profit locking.`,
    });
  }

  if (underwaterCount > 0) {
    riskFlags.push({
      id: "underwater-gap",
      type: "caution",
      title: `Discounted Holdings (${underwaterCount} stock${underwaterCount > 1 ? "s" : ""} >10% below cost)`,
      description: `Positions trading well below entry. Audit technical signals to verify whether to accumulate, hold, or tax-loss harvest.`,
    });
  }

  if (hhi < 1500 && positions.length >= 8) {
    riskFlags.push({
      id: "optimal-breadth",
      type: "positive",
      title: `Optimal Breadth (HHI: ${Math.round(hhi)})`,
      description: `Portfolio maintains strong idiosyncratic risk dispersion across ${positions.length} active holdings (Effective N = ${effectiveN}).`,
    });
  }

  return {
    totalValue,
    totalInvested,
    totalPnl,
    totalPnlPct: Number(totalPnlPct.toFixed(2)),
    positionCount: positions.length,
    hhi: Math.round(hhi),
    effectiveN,
    concentrationRating,
    topHolding,
    top3WeightPct,
    sectors,
    topSector,
    rsiExhaustionCount,
    rsiOversoldCount,
    underwaterCount,
    winnerCount,
    loserCount,
    scores: {
      diversification: divScore,
      sectorBalance: secScore,
      technicalHealth: techScore,
      capitalPreservation: presScore,
      overall,
    },
    verdict,
    riskFlags,
  };
}
