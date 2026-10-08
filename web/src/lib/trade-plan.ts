/**
 * Quantitative Trade Plan & Capital-Constrained Position Sizing Calculations.
 * Conforms to industry-standard asymmetric R-multiples and fixed-fractional sizing
 * with strict cash constraint protection (prevents overleveraged exposure).
 */

export interface TradePlanInput {
  entry: number;
  stop: number;
  lastPrice?: number;
}

export interface TradePlanResult {
  entry: number;
  stop: number;
  riskPerShare: number;
  riskPercent: number;
  t1: number; // 0.75R
  t2: number; // 2.00R
  t3: number; // 3.00R
  isValid: boolean;
}

export interface PositionSizeInput {
  capital: number;
  riskPct: number;
  entry: number;
  stop: number;
}

export interface PositionSizeResult {
  units: number;
  exposure: number;
  exposurePct: number;
  maxLoss: number;
  gainT1: number;
  gainT2: number;
  gainT3: number;
  isCappedByCash: boolean;
  riskBudget: number;
}

export type SentimentZone = "sentiment_peak" | "overbought" | "momentum" | "equilibrium" | "oversold";

export interface SentimentResult {
  zone: SentimentZone;
  label: string;
  sub: string;
  node: number;
  tone: "gain" | "loss" | "neutral";
}

export type TargetStatus =
  | "t3_hit"
  | "t2_hit"
  | "t1_hit"
  | "in_progress"
  | "stop_breached"
  | "invalid";

export interface SignalProgressResult {
  plan: TradePlanResult;
  progressR: number | null;
  targetStatus: TargetStatus;
  statusLabel: string;
  statusTone: "gain" | "loss" | "neutral";
  sentiment: SentimentResult | null;
}

/**
 * Calculates asymmetric trade plan targets based on entry and stop reference.
 * Multiples: T1 = +0.75R, T2 = +2.0R, T3 = +3.0R.
 */
export function calculateTradePlan(input: TradePlanInput): TradePlanResult {
  const entry = Number(input.entry) || 0;
  const stop = Number(input.stop) || 0;

  if (entry <= 0 || stop <= 0 || stop >= entry) {
    return {
      entry,
      stop,
      riskPerShare: 0,
      riskPercent: 0,
      t1: entry,
      t2: entry,
      t3: entry,
      isValid: false,
    };
  }

  const riskPerShare = entry - stop;
  const riskPercent = (riskPerShare / entry) * 100;

  const t1 = Number((entry + 0.75 * riskPerShare).toFixed(2));
  const t2 = Number((entry + 2.0 * riskPerShare).toFixed(2));
  const t3 = Number((entry + 3.0 * riskPerShare).toFixed(2));

  return {
    entry,
    stop,
    riskPerShare,
    riskPercent,
    t1,
    t2,
    t3,
    isValid: true,
  };
}

/**
 * Capital-constrained position sizing.
 * Fixes prototype issue where tight stops resulted in 300%+ capital exposure.
 * Final units = min(floor(riskBudget / riskPerShare), floor(capital / entry)).
 */
export function calculatePositionSize(input: PositionSizeInput): PositionSizeResult {
  const capital = Math.max(0, Number(input.capital) || 0);
  const riskPct = Math.max(0, Number(input.riskPct) || 0);
  const entry = Number(input.entry) || 0;
  const stop = Number(input.stop) || 0;

  const riskBudget = (capital * riskPct) / 100;

  if (capital <= 0 || entry <= 0 || stop <= 0 || stop >= entry || riskBudget <= 0) {
    return {
      units: 0,
      exposure: 0,
      exposurePct: 0,
      maxLoss: 0,
      gainT1: 0,
      gainT2: 0,
      gainT3: 0,
      isCappedByCash: false,
      riskBudget,
    };
  }

  const riskPerShare = entry - stop;
  const rawUnits = Math.floor(riskBudget / riskPerShare);
  const cashMaxUnits = Math.floor(capital / entry);
  const isCappedByCash = rawUnits > cashMaxUnits;
  const units = Math.max(0, Math.min(rawUnits, cashMaxUnits));

  const plan = calculateTradePlan({ entry, stop });
  const exposure = units * entry;
  const exposurePct = capital > 0 ? (exposure / capital) * 100 : 0;
  const maxLoss = units * riskPerShare;
  const gainT1 = units * (plan.t1 - entry);
  const gainT2 = units * (plan.t2 - entry);
  const gainT3 = units * (plan.t3 - entry);

  return {
    units,
    exposure,
    exposurePct,
    maxLoss,
    gainT1,
    gainT2,
    gainT3,
    isCappedByCash,
    riskBudget,
  };
}

/**
 * Classifies RSI (14) into actionable quantitative exhaustion and momentum zones.
 */
export function evaluateSentiment(rsi: number | null | undefined): SentimentResult | null {
  if (rsi == null || Number.isNaN(rsi)) return null;

  if (rsi >= 80) {
    return {
      zone: "sentiment_peak",
      label: "Sentiment Peak",
      sub: "Extreme overbought exhaustion (Node 3). Probability of pullback elevated.",
      node: 3,
      tone: "loss",
    };
  }
  if (rsi >= 70) {
    return {
      zone: "overbought",
      label: "Overbought Zone",
      sub: "RSI above 70 threshold (Node 2). Momentum mature, watch for reversal signals.",
      node: 2,
      tone: "loss",
    };
  }
  if (rsi >= 60) {
    return {
      zone: "momentum",
      label: "Momentum Expansion",
      sub: "Healthy upward trend continuation (Alpha Target Node 1).",
      node: 1,
      tone: "gain",
    };
  }
  if (rsi <= 30) {
    return {
      zone: "oversold",
      label: "Oversold Accumulation",
      sub: "Deeply oversold (RSI ≤ 30). Mean-reversion setup potential.",
      node: 0,
      tone: "gain",
    };
  }
  return {
    zone: "equilibrium",
    label: "Equilibrium",
    sub: "RSI in balanced range (30–60). Trend follows moving average alignment.",
    node: 0,
    tone: "neutral",
  };
}

/**
 * Evaluates real-time progress of a trade signal against its asymmetric plan targets (0.75R, 2.0R, 3.0R),
 * its stop boundary, and the current RSI sentiment node.
 */
export function evaluateSignalProgress(
  entry: number,
  stop: number,
  lastPrice: number | null | undefined,
  rsi: number | null | undefined,
): SignalProgressResult {
  const plan = calculateTradePlan({
    entry,
    stop,
    lastPrice: lastPrice ?? undefined,
  });
  const sentiment = evaluateSentiment(rsi);

  if (!plan.isValid) {
    return {
      plan,
      progressR: null,
      targetStatus: "invalid",
      statusLabel: "Invalid Stop",
      statusTone: "neutral",
      sentiment,
    };
  }

  if (lastPrice == null || lastPrice <= 0) {
    return {
      plan,
      progressR: null,
      targetStatus: "in_progress",
      statusLabel: "Awaiting close",
      statusTone: "neutral",
      sentiment,
    };
  }

  const progressR = Number(
    ((lastPrice - entry) / plan.riskPerShare).toFixed(2),
  );

  if (lastPrice >= plan.t3) {
    return {
      plan,
      progressR,
      targetStatus: "t3_hit",
      statusLabel: "T3 (+3.0R)",
      statusTone: "gain",
      sentiment,
    };
  }

  if (lastPrice >= plan.t2) {
    return {
      plan,
      progressR,
      targetStatus: "t2_hit",
      statusLabel: "T2 (+2.0R)",
      statusTone: "gain",
      sentiment,
    };
  }

  if (lastPrice >= plan.t1) {
    return {
      plan,
      progressR,
      targetStatus: "t1_hit",
      statusLabel: "T1 (+0.75R)",
      statusTone: "gain",
      sentiment,
    };
  }

  if (lastPrice <= plan.stop) {
    return {
      plan,
      progressR,
      targetStatus: "stop_breached",
      statusLabel: "Stop Breached",
      statusTone: "loss",
      sentiment,
    };
  }

  return {
    plan,
    progressR,
    targetStatus: "in_progress",
    statusLabel:
      progressR >= 0 ? `+${progressR.toFixed(1)}R` : `${progressR.toFixed(1)}R`,
    statusTone: progressR >= 0 ? "neutral" : "loss",
    sentiment,
  };
}

export interface QuantumAuditItem {
  symbol: string;
  entryBase: number;
  entryDate?: string | null;
  lastPrice: number;
  rsi: number | null | undefined;
  pnlPct: number;
  sentiment: SentimentResult | null;
  plan: TradePlanResult;
  actionGuidance: string;
  source?: "holding" | "radar";
}

/**
 * Conducts a quantitative audit of a holding or watched stock against its entry base,
 * asymmetric targets, and real-time sentiment exhaustion node.
 */
export function auditStockSentiment(params: {
  symbol: string;
  entryBase: number;
  entryDate?: string | null;
  lastPrice: number;
  rsi?: number | null;
  stop?: number | null;
  source?: "holding" | "radar";
}): QuantumAuditItem {
  const entry = params.entryBase > 0 ? params.entryBase : params.lastPrice;
  const stop =
    params.stop && params.stop < entry
      ? params.stop
      : Number((entry * 0.95).toFixed(2));

  const plan = calculateTradePlan({
    entry,
    stop,
    lastPrice: params.lastPrice,
  });

  const sentiment = evaluateSentiment(params.rsi);
  const pnlPct =
    entry > 0
      ? Number((((params.lastPrice - entry) / entry) * 100).toFixed(2))
      : 0;

  let actionGuidance =
    "Stable position within equilibrium range (RSI 30–60). Trend follows moving averages.";

  if (sentiment?.zone === "sentiment_peak") {
    actionGuidance =
      "Extreme overbought exhaustion (RSI ≥ 80). Elevated pullback probability; scale out partial gains and trail stop.";
  } else if (sentiment?.zone === "overbought") {
    actionGuidance =
      "Momentum mature (RSI ≥ 70). Approaching exhaustion node; tighten stop protection.";
  } else if (sentiment?.zone === "momentum") {
    actionGuidance =
      "Healthy upward trend expansion (RSI 60–69). Momentum continuation toward Targets 2 and 3.";
  } else if (sentiment?.zone === "oversold") {
    actionGuidance =
      "Oversold accumulation (RSI ≤ 30). Potential mean-reversion setup; monitor for stabilization.";
  }

  return {
    symbol: params.symbol,
    entryBase: entry,
    entryDate: params.entryDate,
    lastPrice: params.lastPrice,
    rsi: params.rsi,
    pnlPct,
    sentiment,
    plan,
    actionGuidance,
    source: params.source,
  };
}


